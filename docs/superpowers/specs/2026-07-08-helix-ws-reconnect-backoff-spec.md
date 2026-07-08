# Helix WS Reconnect Backoff Spec

## 背景

本次 `uc-send-1` 排查证明：后端重启后，旧 Tauri/helix 进程里的 WS reader 退出，helix-im 收到 `Tick::Disconnected` 后只标记离线与清理 inflight；driver 没有指数退避重连，也没有把新连接重新注册进 Go hub。HTTP 仍能发送，所以后端能落库与 publish，但 hub 内没有该客户端连接，前端收不到 WS echo。

## 目标

给 `cses-im-server <-> helix` 的 WS transport 层补齐：

- 断线后自动指数退避重连。
- 每次断线、调度、尝试、成功、失败都有结构化日志。
- WS `connect` / `disconnect` / `reconnect` 生命周期必须同时上报 trace，形成可按 traceId/runId 串起来的连接证据。
- 重连成功后替换 transport 路由表，重新进入 hello 握手，再由 helix-im 触发已有 resync 逻辑。
- 保持 `helix-core` / `helix-im` sans-IO，不把网络重连逻辑塞进业务内核。

## 非目标

- 不改 cses-im-server fanout 语义；后端只保留连接生命周期探针。
- 不在 Angular/前端层轮询重连；前端仍只消费 helix 投影。
- 不用 HTTP 成功替代 WS/projection/storage/DOM 证据。
- 不把 cookie/header/body 写入重连日志。
- 不把 cookie/header/body 写入 trace payload；trace 只允许记录 transport_id、action、attempt、delay_ms、reason、error_class、run_id/trace 上下文这类安全字段。

## 当前事实

- `loopforge-tauri-im/src-tauri/src/engine.rs` 只在启动时 `transport.connect().await` 一次。
- `helix-driver-host/src/network.rs` 的 reader 结束时会发送 `Tick::Disconnected`。
- `helix-im/src/module.rs` 的 `Tick::Disconnected` 分支只清理状态，不调度重连。
- `im_reconnect` 只 emit `im:net:reconnect_requested` 控制信号；host dispatch 只把 Emit 交给 event sink，没有消费它。
- `helix-driver-native/docs/design/README.md` 已把 `WS reconnect/backoff` 标为已知缺口。

## 方案

### 分层归属

重连属于 driver/host 边界，不属于 helix-im：

- `helix-driver-host`: 提供通用生命周期事件与可复用退避 supervisor。
- `loopforge-tauri-im/src-tauri`: 提供具体 transport factory，因为这里知道 `Recording<NativeTransport>`、`InstrumentCtx`、WS URL、握手头。
- `helix-im`: 不改；继续只处理 `Connected`、`hello`、`Disconnected` 与业务 resync。
- `cses-im-server`: 不改 fanout；保留 `SetConnObserver` 探针验证 register/unregister/disconnect；允许 `CSES_IM_LISTEN_ADDR` 覆盖运行期监听端口，便于 restart probe 隔离端口验证而不杀已有 `8066` 进程。

### 核心数据流

```text
SharedWsClient reader close/error
  -> Tick::Disconnected(transport_id)
  -> host engine step: helix-im 标记 Disconnected
  -> host engine 同步旁路发 TransportLifecycleEvent::Disconnected
  -> reconnect supervisor 指数退避重建 NativeTransport
  -> connect 成功后经 transport_rx 注册同一个 transport_id 的新 Arc
  -> host engine 替换路由表
  -> NativeTransport connect 发 Tick::Connected + hello frame
  -> helix-im 收 hello，更新 connectionId，按已有逻辑 resync
```

### 退避策略

默认值：

- `initial_delay_ms = 200`
- `max_delay_ms = 10000`
- `multiplier = 2`
- `max_attempts = None`
- 首次断线不立即忙等；先记录 `scheduled`，再按 200ms 起步。

延迟序列：`200ms, 400ms, 800ms, 1600ms, 3200ms, 6400ms, 10000ms...`

### 可观测日志

必须输出以下事件，字段固定：

- `helix.ws.lifecycle disconnected`: `transport_id`, `reason`
- `helix.ws.reconnect scheduled`: `transport_id`, `delay_ms`, `reason`
- `helix.ws.reconnect attempt`: `transport_id`, `attempt`, `delay_ms`
- `helix.ws.reconnect failed`: `transport_id`, `attempt`, `error`, `next_delay_ms`
- `helix.ws.reconnect success`: `transport_id`, `attempt`

### Trace 上报

WS 生命周期必须同时写入 trace / JSONL evidence。事件名与字段固定：

| trace event | 触发点 | 必填字段 |
|---|---|---|
| `helix.ws.connect` | 首次连接尝试 | `transport_id`, `action="connect"`, `attempt=0` |
| `helix.ws.disconnect` | reader close/error 产 `Tick::Disconnected` | `transport_id`, `action="disconnect"`, `reason` |
| `helix.ws.reconnect.schedule` | supervisor 计算下一次退避 | `transport_id`, `action="reconnect_schedule"`, `attempt`, `delay_ms`, `reason` |
| `helix.ws.reconnect.attempt` | supervisor 开始一次重连 | `transport_id`, `action="reconnect_attempt"`, `attempt`, `delay_ms` |
| `helix.ws.reconnect.failed` | 一次重连失败 | `transport_id`, `action="reconnect_failed"`, `attempt`, `error_class`, `next_delay_ms` |
| `helix.ws.reconnect.success` | 新 transport connect 成功并注册回路由表 | `transport_id`, `action="reconnect_success"`, `attempt` |

trace payload 禁止出现 `headers`、`cookieId`、`companyId`、`token`、`body`、`message`、`text`。如需错误信息，只记录 `error_class` / 简短 `error_kind`，不记录可能携带 URL/header 的原始错误全文。

禁止输出：

- cookieId/companyId/header 全文
- HTTP body / WS payload / 消息正文
- token / password / raw DSN

### 验收标准

1. helix host 单测证明 `Tick::Disconnected` 会发出 lifecycle event。
2. reconnect supervisor 单测证明失败两次后按 `200/400` 退避，第三次成功注册 transport。
3. reconnect supervisor 单测证明每个 lifecycle/reconnect 阶段都会调用 trace sink，且 payload 不含敏感字段。
4. loopforge Tauri 构建通过。
5. 手工或脚本化 real-chain：启动 app 后重启 cses-im-server，不重启 Tauri，再跑 `uc-send-1`，应出现后端新 `register` 日志、helix reconnect trace、WDIO 六面全绿。
6. 旧问题的反证成立：不从零启动 Tauri，也能在后端重启后恢复 `scanned=1 / matched=1`。
7. restart probe 不依赖杀掉用户已有 `8066` 进程；默认使用隔离端口 `18066`，退出后恢复 loopforge `dev-local` 配置文件。

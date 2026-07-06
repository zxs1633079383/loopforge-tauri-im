# Loopforge 全局 Trace 方案设计

日期：2026-07-06
状态：approved design draft
范围：本轮只沉淀 loopforge-tauri-im 方案与本仓落点；helix、cses-im-server、mobile 只作为上下游契约边界描述，不在本轮修改。

## 1. 目标

在 loopforge-tauri-im 内建立一套分层 Trace SDK 方案，让一次 IM 动作可以从 PC UI、Tauri IPC、helix 端口边界、HTTP、WS、Tauri event 回到 UI render 全链路串起来。

本设计服务两类问题：

- 运行时排障：知道一次 `im.send(...)` 卡在 Tauri 入站、command 入泵、HTTP、WS 回推、projection、event emit、Angular listen/render 的哪一跳。
- 自动化证据：同一个 trace_id 能同时在 Jaeger 里看拓扑/耗时，在本地 JSONL 里看完整 payload 和 reducer 证据。

本设计不把 trace 混入业务命令 payload、projection schema、DB 业务列。trace context 只通过 header 或 sidecar 传播，trace 诊断数据单独输出到 OTel/JSONL。

## 2. 非目标

- 本轮不改 `/System/Volumes/Data/workspace/rust/helix`。
- 本轮不改 `/System/Volumes/Data/workspace/golang/cses-im-server`。
- 本轮不改 mobile / QuickJS / C++ 仓。
- 不做自动全函数级打点，不扫描每个 helper 生成 span。
- 不以 trace 成败影响业务成败；trace 输出失败必须 fail-soft。

## 3. 设计判断

trace 属于横切基础设施，不属于 IM domain。领域对象是：

- `TraceContext`：trace_id、span_id、traceparent、baggage、corr_key。
- `TraceScope`：一个活跃 span/scope，负责计时、结束、错误记录。
- `TraceEvent`：JSONL 与 OTel event 的统一结构。
- `TracePayloadCapturePolicy`：控制是否记录完整 payload、header、body、frame。

采用的模式：

- Decorator / Middleware：包装 HTTP、WS、Tauri invoke/event 边界。
- Adapter：把同一个 `TraceEvent` 输出到 OTel 和 JSONL。
- Scope / RAII：内部关键执行阶段用 `span_func` 或 `with_span` 包裹。
- Strategy：不同 profile 选择 payload capture 策略和输出 sink。

复杂度：

- span/event 追加为 O(1)。
- payload 捕获为 O(n)，n 为请求体、响应体、WS frame、Tauri payload 大小。
- JSONL append 为 O(n) 写入；后续实现应支持异步队列或大小上限，但本 spec 先固定全量诊断语义。

## 4. 总体架构

全链路分四层。

### 4.1 Trace SDK 层

统一 API：

- `start_root(name, attrs)`：创建根 trace。
- `continue_from_traceparent(traceparent, baggage)`：继承上游 trace。
- `span_boundary(name, attrs)`：边界 span。
- `span_func(name, attrs)` / `with_span(name, fn)`：内部执行流程 span。
- `record_payload(kind, payload)`：记录完整参数、body、frame、event payload。
- `inject_headers(headers)`：向 HTTP/WS 握手注入 `traceparent` / `baggage`。
- `to_jsonl_event()`：生成本地结构化事件。

各仓未来都只消费这套抽象，不应在业务代码里散写 OTel SDK 细节。本轮 loopforge 可先在本仓定义最小版本，后续统一优化时再提炼到共享层。

### 4.2 边界采集层

HTTP、WS、Tauri 是强制边界。每个边界必须产 span 或 event。

- HTTP request / response。
- WS connect / handshake / send / recv / close。
- Tauri invoke 入站 / 出站。
- Tauri event emit / Angular listen。

本设计按用户确认采用全量诊断模式：全环境记录完整请求参数、指定请求头、body、response body、WS frame、Tauri payload。后续安全治理不再阻止记录业务正文，而是通过配置、落点、访问控制和清理策略承担风险。

### 4.3 执行流程 func 层

func 级 trace 指执行流程内部的关键函数/阶段，不是自动覆盖所有函数。

默认关键阶段：

- command accept。
- payload build。
- HTTP effect。
- HTTP reconcile。
- WS ingest。
- gate decision。
- storage persist。
- projection emit。
- Tauri event emit。
- UI render。

临时深挖时，开发者可以用同一个 `span_func` / `with_span` 包任意函数，不另起一套写法。

### 4.4 输出层

OTel/Jaeger 是主链路视图；JSONL 是本地证据视图。

- OTel/Jaeger：查看拓扑、耗时、上下游 span 关系。
- JSONL：保存完整 payload、corr_key、facet/hop，供 reducer 和 e2e 断言。

两者共享 `trace_id`、`span_id`、`parent_span_id`、`corr_key`。

本环境的 OTel 导出端点固定为：

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://opentelemetry-collector.monitoring.svc.cluster.local:4317
```

这是 Collector 的 OTLP gRPC 导出地址；Jaeger Query / checker 读取地址仍由 `JAEGER_QUERY_URL` 单独配置。

## 5. JSONL 落点

所有 JSONL event 日志必须位于 `/tmp` 下，不写入仓库目录。

本设计固定默认落点：

- 现有四面 hop 日志：`/tmp/loopforge/run.jsonl`，由 `HELIX_RUN_JSONL` 覆盖。
- 新 trace event 日志：`/tmp/loopforge-trace/events.jsonl`，建议由 `LOOPFORGE_TRACE_JSONL` 覆盖。
- 每次 e2e run 的归档仍可复制到 `/tmp/loopforge/runs/<run-id>/`，但源日志必须在 `/tmp`。

JSONL 单行结构：

```json
{
  "ts": "2026-07-06T12:00:00.000Z",
  "run_id": "loopforge-...",
  "trace_id": "32hex",
  "span_id": "16hex",
  "parent_span_id": "16hex-or-null",
  "corr_key": "tmp/server/channel/request key",
  "layer": "pc.ui|pc.tauri|helix|cses|mobile",
  "direction": "in|out|internal",
  "name": "pc.tauri.invoke.in",
  "payload": {},
  "result": {},
  "duration_ms": 1,
  "error": null
}
```

写入规则：

- JSONL 创建失败时回退 stdout，并打 warning。
- trace event JSONL 与现有 `run.jsonl` 可以先双写，后续 reducer 可逐步迁移。
- e2e runner 应在启动前清理 `/tmp/loopforge-trace/events.jsonl` 或使用 run-id 分片，避免 stale trace 被误判。

## 6. Span 命名

命名格式：`<端>.<层>.<动作>`。

PC / UI：

- `pc.ui.action`
- `pc.ui.render`

Tauri：

- `pc.tauri.invoke.out`
- `pc.tauri.invoke.in`
- `pc.tauri.command.enqueue`
- `pc.tauri.event.emit`
- `pc.tauri.event.listen`

Helix 边界视角：

- `helix.command.accept`
- `helix.func.<stage>`
- `helix.http.request`
- `helix.http.response`
- `helix.ws.connect`
- `helix.ws.send`
- `helix.ws.recv`
- `helix.storage.persist`
- `helix.event.emit`

cses-im-server 边界视角：

- `cses.http.request`
- `cses.func.<stage>`
- `cses.store.<op>`
- `cses.ws.publish`
- `cses.ws.fanout`
- `cses.ws.deliver`

Mobile 预留：

- `mobile.js.im_send`
- `mobile.core_bridge.call_with_trace`
- `mobile.render`

本仓 runtime checker 可以继续兼容旧名 `pc.tauri.invoke`，但新实现应优先输出方向明确的 `pc.tauri.invoke.out` / `pc.tauri.invoke.in`。

## 7. 采集矩阵

| 层 | 必须 trace 的点 | 记录内容 |
|---|---|---|
| UI action | 用户触发 `im.send(...)` / UI 命令 | action、完整输入、生成的 traceparent、corr_key |
| Tauri invoke out | Angular 调 `invoke(cmd,args,__trace)` 前后 | cmd、完整 args、`__trace`、耗时、结果/错误 |
| Tauri invoke in | Rust `#[tauri::command]` 收到 | cmd、完整入参、traceparent、baggage、反序列化错误 |
| Tauri command enqueue | command 入 pump 前 | tick name、完整 command payload、corr_key |
| HTTP request | 每个 HTTP 出站请求 | method、url、完整 query、指定 header、完整 body |
| HTTP response | 每个 HTTP 响应 | status、完整 header、完整 body、耗时、错误 |
| WS connect | 建连与握手 | url、完整 handshake headers、结果、错误 |
| WS send | 每个 WS 出站帧 | frame bytes/json、action、seq/cursor、corr_key |
| WS recv | 每个 WS 入站帧 | frame bytes/json、action、seq/cursor、corr_key |
| func | 关键内部阶段 | function/stage name、完整输入输出或阶段 payload、耗时、错误 |
| storage | 本地落库 | op、table、key、完整 row/patch 或 test profile 中完整 row |
| projection | event emit | event name、完整 projection payload |
| Tauri event emit | Rust `app.emit("im:__bus__")` | event name、完整 payload、projection type |
| Tauri event listen | Angular listen handler 收到 | event name、完整 payload、handler 结果 |
| UI render | DOM 最终渲染 | msg id/tmp id/channel id、完整 render model、DOM data-* |

## 8. 上下游传播

PC 端是 loopforge 场景的默认 root：

1. Angular 创建 `pc.ui.action`，生成或继承 `traceparent`。
2. `TauriBridgeService.invoke` 通过 `__trace` sidecar 把 trace 带入 Tauri，不进入业务 args。
3. Rust command 边界 normalize trace sidecar，记录 `pc.tauri.invoke.in`。
4. command 入 pump 前记录 `pc.tauri.command.enqueue`。
5. HTTP 出站注入 `traceparent` / `baggage` header。
6. WS 握手注入 `traceparent` / `baggage` header；WS frame payload 被完整记录，但 trace context 不塞业务 frame 字段。
7. Go server 未来从 HTTP/WS header 继承 trace，publish/fanout/deliver 继续同 trace。
8. helix ws recv、projection emit、Tauri event emit、Angular listen/render 继续同一个 trace_id。

如果上游已经传入 trace，则 loopforge 继承上游；如果没有，则 loopforge 创建本地 root。

## 9. 错误与降级

trace 不能影响业务成功率：

- traceparent 非法：记录 warning，业务继续。
- OTel exporter 不可用：记录 warning，业务继续。
- JSONL 写失败：回退 stdout，业务继续。
- payload 过大：本设计语义要求全量记录；实现可在 profile 中配置上限，但启用上限时 gate 需显示标注非全量模式。

测试 profile 是例外：如果明确开启 trace 完整性 gate，缺 span、缺 JSONL event、缺边界 payload 必须 fail。

## 10. 测试与 Gate

本仓 gate 目标：

- 静态边界 gate：`__trace` 只允许出现在边界文件，不能插入业务 command payload。
- 覆盖 gate：HTTP、WS、Tauri invoke/event 的采集点必须存在。
- runtime OTel checker：一次 `im.send(...)` 必须看到 `pc.ui.action -> pc.tauri.invoke.* -> helix.http.request -> cses.http.request -> cses.ws.* -> helix.ws.recv -> pc.ui.render`。
- JSONL checker：同 trace_id 下必须能聚出 Tauri 入站、HTTP 出站、WS 入站、Tauri event 出站、UI render。
- stale 防护：runner 启动前清理 `/tmp/loopforge-trace/events.jsonl` 或指定唯一 run-id 文件。

现有 `scripts/otel-trace-check.mjs` 可以保留 `--self-test` 和 `--input`。新增 checker 应允许读取 `/tmp/loopforge-trace/events.jsonl` 并按 trace_id 校验采集矩阵。

## 11. 本轮实现边界

本轮后续实现只允许考虑 loopforge 文件：

- `src/app/im/**`
- `src-tauri/src/**`
- `crates/helix-driver-instrument/**`
- `scripts/**`
- `docs/**`

不改 helix、cses-im-server、mobile。它们只在本 spec 中作为未来协同契约出现。

## 12. 分阶段计划

Phase 1：本仓 trace event spec 与 JSONL 落点

- 固定 `/tmp/loopforge-trace/events.jsonl`。
- 定义 `TraceEvent` JSONL schema。
- 保留现有 `/tmp/loopforge/run.jsonl` 兼容四面 reducer。

Phase 2：Tauri 全边界

- Angular invoke out。
- Rust command invoke in。
- command enqueue。
- Rust app.emit。
- Angular listen/render。

Phase 3：HTTP / WS 全边界

- HTTP request/response 全量参数记录。
- WS connect/handshake/send/recv/close 全量记录。
- traceparent/baggage header 注入。

Phase 4：func 级工具

- `span_func` / `with_span`。
- 默认覆盖 send round-trip 关键阶段。
- 临时深挖函数可局部加 span。

Phase 5：gate

- OTel checker 更新 span 名。
- JSONL checker 校验 `/tmp/loopforge-trace/events.jsonl`。
- 静态 gate 区分 trace sidecar 边界和全量诊断 payload 记录。

## 13. 风险与取舍

全环境记录完整参数会记录消息正文、cookie、token、业务 body 等敏感内容。该选择满足全量诊断诉求，但不应伪装成默认安全观测。

对应取舍：

- 日志必须默认落 `/tmp`，不进仓库。
- 归档目录仍在 `/tmp/loopforge/runs/**`。
- 未来生产化需要访问控制、保留周期、敏感字段开关和 profile 隔离。
- 静态 gate 不再禁止 trace 文件记录业务正文，但仍应禁止把 `__trace` 写入业务 payload。

## 14. 验收标准

- spec 明确 loopforge 本轮只改本仓，不碰 helix/cses/mobile。
- 所有 JSONL trace event 默认落 `/tmp/loopforge-trace/events.jsonl`。
- 现有 hop JSONL 保持 `/tmp/loopforge/run.jsonl`，不回退到仓库目录作为默认。
- 一次 send trace 能在 Jaeger 和 JSONL 中用同一个 trace_id 关联。
- HTTP、WS、Tauri 边界缺任意一类采集，gate 必须失败。
- func 级工具可覆盖关键阶段，但不要求自动全函数打点。

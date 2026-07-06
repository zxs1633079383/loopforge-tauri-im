# 四仓 Trace OTel 全量可还原设计 Spec

Date: 2026-07-06

## 0. 目标

为 `helix`、`cses-im-server`、`loopforge-tauri-im`、`mobile-qucik-c++` 构建一套低侵入、可独立启停、可复用的 OpenTelemetry Trace 能力。核心验收不是“有日志”，而是同一条 `im.send(...)` 可以在 Jaeger 中稳定还原为一条真实 distributed trace，并且能被 PC 和 mobile 的可执行测试复现。

固定环境：

- OTel Collector endpoint: `http://opentelemetry-collector.monitoring.svc.cluster.local:4317`
- Jaeger UI search URL: `http://192.168.6.66:32281/search?end=1783325369530000&limit=20&lookback=1h&maxDuration&minDuration&service=cses-im-server&start=1783321769530000`
- Jaeger Query API base: `http://192.168.6.66:32281`

## 1. 硬约束

- Trace 不能进入业务 payload、业务 DTO、投影 schema、持久化业务字段。
- `helix-core` 保持 runtime-neutral，不引入 OTel exporter、Tokio runtime、HTTP SDK。
- 各仓独立启停：一个项目关闭 trace 不影响业务，也不阻断其他项目导出 span。
- HTTP / WS 要支持 `inbound` 和 `outbound` 方向标识。
- HTTP capture 支持请求头与请求体，capture 启用时默认规则为全量匹配，并支持 include / exclude 正则。
- WS capture 必须覆盖 action、推送目标 userId / userIds / viewers、payload 全内容。
- 全量内容只进入 debug capture span event 或本地 evidence fixture，不进 memory，不进业务表，不进普通结构化日志。
- 发送消息链路必须同时证明 PC 和 mobile 两端，且证明方式必须是可执行测试，不接受手工看 UI 截图或单次口头观察。

## 2. 当前事实快照

本轮只读扫描到的当前状态：

- `helix` HEAD `dd89b32`：已有 `TraceCarrier`、`TraceHooks`、`CommandTraceQueue`、`helix_command_with_trace`、HTTP traceparent 透传、`scripts/trace-static-gate.sh`。
- `cses-im-server` HEAD `9acde74`：已有 `internal/observability/otel.go`、HTTP trace middleware、Go app/store/WS span、WS envelope `tracing` inject/extract、Pulsar carrier。
- `loopforge-tauri-im` HEAD `0bd2df6`：已有 Angular `TraceContextService`、Tauri invoke `__trace` sidecar、Tauri trace helper、`scripts/otel-trace-check.mjs`、`docs/trace/otel-trace-gate.md`。
- `mobile-qucik-c++` HEAD `d5ca3bd`：已有 JS/C++ `TraceContext.localRoot()`、`CoreBridge::callWithTrace`、QuickJS binding 分离 payload 和 trace、`scripts/trace-static-gate.sh`。本仓当前有较多未跟踪 real-chain report 和已修改根文档，本 Spec 不触碰。

## 3. 设计选择

采用 “Trace Sidecar + Boundary Decorator + Capture Policy”：

- Sidecar 负责跨边界传播 `traceparent` / `baggage`，不污染业务输入。
- Boundary Decorator 负责在 HTTP、WS、Tauri invoke、FFI、Helix host effect、Go handler/store/publisher 等边界开 span。
- Capture Policy 负责决定请求头、请求体、WS payload 是否写入 span event，并做大小上限、正则筛选与敏感字段遮蔽。

拒绝方案：

- 只打普通日志：不能稳定还原父子链，不能让 Jaeger gate 判定完整链路。
- 把 trace 字段塞进 `im.send(...)` 参数：污染 PC/mobile 公共调用面。
- 给每个业务函数手写 OTel SDK：侵入大、难复用、容易遗漏关闭 span。

## 4. 统一 Trace Envelope

跨进程只使用 W3C carrier：

```text
traceparent: 00-<trace_id>-<span_id>-01
baggage: client=loopforge-tauri-im,uc=UC-1.1
```

非 HTTP 边界使用 sidecar：

```json
{
  "__trace": {
    "traceparent": "00-...",
    "baggage": "client=loopforge-tauri-im"
  }
}
```

WS envelope 使用系统级 `tracing` 字段：

```json
{
  "event": "posted",
  "data": {},
  "broadcast": {},
  "tracing": {
    "traceparent": "00-...",
    "baggage": "client=loopforge-tauri-im"
  }
}
```

## 5. Capture Policy

统一配置结构：

```yaml
observability:
  otel:
    enabled: true
    serviceName: "cses-im-server"
    endpoint: "http://opentelemetry-collector.monitoring.svc.cluster.local:4317"
    protocol: "grpc"
    sampler:
      type: "parentbased_traceidratio"
      ratio: 1.0
    capture:
      enabled: true
      maxBodyBytes: 65536
      maxHeaderBytes: 16384
      http:
        headers:
          include: [".*"]
          exclude: []
        requestBody:
          includePath: [".*"]
          excludePath: []
      ws:
        actions:
          include: [".*"]
          exclude: []
        payload:
          include: [".*"]
          exclude: []
      redact:
        headers: ["(?i)^authorization$", "(?i)^cookie$"]
        jsonPaths: ["$.password", "$.token"]
```

语义：

- `capture.enabled=false` 时只记录 span metadata，不记录 full body / payload。
- `capture.enabled=true` 时，include 默认 `.*`，即全量捕获；exclude 先于 include。
- full body / full payload 放入 span event：`http.request.capture`、`ws.payload.capture`，不放普通 attribute，避免高基数污染。
- 超过上限时记录前 `maxBodyBytes` / `maxHeaderBytes`，并加 `capture.truncated=true`、`capture.original_bytes=N`。
- 请求头默认可捕获全部字段名；字段值按 redact 规则遮蔽。用户显式要求的 header 可以通过 include/exclude 正则精细控制。

算法：

- 启动时预编译正则，运行时只做顺序匹配。
- 每次 capture 复杂度为 `O(F * R + B)`：`F` 是字段数，`R` 是规则数，`B` 是被拷贝字节数。
- 空间复杂度受 `maxBodyBytes + maxHeaderBytes` 上限约束。

## 6. 四仓边界与上下游

### 6.1 loopforge-tauri-im

上游：用户点击、Angular component、WDIO real-chain case。

下游：Tauri invoke -> Helix command / FFI host。

必须产出 span：

- `pc.ui.action`
- `pc.tauri.invoke`
- `pc.tauri.command`
- `pc.tauri.app_emit`
- `pc.ui.render`

最低侵入点：

- Angular 只在 bridge 层统一创建 trace sidecar。
- UI service 不接触 `__trace` 字段。
- Tauri command wrapper 只剥离 `__trace` 并传给 Helix command trace queue。

### 6.2 mobile-qucik-c++

上游：QuickJS `im.send(...)`、gtest / real-chain runner。

下游：C++ CoreBridge -> `helix_command_with_trace` -> Helix。

必须产出 span：

- `mobile.js.im_send`
- `mobile.quickjs.call`
- `mobile.cpp.call_with_trace`
- `mobile.ffi.command`
- `mobile.cpp.event_batch`
- `mobile.js.event_drain`
- `mobile.render`

最低侵入点：

- JS facade 内部调用 `TraceContext.localRoot()`，不把 trace 参数暴露给 `im.send(...)` 调用者。
- QuickJS native binding 继续保持 payload 与 trace 两个参数分离。
- C++ 使用 RAII `SpanScope` 或等价 adapter，禁止异常跨 C ABI。

### 6.3 helix

上游：PC Tauri sidecar、mobile FFI sidecar、WS frame tracing。

下游：HTTP to `cses-im-server`、WS receive、storage、event sink。

必须产出 span：

- `helix.command.accept`
- `helix.core.step`
- `helix.storage.persist`
- `helix.event.emit`
- `helix.http.request`
- `helix.ws.recv`
- `helix.port.reply`
- `helix.ffi.batch_flush`

最低侵入点：

- 只扩展 `helix-driver-host` / `helix-driver-ffi` / host app。
- `helix-core` 不知道 OTel；仅由 host effect wrapper 观测 effect。
- 通过 correlation registry 保存 async parent context，HTTP/WS/storage reply 后清理。

### 6.4 cses-im-server

上游：Helix HTTP `traceparent`、WS handshake、Pulsar carrier。

下游：PostgreSQL、Pulsar、Redis、paas-grpc、WS fanout/deliver。

必须产出 span：

- `cses.http.request`
- `cses.handler.create_post`
- `cses.service.create_post`
- `cses.store.create_post`
- `cses.pulsar.produce`
- `cses.pulsar.consume`
- `cses.ws.publish`
- `cses.ws.fanout`
- `cses.ws.deliver`

最低侵入点：

- HTTP middleware 只 extract context、tee request body、恢复 `r.Body`。
- handler / service / store 只通过小型 helper `observability.StartBoundary` 包裹稳定边界函数。
- WS 在 publish / fanout / deliver 边界统一加 span，复用现有 mattermost-style hub，不改变 fanout 语义。

## 7. HTTP 细节

HTTP inbound span 必须记录：

- `trace.direction=inbound`
- `http.method`
- `http.route`
- `http.status_code`
- `user.id`、`company.id` 如果来自已解析 session，不能从 raw cookie 猜。

HTTP outbound span 必须记录：

- `trace.direction=outbound`
- `http.method`
- `url.scheme`
- `url.host`
- `url.path`
- `http.status_code`

Capture event 示例：

```json
{
  "name": "http.request.capture",
  "attributes": {
    "capture.headers_json": "{\"cookieId\":\"444\",\"companyId\":\"64118eebd2b665246b7880eb\"}",
    "capture.body_json": "{\"channelId\":\"ch1\",\"message\":\"hello\"}",
    "capture.truncated": false,
    "capture.rule": "debug-all"
  }
}
```

## 8. WS 细节

WS publish span 必须记录：

- `trace.direction=outbound`
- `ws.action`
- `channel.id`
- `target.user_id` 或 `target.user_ids`
- `viewer.count`
- `payload.bytes`

WS receive span 必须记录：

- `trace.direction=inbound`
- `ws.action`
- `ws.seq`
- `payload.bytes`

Capture event 示例：

```json
{
  "name": "ws.payload.capture",
  "attributes": {
    "ws.action": "posted",
    "target.user_ids_json": "[\"444\",\"678\"]",
    "payload_json": "{\"event\":\"posted\",\"data\":{\"post\":{\"id\":\"p1\"}}}",
    "capture.truncated": false
  }
}
```

## 9. 发送消息完整链路验收

验收命令不暴露 Collector / Jaeger 配置。端点、采样率、capture 规则必须写入各仓脚本读取的 repo-local 配置：

- PC: `loopforge-tauri-im/config/dev-local.json` + `scripts/trace-env.sh`
- Mobile: `mobile-qucik-c++/config/mobile-local.json` + `scripts/trace-env.sh`
- Go: `cses-im-server/config.yaml` 或 Consul KV
- Helix: host profile config 或 FFI host 传入的 trace config

真实运行默认全部开启：

- dev / real-chain profile 中 `observability.otel.enabled=true`。
- dev / real-chain profile 中 `capture.enabled=true`。
- HTTP headers/body 默认 include `.*`，WS action/payload 默认 include `.*`。
- 禁止要求使用者每次在命令行手动传 `OTEL_EXPORTER_OTLP_ENDPOINT` / `JAEGER_QUERY_URL`；脚本内部从配置读取，并允许本地临时 override。

PC 必须可执行：

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
bash scripts/otel-pc-send-trace-smoke.sh
```

Mobile 必须可执行：

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
REAL_CHAIN_CASE=UC-1.1 make real-chain-trace
```

两个 gate 都必须：

- 触发一次真实 `im.send(...)`。
- 从运行输出或 evidence 文件提取 trace id。
- 调 Jaeger Query API：`GET http://192.168.6.66:32281/api/traces/<trace-id>`。
- 断言所有 required span 存在。
- 断言所有 span 属于同一个 trace id。
- 断言顺序满足：client action -> bridge -> helix command -> helix HTTP -> cses HTTP -> cses store -> cses WS publish/fanout/deliver -> helix WS recv -> render。
- 断言 HTTP capture 中至少包含按规则命中的 request headers 和 request body。
- 断言 WS capture 中包含 action、target userId、payload full content。
- 断言 capture disabled profile 下没有 full body / full payload span event。

## 10. 发送消息 Trace 链路铺开展示

### 10.1 PC 完整链路

```text
trace_id=<same 32 hex trace id>

pc.ui.action
  direction=outbound
  attrs: ui.action=im.send, component=ImComposer, temporary_id=<tmp>
  event: ui.input.capture(text length only by default; full text only when capture rule allows)

  -> pc.tauri.invoke
     direction=outbound
     attrs: tauri.command=im_send, payload.bytes=N
     sidecar: __trace.traceparent propagated, business payload unchanged

     -> pc.tauri.command
        direction=inbound
        attrs: tauri.command=im_send, accepted=true
        action: strip __trace, pass TraceCarrier to Helix command queue

        -> helix.command.accept
           direction=inbound
           attrs: helix.command=im.send, trace.source=pc.tauri

           -> helix.core.step
              attrs: tick.kind=command, effects.count=N

              -> helix.storage.persist
                 direction=outbound
                 attrs: storage.tables=message, storage.ops.count=N, temporary_id=<tmp>
                 note: local optimistic message persisted

              -> helix.event.emit
                 direction=outbound
                 attrs: event.name=im:post:sending, payload.bytes=N

              -> helix.http.request
                 direction=outbound
                 attrs: http.method=POST, url.path=/api/cses/posts/create
                 event: http.request.capture(headers/body by regex policy)

                 -> cses.http.request
                    direction=inbound
                    attrs: http.method=POST, http.route=/api/cses/posts/create, user.id=444, company.id=64118eebd2b665246b7880eb
                    event: http.request.capture(headers/body by regex policy)

                    -> cses.handler.create_post
                       attrs: handler.name=create_post, channel.id=<channel>, temporary_id=<tmp>

                       -> cses.service.create_post
                          attrs: service.name=post, operation=create

                          -> cses.store.create_post
                             attrs: db.system=postgresql, db.operation=insert, table=post, rows.affected=1

                          -> cses.ws.publish
                             direction=outbound
                             attrs: ws.action=posted, channel.id=<channel>
                             event: ws.payload.capture(action,target userId/userIds/viewers,payload full content)

                             -> cses.ws.fanout
                                attrs: viewer.count=N, local.count=N, remote.count=N

                                -> cses.ws.deliver
                                   direction=outbound
                                   attrs: user.id=444, connection.id=<conn>
                                   event: ws.payload.capture(payload full content)

                                   -> helix.ws.recv
                                      direction=inbound
                                      attrs: ws.action=posted, ws.seq=<seq>, payload.bytes=N

                                      -> helix.core.step
                                         attrs: tick.kind=inbound, effects.count=N

                                         -> helix.storage.persist
                                            attrs: storage.tables=message/channel_event_cursor, storage.ops.count=N

                                         -> helix.event.emit
                                            attrs: event.name=im:post:received, payload.bytes=N

                                            -> pc.tauri.app_emit
                                               direction=outbound
                                               attrs: event.channel=im:__bus__

                                               -> pc.ui.render
                                                  direction=inbound
                                                  attrs: event.channel=im:post:received, dom.anchor=<message row>
```

PC gate 必须从这条链里证明四件事：

- HTTP capture 看得到请求头和请求体。
- WS capture 看得到 action、推送 userId / userIds / viewers、payload 全内容。
- optimistic `im:post:sending` 和 server echo `im:post:received` 都在同一个 trace。
- DOM/render 不是靠 HTTP 成功推断，而是由 `pc.ui.render` span 和 WDIO evidence 证明。

### 10.2 Mobile 完整链路

```text
trace_id=<same 32 hex trace id>

mobile.js.im_send
  direction=outbound
  attrs: command=im.send, temporary_id=<tmp>, channel.id=<channel>
  action: TraceContext.localRoot() creates trace internally; public im.send(input) has no trace arg

  -> mobile.quickjs.call
     direction=outbound
     attrs: core.command=im_send, payload.bytes=N
     action: native binding keeps payload and trace as separate JSON values

     -> mobile.cpp.call_with_trace
        direction=outbound
        attrs: core.command=im_send, rc=0
        action: CoreBridge::callWithTrace(payload_json, trace_json)

        -> mobile.ffi.command
           direction=outbound
           attrs: ffi.abi=helix_command_with_trace, command=im_send

           -> helix.command.accept
              direction=inbound
              attrs: helix.command=im.send, trace.source=mobile-quickjs

              -> helix.core.step
                 attrs: tick.kind=command, effects.count=N

                 -> helix.storage.persist
                    attrs: storage.tables=message, storage.ops.count=N, temporary_id=<tmp>

                 -> helix.event.emit
                    attrs: event.name=im:post:sending, payload.bytes=N

                 -> helix.http.request
                    direction=outbound
                    attrs: http.method=POST, url.path=/api/cses/posts/create
                    event: http.request.capture(headers/body by regex policy)

                    -> cses.http.request
                       direction=inbound
                       attrs: http.method=POST, http.route=/api/cses/posts/create, user.id=444, company.id=64118eebd2b665246b7880eb
                       event: http.request.capture(headers/body by regex policy)

                       -> cses.handler.create_post
                          attrs: handler.name=create_post, channel.id=<channel>, temporary_id=<tmp>

                          -> cses.service.create_post
                             attrs: service.name=post, operation=create

                             -> cses.store.create_post
                                attrs: db.system=postgresql, db.operation=insert, table=post, rows.affected=1

                             -> cses.ws.publish
                                direction=outbound
                                attrs: ws.action=posted, channel.id=<channel>
                                event: ws.payload.capture(action,target userId/userIds/viewers,payload full content)

                                -> cses.ws.fanout
                                   attrs: viewer.count=N, local.count=N, remote.count=N

                                   -> cses.ws.deliver
                                      direction=outbound
                                      attrs: user.id=444, connection.id=<conn>
                                      event: ws.payload.capture(payload full content)

                                      -> helix.ws.recv
                                         direction=inbound
                                         attrs: ws.action=posted, ws.seq=<seq>, payload.bytes=N

                                         -> helix.core.step
                                            attrs: tick.kind=inbound, effects.count=N

                                            -> helix.storage.persist
                                               attrs: storage.tables=message/channel_event_cursor, storage.ops.count=N

                                            -> helix.event.emit
                                               attrs: event.name=im:post:received, payload.bytes=N

                                               -> mobile.cpp.event_batch
                                                  direction=inbound
                                                  attrs: batch.bytes=N, events.count=N

                                                  -> mobile.js.event_drain
                                                     direction=inbound
                                                     attrs: events.count=N

                                                     -> mobile.render
                                                        direction=inbound
                                                        attrs: event.channel=im:post:received
```

Mobile gate 必须从这条链里证明四件事：

- `im.send(input)` 公共调用面没有 trace 参数。
- QuickJS / C++ / FFI 三层都保持 payload 和 trace 分离。
- HTTP 和 WS capture 都在同一个 trace id 内。
- mobile render 由 real-chain report 的 bus/projection/render evidence 证明，不能只靠 gtest 或 manifest。

## 11. Jaeger Gate Required Spans

PC 必须包含：

```text
pc.ui.action
pc.tauri.invoke
pc.tauri.command
helix.command.accept
helix.core.step
helix.storage.persist
helix.event.emit
helix.http.request
cses.http.request
cses.handler.create_post
cses.service.create_post
cses.store.create_post
cses.ws.publish
cses.ws.fanout
cses.ws.deliver
helix.ws.recv
helix.event.emit
pc.tauri.app_emit
pc.ui.render
```

Mobile 必须包含：

```text
mobile.js.im_send
mobile.quickjs.call
mobile.cpp.call_with_trace
mobile.ffi.command
helix.command.accept
helix.core.step
helix.storage.persist
helix.event.emit
helix.http.request
cses.http.request
cses.handler.create_post
cses.service.create_post
cses.store.create_post
cses.ws.publish
cses.ws.fanout
cses.ws.deliver
helix.ws.recv
helix.event.emit
mobile.cpp.event_batch
mobile.js.event_drain
mobile.render
```

## 12. 实现分层

### Go

新增或扩展：

- `internal/observability/capture.go`：规则结构、正则编译、body/header capture。
- `internal/observability/http_capture.go`：tee request body，恢复 `r.Body`。
- `internal/observability/ws_capture.go`：WS payload event 写入。
- `internal/observability/boundary.go`：`StartBoundary(ctx, name, opts...)`，统一方向、protocol、capture policy。
- `internal/api/trace_middleware.go`：接入 HTTP capture。
- `internal/ws/trace.go`：接入 WS action / target / payload capture。

### Rust / Helix

新增或扩展：

- `helix-driver-host/src/otel.rs`：host-level OTel adapter。
- `helix-driver-host/src/trace.rs`：继续作为 sidecar carrier 和 hooks 抽象。
- `helix-driver-ffi/src/api.rs`：保留 `helix_command_with_trace`，并把 trace context 送入 command queue。
- `scripts/trace-static-gate.sh`：继续禁止 trace 污染 `helix-core` / `helix-im` 业务层。

### Loopforge

新增或扩展：

- `src/app/im/trace-context.service.ts`：支持 debug capture baggage。
- `src/app/im/tauri-bridge.service.ts`：只在 bridge 层注入 `__trace`。
- `src-tauri/src/otel.rs`：初始化 OTel exporter。
- `scripts/trace-env.sh`：读取 repo-local trace 配置，并只在脚本内部导出 Collector / Jaeger 运行时变量。
- `scripts/otel-pc-send-trace-smoke.sh`：真实 PC send trace gate；调用方不需要显式传 endpoint。
- `scripts/otel-trace-check.mjs`：从 count-only 升级为 span 存在 + trace id + ordering + capture event 检查。

### Mobile

新增或扩展：

- `cpp/TraceContext.*`：保持本地 root trace 生成。
- `cpp/OtelRuntime.*`：C++ OTel 初始化和 RAII span。
- `quickjs/bind_mobile_im.cpp`：`im.send(...)` 内部生成 sidecar，调用 `CoreBridge::callWithTrace`。
- `scripts/trace-env.sh`：读取 `config/mobile-local.json`，并只在脚本内部导出 Collector / Jaeger 运行时变量。
- `scripts/real-chain/run-real-chain.mjs`：记录 trace id 和 Jaeger evidence。
- `Makefile`：新增 `real-chain-trace`。

## 13. Test Compensation

每仓最低测试：

- `helix`：Rust unit test 覆盖 trace sidecar parse、command queue FIFO、HTTP traceparent passthrough、WS tracing extract。
- `cses-im-server`：Go unit test 覆盖 capture include/exclude、body restore、redaction、WS target userId/payload capture、disabled profile 不记录 full payload。
- `loopforge-tauri-im`：Angular/Tauri test 覆盖 `__trace` 只在 bridge envelope；WDIO trace smoke 覆盖 PC real send。
- `mobile-qucik-c++`：gtest 覆盖 `TraceContext.localRoot()`、`callWithTrace` 参数分离；real-chain trace 覆盖 mobile send 到 Jaeger full trace。

Collector 不能说 green；只有 Jaeger gate + repo-local test 都通过后，collector 才能把节点标为 green。

## 14. 安全与性能

- dev / real-chain 真实运行 profile 默认全部开启：OTel enabled、capture enabled、HTTP include `.*`、WS include `.*`。
- production profile 默认 metadata + headers allowlist；如需 full body / full WS payload capture，必须通过配置显式开启，且带采样率、TTL、redaction 和 max bytes。
- 脚本必须从 repo-local config 读取 endpoint 与 Jaeger Query base，不把关键端点要求暴露为每次命令行参数。
- OTel exporter 初始化失败必须降级 noop，不影响业务启动。
- Capture 不允许二次读 body 导致 handler 收不到 body。
- Go request body 只在 configured max bytes 内读入；超过上限仍恢复原 body，使业务完整读取。
- WS payload 已经在内存中时只做一次 bounded copy；不要为了 trace 重新 marshal 大对象。
- Regex 编译失败时启动失败或该 capture policy 失效并记录配置错误，不在请求热路径编译 regex。

## 15. 验收定义

完成态必须同时满足：

- 四仓配置指向同一个 Collector endpoint。
- PC / mobile 的 trace smoke 命令无需显式传 endpoint；脚本内部从配置读取。
- PC / mobile 真实运行默认开启 OTel + capture 全量规则。
- PC 和 mobile 都能跑出一个真实 trace id。
- Jaeger Query 能查到该 trace id。
- Gate 断言 required span、父子/顺序、HTTP capture、WS capture 全部通过。
- `scripts/trace-static-gate.sh` 类静态 gate 证明 trace 不进入业务 payload / core / projection。
- Debug evidence 明确区分 HTTP 成功、Go DB 成功、WS push 成功、Helix projection 成功、PC DOM / mobile render 成功。

## 16. Open Decisions

本 Spec 已默认选择：

- dev / real-chain 真实运行默认全部开启，包含 HTTP headers/body 和 WS action/target/payload full capture。
- 命令行不暴露 Collector / Jaeger endpoint；脚本从 repo-local config 读取。
- production profile 推荐 metadata + headers allowlist，除非显式打开 full capture。
- Jaeger gate 使用 Query API base `http://192.168.6.66:32281`，不是 UI `/search` URL。

需要你 review 的唯一产品取舍：

- 是否允许生产环境临时打开 full body / full WS payload capture。如果允许，必须强制 TTL、采样率上限和红线字段遮蔽。

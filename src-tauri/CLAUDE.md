# src-tauri 局部指令（就近优先，根 CLAUDE.md / rules/ 为上位）

> **本 crate 是什么**：LoopForge 的 **Tauri 2 宿主壳**——内嵌真实 helix 引擎（path dep 只读消费 ·
> 零改），最外层 I/O 边界 = Tauri IPC（前端 invoke / `im:__bus__` emit）。是 helix-host-cli 的
> 「有 UI 孪生」：中间 `ExecutionShell + ImModule + ports` 与 host-cli 完全一致，只换最外层边界
> （host-cli = stdin/stdout，本壳 = IPC）。

## 模块布局（src/）

- `lib.rs` —— Tauri builder 装配：tracing init → InstrumentCtx → `.setup()`（block_on `engine::spawn`）→
  manage(AppState) → invoke_handler → run。webdriver plugin + `set_uc` 经 `webdriver` feature 闸。
- `engine.rs` —— helix 引擎装配（host-cli main.rs 同构）：ports 构造 + 身份头 + transport.connect +
  shell.register(ImModule) + 跑 `run_engine_loop_with_transports` + **bus→app.emit 桥**（投影面 tee +
  就绪 probe）。
- `commands.rs` —— `#[tauri::command]`：`im_send`（前端 camel → snake AppCommand 入泵）/ `im_ready`
  （就绪 probe 读）/ `set_uc`（feature 闸）。
- `state.rs` —— `AppState`（manage 注入，无全局 static）+ `ReadinessProbe`。

## 本壳约定（破坏即拒）

1. **helix 引擎零改**：本壳只 `use helix_driver_native::*` 装配，绝不改 helix path dep 源码。
2. **薄壳纪律**：命令只「翻译入参 + 入泵」，业务（落库/出站 HTTP/echo 对账）全在 helix-im。
3. **送 send body 字段对齐 host-cli `cmd_parse::parse_send`**（`{channel_id, temporary_id, text}`）——
   出站 `posts/create` 真源（真机curl真源 §1）由 helix-im handle_send_message 兑现，本壳不臆造 body。
4. **webdriver / set_uc / 录放 = `webdriver` feature 闸（默认开）**：release 出货
   `cargo build --release --no-default-features` 去掉，绝不带 W3C 自动化接口（根 CLAUDE.md §2.4）。
   注：cargo `target.'cfg(debug_assertions)'.dependencies` 不支持依赖选择（实测 warn），故用 feature。
5. **身份头单一真源**：HTTP 全局头 + WS 握手头同源（env 注入，与 host-cli 同 key）；Tauri 壳后续
   改从登录态注入，driver 注入代码不变。

## W1 仪表化现实边界（诚实记录 · 后续集成项）

native `EngineConfig` 字段是**具体** ports（`NativeStorage`/`NativeHttp`/`NativeEventSink`），**非泛型**
→ 不能把 `Recording<P>` 直接塞进引擎（要么改 helix 违零改铁律，要么走 driver-host `BatchSink` 泛型缝
补 ffi 同款装饰 sink）。故 W1 落地的仪表面 = **投影面（facet ②）**：broadcast 消费 loop 在 emit 抵达
`app.emit` 之前 tee 一条 `Facet::Projection` 日志。Transport/Http/Storage/Clock/IdSource 的 Record/Replay
tape（facet ① outbound / ④ storage + 确定性回放）需引擎接受被装饰 port，是后续集成项——见根
`docs/CHECKLIST.md` W1「BatchSink vs EventSink 集成缝」+ integration_todos。

就绪 probe 同理：精确 `inflight==0` 需 Http 装饰器注入引擎；W1 用「bus 静默窗口」近似
（increment 流动后连续无新 bus 事件 → ready），不冒充精确计数（守可证伪）。

## 改动验收

```bash
cargo check -p loopforge-tauri-im                          # 默认（webdriver feature 开）
cargo check -p loopforge-tauri-im --no-default-features    # release 形态（无 webdriver）
```
联调起 app：起 Go 服务端 + `HELIX_COOKIE_ID=<userId> cargo run -p loopforge-tauri-im`（debug → 4445 可连）。

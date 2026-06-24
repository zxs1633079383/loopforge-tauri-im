# helix-driver-instrument

仪表层装饰器（**唯一新缝**）。四面要看的每一面都已是 helix 的一个 port → 用 **Decorator 模式**包现有 port，一处干三件事：**日志 / 金标帧录制 / 回放**。helix 引擎零改（守 HX-C001 sans-IO）。

## 装饰了哪些 port

| port | 模块 | 面/职责 |
|---|---|---|
| `Transport` | `transport.rs` | ① 出站帧 + 入站帧录放 |
| `HttpRequester` | `http.rs` | ① 出站 HTTP body + 响应录放 |
| `EventSink` | `event_sink.rs` | ② 投影 envelope |
| `Storage` | `storage.rs` | ④ DB 落库行（只 tee，不回放） |
| `Clock` | `clock.rs` | 回放确定性（时钟） |
| `IdSource` / `Random` | `id.rs` | 回放确定性（id / jitter） |

## 三种模式

- `Live`：透传真 go + tee 日志。
- `Record`：透传真 go + tee 日志 + 录「go 帧 + 时钟 + id」进 `Tape`。
- `Replay`：不碰网络，出站只 tee 日志（facet ① 仍可断言），入站/响应/时钟/id 从 `Tape` 供。

## 用法（组装根，仅 debug 构建）

```rust
use helix_driver_instrument::{InstrumentCtx, LogSink, Mode, Recording, Tape};

let log = LogSink::to_file("run.jsonl")?;
let ctx = InstrumentCtx::new("run-1", Mode::Record, log, Tape::new());

// 把真实 port 各包一层再交给 engine：
let transport = Recording::new(native_transport, ctx.clone());
let http      = Recording::new(native_http,      ctx.clone());
let event_sink= Recording::new(native_event_sink,ctx.clone());
let storage   = Recording::new(native_storage,   ctx.clone());
let clock     = Recording::new(native_clock,     ctx.clone());
// … engine 跑完后：
ctx.set_uc("UC-send-1");      // 每个 UC 前 set
ctx.save_tape("fixtures/uc-send-1.tape.json")?;   // Record 跑完存金标帧
```

## 锁纪律

`with_tape` / `log` 内只做同步读写，**绝不跨 `.await` 持锁**（装饰器在 async fn 里先取值释放锁，再 await inner）。

## 集成提示

helix-driver-host 泛型引擎对投影面用 `BatchSink`（driver-host 本地 trait），本 crate 装饰 core 的 `EventSink`。组装根需确保投影 emit 经被装饰的 `EventSink`；若引擎只认 `BatchSink`，在 src-tauri 侧补一个 `BatchSink` 同款装饰（driver-host 关注点）。

## 测试

```bash
cargo test -p helix-driver-instrument   # blob/event/tape 单测 + Record→Replay 往返集成测试
```

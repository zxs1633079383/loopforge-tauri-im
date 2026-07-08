# Helix WS Reconnect Backoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `cses-im-server <-> helix` WS transport 补齐指数退避重连、连接生命周期日志与 trace 上报，使后端重启后旧 Tauri/helix 进程无需重启也能重新 register 并收 WS echo。

**Architecture:** 重连放在 driver/host 边界。`helix-driver-host` 只提供通用 lifecycle event 与 reconnect supervisor；`loopforge-tauri-im` 的 Tauri 组装根负责构造 `Recording<NativeTransport>` factory 并把成功重连的新 transport 重新注册进 host transport table。`helix-core` 与 `helix-im` 保持 sans-IO，不承载网络策略。

**Tech Stack:** Rust, Tokio, helix-driver-host pump, helix-driver-native NativeTransport, loopforge Tauri, WebdriverIO real-chain e2e.

## Global Constraints

- 默认中文沟通与报告。
- 不改 `helix-core`。
- 不把重连策略塞进 `helix-im` 业务模块。
- 不记录 cookie/header/body/token/message text。
- WS `connect` / `disconnect` / `reconnect` 生命周期必须上报 trace；trace payload 只允许安全字段：`transport_id`、`action`、`attempt`、`delay_ms`、`reason`、`error_class`、`run_id` / trace 上下文。
- trace / log 禁止出现 `headers`、`cookieId`、`companyId`、`token`、`body`、`message`、`text`。
- 不把 HTTP 成功当 WS/projection/storage/DOM 成功。
- Cargo 纪律：完整模块改完后再跑 `cargo check` / `cargo test`，不要改一行跑一次。
- 现有 dirty worktree 不回滚、不清理、不覆盖用户改动。

---

## File Structure

- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/engine.rs`
  - 增加 `TransportLifecycleEvent` 与 `EngineDeps.transport_lifecycle_tx`，在 pump 看到 `Tick::Disconnected` 时旁路通知 supervisor。
- Create: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/reconnect.rs`
  - 定义 `ReconnectPolicy`、`ReconnectTraceSink`、`ReconnectDelay`、`spawn_reconnect_supervisor`。
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/lib.rs`
  - 导出 reconnect API。
- Test: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/reconnect_supervisor_test.rs`
  - 验证指数退避、trace 上报与成功注册。
- Test: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/transport_lifecycle_test.rs`
  - 验证 `Tick::Disconnected` 会发 lifecycle event。
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-native/src/engine_loop.rs`
  - `EngineConfig::into_deps` 填 `transport_lifecycle_tx: None`，保持旧 API 行为不变。
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-ffi/src/pump.rs`
  - FFI `EngineDeps` 构造点同样填 `transport_lifecycle_tx: None` / `transport_trace_tx: None`，保持旧 API 行为不变。
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/ws_reconnect.rs`
  - loopforge 具体 factory：重建 `Recording<NativeTransport>`，注入 WS URL、握手头、`InstrumentCtx`。
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/engine.rs`
  - 使用 lifecycle channel + reconnect supervisor；保留首次 connect，但首次失败也触发 supervisor；首次 connect 与重连阶段都写安全 trace。
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/lib.rs`
  - 挂载 `mod ws_reconnect;`；当前 Tauri crate 的模块根是 `lib.rs`，`main.rs` 只调用 `loopforge_tauri_im_lib::run()`。
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/Cargo.toml`
  - 将 `helix-core` / `helix-im` / `helix-driver-native` / `helix-driver-host` 的 git rev 统一升级到包含 Task 1/2 的 helix commit `7c8a03730581fd442de2f9b4ec4326697c008ff0`，保持四个 helix crate 同源同 rev。
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/probe-ws-reconnect-uc-send-1.sh`
  - 自动化验证：启动探针版后端、启动 Tauri、重启后端、不重启 Tauri、跑 `uc-send-1`。

## Task 1: Host Lifecycle Event

**Files:**
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/engine.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-native/src/engine_loop.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-ffi/src/pump.rs`
- Test: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/transport_lifecycle_test.rs`

**Interfaces:**
- Produces: `TransportLifecycleEvent::Disconnected { transport_id: TransportId, reason: &'static str }`
- Produces: `EngineDeps.transport_lifecycle_tx: Option<mpsc::UnboundedSender<TransportLifecycleEvent>>`
- Produces: `EngineDeps.transport_trace_tx: Option<mpsc::UnboundedSender<TransportTraceEvent>>`

- [ ] **Step 1: Add lifecycle event type**

Add near `TransportTable` in `engine.rs`:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportLifecycleEvent {
    Disconnected {
        transport_id: TransportId,
        reason: &'static str,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransportTraceEvent {
    pub transport_id: TransportId,
    pub name: &'static str,
    pub action: &'static str,
    pub attempt: Option<u32>,
    pub delay_ms: Option<u64>,
    pub reason: Option<&'static str>,
    pub error_class: Option<String>,
}
```

- [ ] **Step 2: Extend EngineDeps**

Change `EngineDeps` to:

```rust
pub struct EngineDeps<S, H, U, E, C> {
    pub storage: Arc<S>,
    pub http: Arc<H>,
    pub uploader: Arc<U>,
    pub event_sink: Arc<E>,
    pub clock: C,
    pub trace: TraceHooks,
    pub max_http_inflight: usize,
    pub transport_lifecycle_tx: Option<mpsc::UnboundedSender<TransportLifecycleEvent>>,
    pub transport_trace_tx: Option<mpsc::UnboundedSender<TransportTraceEvent>>,
}
```

- [ ] **Step 3: Notify on disconnected tick**

Insert after `let tick = tokio::select! { ... };` and before `trace.on_tick_start(&tick)`:

```rust
if let Tick::Disconnected(transport_id) = &tick {
    if let Some(tx) = &transport_lifecycle_tx {
        tx.send(TransportLifecycleEvent::Disconnected {
            transport_id: *transport_id,
            reason: "reader_closed_or_error",
        })
        .ok();
    }
    if let Some(tx) = &transport_trace_tx {
        tx.send(TransportTraceEvent {
            transport_id: *transport_id,
            name: "helix.ws.disconnect",
            action: "disconnect",
            attempt: None,
            delay_ms: None,
            reason: Some("reader_closed_or_error"),
            error_class: None,
        })
        .ok();
    }
}
```

Because `deps` is destructured today, keep `let transport_lifecycle_tx = deps.transport_lifecycle_tx.clone();` and `let transport_trace_tx = deps.transport_trace_tx.clone();` before destructuring, then use those locals instead of `deps.*`.

- [ ] **Step 4: Update native default deps**

In `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-native/src/engine_loop.rs` and `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-ffi/src/pump.rs`, set:

```rust
transport_lifecycle_tx: None,
transport_trace_tx: None,
```

inside `EngineConfig::into_deps`.

- [ ] **Step 5: Run targeted compile**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/helix
cargo check -p helix-driver-host -p helix-driver-native
```

Expected: both crates compile. Also run `cargo check -p helix-driver-ffi` because `EngineDeps` is public and FFI has a direct struct literal constructor.

## Task 2: Generic Reconnect Supervisor

**Files:**
- Create: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/reconnect.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/lib.rs`
- Test: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/reconnect_supervisor_test.rs`

**Interfaces:**
- Consumes: `TransportLifecycleEvent`
- Produces: `ReconnectPolicy`
- Produces: `ReconnectTraceSink`
- Produces: `spawn_reconnect_supervisor<Tr, Make, Fut>()`

- [ ] **Step 1: Create reconnect module**

Create `reconnect.rs`:

```rust
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use helix_core::effect::TransportId;
use helix_core::ports::Transport;
use tokio::sync::mpsc;

use crate::engine::TransportLifecycleEvent;
use crate::engine::TransportTraceEvent;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReconnectPolicy {
    pub initial_delay: Duration,
    pub max_delay: Duration,
    pub multiplier: u32,
    pub max_attempts: Option<u32>,
}

impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            initial_delay: Duration::from_millis(200),
            max_delay: Duration::from_secs(10),
            multiplier: 2,
            max_attempts: None,
        }
    }
}

impl ReconnectPolicy {
    pub fn delay_for_attempt(&self, attempt: u32) -> Duration {
        let mut delay = self.initial_delay;
        for _ in 1..attempt {
            delay = delay
                .checked_mul(self.multiplier)
                .unwrap_or(self.max_delay)
                .min(self.max_delay);
        }
        delay
    }
}

#[derive(Clone, Default)]
pub struct ReconnectTraceSink {
    tx: Option<mpsc::UnboundedSender<TransportTraceEvent>>,
}

impl ReconnectTraceSink {
    pub fn new(tx: Option<mpsc::UnboundedSender<TransportTraceEvent>>) -> Self {
        Self { tx }
    }

    pub fn emit(&self, event: TransportTraceEvent) {
        if let Some(tx) = &self.tx {
            tx.send(event).ok();
        }
    }
}

pub fn spawn_reconnect_supervisor<Tr, Make, Fut>(
    transport_id: TransportId,
    policy: ReconnectPolicy,
    mut lifecycle_rx: mpsc::UnboundedReceiver<TransportLifecycleEvent>,
    register_tx: mpsc::UnboundedSender<(TransportId, Arc<Tr>)>,
    trace_sink: ReconnectTraceSink,
    mut make_transport: Make,
) -> tokio::task::JoinHandle<()>
where
    Tr: Transport + Send + Sync + 'static,
    Make: FnMut() -> Fut + Send + 'static,
    Fut: Future<Output = Result<Tr, helix_core::PortError>> + Send + 'static,
{
    tokio::spawn(async move {
        while let Some(event) = lifecycle_rx.recv().await {
            let TransportLifecycleEvent::Disconnected {
                transport_id: event_transport_id,
                reason,
            } = event;
            if event_transport_id != transport_id {
                continue;
            }

            tracing::warn!(
                transport_id = transport_id.raw(),
                reason,
                "helix.ws.lifecycle disconnected"
            );

            let mut attempt = 1u32;
            loop {
                if let Some(max_attempts) = policy.max_attempts {
                    if attempt > max_attempts {
                        tracing::error!(
                            transport_id = transport_id.raw(),
                            max_attempts,
                            "helix.ws.reconnect exhausted"
                        );
                        break;
                    }
                }

                let delay = policy.delay_for_attempt(attempt);
                trace_sink.emit(TransportTraceEvent {
                    transport_id,
                    name: "helix.ws.reconnect.schedule",
                    action: "reconnect_schedule",
                    attempt: Some(attempt),
                    delay_ms: Some(delay.as_millis() as u64),
                    reason: Some(reason),
                    error_class: None,
                });
                tracing::info!(
                    transport_id = transport_id.raw(),
                    attempt,
                    delay_ms = delay.as_millis() as u64,
                    reason,
                    "helix.ws.reconnect scheduled"
                );
                tokio::time::sleep(delay).await;
                trace_sink.emit(TransportTraceEvent {
                    transport_id,
                    name: "helix.ws.reconnect.attempt",
                    action: "reconnect_attempt",
                    attempt: Some(attempt),
                    delay_ms: Some(delay.as_millis() as u64),
                    reason: None,
                    error_class: None,
                });
                tracing::info!(
                    transport_id = transport_id.raw(),
                    attempt,
                    delay_ms = delay.as_millis() as u64,
                    "helix.ws.reconnect attempt"
                );

                match make_transport().await {
                    Ok(transport) => {
                        if register_tx
                            .send((transport_id, Arc::new(transport)))
                            .is_err()
                        {
                            tracing::warn!(
                                transport_id = transport_id.raw(),
                                "helix.ws.reconnect success_but_engine_closed"
                            );
                        } else {
                            trace_sink.emit(TransportTraceEvent {
                                transport_id,
                                name: "helix.ws.reconnect.success",
                                action: "reconnect_success",
                                attempt: Some(attempt),
                                delay_ms: None,
                                reason: None,
                                error_class: None,
                            });
                            tracing::info!(
                                transport_id = transport_id.raw(),
                                attempt,
                                "helix.ws.reconnect success"
                            );
                        }
                        break;
                    }
                    Err(error) => {
                        let next_delay = policy.delay_for_attempt(attempt + 1);
                        trace_sink.emit(TransportTraceEvent {
                            transport_id,
                            name: "helix.ws.reconnect.failed",
                            action: "reconnect_failed",
                            attempt: Some(attempt),
                            delay_ms: None,
                            reason: None,
                            error_class: Some(classify_port_error(&error)),
                        });
                        tracing::warn!(
                            transport_id = transport_id.raw(),
                            attempt,
                            error = %error,
                            next_delay_ms = next_delay.as_millis() as u64,
                            "helix.ws.reconnect failed"
                        );
                        attempt += 1;
                    }
                }
            }
        }
    })
}

fn classify_port_error(error: &helix_core::PortError) -> String {
    match error {
        helix_core::PortError::Transport(_) => "transport".to_string(),
        helix_core::PortError::Http(_) => "http".to_string(),
        helix_core::PortError::Storage(_) => "storage".to_string(),
        helix_core::PortError::Clock(_) => "clock".to_string(),
        helix_core::PortError::IdSource(_) => "id_source".to_string(),
        helix_core::PortError::Other(_) => "other".to_string(),
    }
}
```

- [ ] **Step 2: Export module**

In `lib.rs`:

```rust
pub mod reconnect;
pub use reconnect::{spawn_reconnect_supervisor, ReconnectPolicy, ReconnectTraceSink};
```

- [ ] **Step 3: Add policy unit test**

Add in `tests/reconnect_supervisor_test.rs`:

```rust
use std::time::Duration;

use helix_driver_host::ReconnectPolicy;

#[test]
fn reconnect_policy_uses_capped_exponential_delays() {
    let policy = ReconnectPolicy {
        initial_delay: Duration::from_millis(200),
        max_delay: Duration::from_secs(10),
        multiplier: 2,
        max_attempts: None,
    };

    assert_eq!(policy.delay_for_attempt(1), Duration::from_millis(200));
    assert_eq!(policy.delay_for_attempt(2), Duration::from_millis(400));
    assert_eq!(policy.delay_for_attempt(3), Duration::from_millis(800));
    assert_eq!(policy.delay_for_attempt(10), Duration::from_secs(10));
}
```

- [ ] **Step 4: Run host reconnect tests**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/helix
cargo test -p helix-driver-host reconnect_policy_uses_capped_exponential_delays
```

Expected: PASS.

- [ ] **Step 5: Add trace emission test**

Add in `tests/reconnect_supervisor_test.rs`:

```rust
use helix_core::effect::TransportId;
use helix_driver_host::engine::TransportTraceEvent;
use helix_driver_host::ReconnectTraceSink;
use tokio::sync::mpsc;

#[test]
fn reconnect_trace_sink_emits_safe_payload_shape() {
    let (tx, mut rx) = mpsc::unbounded_channel::<TransportTraceEvent>();
    let sink = ReconnectTraceSink::new(Some(tx));
    sink.emit(TransportTraceEvent {
        transport_id: TransportId::from_raw(7),
        name: "helix.ws.reconnect.schedule",
        action: "reconnect_schedule",
        attempt: Some(2),
        delay_ms: Some(400),
        reason: Some("reader_closed_or_error"),
        error_class: None,
    });

    let event = rx.try_recv().expect("trace event");
    assert_eq!(event.transport_id, TransportId::from_raw(7));
    assert_eq!(event.name, "helix.ws.reconnect.schedule");
    assert_eq!(event.action, "reconnect_schedule");
    assert_eq!(event.attempt, Some(2));
    assert_eq!(event.delay_ms, Some(400));
    assert_eq!(event.reason, Some("reader_closed_or_error"));
    assert!(event.error_class.is_none());
}
```

## Task 3: Loopforge Transport Factory And Supervisor Wiring

**Files:**
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/ws_reconnect.rs`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/engine.rs`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/lib.rs`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `ReconnectPolicy`, `spawn_reconnect_supervisor`
- Produces: `make_recording_transport(...) -> Result<Recording<NativeTransport>, PortError>`

- [ ] **Step 0: Pin loopforge to the helix reconnect commit**

In `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/Cargo.toml`, set all four helix git dependencies to:

```toml
rev = "7c8a03730581fd442de2f9b4ec4326697c008ff0"
```

Update the nearby comment to:

```toml
# 当前 pin: helix 7c8a037（WS lifecycle trace + reconnect supervisor）。
```

Expected: all four helix deps stay same-rev. Do not leave a mixed `helix-core` / `helix-driver-host` rev set.

- [ ] **Step 1: Create factory module**

Create `ws_reconnect.rs`:

```rust
use helix_core::effect::TransportId;
use helix_core::ports::Transport;
use helix_core::PortError;
use helix_driver_instrument::{InstrumentCtx, Recording};
use helix_driver_native::NativeTransport;
use tokio::sync::mpsc;

pub async fn connect_recording_transport(
    ws_url: String,
    transport_id: TransportId,
    tick_tx: mpsc::Sender<helix_core::Tick>,
    ws_headers: Vec<(String, String)>,
    ctx: InstrumentCtx,
) -> Result<Recording<NativeTransport>, PortError> {
    let mut transport = NativeTransport::new(ws_url, transport_id, Some(tick_tx))
        .with_handshake_headers(ws_headers);
    transport.connect().await?;
    Ok(Recording::new(transport, ctx))
}
```

- [ ] **Step 2: Register module**

In the Tauri crate module root:

```rust
mod ws_reconnect;
```

- [ ] **Step 3: Wire lifecycle channel in engine assembly**

In `src-tauri/src/engine.rs`, replace the empty transport registration channel with:

```rust
let (transport_tx, transport_rx) =
    mpsc::unbounded_channel::<(TransportId, Arc<Recording<NativeTransport>>)>();
let (transport_lifecycle_tx, transport_lifecycle_rx) =
    mpsc::unbounded_channel::<helix_driver_host::engine::TransportLifecycleEvent>();
let (transport_trace_tx, mut transport_trace_rx) =
    mpsc::unbounded_channel::<helix_driver_host::engine::TransportTraceEvent>();
```

Then pass `transport_lifecycle_tx` and `transport_trace_tx` through `EngineDeps` when constructing the host engine dependencies. If the current code calls `run_engine_loop_with_transports`, introduce a local helper in `engine.rs` that calls `helix_driver_host::engine::run_engine_loop` directly with `EngineDeps { transport_lifecycle_tx: Some(transport_lifecycle_tx), transport_trace_tx: Some(transport_trace_tx), ... }`.

- [ ] **Step 4: Bridge transport trace events into loopforge trace JSONL**

Spawn a task in `engine.rs`:

```rust
let trace_ctx = ctx.clone();
tokio::spawn(async move {
    while let Some(event) = transport_trace_rx.recv().await {
        let mut payload = serde_json::json!({
            "transport_id": event.transport_id.raw(),
            "action": event.action,
        });
        if let Some(attempt) = event.attempt {
            payload["attempt"] = serde_json::json!(attempt);
        }
        if let Some(delay_ms) = event.delay_ms {
            payload["delay_ms"] = serde_json::json!(delay_ms);
        }
        if let Some(reason) = event.reason {
            payload["reason"] = serde_json::json!(reason);
        }
        if let Some(error_class) = event.error_class {
            payload["error_class"] = serde_json::json!(error_class);
        }
        trace_ctx.trace(
            event.name,
            "helix",
            helix_driver_instrument::TraceDirection::Out,
            payload,
        );
    }
});
```

- [ ] **Step 5: Spawn supervisor**

After `ws_headers` and `ctx` are ready:

```rust
let reconnect_ws_url = ws_url.clone();
let reconnect_headers = ws_headers.clone();
let reconnect_tick_tx = tick_tx.clone();
let reconnect_ctx = ctx.clone();
helix_driver_host::spawn_reconnect_supervisor(
    main_transport,
    helix_driver_host::ReconnectPolicy::default(),
    transport_lifecycle_rx,
    transport_tx.clone(),
    helix_driver_host::ReconnectTraceSink::new(Some(transport_trace_tx.clone())),
    move || {
        ws_reconnect::connect_recording_transport(
            reconnect_ws_url.clone(),
            main_transport,
            reconnect_tick_tx.clone(),
            reconnect_headers.clone(),
            reconnect_ctx.clone(),
        )
    },
);
```

- [ ] **Step 6: Trace initial connect and trigger supervisor on initial connect failure**

If the initial `transport.connect().await` fails, send:

```rust
transport_trace_tx
    .send(helix_driver_host::engine::TransportTraceEvent {
        transport_id: main_transport,
        name: "helix.ws.connect",
        action: "connect",
        attempt: Some(0),
        delay_ms: None,
        reason: Some("initial_connect_failed"),
        error_class: Some("transport".to_string()),
    })
    .ok();
transport_lifecycle_tx
    .send(helix_driver_host::engine::TransportLifecycleEvent::Disconnected {
        transport_id: main_transport,
        reason: "initial_connect_failed",
    })
    .ok();
```

Expected behavior: app still starts, sends warn on `Effect::Send` while disconnected, and supervisor keeps reconnecting.

## Task 4: Tests And Gates

**Files:**
- Test: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/reconnect_supervisor_test.rs`
- Backend support: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/config/config.go`
- Backend test: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/config/config_test.go`
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/probe-ws-reconnect-uc-send-1.sh`

**Interfaces:**
- Produces: automated proof that backend restart does not require Tauri restart.

- [ ] **Step 1: Run helix driver tests**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/helix
cargo test -p helix-driver-host reconnect
cargo check -p helix-driver-host -p helix-driver-native
```

Expected: all pass.

- [ ] **Step 2: Run loopforge Tauri compile**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
cargo check --manifest-path src-tauri/Cargo.toml --features webdriver
```

Expected: PASS.

- [ ] **Step 3: Create restart probe script**

Create `scripts/probe-ws-reconnect-uc-send-1.sh`.

Requirements:
- Do not kill unknown/user processes on `8066`.
- Run the probe backend on isolated `LOOPFORGE_PROBE_BACKEND_PORT` (default `18066`).
- Let `cses-im-server` honor `CSES_IM_LISTEN_ADDR` as a runtime listen-address override even when other config comes from Consul.
- Temporarily point loopforge `dev-local` endpoints at the probe backend during the script and restore the file on exit.
- Give the probe backend a unique `USER` / `CSES_IM_NODE_ID` so it does not fight an existing local server for Pulsar exclusive subscriptions.
- Assert `helix.ws.reconnect.success`, backend `ws connection lifecycle ... action=register`, and UC-send-1 green both before and after restart.

Skeleton:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="/System/Volumes/Data/workspace/rust/loopforge-tauri-im"
GO_ROOT="/System/Volumes/Data/workspace/golang/cses-im-server"
BACKEND_PORT="${LOOPFORGE_PROBE_BACKEND_PORT:-18066}"
LOG_DIR="/tmp/loopforge/reconnect-probe-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

cd "$GO_ROOT"
go build -o /tmp/cses-im-server-reconnect-probe ./cmd/server

# Start phase 1 on :$BACKEND_PORT, run UC-send-1, stop only this pid,
# start phase 2, wait for reconnect trace + backend register, run UC-send-1 again.
# Full implementation lives in scripts/probe-ws-reconnect-uc-send-1.sh.
env CSES_IM_LISTEN_ADDR=":${BACKEND_PORT}" \
  CSES_IM_NODE_ID="loopforge-reconnect-1" \
  USER="loopforge_reconnect" \
  /tmp/cses-im-server-reconnect-probe > "$LOG_DIR/cses-reconnect-probe-1.log" 2>&1 &
GO_PID=$!

cleanup() {
  kill "$GO_PID" 2>/dev/null || true
}
trap cleanup EXIT
```

- [ ] **Step 4: Run restart probe**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
bash scripts/probe-ws-reconnect-uc-send-1.sh
```

Expected:

```text
helix.ws.reconnect success
helix.ws.reconnect.success
ws connection lifecycle ... action=register
UC-send-1 六面全绿
Spec Files: 1 passed
```

## Task 5: Review Boundaries

**Files:**
- No code changes in this task.

**Interfaces:**
- Produces: reviewer checklist.

- [ ] **Step 1: Confirm changed files stay in allowed boundary**

Run:

```bash
git -C /System/Volumes/Data/workspace/rust/helix diff --name-only
git -C /System/Volumes/Data/workspace/rust/loopforge-tauri-im diff --name-only
```

Expected changed implementation files are limited to host/native driver and loopforge Tauri assembly/script. `helix-core` and `helix-im` source files should not change.

- [ ] **Step 2: Confirm no sensitive logging**

Run:

```bash
rg -n "cookie|token|password|DataSource|message|body|headers" \
  /System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/reconnect.rs \
  /System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/ws_reconnect.rs \
  /System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/engine.rs
```

Expected: no log/trace statement includes raw sensitive fields. Mention of `ws_headers` in factory is allowed only as input to `with_handshake_headers`, not as log or trace output.

- [ ] **Step 3: Final evidence summary**

Collect:

```bash
tail -n 80 /tmp/loopforge/uc-send-1-reconnect-*.log
rg "helix.ws.reconnect|ws connection lifecycle" /tmp/loopforge
```

Expected final summary separates:

- backend register/unregister/disconnect logs
- helix reconnect attempt/success logs
- helix trace events for `connect` / `disconnect` / `reconnect.schedule` / `reconnect.attempt` / `reconnect.success`
- WDIO `uc-send-1` green
- metrics or reducer proof that WS/projection/storage/DOM are green

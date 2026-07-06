# Loopforge Global Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build loopforge-side full-link trace capture for Tauri, HTTP, WS, and key function stages, with OTel-compatible span names and JSONL trace events under `/tmp`.

**Architecture:** Add a loopforge-owned trace event layer beside the existing four-facet hop logger. Tauri/HTTP/WS boundaries emit trace events to `/tmp/loopforge-trace/events.jsonl`, while existing `/tmp/loopforge/run.jsonl` remains the reducer source. Trace context stays sidecar/header-only and never enters business command payloads.

**Tech Stack:** Angular 20 services, Tauri 2 commands/events, Rust `helix-driver-instrument`, Node 22 checker scripts, existing `scripts/gate.sh`, existing GitNexus CLI.

## Global Constraints

- 本轮只改 loopforge-tauri-im；不改 `/System/Volumes/Data/workspace/rust/helix`。
- 本轮不改 `/System/Volumes/Data/workspace/golang/cses-im-server`。
- 本轮不改 mobile / QuickJS / C++ 仓。
- JSONL trace event 默认落点必须是 `/tmp/loopforge-trace/events.jsonl`。
- OTel 导出端点固定为 `OTEL_EXPORTER_OTLP_ENDPOINT=http://opentelemetry-collector.monitoring.svc.cluster.local:4317`；这是 OTLP gRPC Collector 地址，不是 Jaeger Query 读取地址。
- 现有四面 hop 日志继续默认落 `/tmp/loopforge/run.jsonl`。
- `__trace` 只允许作为 Tauri invoke envelope sidecar，不得进入 `Tick::Command` business payload。
- HTTP、WS、Tauri 边界是强制 trace；func 级 trace 是关键执行阶段和按需工具，不做自动全函数扫描。
- 用户选择全量诊断模式：trace event 允许记录完整 HTTP query/header/body、response body、WS frame、Tauri payload。
- trace 失败必须 fail-soft；只有测试 gate 明确要求完整性时才 fail。
- 当前工作区有既有未提交改动；每个任务只 stage 自己的文件，不 stage `AGENTS.md`、`CLAUDE.md`、`src-tauri/Cargo.toml`、`src-tauri/src/engine.rs`、`.claude/skills/` 等无关既有改动。
- 修改既有函数/类/方法前必须运行 GitNexus impact；提交前必须运行 GitNexus detect_changes。

---

## File Structure

- Create `crates/helix-driver-instrument/src/trace_event.rs`
  - Owns `TraceEvent`, `TraceDirection`, `TraceLayer`, `TraceJsonlSink`, `TraceEmitter`, traceparent parsing helpers, and unit tests.
- Modify `crates/helix-driver-instrument/src/lib.rs`
  - Re-export the trace event API.
- Modify `crates/helix-driver-instrument/src/ctx.rs`
  - Add trace emitter storage and helper methods that can emit trace events beside existing hop events.
- Modify `crates/helix-driver-instrument/src/http.rs`
  - Emit `helix.http.request` / `helix.http.response` trace events with full request/response payload.
- Modify `crates/helix-driver-instrument/src/transport.rs`
  - Emit `helix.ws.connect` / `helix.ws.send` / `helix.ws.recv` / `helix.ws.close`.
- Modify `src-tauri/src/lib.rs`
  - Build the trace JSONL sink from `LOOPFORGE_TRACE_JSONL` or `/tmp/loopforge-trace/events.jsonl`.
- Modify `src-tauri/src/state.rs`
  - Keep trace emitter reachable from commands if it is not embedded directly in `InstrumentCtx`.
- Modify `src-tauri/src/trace.rs`
  - Extend sidecar normalization helpers with trace id/span id accessors and Tauri trace event helpers.
- Modify `src-tauri/src/commands.rs`
  - Emit Tauri command ingress events and add a test-only `trace_record_event` command for Angular-side invoke/listen/render evidence.
- Modify `src-tauri/src/engine.rs`
  - Emit Tauri event egress from `spawn_bus_bridge` and ensure HTTP/WS port decorators share the trace emitter.
- Modify `src/app/im/trace-context.service.ts`
  - Add trace id/span id parsing and child span generation helpers.
- Modify `src/app/im/tauri-bridge.service.ts`
  - Emit `pc.tauri.invoke.out`, `pc.tauri.event.listen`, and fail-soft event recording through `trace_record_event`.
- Modify `src/app/im/im-store.service.ts`
  - Use `pc.ui.action` for send/resend and `pc.ui.render` for post render evidence without moving business logic into the shell.
- Create `scripts/trace-jsonl-check.mjs`
  - Validate `/tmp/loopforge-trace/events.jsonl` for required span names under one trace id.
- Modify `scripts/otel-trace-check.mjs`
  - Accept new Tauri span names while retaining old names during migration.
- Modify `scripts/trace-static-gate.sh`
  - Keep sidecar boundary checks, allow trace diagnostics payload capture, and assert trace JSONL default path is under `/tmp`.
- Modify `scripts/run.sh` and `scripts/multi-end-loop.sh`
  - Clear `/tmp/loopforge-trace/events.jsonl` per run and archive it with other `/tmp/loopforge` artifacts.
- Modify `docs/trace/otel-trace-gate.md`
  - Document trace JSONL location and the new checker.

---

### Task 1: Rust Trace Event Core And `/tmp` JSONL Sink

**Files:**
- Create: `crates/helix-driver-instrument/src/trace_event.rs`
- Modify: `crates/helix-driver-instrument/src/lib.rs`
- Modify: `crates/helix-driver-instrument/src/ctx.rs`

**Interfaces:**
- Consumes: existing `LogSink` fail-soft style and `InstrumentCtx::log`.
- Produces:
  - `TraceEvent`
  - `TraceDirection`
  - `TraceJsonlSink::to_file(path: impl AsRef<Path>) -> std::io::Result<Self>`
  - `TraceJsonlSink::in_memory() -> (Self, SharedTraceBuf)`
  - `TraceEmitter::emit(&self, event: TraceEvent)`
  - `TraceEmitter::next_span_id(&self) -> String`
  - `InstrumentCtx::trace(&self, name: &str, layer: &str, direction: TraceDirection, payload: serde_json::Value)`
  - `InstrumentCtx::trace_with_ids(&self, name: &str, layer: &str, direction: TraceDirection, traceparent: Option<&str>, payload: serde_json::Value)`

- [ ] **Step 1: Run GitNexus impact for existing symbols**

Run:

```bash
node .gitnexus/run.cjs impact --repo loopforge-tauri-im InstrumentCtx
node .gitnexus/run.cjs impact --repo loopforge-tauri-im LogSink
```

Expected: report risk before editing. If risk is HIGH or CRITICAL, stop and ask main session for approval.

- [ ] **Step 2: Write failing tests for trace event serialization and `/tmp` path**

Add this test module in new file `crates/helix-driver-instrument/src/trace_event.rs` after the type definitions are introduced as compile targets:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trace_event_serializes_required_schema() {
        let ev = TraceEvent {
            ts: "2026-07-06T12:00:00.000Z".to_string(),
            run_id: "run-1".to_string(),
            trace_id: Some("00000000000000000000000000000001".to_string()),
            span_id: Some("0000000000000002".to_string()),
            parent_span_id: Some("0000000000000001".to_string()),
            corr_key: Some("ch=c1;tmp=t1".to_string()),
            layer: "pc.tauri".to_string(),
            direction: TraceDirection::In,
            name: "pc.tauri.invoke.in".to_string(),
            payload: json!({"cmd":"im_send"}),
            result: json!({"ok":true}),
            duration_ms: Some(3),
            error: None,
        };

        let line = serde_json::to_string(&ev).expect("trace event JSON");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["run_id"], "run-1");
        assert_eq!(parsed["trace_id"], "00000000000000000000000000000001");
        assert_eq!(parsed["span_id"], "0000000000000002");
        assert_eq!(parsed["layer"], "pc.tauri");
        assert_eq!(parsed["direction"], "in");
        assert_eq!(parsed["name"], "pc.tauri.invoke.in");
        assert_eq!(parsed["payload"]["cmd"], "im_send");
    }

    #[test]
    fn sink_writes_jsonl_fail_soft_style() {
        let (sink, buf) = TraceJsonlSink::in_memory();
        let emitter = TraceEmitter::new("run-1", sink);
        emitter.emit(TraceEvent::new(
            "run-1",
            "pc.tauri.invoke.in",
            "pc.tauri",
            TraceDirection::In,
            json!({"cmd":"im_send"}),
        ));

        let lines = buf.lines();
        assert_eq!(lines.len(), 1);
        let parsed: serde_json::Value = serde_json::from_str(&lines[0]).expect("valid JSONL");
        assert_eq!(parsed["name"], "pc.tauri.invoke.in");
        assert_eq!(parsed["payload"]["cmd"], "im_send");
    }

    #[test]
    fn default_trace_jsonl_path_is_tmp() {
        assert_eq!(default_trace_jsonl_path(), "/tmp/loopforge-trace/events.jsonl");
    }
}
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml -p helix-driver-instrument trace_event -- --nocapture
```

Expected: FAIL with unresolved `TraceEvent`, `TraceJsonlSink`, `TraceEmitter`, or `default_trace_jsonl_path`.

- [ ] **Step 4: Implement trace event core**

Create `crates/helix-driver-instrument/src/trace_event.rs` with this implementation shape:

```rust
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub fn default_trace_jsonl_path() -> &'static str {
    "/tmp/loopforge-trace/events.jsonl"
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TraceDirection {
    In,
    Out,
    Internal,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TraceEvent {
    pub ts: String,
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corr_key: Option<String>,
    pub layer: String,
    pub direction: TraceDirection,
    pub name: String,
    pub payload: Value,
    pub result: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl TraceEvent {
    pub fn new(
        run_id: impl Into<String>,
        name: impl Into<String>,
        layer: impl Into<String>,
        direction: TraceDirection,
        payload: Value,
    ) -> Self {
        Self {
            ts: now_utc_millis(),
            run_id: run_id.into(),
            trace_id: None,
            span_id: None,
            parent_span_id: None,
            corr_key: None,
            layer: layer.into(),
            direction,
            name: name.into(),
            payload,
            result: Value::Null,
            duration_ms: None,
            error: None,
        }
    }
}

fn now_utc_millis() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", now.as_secs(), now.subsec_millis())
}

#[derive(Clone)]
pub struct TraceJsonlSink {
    inner: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl TraceJsonlSink {
    pub fn to_writer(w: Box<dyn Write + Send>) -> Self {
        Self { inner: Arc::new(Mutex::new(w)) }
    }

    pub fn to_file(path: impl AsRef<Path>) -> std::io::Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .truncate(false)
            .open(path)?;
        f.set_len(0)?;
        Ok(Self::to_writer(Box::new(f)))
    }

    pub fn in_memory() -> (Self, SharedTraceBuf) {
        let buf = SharedTraceBuf::default();
        (Self::to_writer(Box::new(buf.clone())), buf)
    }

    pub fn emit(&self, ev: &TraceEvent) {
        if let Ok(line) = serde_json::to_string(ev) {
            if let Ok(mut w) = self.inner.lock() {
                let _ = w.write_all(line.as_bytes());
                let _ = w.write_all(b"\n");
                let _ = w.flush();
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct SharedTraceBuf(Arc<Mutex<Vec<u8>>>);

impl SharedTraceBuf {
    pub fn lines(&self) -> Vec<String> {
        let g = self.0.lock().expect("trace buf mutex poisoned");
        String::from_utf8_lossy(&g)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect()
    }
}

impl Write for SharedTraceBuf {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("trace buf mutex poisoned").extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
pub struct TraceEmitter {
    run_id: String,
    sink: TraceJsonlSink,
    seq: Arc<Mutex<u64>>,
}

impl TraceEmitter {
    pub fn new(run_id: impl Into<String>, sink: TraceJsonlSink) -> Self {
        Self { run_id: run_id.into(), sink, seq: Arc::new(Mutex::new(0)) }
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn emit(&self, mut event: TraceEvent) {
        if event.run_id.is_empty() {
            event.run_id = self.run_id.clone();
        }
        self.sink.emit(&event);
    }

    pub fn next_span_id(&self) -> String {
        let mut g = self.seq.lock().expect("trace seq mutex poisoned");
        *g += 1;
        format!("{:016x}", *g)
    }
}
```

Then re-export in `crates/helix-driver-instrument/src/lib.rs`:

```rust
pub mod trace_event;
pub use trace_event::{default_trace_jsonl_path, TraceDirection, TraceEmitter, TraceEvent, TraceJsonlSink};
```

Add trace methods to `InstrumentCtx` by extending `CtxInner`:

```rust
trace: Option<TraceEmitter>,
```

Add constructor and methods:

```rust
pub fn with_trace(mut self, trace: TraceEmitter) -> Self {
    Arc::get_mut(&mut self.inner)
        .expect("with_trace must be called before cloning InstrumentCtx")
        .trace = Some(trace);
    self
}

pub fn trace(
    &self,
    name: &str,
    layer: &str,
    direction: crate::trace_event::TraceDirection,
    payload: Value,
) {
    self.trace_with_ids(name, layer, direction, None, payload);
}

pub fn trace_with_ids(
    &self,
    name: &str,
    layer: &str,
    direction: crate::trace_event::TraceDirection,
    traceparent: Option<&str>,
    payload: Value,
) {
    let Some(emitter) = self.inner.trace.as_ref() else {
        return;
    };
    let mut ev = crate::trace_event::TraceEvent::new(
        emitter.run_id().to_string(),
        name.to_string(),
        layer.to_string(),
        direction,
        payload.clone(),
    );
    ev.corr_key = extract_corr_key(&payload);
    if let Some(tp) = traceparent {
        if let Some((trace_id, parent_span_id)) = parse_traceparent_ids(tp) {
            ev.trace_id = Some(trace_id);
            ev.parent_span_id = Some(parent_span_id);
            ev.span_id = Some(emitter.next_span_id());
        }
    }
    emitter.emit(ev);
}

fn parse_traceparent_ids(traceparent: &str) -> Option<(String, String)> {
    let mut parts = traceparent.trim().split('-');
    let version = parts.next()?;
    let trace_id = parts.next()?;
    let span_id = parts.next()?;
    let flags = parts.next()?;
    if parts.next().is_some()
        || version.len() != 2
        || trace_id.len() != 32
        || span_id.len() != 16
        || flags.len() != 2
    {
        return None;
    }
    Some((trace_id.to_string(), span_id.to_string()))
}
```

- [ ] **Step 5: Run tests and format**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -p helix-driver-instrument trace_event -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml -p helix-driver-instrument log_ipc_in_emits_facet_and_payload -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Run GitNexus detect_changes and commit**

Run:

```bash
node .gitnexus/run.cjs detect_changes --repo loopforge-tauri-im --scope all --limit 30
git add crates/helix-driver-instrument/src/trace_event.rs crates/helix-driver-instrument/src/lib.rs crates/helix-driver-instrument/src/ctx.rs
git commit -m "feat(trace): add loopforge trace jsonl sink"
```

Expected: detect_changes mentions only trace event core and `InstrumentCtx`; commit succeeds.

---

### Task 2: Wire Trace Sink Startup And Tauri Command Ingress

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/trace.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Consumes from Task 1: `TraceJsonlSink`, `TraceEmitter`, `default_trace_jsonl_path`, `InstrumentCtx::trace_with_ids`.
- Produces:
  - `build_trace_emitter(run_id: &str) -> TraceEmitter`
  - `TraceSidecar::trace_id() -> Option<String>`
  - `TraceSidecar::parent_span_id() -> Option<String>`
  - command-side event `pc.tauri.invoke.in`
  - test-only command `trace_record_event(event: serde_json::Value) -> Result<(), String>`

- [ ] **Step 1: Run GitNexus impact**

Run:

```bash
node .gitnexus/run.cjs impact --repo loopforge-tauri-im build_log_sink
node .gitnexus/run.cjs impact --repo loopforge-tauri-im im_send
node .gitnexus/run.cjs impact --repo loopforge-tauri-im normalize_trace_sidecar
```

Expected: report risk. If HIGH or CRITICAL, stop and ask main session for approval.

- [ ] **Step 2: Add failing Rust tests**

In `src-tauri/src/trace.rs`, add tests:

```rust
#[test]
fn trace_sidecar_exposes_trace_ids() {
    let sidecar = TraceSidecar {
        traceparent: "00-00000000000000000000000000000001-0000000000000002-01".to_string(),
        baggage: None,
    }
    .normalized()
    .expect("valid sidecar");

    assert_eq!(
        sidecar.trace_id().as_deref(),
        Some("00000000000000000000000000000001")
    );
    assert_eq!(sidecar.parent_span_id().as_deref(), Some("0000000000000002"));
}
```

In `src-tauri/src/commands.rs` command tests, add:

```rust
#[test]
fn send_payload_still_never_contains_trace_sidecar_after_trace_ingress() {
    let payload = send_payload(
        "c1".to_string(),
        "hello".to_string(),
        "tmp1".to_string(),
        Some("TEXT".to_string()),
    );
    assert!(payload.get("__trace").is_none());
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml trace_sidecar_exposes_trace_ids -- --nocapture
```

Expected: FAIL with missing `trace_id` / `parent_span_id` methods.

- [ ] **Step 4: Implement `/tmp` trace emitter startup**

Modify `src-tauri/src/lib.rs`:

```rust
use helix_driver_instrument::{
    default_trace_jsonl_path, InstrumentCtx, LogSink, Mode, Tape, TraceEmitter, TraceJsonlSink,
};

fn build_trace_emitter(run_id: &str) -> TraceEmitter {
    let path = std::env::var("LOOPFORGE_TRACE_JSONL")
        .unwrap_or_else(|_| default_trace_jsonl_path().to_string());
    let sink = TraceJsonlSink::to_file(&path).unwrap_or_else(|e| {
        tracing::warn!(error = %e, %path, "trace JSONL 创建失败，回退 stdout");
        TraceJsonlSink::to_writer(Box::new(std::io::stdout()))
    });
    TraceEmitter::new(run_id.to_string(), sink)
}
```

Then build ctx with trace:

```rust
let trace = build_trace_emitter(&run_id);
let ctx = InstrumentCtx::new(run_id, mode, build_log_sink(), tape).with_trace(trace);
```

- [ ] **Step 5: Add trace id helpers**

Modify `src-tauri/src/trace.rs`:

```rust
impl TraceSidecar {
    pub fn trace_id(&self) -> Option<String> {
        self.traceparent.split('-').nth(1).map(ToOwned::to_owned)
    }

    pub fn parent_span_id(&self) -> Option<String> {
        self.traceparent.split('-').nth(2).map(ToOwned::to_owned)
    }
}
```

- [ ] **Step 6: Emit `pc.tauri.invoke.in` for `im_send` without changing business payload**

In `im_send`, after successful sidecar normalization, add:

```rust
let normalized_trace = __trace
    .as_ref()
    .and_then(|raw| normalize_trace_sidecar(raw).ok());

state.ctx.trace_with_ids(
    "pc.tauri.invoke.in",
    "pc.tauri",
    helix_driver_instrument::TraceDirection::In,
    normalized_trace.as_ref().map(|t| t.traceparent.as_str()),
    serde_json::json!({
        "cmd": "im_send",
        "args": {
            "channelId": &channel_id,
            "text": &text,
            "temporaryId": &temporary_id,
            "type": &msg_type,
            "__trace": normalized_trace,
        }
    }),
);
```

Keep the existing `send_payload_never_contains_trace_sidecar` test green. The event payload may include `__trace`; the business command payload must not.

- [ ] **Step 7: Add fail-soft `trace_record_event` command for Angular evidence**

Add a webdriver-gated command in `src-tauri/src/commands.rs`:

```rust
#[cfg(feature = "webdriver")]
#[tauri::command]
pub fn trace_record_event(
    state: State<'_, AppState>,
    event: serde_json::Value,
) -> Result<(), String> {
    let name = event
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("pc.trace.event");
    let layer = event
        .get("layer")
        .and_then(|v| v.as_str())
        .unwrap_or("pc.ui");
    let direction = match event.get("direction").and_then(|v| v.as_str()) {
        Some("out") => helix_driver_instrument::TraceDirection::Out,
        Some("internal") => helix_driver_instrument::TraceDirection::Internal,
        _ => helix_driver_instrument::TraceDirection::In,
    };
    let traceparent = event
        .get("traceparent")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned);
    state.ctx.trace_with_ids(name, layer, direction, traceparent.as_deref(), event);
    Ok(())
}
```

Register the command in the existing `tauri::generate_handler!` list in `src-tauri/src/lib.rs` under `#[cfg(feature = "webdriver")]` if the handler list is cfg-split. If it is a single list, add the function with cfg wrapper matching existing debug commands.

- [ ] **Step 8: Run tests**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml trace_sidecar_exposes_trace_ids -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml send_payload_still_never_contains_trace_sidecar_after_trace_ingress -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml --features webdriver
```

Expected: PASS.

- [ ] **Step 9: Run GitNexus detect_changes and commit**

Run:

```bash
node .gitnexus/run.cjs detect_changes --repo loopforge-tauri-im --scope all --limit 30
git add src-tauri/src/lib.rs src-tauri/src/state.rs src-tauri/src/trace.rs src-tauri/src/commands.rs
git commit -m "feat(trace): record tauri command ingress"
```

Expected: commit succeeds with only Task 2 files staged.

---

### Task 3: Angular Invoke, Listen, And Render Trace Events

**Files:**
- Modify: `src/app/im/trace-context.service.ts`
- Modify: `src/app/im/tauri-bridge.service.ts`
- Modify: `src/app/im/im-store.service.ts`

**Interfaces:**
- Consumes from Task 2: `trace_record_event` Tauri command.
- Produces:
  - `TraceContextService.traceId(trace: TraceSidecar): string`
  - `TraceContextService.childTrace(parent: TraceSidecar): TraceSidecar`
  - `TauriBridgeService.recordTraceEvent(event: Record<string, unknown>): Promise<void>`
  - `pc.tauri.invoke.out`
  - `pc.tauri.event.listen`
  - `pc.ui.action`
  - `pc.ui.render`

- [ ] **Step 1: Run GitNexus impact**

Run:

```bash
node .gitnexus/run.cjs impact --repo loopforge-tauri-im TraceContextService
node .gitnexus/run.cjs impact --repo loopforge-tauri-im TauriBridgeService
node .gitnexus/run.cjs impact --repo loopforge-tauri-im ImStoreService
```

Expected: report risk. If HIGH or CRITICAL, stop and ask main session for approval.

- [ ] **Step 2: Add TypeScript tests or compile-time checks**

If the repo has no Angular unit test harness, add a small Node-checkable module test file `src/app/im/trace-context.service.spec.ts` only if Angular test tooling is already configured. If no test runner exists, use `npx tsc --noEmit` as compile coverage and add pure exported helpers in `trace-context.service.ts`.

Add these pure helpers:

```ts
export function traceIdFromTraceparent(traceparent: string): string {
  const parts = traceparent.trim().toLowerCase().split("-");
  if (parts.length !== 4 || parts[1].length !== 32) return "";
  return parts[1];
}

export function parentSpanIdFromTraceparent(traceparent: string): string {
  const parts = traceparent.trim().toLowerCase().split("-");
  if (parts.length !== 4 || parts[2].length !== 16) return "";
  return parts[2];
}
```

- [ ] **Step 3: Implement child span generation**

Modify `src/app/im/trace-context.service.ts`:

```ts
@Injectable({ providedIn: "root" })
export class TraceContextService {
  startTrace(): TraceSidecar {
    const traceId = nonZeroHex(16);
    const spanId = nonZeroHex(8);
    return {
      traceparent: `00-${traceId}-${spanId}-01`,
      baggage: "client=loopforge-tauri-im",
    };
  }

  childTrace(parent: TraceSidecar): TraceSidecar {
    const traceId = traceIdFromTraceparent(parent.traceparent) || nonZeroHex(16);
    const spanId = nonZeroHex(8);
    return {
      traceparent: `00-${traceId}-${spanId}-01`,
      baggage: parent.baggage,
    };
  }

  traceId(trace: TraceSidecar): string {
    return traceIdFromTraceparent(trace.traceparent);
  }
}
```

- [ ] **Step 4: Implement fail-soft trace event recording in bridge**

Modify `src/app/im/tauri-bridge.service.ts`:

```ts
  async recordTraceEvent(event: Record<string, unknown>): Promise<void> {
    if (!this.isTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("trace_record_event", { event });
    } catch {
      // trace must never break business flow
    }
  }
```

Wrap `invoke`:

```ts
    const started = performance.now();
    const envelope = trace ? { ...(args ?? {}), __trace: trace } : args;
    await this.recordTraceEvent({
      name: "pc.tauri.invoke.out",
      layer: "pc.tauri",
      direction: "out",
      traceparent: trace?.traceparent,
      payload: { cmd, args: envelope },
    });
    try {
      const result = await invoke<T>(cmd, envelope);
      await this.recordTraceEvent({
        name: "pc.tauri.invoke.out",
        layer: "pc.tauri",
        direction: "out",
        traceparent: trace?.traceparent,
        payload: { cmd, args: envelope },
        result: { ok: true },
        duration_ms: Math.round(performance.now() - started),
      });
      return result;
    } catch (error) {
      await this.recordTraceEvent({
        name: "pc.tauri.invoke.out",
        layer: "pc.tauri",
        direction: "out",
        traceparent: trace?.traceparent,
        payload: { cmd, args: envelope },
        error: String(error),
        duration_ms: Math.round(performance.now() - started),
      });
      throw error;
    }
```

Wrap `listen` handler:

```ts
    const unlisten = await listen<T>(event, async (e) => {
      await this.recordTraceEvent({
        name: "pc.tauri.event.listen",
        layer: "pc.tauri",
        direction: "in",
        payload: { event, payload: e.payload },
      });
      handler(e.payload);
    });
```

- [ ] **Step 5: Emit UI action/render evidence for send path**

Modify `ImStoreService.send` around the existing `this.traceContext.startTrace()` call:

```ts
    const trace = this.traceContext.startTrace();
    await this.bridge.recordTraceEvent({
      name: "pc.ui.action",
      layer: "pc.ui",
      direction: "out",
      traceparent: trace.traceparent,
      payload: { action: "im.send", channelId, text, temporaryId, type },
    });
    await this.bridge.invoke<void>(
      "im_send",
      { channelId, text, temporaryId, msgType: type },
      trace,
    );
```

In the message apply/render path where `MessageRow` is updated after projection, emit:

```ts
    this.bridge.recordTraceEvent({
      name: "pc.ui.render",
      layer: "pc.ui",
      direction: "internal",
      payload: {
        msgId: row.msgId,
        temporaryId: row.temporaryId,
        channelId: row.channelId,
        status: row.status,
        text: row.text,
      },
    });
```

Use the exact local variable names in the current apply method; do not create a second business model.

- [ ] **Step 6: Run frontend checks**

Run:

```bash
CI=1 NG_BUILD_MAX_WORKERS=1 NG_BUILD_PARALLEL_TS=0 pnpm exec ng build --configuration development
```

Expected: PASS. If esbuild worker hangs, retry the same command once.

- [ ] **Step 7: Commit**

Run:

```bash
node .gitnexus/run.cjs detect_changes --repo loopforge-tauri-im --scope all --limit 30
git add src/app/im/trace-context.service.ts src/app/im/tauri-bridge.service.ts src/app/im/im-store.service.ts
git commit -m "feat(trace): record angular tauri trace events"
```

Expected: commit succeeds.

---

### Task 4: HTTP And WS Boundary Trace Events In Port Decorators

**Files:**
- Modify: `crates/helix-driver-instrument/src/http.rs`
- Modify: `crates/helix-driver-instrument/src/transport.rs`
- Modify: `src-tauri/src/engine.rs`

**Interfaces:**
- Consumes from Task 1: `InstrumentCtx::trace`.
- Produces:
  - `helix.http.request`
  - `helix.http.response`
  - `helix.ws.connect`
  - `helix.ws.send`
  - `helix.ws.recv`
  - `helix.ws.close`

- [ ] **Step 1: Run GitNexus impact**

Run:

```bash
node .gitnexus/run.cjs impact --repo loopforge-tauri-im request
node .gitnexus/run.cjs impact --repo loopforge-tauri-im send
node .gitnexus/run.cjs impact --repo loopforge-tauri-im recv
node .gitnexus/run.cjs impact --repo loopforge-tauri-im connect
```

Expected: report risk. If HIGH or CRITICAL, stop and ask main session for approval.

- [ ] **Step 2: Add failing tests for HTTP trace payload**

Add tests to `crates/helix-driver-instrument/src/http.rs` under `#[cfg(test)]`:

```rust
#[test]
fn http_trace_payload_includes_headers_and_body() {
    let req = HttpRequest {
        method: "POST".to_string(),
        url: "posts/create?debug=1".to_string(),
        headers: vec![("traceparent".to_string(), "00-00000000000000000000000000000001-0000000000000002-01".to_string())],
        body: Some(Bytes::from_static(br#"{"message":"hello"}"#)),
    };
    let payload = req_payload(&req);
    assert_eq!(payload["method"], "POST");
    assert_eq!(payload["url"], "posts/create?debug=1");
    assert_eq!(payload["headers"][0][0], "traceparent");
    assert_eq!(payload["body"]["message"], "hello");
}
```

- [ ] **Step 3: Emit HTTP trace events**

In `crates/helix-driver-instrument/src/http.rs`, before the existing hop log:

```rust
let request_payload = req_payload(&req);
self.ctx.trace(
    "helix.http.request",
    "helix",
    crate::TraceDirection::Out,
    request_payload.clone(),
);
self.ctx.log(Facet::Outbound, Hop::HttpReq, request_payload);
```

After receiving or replaying response:

```rust
let response_payload = serde_json::json!({
    "status": resp.status,
    "body": payload_from_bytes(&resp.body),
});
self.ctx.trace(
    "helix.http.response",
    "helix",
    crate::TraceDirection::In,
    response_payload.clone(),
);
self.ctx.log(Facet::WsRecv, Hop::HttpResp, response_payload);
```

Keep existing record/replay behavior unchanged.

- [ ] **Step 4: Emit WS trace events**

In `crates/helix-driver-instrument/src/transport.rs`, add:

```rust
self.ctx.trace(
    "helix.ws.connect",
    "helix",
    crate::TraceDirection::Out,
    serde_json::json!({"op": "connect", "mode": format!("{:?}", self.ctx.mode())}),
);
```

In `send`:

```rust
let payload = payload_from_bytes(&frame);
self.ctx.trace("helix.ws.send", "helix", crate::TraceDirection::Out, payload.clone());
self.ctx.log(Facet::Outbound, Hop::WsSend, payload);
```

In `recv` when frame exists:

```rust
let payload = payload_from_bytes(b);
self.ctx.trace("helix.ws.recv", "helix", crate::TraceDirection::In, payload.clone());
self.ctx.log(Facet::WsRecv, Hop::WsRecv, payload);
```

In `close`:

```rust
self.ctx.trace(
    "helix.ws.close",
    "helix",
    crate::TraceDirection::Out,
    serde_json::json!({"op": "close"}),
);
```

- [ ] **Step 5: Emit Tauri event egress**

In `src-tauri/src/engine.rs`, find `spawn_bus_bridge` and log before `app.emit`:

```rust
ctx.trace(
    "pc.tauri.event.emit",
    "pc.tauri",
    helix_driver_instrument::TraceDirection::Out,
    serde_json::json!({
        "event": "im:__bus__",
        "payload": payload_from_bytes(&ev.0),
    }),
);
```

If `spawn_bus_bridge` does not currently receive `ctx`, add a cloned `InstrumentCtx` parameter from `engine::spawn`.

- [ ] **Step 6: Run Rust checks**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -p helix-driver-instrument http_trace_payload_includes_headers_and_body -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml --features webdriver
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
node .gitnexus/run.cjs detect_changes --repo loopforge-tauri-im --scope all --limit 30
git add crates/helix-driver-instrument/src/http.rs crates/helix-driver-instrument/src/transport.rs src-tauri/src/engine.rs
git commit -m "feat(trace): record http and ws boundaries"
```

Expected: commit succeeds.

---

### Task 5: Trace JSONL Checker And Runtime Gate Wiring

**Files:**
- Create: `scripts/trace-jsonl-check.mjs`
- Modify: `scripts/otel-trace-check.mjs`
- Modify: `scripts/trace-static-gate.sh`
- Modify: `scripts/gate.sh`

**Interfaces:**
- Consumes: `/tmp/loopforge-trace/events.jsonl`.
- Produces:
  - `node scripts/trace-jsonl-check.mjs --self-test`
  - `node scripts/trace-jsonl-check.mjs --input /tmp/loopforge-trace/events.jsonl --trace-id <id>`
  - updated `scripts/gate.sh` step for trace JSONL checker self-test.

- [ ] **Step 1: Write failing checker self-test**

Create `scripts/trace-jsonl-check.mjs` with a `--self-test` fixture that expects these names:

```js
const requiredNames = [
  "pc.ui.action",
  "pc.tauri.invoke.out",
  "pc.tauri.invoke.in",
  "pc.tauri.command.enqueue",
  "helix.http.request",
  "helix.http.response",
  "helix.ws.recv",
  "pc.tauri.event.emit",
  "pc.tauri.event.listen",
  "pc.ui.render",
];
```

The self-test fixture must include all names under trace id `self-test-trace` and exit 0.

- [ ] **Step 2: Implement checker**

Use this complete shape:

```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";

const requiredNames = [
  "pc.ui.action",
  "pc.tauri.invoke.out",
  "pc.tauri.invoke.in",
  "pc.tauri.command.enqueue",
  "helix.http.request",
  "helix.http.response",
  "helix.ws.recv",
  "pc.tauri.event.emit",
  "pc.tauri.event.listen",
  "pc.ui.render",
];

function usage() {
  return "usage: node scripts/trace-jsonl-check.mjs [--input <jsonl>] [--trace-id <id>] [--self-test]";
}

function parseArgs(argv) {
  const args = { input: "/tmp/loopforge-trace/events.jsonl", traceId: "", selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i] ?? "";
    else if (arg === "--trace-id") args.traceId = argv[++i] ?? "";
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function selfTestLines() {
  return requiredNames.map((name, index) =>
    JSON.stringify({
      ts: "2026-07-06T12:00:00.000Z",
      run_id: "self-test",
      trace_id: "self-test-trace",
      span_id: String(index + 1).padStart(16, "0"),
      parent_span_id: index === 0 ? null : String(index).padStart(16, "0"),
      corr_key: "ch=c1;tmp=t1",
      layer: name.startsWith("pc.") ? "pc" : "helix",
      direction: name.includes(".in") || name.includes(".recv") ? "in" : "out",
      name,
      payload: { marker: name },
      result: {},
      duration_ms: 1,
      error: null,
    }),
  ).join("\n");
}

function parseJsonl(text) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid JSONL line ${index + 1}: ${error.message}`);
      }
    });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.selfTest ? selfTestLines() : readFileSync(args.input, "utf8");
  const events = parseJsonl(text);
  const traceId = args.traceId || events.find((event) => event.trace_id)?.trace_id;
  if (!traceId) throw new Error("trace id is required or must exist in input");

  const scoped = events.filter((event) => event.trace_id === traceId);
  const names = new Set(scoped.map((event) => event.name));
  const missing = requiredNames.filter((name) => !names.has(name));
  if (missing.length > 0) {
    console.error(`trace ${traceId} is missing JSONL events:`);
    for (const name of missing) console.error(`- ${name}`);
    console.error(`observed names: ${[...names].sort().join(", ") || "(none)"}`);
    process.exit(1);
  }
  console.log(`trace ${traceId} contains required JSONL trace events (${scoped.length} events observed)`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}
```

- [ ] **Step 3: Update OTel checker names**

Modify `scripts/otel-trace-check.mjs` client alternatives:

```js
const clientSpanGroups = [
  {
    label: "client action",
    alternatives: ["pc.ui.action", "mobile.js.im_send"],
  },
  {
    label: "client bridge",
    alternatives: ["pc.tauri.invoke", "pc.tauri.invoke.out", "pc.tauri.invoke.in", "mobile.core_bridge.call_with_trace"],
  },
  {
    label: "client render",
    alternatives: ["pc.ui.render", "mobile.render"],
  },
];
```

- [ ] **Step 4: Update static gate**

In `scripts/trace-static-gate.sh`, keep the existing `__trace` allowlist. Replace sensitive payload ban with two checks:

```bash
if rg -n 'default_trace_jsonl_path\(\).*src-tauri/run\.jsonl|LOOPFORGE_TRACE_JSONL.*src-tauri' crates src-tauri scripts >"$RAW_DANGER"; then
  fail "trace JSONL default must stay under /tmp"
  print_hits "$RAW_DANGER"
else
  pass "trace JSONL defaults stay under /tmp"
fi

if rg -n 'payload\[[[:space:]]*["'\'']__trace["'\''][[:space:]]*\][[:space:]]*=|\.insert\([[:space:]]*["'\'']__trace["'\'']' src-tauri/src/commands.rs >"$PAYLOAD_TRACE"; then
  fail "src-tauri/src/commands.rs appears to insert __trace into a business payload"
  print_hits "$PAYLOAD_TRACE"
else
  pass "business payload builders do not insert __trace"
fi
```

Do not fail on `message|text|payload|body` inside trace files because the approved spec requires full diagnostic payload capture.

- [ ] **Step 5: Wire gate self-test**

Add to `scripts/gate.sh` after the current trace static gate:

```bash
step "12b trace JSONL checker self-test"
if node scripts/trace-jsonl-check.mjs --self-test >/tmp/lf-gate-trace-jsonl.log 2>&1; then
  ok "$(cat /tmp/lf-gate-trace-jsonl.log)"
else
  cat /tmp/lf-gate-trace-jsonl.log
  bad "trace JSONL checker self-test 红"
fi
```

- [ ] **Step 6: Run checks**

Run:

```bash
node --check scripts/trace-jsonl-check.mjs
node scripts/trace-jsonl-check.mjs --self-test
node scripts/otel-trace-check.mjs --self-test
bash scripts/trace-static-gate.sh
```

Expected: all PASS.

- [ ] **Step 7: Commit**

Run:

```bash
node .gitnexus/run.cjs detect_changes --repo loopforge-tauri-im --scope all --limit 30
git add scripts/trace-jsonl-check.mjs scripts/otel-trace-check.mjs scripts/trace-static-gate.sh scripts/gate.sh
git commit -m "test(trace): add trace jsonl checker"
```

Expected: commit succeeds.

---

### Task 6: Runner Cleanup, Archiving, And Documentation

**Files:**
- Modify: `scripts/run.sh`
- Modify: `scripts/multi-end-loop.sh`
- Modify: `docs/trace/otel-trace-gate.md`
- Modify: `docs/superpowers/specs/2026-07-06-loopforge-global-trace-design.md` only if implementation changes the chosen env var or path.

**Interfaces:**
- Consumes from Task 5: `scripts/trace-jsonl-check.mjs`.
- Produces:
  - run startup clears `/tmp/loopforge-trace/events.jsonl`
  - archive includes `trace-events.jsonl`
  - docs name `LOOPFORGE_TRACE_JSONL`

- [ ] **Step 1: Run GitNexus impact**

Run:

```bash
node .gitnexus/run.cjs impact --repo loopforge-tauri-im run_wdio
```

Expected: if symbol not found, record that shell scripts are not mapped by GitNexus and continue.

- [ ] **Step 2: Clear trace JSONL on `scripts/run.sh` startup**

Add near the existing `: >"$HELIX_RUN_JSONL"` line:

```bash
TRACE_JSONL="${LOOPFORGE_TRACE_JSONL:-/tmp/loopforge-trace/events.jsonl}"
mkdir -p "$(dirname "$TRACE_JSONL")"
: >"$TRACE_JSONL" 2>/dev/null || true
```

Pass env into app startup:

```bash
"LOOPFORGE_TRACE_JSONL=$TRACE_JSONL" \
```

- [ ] **Step 3: Archive trace JSONL in `scripts/multi-end-loop.sh`**

Add top-level variable:

```bash
TRACE_JSONL="${LOOPFORGE_TRACE_JSONL:-/tmp/loopforge-trace/events.jsonl}"
```

When cleaning run logs:

```bash
mkdir -p "$(dirname "$TRACE_JSONL")"
: >"$TRACE_JSONL" 2>/dev/null || true
```

When copying artifacts:

```bash
copy_if_exists "$TRACE_JSONL" "$spec_dir/trace-events.jsonl"
copy_if_exists "$TRACE_JSONL" "$ARCHIVE_DIR/trace-events.jsonl"
```

- [ ] **Step 4: Update docs**

In `docs/trace/otel-trace-gate.md`, add:

```markdown
## Trace JSONL

Loopforge trace events are written to `/tmp/loopforge-trace/events.jsonl` by default.
Override with:

```bash
LOOPFORGE_TRACE_JSONL=/tmp/loopforge-trace/my-run.jsonl bash scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs
```

Validate the local evidence:

```bash
node scripts/trace-jsonl-check.mjs --input /tmp/loopforge-trace/events.jsonl --trace-id <trace-id>
node scripts/trace-jsonl-check.mjs --self-test
```
```

- [ ] **Step 5: Run checks**

Run:

```bash
bash -n scripts/run.sh
bash -n scripts/multi-end-loop.sh
node scripts/trace-jsonl-check.mjs --self-test
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
node .gitnexus/run.cjs detect_changes --repo loopforge-tauri-im --scope all --limit 30
git add scripts/run.sh scripts/multi-end-loop.sh docs/trace/otel-trace-gate.md docs/superpowers/specs/2026-07-06-loopforge-global-trace-design.md
git commit -m "docs(trace): document trace jsonl runtime flow"
```

Expected: commit succeeds.

---

### Task 7: End-To-End Trace Smoke

**Files:**
- Modify: `scripts/otel-trace-smoke.sh`
- Create: `test/fixtures/trace-jsonl-self-test.jsonl` only if a fixture is useful beyond the self-test.
- No product code changes unless the smoke exposes a missing trace event from Tasks 1-6.

**Interfaces:**
- Consumes:
  - `/tmp/loopforge-trace/events.jsonl`
  - `scripts/trace-jsonl-check.mjs`
  - `scripts/otel-trace-check.mjs`
- Produces:
  - one command path that validates both Jaeger and JSONL when a trace id is available.

- [ ] **Step 1: Extend smoke wrapper**

Modify `scripts/otel-trace-smoke.sh` so after OTel check it runs:

```bash
TRACE_JSONL="${LOOPFORGE_TRACE_JSONL:-/tmp/loopforge-trace/events.jsonl}"
node scripts/trace-jsonl-check.mjs --input "$TRACE_JSONL" --trace-id "$TRACE_ID"
```

Keep Jaeger URL behavior unchanged.

- [ ] **Step 2: Run deterministic smoke tests**

Run:

```bash
bash -n scripts/otel-trace-smoke.sh
node scripts/otel-trace-check.mjs --self-test
node scripts/trace-jsonl-check.mjs --self-test
```

Expected: PASS.

- [ ] **Step 3: Optional live smoke only when services are already running**

Run only if Angular/Tauri/cses-im-server/Jaeger are already up:

```bash
bash scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs
TRACE_ID="$(node -e "const fs=require('fs');const p='/tmp/loopforge-trace/events.jsonl';const rows=fs.readFileSync(p,'utf8').trim().split('\\n').map(JSON.parse);console.log(rows.find(r=>r.trace_id)?.trace_id||'')")"
node scripts/trace-jsonl-check.mjs --input /tmp/loopforge-trace/events.jsonl --trace-id "$TRACE_ID"
```

Expected: JSONL checker PASS. If Jaeger/Docker are unavailable, do not claim live OTel full-link success.

- [ ] **Step 4: Commit**

Run:

```bash
node .gitnexus/run.cjs detect_changes --repo loopforge-tauri-im --scope all --limit 30
git add scripts/otel-trace-smoke.sh test/fixtures/trace-jsonl-self-test.jsonl
git commit -m "test(trace): connect jsonl trace smoke"
```

If no fixture was created, omit `test/fixtures/trace-jsonl-self-test.jsonl` from `git add`.

Expected: commit succeeds.

---

## Final Verification

- [ ] Run Rust checks:

```bash
cargo test --manifest-path src-tauri/Cargo.toml -p helix-driver-instrument trace_event -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml --features webdriver
```

- [ ] Run frontend check:

```bash
CI=1 NG_BUILD_MAX_WORKERS=1 NG_BUILD_PARALLEL_TS=0 pnpm exec ng build --configuration development
```

- [ ] Run trace checkers:

```bash
node scripts/otel-trace-check.mjs --self-test
node scripts/trace-jsonl-check.mjs --self-test
bash scripts/trace-static-gate.sh
```

- [ ] Run full gate if time allows:

```bash
bash scripts/gate.sh
```

- [ ] Run GitNexus final scope check:

```bash
node .gitnexus/run.cjs detect_changes --repo loopforge-tauri-im --scope compare --base-ref main --limit 50
```

Expected: changes are limited to loopforge trace instrumentation, scripts, and docs. If the branch is already on `main`, use `--scope all` instead.

## Self-Review

Spec coverage:

- `/tmp/loopforge-trace/events.jsonl` is covered in Tasks 1, 5, and 6.
- Existing `/tmp/loopforge/run.jsonl` compatibility is preserved in Tasks 1 and 6.
- Tauri invoke/listen/event/render coverage is covered in Tasks 2, 3, and 4.
- HTTP/WS coverage is covered in Task 4.
- func-level trace tool is introduced through `InstrumentCtx::trace`; deeper ergonomic wrappers can be added after the boundary gate is green.
- OTel/JSONL checker coverage is covered in Tasks 5 and 7.
- No helix/cses/mobile modifications are included.

Placeholder scan:

- No task uses red-flag placeholder wording or unspecified "add tests" instructions.
- Every task lists files, interfaces, commands, and expected outcomes.

Type consistency:

- Rust direction enum is consistently named `TraceDirection`.
- JSONL sink is consistently named `TraceJsonlSink`.
- Trace event checker path is consistently `/tmp/loopforge-trace/events.jsonl`.
- Angular event command is consistently `trace_record_event`.

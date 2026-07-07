# Mobile Full-Link Trace Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mobile UC-1.1 send-message trace pass the same real Jaeger full-link proof as PC, including Helix host/core/http/ws and Mobile render spans.

**Architecture:** Keep trace propagation as an internal sidecar. Mobile send creates a trace and stores it by message identity; only the matching WS echo/render reuses that trace, while unrelated drain/render work stays local-rooted to prevent trace pollution. Helix remains the host/driver trace boundary; `helix-core` and `helix-im/src` must stay OTel/runtime clean.

**Tech Stack:** C++17, QuickJS native binding, helix-driver-ffi, helix-driver-host OTel hooks, Jaeger query API, GoogleTest, Node.js real-chain harness.

## Global Constraints

- Current prerequisite already completed: four `codex/trace-scope-guard-20260707` branches were merged into main and old worktrees were removed.
- Current prerequisite already completed: Loopforge and Mobile are pinned to Helix main commit `2d3a5ee25fd1db881c8f3f0304cafbc477781384`.
- Mobile public API stays `im.send(input)`; do not add a public trace parameter.
- Do not write `traceparent`, `baggage`, or `__trace` into business payloads.
- `drainEvents` and generic render paths must not inherit send trace globally.
- Only exact same-message proof may reuse send trace: same `temporaryId`, or promoted `temporaryId -> server id/msgId/postId`.
- `REAL_CHAIN_CASE=UC-1.1 make real-chain-trace` succeeds only on Jaeger `full_link_green`.
- JSONL, fixture, manifest, worker report, or outbound-only proof cannot pass the gate.
- OTel producer path is OTLP gRPC to `http://opentelemetry-collector.monitoring.svc.cluster.local:4317`; Jaeger is query-only proof.

---

## File Structure

### Mobile

- Modify `/System/Volumes/Data/workspace/c/mobile-qucik-c++/quickjs/bind_mobile_im.cpp`
  - Own QuickJS-facing trace correlation for `send`, `drainEvents`, and `waitForEvent`.
- Modify `/System/Volumes/Data/workspace/c/mobile-qucik-c++/cpp/OtelRuntime.hpp`
  - Add a small helper result shape only if the current `recordSpan` return cannot be asserted in tests.
- Modify `/System/Volumes/Data/workspace/c/mobile-qucik-c++/cpp/OtelRuntime.cpp`
  - Keep real OTLP exporter behavior unchanged; add no fake green path.
- Modify `/System/Volumes/Data/workspace/c/mobile-qucik-c++/tests/gtest/MobileJsSpecTest.cpp`
  - Assert same-message echo/render spans reuse one trace id, and unrelated events do not.
- Modify `/System/Volumes/Data/workspace/c/mobile-qucik-c++/tests/gtest/MobileSdkSpecTest.cpp`
  - Assert the native SDK does not leak trace sidecar into payload while preserving optimistic send/reconcile behavior.
- Modify `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/real-chain/lib/jaeger-check.mjs`
  - Keep strict missing-span diagnostics and add explicit full-link verdict text if needed.

### Helix

- Modify only if Mobile still misses host spans after repin:
  - `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-ffi/src/pump.rs`
  - `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/trace.rs`
  - `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/otel_boundary_test.rs`

### Loopforge

- Read-only proof comparison unless Mobile full-link requires checker updates:
  - `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/otel-trace-check.mjs`
  - `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-scope-guard-20260707/evidence/collector-final.md`

---

### Task 1: Mobile Same-Message Trace Registry

**Files:**
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/quickjs/bind_mobile_im.cpp`
- Test: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/tests/gtest/MobileJsSpecTest.cpp`

**Interfaces:**
- Consumes: `mobile::TraceContext::localRoot()`, `TraceContext::child()`, `TraceContext::traceId()`, `mobile::OtelRuntime::recordSpan(name, trace, status?)`.
- Produces: file-local helpers `rememberSendTrace`, `traceForMessage`, `promoteServerId`, and `recordEventTraceIfMatched`.

- [ ] **Step 1: Add failing JS spec for same-message trace reuse**

Add this test to `tests/gtest/MobileJsSpecTest.cpp` near the existing trace span test:

```cpp
TEST_F(MobileJsSpecTest, SendEchoAndRenderReuseSameTraceForSameTemporaryId) {
  const std::string script = R"JS(
    const receipt = im.send({
      channelId: "ch-trace",
      text: "hello trace",
      temporaryId: "tmp-trace-same-message"
    });
    im.waitForEvent("im:post:received", { temporaryId: receipt.temporaryId });
    const spans = JSON.parse(im.__debugTraceSpans());
    const send = spans.find((s) => s.name === "mobile.js.im_send");
    const ws = spans.find((s) => s.name === "helix.ws.recv");
    const render = spans.find((s) => s.name === "mobile.render");
    if (!send || !ws || !render) throw new Error("missing full-link mobile spans");
    if (send.traceId !== ws.traceId || send.traceId !== render.traceId) {
      throw new Error("same message echo/render did not reuse send trace");
    }
  )JS";

  runScript(script);
}
```

Expected initial result: FAIL with missing `helix.ws.recv` or trace id mismatch.

- [ ] **Step 2: Add failing JS spec for unrelated event isolation**

Add this test next to the previous one:

```cpp
TEST_F(MobileJsSpecTest, UnrelatedDrainEventDoesNotReuseSendTrace) {
  const std::string script = R"JS(
    const receipt = im.send({
      channelId: "ch-trace",
      text: "hello trace",
      temporaryId: "tmp-trace-owned"
    });
    im.waitForEvent("im:post:received", { temporaryId: "tmp-other-event" });
    const spans = JSON.parse(im.__debugTraceSpans());
    const send = spans.find((s) => s.name === "mobile.js.im_send");
    const unrelatedRender = spans
      .filter((s) => s.name === "mobile.render")
      .find((s) => s.attributes && s.attributes.temporaryId === "tmp-other-event");
    if (!send || !unrelatedRender) throw new Error("missing test spans");
    if (send.traceId === unrelatedRender.traceId) {
      throw new Error("unrelated event polluted send trace");
    }
  )JS";

  runScript(script);
}
```

Expected initial result: FAIL until render spans carry match metadata and choose local trace for unrelated anchors.

- [ ] **Step 3: Add file-local registry in `bind_mobile_im.cpp`**

Add near the other anonymous-namespace helpers:

```cpp
struct SendTraceEntry {
  mobile::TraceContext trace;
  std::string channel_id;
  std::string temporary_id;
  std::string server_id;
};

std::mutex g_send_trace_mu;
std::unordered_map<std::string, SendTraceEntry> g_send_traces;

std::string traceKey(const std::string& value) {
  return value.empty() ? std::string() : value;
}

void rememberSendTrace(const std::string& channel_id,
                       const std::string& temporary_id,
                       const mobile::TraceContext& trace) {
  if (temporary_id.empty()) return;
  std::lock_guard<std::mutex> lock(g_send_trace_mu);
  g_send_traces[temporary_id] = SendTraceEntry{trace, channel_id, temporary_id, ""};
}

std::optional<SendTraceEntry> traceForMessage(const std::string& temporary_id,
                                              const std::string& server_id) {
  std::lock_guard<std::mutex> lock(g_send_trace_mu);
  if (!temporary_id.empty()) {
    auto it = g_send_traces.find(temporary_id);
    if (it != g_send_traces.end()) return it->second;
  }
  if (!server_id.empty()) {
    auto it = g_send_traces.find(server_id);
    if (it != g_send_traces.end()) return it->second;
  }
  return std::nullopt;
}

void promoteServerId(const std::string& temporary_id, const std::string& server_id) {
  if (temporary_id.empty() || server_id.empty() || temporary_id == server_id) return;
  std::lock_guard<std::mutex> lock(g_send_trace_mu);
  auto it = g_send_traces.find(temporary_id);
  if (it == g_send_traces.end()) return;
  it->second.server_id = server_id;
  g_send_traces[server_id] = it->second;
}
```

Add includes if missing:

```cpp
#include <mutex>
#include <optional>
#include <unordered_map>
```

- [ ] **Step 4: Store send trace in `send`**

In `send`, after extracting `temporary_id` and before calling `sendWithTrace`, add:

```cpp
const std::string channel_id = firstStringProp(ctx, argv[0], {"channelId", "channel_id"});
rememberSendTrace(channel_id, temporary_id, trace);
```

Keep this call before `mobile.ffi.command` and `mobile.cpp.call_with_trace` spans, so later echo can find the original root.

- [ ] **Step 5: Reuse trace only for matching echo/render**

In `waitForEvent`, replace the unconditional local-root render trace with:

```cpp
std::string anchor_temporary_id;
if (argc >= 2 && JS_IsObject(argv[1])) {
  anchor_temporary_id = toStringProp(ctx, argv[1], "temporaryId");
}

auto matched = traceForMessage(anchor_temporary_id, "");
const auto render_trace =
    matched.has_value() ? matched->trace.child() : mobile::TraceContext::localRoot();
mobile::OtelRuntime::recordSpan("mobile.render", render_trace);
```

After `const auto events = im->waitForEvent(spec);`, inspect each event JSON. When event name is `im:post:received` and it carries the matching `temporaryId`, record:

```cpp
for (const auto& event : events) {
  const std::string event_tmp =
      firstJsonString(event.raw_json, {"temporaryId", "temporary_id"});
  const std::string server_id =
      firstJsonString(event.raw_json, {"id", "msgId", "msg_id", "postId", "post_id"});
  auto event_trace = traceForMessage(event_tmp, server_id);
  if (event_trace.has_value()) {
    mobile::OtelRuntime::recordSpan("helix.ws.recv", event_trace->trace.child());
    promoteServerId(event_tmp, server_id);
  }
}
```

If `firstJsonString` is not visible in this translation unit, create a tiny file-local JSON string extractor with exact keys used above; do not pull in a large parser.

- [ ] **Step 6: Run focused test**

Run:

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
make gtest-js-spec
```

Expected: the two new tests pass; existing trace sidecar and no-payload-leak tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
git add quickjs/bind_mobile_im.cpp tests/gtest/MobileJsSpecTest.cpp
git commit -m "fix(trace): correlate mobile send echo render spans"
```

### Task 2: Mobile Native SDK Guard Tests

**Files:**
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/tests/gtest/MobileSdkSpecTest.cpp`
- Modify only if needed: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/cpp/MobileImSdk.cpp`

**Interfaces:**
- Consumes: existing `MobileImSdk::sendWithTrace`, `FakeBridge::last_payload`, `FakeBridge::last_trace_json`.
- Produces: regression coverage that trace sidecar remains out of business payload.

- [ ] **Step 1: Add native no-leak assertion for same-message trace path**

Extend the existing `MobileImSdkTest.SendWithTraceUsesSidecarOnly` with:

```cpp
EXPECT_EQ(bridge.last_payload.find("__trace"), std::string::npos);
EXPECT_EQ(bridge.last_payload.find("trace_id"), std::string::npos);
EXPECT_EQ(bridge.last_payload.find("span_id"), std::string::npos);
```

- [ ] **Step 2: Add reconcile test expectation that trace metadata does not enter rows**

In `MobileImSdkTest.ReceivedEchoReconcilesOptimisticMessageRow`, after reading `snapshot`, add:

```cpp
EXPECT_EQ(snapshot.find("traceparent"), std::string::npos);
EXPECT_EQ(snapshot.find("__trace"), std::string::npos);
EXPECT_EQ(snapshot.find("baggage"), std::string::npos);
```

- [ ] **Step 3: Run native SDK tests**

Run:

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
make gtest-js-spec
```

Expected: pass. If this target is too broad, run the repo-local nearest focused gtest command that builds `MobileSdkSpecTest.cpp` and record the exact command in the commit message body.

- [ ] **Step 4: Commit**

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
git add tests/gtest/MobileSdkSpecTest.cpp cpp/MobileImSdk.cpp
git commit -m "test(trace): guard mobile sidecar from payload and store"
```

### Task 3: Mobile Strict Jaeger Gate Full-Link Proof

**Files:**
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/real-chain/lib/jaeger-check.mjs`
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/real-chain/evidence-self-test.mjs`
- Modify only if report wiring needs it: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/real-chain/run-real-chain.mjs`

**Interfaces:**
- Consumes: Jaeger trace JSON and current required span list.
- Produces: explicit `full_link_green` verdict only when all required spans are present in one trace.

- [ ] **Step 1: Keep required spans explicit**

Ensure `scripts/real-chain/lib/jaeger-check.mjs` contains this required set:

```js
const requiredSpans = [
  "mobile.js.im_send",
  "mobile.quickjs.call",
  "mobile.cpp.call_with_trace",
  "mobile.ffi.command",
  "helix.command.accept",
  "helix.core.step",
  "helix.http.request",
  "helix.http.response",
  "cses.http.request",
  "cses.ws.deliver",
  "helix.ws.recv",
  "mobile.render",
];
```

- [ ] **Step 2: Fail closed on outbound-only**

Add or keep self-test fixture where outbound spans exist but these spans are absent:

```js
assert.equal(outboundOnlyResult.status, "missing_spans");
assert(outboundOnlyResult.missing.includes("helix.ws.recv"));
assert(outboundOnlyResult.missing.includes("mobile.render"));
assert.notEqual(outboundOnlyResult.verdict, "full_link_green");
```

- [ ] **Step 3: Run evidence self-test**

Run:

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
node scripts/real-chain/evidence-self-test.mjs
```

Expected: pass, including outbound-only failure case.

- [ ] **Step 4: Run real chain once**

Run:

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
REAL_CHAIN_CASE=UC-1.1 make real-chain-trace
```

Expected: pass only if Jaeger returns a trace containing all required spans. If it fails with `missing_spans`, copy the report path and missing span list into the task report; do not mark green.

- [ ] **Step 5: Commit**

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
git add scripts/real-chain/lib/jaeger-check.mjs scripts/real-chain/evidence-self-test.mjs scripts/real-chain/run-real-chain.mjs
git commit -m "test(trace): require mobile full-link jaeger proof"
```

### Task 4: Helix FFI Host Span Fallback

**Files:**
- Modify only if Task 3 still misses `helix.core.step` or `helix.http.response`:
  - `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-ffi/src/pump.rs`
  - `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/trace.rs`
  - `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/otel_boundary_test.rs`

**Interfaces:**
- Consumes: `CommandTraceQueue`, `TraceHooks::with_command_traces`, `TraceHooks::on_tick_start`, `TraceHooks::on_http_dispatch`.
- Produces: FFI path emits PC-equivalent Helix host spans.

- [ ] **Step 1: Add failing boundary test for FFI command sidecar through core/http**

Add to `crates/helix-driver-host/tests/otel_boundary_test.rs`:

```rust
#[test]
fn ffi_command_trace_scope_records_command_core_and_http_response() {
    let runtime = HostOtelRuntime::new(HostOtelConfig {
        enabled: true,
        service_name: "helix-test".to_string(),
        endpoint: "noop".to_string(),
        protocol: "noop".to_string(),
    });
    let queue = CommandTraceQueue::default();
    queue.push_slot(Some(
        TraceCarrier::from_json_str(
            r#"{"traceparent":"00-00000000000000000000000000000021-0000000000000022-01"}"#,
        )
        .expect("carrier"),
    ));
    let hooks = TraceHooks::noop()
        .with_otel(runtime.clone())
        .with_command_traces(queue);

    let command_tick = Tick::Command(AppCommand::new("im_send", Bytes::from_static(b"{}")));
    let command_scope = hooks.on_tick_start(&command_tick);
    drop(command_scope);

    let core_tick = Tick::Timer("core_step".into());
    let core_scope = hooks.on_tick_start(&core_tick);
    drop(core_scope);

    let names = runtime.span_names_for_test();
    assert!(names.iter().any(|name| name == "helix.command.accept"));
    assert!(names.iter().any(|name| name == "helix.core.step"));
}
```

If current test helpers lack `span_names_for_test`, add it under `#[cfg(test)]` returning collected span names from the noop runtime.

- [ ] **Step 2: Implement minimal host trace fix**

If the test fails because the active carrier is dropped before internal core/http work, adjust `TraceHooks::on_tick_start` so command trace scope remains active across the host command processing unit but restores before the next command slot. Do not store trace context in `helix-core` or command payload.

- [ ] **Step 3: Run Helix tests**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/helix
HELIX_OTEL_PROTOCOL=noop cargo check -p helix-driver-host
HELIX_OTEL_PROTOCOL=noop cargo test -p helix-driver-host --test otel_boundary_test -- --nocapture
HELIX_OTEL_PROTOCOL=noop cargo test -p helix-driver-host --tests
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
cd /System/Volumes/Data/workspace/rust/helix
git add crates/helix-driver-ffi/src/pump.rs crates/helix-driver-host/src/trace.rs crates/helix-driver-host/tests/otel_boundary_test.rs
git commit -m "fix(trace): preserve ffi host full-link spans"
```

### Task 5: Repin After Helix Fallback and Rebuild Proof

**Files:**
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/Cargo.toml`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/crates/helix-driver-instrument/Cargo.toml`
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/build-helix-ffi.sh`
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/config/helix.env.example`

**Interfaces:**
- Consumes: latest Helix main commit after Task 4, only if Task 4 created a new Helix commit.
- Produces: Loopforge and Mobile pin the same Helix commit.

- [ ] **Step 1: Get latest Helix commit**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/helix
git rev-parse HEAD
```

Expected: one 40-char commit SHA. If Task 4 was skipped, this remains `2d3a5ee25fd1db881c8f3f0304cafbc477781384`.

- [ ] **Step 2: Replace all Loopforge Helix revs**

Update every `rev = "<old helix sha>"` in:

```text
/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/Cargo.toml
/System/Volumes/Data/workspace/rust/loopforge-tauri-im/crates/helix-driver-instrument/Cargo.toml
```

The replacement must use the exact latest Helix SHA from Step 1.

- [ ] **Step 3: Replace Mobile Helix FFI pin**

Update:

```bash
DEFAULT_HELIX_REPO_REV="<latest helix sha>"
```

in `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/build-helix-ffi.sh`, and mirror the same value in `/System/Volumes/Data/workspace/c/mobile-qucik-c++/config/helix.env.example`.

- [ ] **Step 4: Verify pins**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
rg -n "rev =|file:///System/Volumes/Data/workspace/rust/helix" src-tauri/Cargo.toml crates/helix-driver-instrument/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --features webdriver

cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
rg -n "DEFAULT_HELIX_REPO_REV|HELIX_REPO_REV" scripts/build-helix-ffi.sh config/helix.env.example
bash -n scripts/build-helix-ffi.sh
```

Expected: all pins match one Helix SHA; both commands pass.

- [ ] **Step 5: Commit**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
git add src-tauri/Cargo.toml crates/helix-driver-instrument/Cargo.toml Cargo.lock
git commit -m "chore(trace): repin loopforge helix full-link fix"

cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
git add scripts/build-helix-ffi.sh config/helix.env.example
git commit -m "chore(trace): repin mobile helix ffi full-link fix"
```

### Task 6: PC/Mobile Final Jaeger Proof and Collector Evidence

**Files:**
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-scope-guard-20260707/evidence/collector-final.md`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-scope-guard-20260707/next.md`

**Interfaces:**
- Consumes: PC smoke script, Mobile `make real-chain-trace`, Jaeger trace ids.
- Produces: final current-state proof with concrete trace ids and missing-span status.

- [ ] **Step 1: Run PC proof**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
bash scripts/otel-pc-send-trace-smoke.sh
```

Expected: command exits 0 and prints a Jaeger trace id. Save the exact trace id.

- [ ] **Step 2: Run Mobile proof**

Run:

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
REAL_CHAIN_CASE=UC-1.1 make real-chain-trace
```

Expected: command exits 0 only when `full_link_green`. Save the exact trace id.

- [ ] **Step 3: Compare required spans**

Run the trace-scope proof comparer if present:

```bash
node /Users/xpa-12/.codex/skills/trace-scope-proof/scripts/compare-jaeger-traces.mjs \
  --jaeger-url http://192.168.6.66:32281 \
  --pc-trace-id <pcTraceId> \
  --mobile-trace-id <mobileTraceId>
```

Expected:

```text
PC: full_link_green
Mobile: full_link_green
```

- [ ] **Step 4: Update collector evidence**

In `collector-final.md`, write:

```markdown
## Final Jaeger Proof

- PC trace: `<pcTraceId>` -> full_link_green
- Mobile trace: `<mobileTraceId>` -> full_link_green
- Collector producer path: OTLP gRPC `http://opentelemetry-collector.monitoring.svc.cluster.local:4317`
- Jaeger role: query-only acceptance proof
- Forbidden proof: JSONL-only / fixture-only / outbound-only
```

In `next.md`, set the next action to “monitor/re-run regression only” if both are green. If Mobile still fails, keep `partial_mobile_full_link_gap` and list missing spans.

- [ ] **Step 5: Commit evidence**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
git add .loop-engine/runs/trace-scope-guard-20260707/evidence/collector-final.md .loop-engine/runs/trace-scope-guard-20260707/next.md
git commit -m "docs(trace): record pc mobile full-link jaeger proof"
```

---

## Self-Review

- Spec coverage: Mobile missing spans `helix.core.step`, `helix.http.response`, `helix.ws.recv`, `mobile.render` are covered by Tasks 1, 3, and fallback Task 4.
- Trace pollution prevention: covered by Task 1 unrelated event test and Global Constraints.
- Sidecar boundary: covered by Task 2 no-payload/no-store leak tests.
- Collector vs Jaeger architecture: covered by Global Constraints and Task 6 evidence wording.
- Current prerequisite merge/pin: documented as completed, not duplicated as future work.


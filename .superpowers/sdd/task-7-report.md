# Task 7 Report - Golden End-To-End Trace Gate

## Status

DONE

## Commit Hash

Final response carries exact committed HEAD. A committed report cannot embed its own final commit hash without changing that hash.

## Files Changed

- `scripts/otel-trace-check.mjs`
- `scripts/otel-trace-smoke.sh`
- `docs/trace/otel-trace-gate.md`
- `.superpowers/sdd/task-7-report.md`

## Checker Semantics And Usage

- `scripts/otel-trace-check.mjs` accepts a trace id positional argument and queries Jaeger Query at `http://127.0.0.1:16686/api/traces/<trace-id>` by default.
- The checker target can be overridden with `--jaeger-url <url>` / `--jaeger-query-url <url>` or `JAEGER_QUERY_URL`. This only changes the Jaeger read target; it is not trace enablement source-of-truth.
- The checker also supports deterministic no-network verification:
  - `node scripts/otel-trace-check.mjs --self-test`
  - `node scripts/otel-trace-check.mjs --input <jaeger-response.json> <trace-id>`
- Client span semantics are alternative-group based:
  - action: `pc.ui.action` or future `mobile.js.im_send`
  - bridge: `pc.tauri.invoke` or future `mobile.core_bridge.call_with_trace`
  - render: `pc.ui.render` or future `mobile.render`
- Fixed middle spans are required from Helix and cses-im-server. `helix.event.emit` must appear at least twice; every other fixed middle span must appear at least once.
- `scripts/otel-trace-smoke.sh <trace-id>` is the normal operator wrapper. It prints usage and exits `2` when no trace id is provided.

## Verification

- PASS: `node --check scripts/otel-trace-check.mjs`
- PASS: `node scripts/otel-trace-check.mjs --self-test`
  - Output included: `trace self-test-trace contains required full-link spans`
- PASS: `bash -n scripts/otel-trace-smoke.sh`
- PASS: `bash scripts/otel-trace-smoke.sh` with no args exited `2` and printed usage.
- PASS: `git diff --check`
- UNAVAILABLE: `shellcheck scripts/otel-trace-smoke.sh`
  - `shellcheck` is not installed on this machine.
- UNAVAILABLE: GitNexus `detect_changes`
  - `mcp__gitnexus.list_repos` returned zero indexed repositories.
  - `mcp__gitnexus.detect_changes(scope=all, worktree=...)` returned `Error: No indexed repositories. Run: gitnexus analyze`.

## Residual Risks

- This gate validates one trace after PC/mobile clients, Helix, and cses-im-server actually export spans to the local OTel Collector / Jaeger stack.
- The checker asserts operation-name presence and duplicate counts only. It does not yet validate parent-child topology, span timing, service names, or attributes.
- Mobile alternatives are accepted by name for future reuse, but the committed wrapper lives in LoopForge and the primary documented path is the PC Tauri trace.

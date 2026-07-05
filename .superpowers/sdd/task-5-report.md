# Task 5 Report - PC Tauri Trace Bridge In Loopforge

Status: DONE_WITH_CONCERNS

Commit hash: final response carries exact committed HEAD; self-referential commit hashes cannot be embedded in the committed file.

## Files Changed

- `config/dev-local.json`
- `config/pre.json`
- `config/prod.json`
- `src-tauri/src/config.rs`
- `src-tauri/src/trace.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src/app/im/trace-context.service.ts`
- `src/app/im/tauri-bridge.service.ts`
- `src/app/im/im-store.service.ts`
- `.superpowers/sdd/task-5-report.md`

## Behavior Added

- Added optional `observability.otel` config to all Loopforge JSON profiles.
- `dev-local` enables local OTLP HTTP Collector endpoint `http://127.0.0.1:4318` with sampling ratio `1.0`.
- `pre` and `prod` keep tracing disabled by default with conservative sampling metadata.
- Extended Rust profile parsing so missing `observability` remains valid and defaults to tracing disabled.
- Added Rust `trace.rs` sidecar helpers for W3C `traceparent` validation/normalization and baggage trimming.
- Added `im_send(..., __trace: Option<serde_json::Value>)` at the Tauri IPC boundary so malformed sidecars cannot fail typed command deserialization before handler code runs.
- Valid trace sidecars are parsed and logged at the IPC boundary; malformed trace sidecars are ignored with a warning after command entry, and IM business command success/failure is unchanged.
- Added Angular `TraceContextService` to generate browser-safe W3C `traceparent` plus optional baggage.
- Extended `TauriBridgeService.invoke` to attach `__trace` only to the Tauri invoke envelope without mutating caller args.
- `ImStoreService.send`, `sendDocument`, and `resend` now start and pass a trace sidecar for `im_send`.

## Evidence That `__trace` Does Not Enter Helix Business Payload

- `src-tauri/src/commands.rs::im_send` accepts `__trace` as a separate raw `serde_json::Value` sidecar parameter, not as a required `TraceSidecar`.
- `src-tauri/src/trace.rs::normalize_trace_sidecar` validates raw JSON inside handler execution; malformed sidecars return `InvalidSidecar` / `InvalidTraceparent` and are logged/dropped.
- `src-tauri/src/commands.rs::send_payload` constructs the `Tick::Command` JSON from only `channel_id`, `temporary_id`, `text`, and `type`.
- `commands::command_tests::send_payload_never_contains_trace_sidecar` asserts the command payload has no `__trace`.
- `trace::tests::raw_sidecar_shape_errors_are_reported_after_command_deserialization` covers malformed raw sidecar shapes without requiring Tauri command deserialization to fail.
- Existing `state.ctx.log_ipc_in("im_send", ...)` logs only business args and does not include the sidecar.
- Existing `TeeTickSender` logs `Tick::Command` payload after serialization; since the serialized payload is built by `send_payload`, the inbound Helix command remains trace-free.

## Verification

- PASS: `cargo test --manifest-path src-tauri/Cargo.toml`
  - 8 passed; 0 failed.
- PASS: `pnpm run check:static`
  - TypeScript check and Angular build completed.
  - Existing warning remains: `src/app/app.component.ts` component style budget exceeds 4.00 kB by 3.98 kB.
- FAIL_UNAVAILABLE: `pnpm test -- --runInBand`
  - Exact output: `test: --: unexpected operator`.
  - `package.json` has no `test` script, so this is not treated as a Task 5 code failure.
- PASS: `git diff --check`
- UNAVAILABLE: GitNexus MCP tools were not exposed for this worker, and main reported `mcp__gitnexus.list_repos` returned zero repositories. No broad reindex was run.

## Residual Risks

- The pinned Loopforge Helix dependency is `97b840863793cadeb843ce41b92393f52c41e3f9`.
- That pinned rev lacks Task 4 host trace APIs (`helix-driver-host/src/trace.rs`, `TraceHooks`, `CommandTraceQueue`), verified with `git ls-tree` / `git show` against the pinned rev.
- Therefore this task does not wire the sidecar into host `TraceHooks` or exporters. `engine.rs` was intentionally left unchanged.
- No blocking exporter work was added to Tauri hot paths.

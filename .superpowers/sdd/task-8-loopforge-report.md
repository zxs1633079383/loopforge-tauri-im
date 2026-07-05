# Task 8 Loopforge Static Trace Gate Report

Status: DONE

Commit: included in the final `test(trace): add loopforge static trace gate` commit.

Files changed:
- `scripts/trace-static-gate.sh`
- `scripts/gate.sh`
- `.superpowers/sdd/task-8-loopforge-report.md`

Gate semantics:
- `__trace` may appear only in the approved source boundary files:
  `src-tauri/src/commands.rs`, `src-tauri/src/trace.rs`,
  `src/app/im/tauri-bridge.service.ts`, and
  `src/app/im/trace-context.service.ts`.
- `src/app/im/im-store.service.ts` is explicitly checked for zero `__trace`
  references.
- `src-tauri/src/commands.rs` is checked for patterns that insert `__trace`
  into a business payload.
- Trace-related files are discovered with
  `rg -0 -l 'TraceContext|__trace|traceparent|baggage|otel|opentelemetry' src src-tauri scripts config`,
  then scanned through `xargs -0` for span/log contexts combined with
  sensitive or business正文 fields.

Verification:
- `bash -n scripts/trace-static-gate.sh scripts/gate.sh`
- `bash scripts/trace-static-gate.sh`
- `git diff --check`

Residual risks:
- This is a conservative static gate. It proves current source patterns do not
  mix trace sidecar into business payloads or log obvious sensitive/business
  fields in trace contexts; it does not replace runtime full-link trace checks.

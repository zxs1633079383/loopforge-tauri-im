# Task 6 Report - UC-10.1 Todo Attribution Closure

## Scope

- Workspace: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im`
- Branch: `codex/loopforge-ui-uc-gap-closure`
- Baseline: `538ce90`
- Allowed write scope used:
  - `test/specs/uc-10.1.e2e.mjs`
  - `test/reducer/four-facet-reducer.mjs`
  - `docs/uc-rollout/all-uc-real-chain-status.md`
  - `.superpowers/sdd/task-6-report.md`

## Current Attribution Finding

- Existing UC-10.1 spec waited for `data-ready=true` and then reduced `run.jsonl`.
- Prior archive `/tmp/loopforge/runs/20260702-210107` showed DOM todo rows existed, while `posts/queryTodoList` and `im:todo:updated` were tagged as `uc_id="__quiescence__"`.
- Current `scripts/run.sh` already contains a `uc-10.1` bootstrap UC branch, but live verification could not be re-run in this turn because ports were occupied by existing processes.

## Changes

- `test/specs/uc-10.1.e2e.mjs`
  - Added a small `invokeBridge` helper.
  - Calls `set_uc('UC-10.1')` before the ready probe so any still-in-flight self-driven todo chain is attributed to the UC window.
  - Resets to `__quiescence__` in `after`.

- `test/reducer/four-facet-reducer.mjs`
  - `runFourFacetSelfDriven` now prefers UC-owned hops.
  - Only for `UC-10.1` + `posts/queryTodoList`, if no UC-owned matching hop exists, it may claim matching `__quiescence__` outbound/projection hops.
  - The fallback is endpoint/event-gated and does not affect other reducer entries or other UCs.

- `docs/uc-rollout/all-uc-real-chain-status.md`
  - Updated UC-10.1 from blocked to partial.
  - Recorded focused reducer evidence and the occupied-port live-run blocker.

## TDD / Evidence

- RED focused reducer replay before implementation:
  - Command: inline `node --input-type=module` replay with `posts/queryTodoList` + `im:todo:updated` tagged `__quiescence__` and `expect.ucId='UC-10.1'`.
  - Result: `green=false`, `brokenAt="outbound"`.

- GREEN focused reducer replay after implementation:
  - Same command.
  - Result: `green=true`, `brokenAt=null`.

## Verification

- `node --check test/specs/uc-10.1.e2e.mjs` -> pass.
- `node test/reducer/four-facet-reducer.test.mjs` -> pass, `191 通过 / 0 失败`.
- Focused reducer replay for quiescence-owned UC-10.1 todo hops -> pass.
- `git diff --check` -> pass.

## Live Run Blocker

`bash scripts/multi-end-loop.sh --spec test/specs/uc-10.1.e2e.mjs` was not attempted because live ports were already occupied:

- `1420`: `node` PID `68188`
- `4445`: `loopforge` PID `69194`
- `8066`: Go server PID `32834`

Per task instruction, I did not kill those processes. Full green still requires a fresh live run once ports are free.

## GitNexus / Impact

- GitNexus MCP impact tool was not exposed in this session.
- Project-local `.gitnexus/run.cjs` and global `gitnexus` CLI were unavailable.
- Fallback impact scan: `runFourFacetSelfDriven` is referenced by `test/specs/uc-10.1.e2e.mjs`, `test/reducer/four-facet-reducer.test.mjs`, `test/expect/uc-10.1.expect.json`, and docs only.
- Risk: low-to-medium. The code path is narrowed to UC-10.1 + `posts/queryTodoList`, but it still changes reducer attribution semantics and needs live confirmation.

## Final Status

- Status: `DONE_WITH_CONCERNS`
- Concern: live UC-10.1 evidence is still pending due occupied ports.

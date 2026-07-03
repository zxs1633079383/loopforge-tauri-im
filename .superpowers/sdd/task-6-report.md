# Task 6 Report - UC-10.1 Todo Attribution Closure

## Scope

- Workspace: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im`
- Branch: `codex/loopforge-ui-uc-gap-closure`
- Baseline: `538ce90`
- Allowed write scope used:
  - `test/specs/uc-10.1.e2e.mjs`
  - `test/reducer/four-facet-reducer.mjs`
  - `test/reducer/four-facet-reducer.test.mjs`
  - `docs/uc-rollout/all-uc-real-chain-status.md`
  - `.superpowers/sdd/task-6-report.md`

## Current Attribution Finding

- Existing UC-10.1 spec waited for `data-ready=true` and then reduced `run.jsonl`.
- Prior archive `/tmp/loopforge/runs/20260702-210107` showed DOM todo rows existed, while `posts/queryTodoList` and `im:todo:updated` were tagged as `uc_id="__quiescence__"`.
- Review finding: accepting those `__quiescence__` hops as UC-10.1 evidence contradicts the task requirement. UC-10.1 evidence must be owned by the UC window.
- Current `scripts/run.sh` already contains a `uc-10.1` bootstrap UC branch. A focused live rerun was attempted in this review-fix turn, but `run.sh` stopped because port 1420 was occupied.

## Changes

- `test/specs/uc-10.1.e2e.mjs`
  - Added a small `invokeBridge` helper.
  - Calls `set_uc('UC-10.1')` before the ready probe so any still-in-flight self-driven todo chain is attributed to the UC window.
  - Resets to `__quiescence__` in `after`.

- `test/reducer/four-facet-reducer.mjs`
  - `runFourFacetSelfDriven` now only accepts UC-owned hops.
  - Review fix removes the UC-10.1 `__quiescence__` fallback entirely.
  - `posts/queryTodoList` outbound and `im:todo:updated` projection must now be tagged with `uc_id="UC-10.1"` to pass.

- `test/reducer/four-facet-reducer.test.mjs`
  - Added a regression pair: UC-owned UC-10.1 todo hops pass; the same hops retagged to `__quiescence__` fail outbound and projection.

- `docs/uc-rollout/all-uc-real-chain-status.md`
  - Updated UC-10.1 from blocked to partial.
  - Replaced the old fallback claim with the review-fix rule: `__quiescence__` evidence is rejected, and live rerun remains pending.

## TDD / Evidence

- Regression test in `test/reducer/four-facet-reducer.test.mjs`:
  - Bad pattern: `posts/queryTodoList` + `im:todo:updated` tagged `uc_id="__quiescence__"` with `expect.ucId='UC-10.1'` -> `green=false`, outbound false, projection false.
  - Good pattern: identical todo hops tagged `uc_id="UC-10.1"` -> `green=true`.

## Verification

- `node --check test/specs/uc-10.1.e2e.mjs` -> pass.
- `node --check test/reducer/four-facet-reducer.mjs` -> pass.
- `node test/reducer/four-facet-reducer.test.mjs` -> pass, `195 通过 / 0 失败`.
- `bash scripts/multi-end-loop.sh --spec test/specs/uc-10.1.e2e.mjs` -> blocked before WDIO by occupied frontend port 1420; archive `/tmp/loopforge/runs/20260703-130509`.
- `git diff --check` -> pass.

## Review Fix Commit

- `5f084a2` (`test(im): 拒绝 UC-10.1 静默归属`)

## Live Run Blocker

`bash scripts/multi-end-loop.sh --spec test/specs/uc-10.1.e2e.mjs` was attempted and stopped before WDIO because the frontend port was already occupied:

- `1420`: `node` PID `68188`
- archive: `/tmp/loopforge/runs/20260703-130509`

Per task instruction, I did not kill those processes. Full green still requires a fresh live run once ports are free.

## GitNexus / Impact

- GitNexus MCP impact tool was not exposed in this session.
- Project-local `.gitnexus/run.cjs` and global `gitnexus` CLI were unavailable.
- Fallback impact scan: `runFourFacetSelfDriven` is referenced by `test/specs/uc-10.1.e2e.mjs`, `test/reducer/four-facet-reducer.test.mjs`, `test/expect/uc-10.1.expect.json`, and docs only.
- Risk: low-to-medium. The code path is narrowed to UC-10.1 + `posts/queryTodoList`, but it still changes reducer attribution semantics and needs live confirmation.

## Final Status

- Status: `DONE_WITH_CONCERNS`
- Concern: live UC-10.1 evidence is still pending due occupied ports.

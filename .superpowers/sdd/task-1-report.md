# Task 1 Report: Preserve Per-Spec DOM Evidence

Status: DONE_WITH_CONCERNS

Commits created:
- Current HEAD on `codex/loopforge-ui-uc-gap-closure` — `test(im): 归档 L2 DOM 证据`

What changed:
- Added `test/helpers/l2-evidence.mjs` with `captureDomEvidence(browser, name, selectors)` to persist per-spec DOM snapshots into `LOOPFORGE_EVIDENCE_DIR`.
- Updated `scripts/run.sh` to export `LOOPFORGE_EVIDENCE_DIR="$RUN_LOG_DIR/evidence"`, create the directory, and pass it into the app launch environment.
- Updated `scripts/multi-end-loop.sh` to clear stale evidence between runs and copy `RUN_LOG_DIR/evidence` into both the per-spec archive and the top-level archive when present.
- Added `docs/uc-rollout/l2-evidence-runbook.md` documenting that L2 closure evidence requires `run.jsonl`, `wdio-out.log`, `summary.md`, and `evidence/*.dom.json`.
- Updated these L2 specs to capture DOM evidence after convergence without changing business behavior:
  - `test/specs/uc-3.1-l2.e2e.mjs`
  - `test/specs/uc-3.2-l2.e2e.mjs`
  - `test/specs/uc-5.3b-l2.e2e.mjs`
  - `test/specs/uc-6.1-l2.e2e.mjs`
  - `test/specs/uc-6.2-l2.e2e.mjs`
  - `test/specs/uc-11.2-l2.e2e.mjs`

Verification:
- `node --check test/helpers/l2-evidence.mjs` ✅
- `bash -n scripts/run.sh scripts/multi-end-loop.sh` ✅
- `curl http://127.0.0.1:8066/api/cses/health` returned `200` ✅
- `bash scripts/multi-end-loop.sh --spec test/specs/uc-3.1-l2.e2e.mjs` ⚠️ attempted, but `scripts/run.sh` failed before WDIO because `1420` and `4445` were already occupied by existing local processes:
  - `node` pid `80309` listening on `:1420`
  - `loopforge` pid `80497` listening on `:4445`

Concerns:
- The required live WDIO verification did not complete because existing local frontend/webdriver processes occupied the default ports. The code changes are statically validated, but archive-shape confirmation for the new DOM evidence files remains blocked until the ports are freed or the local runtime setup is coordinated.
- GitNexus CLI/tooling was not available in this checkout (`gitnexus: command not found`, no local `.gitnexus` / `.claude/skills/gitnexus` files), so impact/detect_changes could not be run; I limited edits strictly to the requested files and verified scope with `git diff --stat`.

Report file path:
- `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.superpowers/sdd/task-1-report.md`

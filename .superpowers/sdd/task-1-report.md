# Task 1 Report: Add Go-Only Apifox Profile

Status: DONE

Commits created:
- `71c6050` — `test: 增加 Apifox go-only 套件边界`

What changed:
- Added `APIFOX_PROFILE` support to `scripts/apifox-suite-create.py` with validation for `full` and `go-only`.
- Added `go-only` scenario filtering that excludes only:
  - `UC-8.x 投票 CRUD`
  - `UC-8.x 平均分 CRUD`
- Kept `UC-10.1 待办列表` in the selected set.
- Updated suite naming, description, scenario counts, and banner output to reflect the active profile.
- Echoed the active `APIFOX_PROFILE` in `scripts/multi-end-loop.sh` before the Apifox generator runs.

Test summary:
- `python3 -m py_compile scripts/apifox-suite-create.py` ✅
- `APIFOX_PROFILE=bad python3 scripts/apifox-suite-create.py` ✅ failed early with the expected validation error before token lookup or network calls

Concerns:
- None observed in the edited scope.
- `APIFOX_PROFILE=go-only` still preserves the stage grouping structure, so empty stage groups are skipped naturally rather than removed.

Report file path:
- `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.superpowers/sdd/task-1-report.md`

# UC Run Reports

Runtime artifacts stay outside git under archive directories such as `/tmp/loopforge/runs/20260702-153000/`.
`bash scripts/multi-end-loop.sh` now writes a per-run archive with copied logs plus `summary.md`.

Useful entrypoints:

- `bash scripts/multi-end-loop.sh --list`
- `bash scripts/multi-end-loop.sh --list --area MB`
- `bash scripts/multi-end-loop.sh --area MB`
- `bash scripts/multi-end-loop.sh --all`
- `bash scripts/multi-end-loop.sh --l2`
- `bash scripts/multi-end-loop.sh --apifox`
- `bash scripts/multi-end-loop.sh --screenshot`

Committed report notes in this directory should stay small and include:

- command that was run
- pass/fail counts
- linked runtime archive path
- Apifox report path when used
- screenshot paths when used
- final status line

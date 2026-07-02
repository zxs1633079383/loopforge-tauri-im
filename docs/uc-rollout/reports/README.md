# UC Run Reports

Runtime artifacts stay outside git under archive directories such as `/tmp/loopforge/runs/20260702-153000/`.
`bash scripts/multi-end-loop.sh` now writes a per-run archive with copied logs plus `summary.md`.
Use `--archive-dir /custom/path` when you want a stable or task-specific archive location.
Live runs assume the Go backend is already up on `http://127.0.0.1:8066`; the harness health-checks that endpoint before running static/live gates.

Useful entrypoints:

- `bash scripts/multi-end-loop.sh --list`
- `bash scripts/multi-end-loop.sh --list --area MB`
- `bash scripts/multi-end-loop.sh --area MB`
- `bash scripts/multi-end-loop.sh --all`
- `bash scripts/multi-end-loop.sh --l2`
- `bash scripts/multi-end-loop.sh --apifox` (`APIFOX_TOKEN` required)
- `bash scripts/multi-end-loop.sh --screenshot` (depends on `scripts/capture-ui-screenshots.mjs`, added later)
- `bash scripts/multi-end-loop.sh --archive-dir /tmp/loopforge/runs/task3-smoke`

Apifox is summarized as HTTP-only evidence, not as WS/DOM/client end-to-end green.
`summary.md` reports `Apifox HTTP | pass` only when the archive contains `apifox-status.json` with `{"status":"pass","scope":"http-only"}` written by the harness after a successful Apifox command.
If only `apifox-run.log` exists, or the sentinel is missing/malformed, the summary stays conservative as `not-pass-or-unknown`.

Committed report notes in this directory should stay small and include:

- command that was run
- pass/fail counts
- linked runtime archive path
- Apifox report path when used
- screenshot paths when used
- final status line

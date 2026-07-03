# Task 1 Report: Sender Actor Contract Tests

Status: DONE_WITH_CONCERNS

Review fix status: DONE

Commits created:
- `8e68525` — `test(im): 增加双账号发送者切换用例`
- `332370a` — `test(im): 收紧双账号发送者身份断言`

What changed:
- Added `test/specs/uc-l2-sender-switch.e2e.mjs`.
- The spec asserts the debug sender contract:
  - status bar exposes `data-active-user-id="444"`.
  - status bar exposes `data-sender-user-id`.
  - `account-678-btn` switches the sender to `678`.
  - composer send renders a message whose DOM sender is `678`.
  - `run.jsonl` records a `posts/create` outbound containing the sent text and `678`.
- Review fix:
  - message text now uses `lf-sender-alt-*`, so it does not contain `678`.
  - outbound identity assertion now accepts only structured identity evidence: explicit `cookieId`/`userId`, header `cookieId`, session cookie values, or body `userId`.
  - message text is no longer used as identity evidence.

Verification:
- `node --check test/specs/uc-l2-sender-switch.e2e.mjs` passed.
- Review fix verification:
  - `node --check test/specs/uc-l2-sender-switch.e2e.mjs` passed.
  - `git diff --check` passed.
- Focused live command was not run because required ports were occupied:
  - `1420`: `node` pid `68188` listening on `[::1]:1420`.
  - `4445`: `loopforge` pid `69194` listening on `127.0.0.1:4445`.
- Per instruction, I did not kill or restart user processes.

Concerns:
- Live RED could not be observed because ports `1420` and `4445` were already occupied.
- The expected future RED point remains `data-sender-user-id` / `account-678-btn` / actor-aware outbound, depending on which contract surface is missing first in the currently running app.
- GitNexus local runner was unavailable in this checkout (`.gitnexus/run.cjs` missing), so `detect_changes` could not run.

Report file path:
- `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.superpowers/sdd/task-1-report.md`

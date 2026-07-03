# Task 3 Report - Right-Top Sender Switch UI

## Status

DONE_WITH_CONCERNS

## Baseline

- Requested baseline: `a1271c3`
- Branch: `codex/loopforge-ui-uc-gap-closure`
- HEAD before commit: `a1271c33ec35e1edcd1d222130df34a233aa5318`

## TDD

### RED

- Existing WDIO contract file used as the RED target: `test/specs/uc-l2-sender-switch.e2e.mjs`.
- Syntax check passed: `node --check test/specs/uc-l2-sender-switch.e2e.mjs`.
- Live RED was not run because required ports were already occupied by user processes:
  - `1420`: `node` PID `68188`
  - `4445`: `loopforge` PID `69194`
  - `8066`: `___7go_bu` PID `32834`
- Per instruction, no user processes were killed.

## Implementation Summary

- Added selected sender state in `ImStoreService`:
  - `senderUserId(): "444" | "678"`
  - `setSenderUserId(userId)`
- Added actor-aware wrappers:
  - `sendAsSelected(channelId, text, mentionUserId?)`
  - `readChannelAsSelected(channelId)`
  - `urgentPostAsSelected(channelId, postId, targetIds, message?)`
- Threaded `actorUserId` through existing L2 debug store methods:
  - `l2Send`
  - `l2ReadChannel`
  - `l2ReadPost`
  - `l2UrgentPost`
- Wired `AppComponent` so:
  - default composer send uses normal `im_send` under sender `444`
  - sender `678` composer send uses `im_l2_send` with `actorUserId: "678"`
  - read-channel and urgent paths use selected sender wrappers
- Updated status bar:
  - exposes `data-active-user-id`
  - exposes `data-sender-user-id`
  - renders `account-444-btn` and `account-678-btn`
- Updated composer:
  - exposes `data-composer-sender-user-id`
- Updated message row root:
  - exposes real projection sender as `data-user-id`

## Impact / Scope

GitNexus attempts:

```bash
gitnexus impact --target ImStoreService --direction upstream || true
gitnexus impact --target ImStatusBarComponent --direction upstream || true
gitnexus impact --target onSend --direction upstream || true
```

MCP context and detect attempts also ran.

Result:

- `gitnexus` CLI was not found on `PATH`.
- GitNexus MCP reported `No indexed repositories`.
- Fallback used scoped `rg`, static TypeScript/Angular build, and diff review.

Risk: low to medium. Changes are limited to allowed Angular shell files; behavior routes selected sender to existing Tauri commands without changing the main observation/login identity.

## Verification

- `npm run check:static` - passed
  - Existing Angular style budget warning remains: component styles budget `4.00 kB`, total `7.98 kB`.
- `node --check test/specs/uc-l2-sender-switch.e2e.mjs` - passed
- `bash scripts/multi-end-loop.sh --spec test/specs/uc-l2-sender-switch.e2e.mjs` - not run because ports were occupied:
  - `1420`: `node` PID `68188`
  - `4445`: `loopforge` PID `69194`
  - `8066`: `___7go_bu` PID `32834`
- `git diff --check` - passed

## Changed Files

- `src/app/app.component.ts`
- `src/app/im/im-store.service.ts`
- `src/app/im/ui/im-status-bar.component.ts`
- `src/app/im/ui/im-composer.component.ts`
- `src/app/im/ui/im-message-list.component.ts`
- `.superpowers/sdd/task-3-report.md`

## Concerns

- Live WDIO RED/GREEN could not be observed because the required local ports were already occupied.
- GitNexus impact/detect was unavailable; fallback analysis was used.

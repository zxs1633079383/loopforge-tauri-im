# Task 7 Report - P1 Read-Result UI Surfaces

## Scope

- Workspace: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im`
- Branch: `codex/loopforge-ui-uc-gap-closure`
- Baseline: `538ce90`
- Allowed write scope used:
  - `src/app/im/message-row.model.ts`
  - `src/app/im/im-store.service.ts`
  - `src/app/im/ui/im-aux-panel.component.ts`
  - `src/app/im/ui/im-member-panel.component.ts`
  - `test/specs/uc-5.6r.e2e.mjs`
  - `test/specs/uc-5.7.e2e.mjs`
  - `test/specs/uc-5.8.e2e.mjs`
  - `test/specs/uc-9.x.e2e.mjs`
  - `test/specs/uc-10.3.e2e.mjs`
  - `.superpowers/sdd/task-7-report.md`

## TDD Evidence

- Added WDIO DOM assertions first for:
  - `data-bookmark-id`
  - `data-announcement-id`
  - `data-online-count`
  - `data-member-online` when online members exist in response body
  - `data-module-id`
  - `data-query-channel-id`
- Each assertion derives expected ids/counts from the matching `im:read:result` body in `run.jsonl`.
- Empty response bodies assert no corresponding rendered rows, avoiding rows faked from request inputs.
- `node --check` passed for all modified P1 specs before implementation and after implementation.

## Implementation

- Added render row models for announcements, modules, query-channel results, and online status.
- Added store signals for announcements/modules/query-channel rows/online statuses and online member status chips.
- Routed `im:read:result` by deterministic `req_id` prefixes:
  - `bookmark-load-`
  - `announcement-list-`
  - `modules-get-all-`
  - `channel-query-`
  - `online-status-`
- Updated store request-id defaults for the corresponding UI methods.
- Rendered read-result surfaces in AX/MB:
  - AX bookmark rows include message text when present.
  - AX announcement/module/channel-query panels render the required `data-*` attributes.
  - MB online status panel renders `data-online-count` and member-level `data-member-online`.

## Conservative Mapping Notes

- Response arrays are accepted only from the response body itself: `body`, `body.data`, or common list wrappers such as `items/list/rows/postList/posts/announcements/channels/modules/records/content`.
- Rows without an authoritative id from the response are skipped.
- Announcement rows use response `announcementId`, else response `id`, else response `postId`; `postId` uses response `postId`, else response `id`.
- Bookmark rows use response `bookmarkId`, else response `postId`, `id`, or `msgId`.
- Module rows use response `moduleId` or `id`; display name uses `name` or `label`.
- Channel query rows use response `channelId` or `id`; display name uses `displayName` or `name`.
- Online count uses response `onlineCount`/`count` if present; otherwise it counts response members whose status is `online` or `online === true`.
- The brief suggested a `queryChannels` computed signal, but the store already has a `queryChannels(...)` command method used by `app.component.ts`. The render signal is named `queryChannelRows` to avoid breaking the command API.

## Verification

- `node --check test/specs/uc-5.6r.e2e.mjs` - pass
- `node --check test/specs/uc-5.7.e2e.mjs` - pass
- `node --check test/specs/uc-5.8.e2e.mjs` - pass
- `node --check test/specs/uc-9.x.e2e.mjs` - pass
- `node --check test/specs/uc-10.3.e2e.mjs` - pass
- `npm run check:static` - pass; existing Angular style budget warning remains.
- `git diff --check` - pass

## Live Focused Runs

Not run because required live ports were already occupied, and the task explicitly said not to kill user processes:

- `1420`: `node` PID 68188
- `4445`: `loopforge` PID 69194
- `8066`: `___7go_bu` PID 32834

## GitNexus / Impact

- GitNexus MCP returned no indexed repositories, so symbol impact analysis and `detect_changes` could not be used for this workspace.
- Fallback impact control used static typecheck/build, scoped grep, allowed-file diff review, and `git diff --check`.

## Final Assessment

- Status: `DONE_WITH_CONCERNS`
- Concern: focused live RED/GREEN was skipped due occupied ports.

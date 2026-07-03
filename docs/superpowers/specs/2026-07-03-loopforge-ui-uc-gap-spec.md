# LoopForge UI UC Gap Spec

Date: 2026-07-03

## Scope

This spec answers one question:

Can every non-excluded UC be driven from the LoopForge UI into real Tauri/helix behavior?

Excluded from this accounting:

- bot / agent domain
- vote and average score domain (`UC-8.x`)
- permanently excluded search / cross-repo demo / non-business trace endpoints
- `UC-12.1` health probe as an infrastructure preflight surface, not an IM render-proof feature

Apifox green is treated as HTTP preflight only. It does not prove WS echo, helix projection, DOM rendering, DB persistence, or L2 multi-account convergence.

## Current Pin

LoopForge is pinned to the latest local helix commit:

- helix HEAD: `770e79e30ad7153d38aa2215f4755a7bcdebe94a`
- `src-tauri/Cargo.toml`: `helix-core`, `helix-im`, `helix-driver-native`, `helix-driver-host`
- `crates/helix-driver-instrument/Cargo.toml`: `helix-core`

## Definitions

| State | Meaning |
|---|---|
| UI-linked | A user action exists and calls a real Tauri command. |
| Helix-linked | The Tauri command enters helix or a debug-only real HTTP path designed for L2 verification. |
| Render-proven | A helix projection updates DOM data attributes or visible UI state. |
| Evidence-proven | WDIO/reducer evidence is fresh and recoverable from disk. |

## Honest Answer

Not all UC UI interaction logic is complete.

Most reachable business UCs have UI entrypoints and real Tauri/helix commands, but several are still partial because they are HTTP-only, L2 evidence is missing, read result bodies are not rendered into user-facing UI, or the current harness cannot attribute the flow to the UC window.

## P0 Gaps

| UC | Current state | Gap | Required closure |
|---|---|---|---|
| UC-1.4 resend failed message | UI has `resend-btn`; store can resend a failed row | Healthy real chain does not naturally create a failed row, so the spec cannot reach the UI action honestly | Add real failure injection via backend/transport fault harness; never synthesize a fake failed row in Angular |
| UC-10.1 todo list | `im:todo:updated` is rendered by `applyTodoUpdated` | Outbound `posts/queryTodoList` and projection are attributed to `__quiescence__`, not the UC window | Fix reducer/window attribution for self-driven hello flows |
| UC-3.1 channel read | UI now triggers `im_read_channel` on header button, composer focus/click, and channel switch | L2 evidence for read echo/unread convergence is not recoverable per spec | Re-run focused L2 spec and preserve projection + DOM archive |
| UC-3.2 post read | UI has `read-post-btn` -> `im_mark_read` | Same L2 evidence preservation problem as UC-3.1 | Re-run focused L2 spec and preserve projection + DOM archive |
| UC-5.3b member leave broadcast | L2 spec has raw WS proof only | Fresh helix projection + DOM proof for observer side is missing | Re-run focused L2 with full projection/DOM evidence |
| UC-6.1b member add broadcast | L2 spec has raw WS proof only | Fresh observer-side projection + DOM proof is missing | Re-run focused L2 with full projection/DOM evidence |
| UC-6.2b admin broadcast | L2 spec has raw WS proof only | `data-admin` must come from backend/helix projection, not optimistic UI | Re-run focused L2 with full projection/DOM evidence |
| UC-11.2 quit company | Debug observer bootstrap is proven | Full quit-company projection + DOM removal evidence is not preserved | Re-run focused L2 with per-spec archive preservation |
| UC-5.6w announcement write | UI can invoke save/read/delete | Write echo/projection/DB path is still partial in current closure docs | Keep as blocked/partial until real backend echo chain is re-verified |

## P1 UI-Linked But Not Fully Rendered

| UC | Existing real call | Missing UI proof |
|---|---|---|
| UC-9.x bookmarks | `im_bookmark_create`, `im_bookmark_delete`, `im_bookmark_load` | `applyReadResult` does not populate `_bookmarks`; bookmark panel cannot prove loaded bookmark rows |
| UC-5.6r announcement reads | `im_announcement_accept_list`, `im_announcement_list`, `im_announcement_detail` | Read bodies are not rendered into a clear announcement list/detail UI |
| UC-5.7 online status | `im_channel_online_status` | Response body is not rendered into visible online-status UI |
| UC-10.3 modules | `im_modules_get_all` | Response body is not rendered into visible module list UI |
| UC-5.8 channel query | `im_channel_query` | Query response is not rendered into a result surface distinct from existing channel list state |

## Accepted Preflight-Only Exception

| UC | Existing real call | Status |
|---|---|---|
| UC-12.1 health | `im_health` | Accepted as infrastructure HTTP preflight only. It is intentionally not part of IM render-proof closure. Existing `data-health` may remain as a lightweight indicator, but it is not used to claim WS/projection/DOM/DB business proof. |

## P2 Endpoint-Level UI Holes Inside Non-Excluded Domains

These are mapped to business-adjacent UCs but do not have complete ergonomic UI entrypoints today:

- channel approval toggle: `channels/enableApproval`
- channel permission/info/source/picture/props/orient/purpose changes
- member notification settings: `channel/member/change/notify`
- cancel message pin: `channel/remove/postPinned`
- load pinned message list: `channel/load/postPinned`
- schedule list read: `posts/getSchedule`
- urgent cancel: `posts/urgentCancel`
- historical fallback reads: `posts/get`, `posts/getPostsAfterIndex`
- approval action: `post/approval/approval`
- notification read surfaces: `notification/loadSend`, `notification/loadTarget`

These should not be marked complete merely because helix has an outbound command or Apifox passes an HTTP endpoint.

## Recently Closed UI Gaps

The following gaps are now closed in the current worktree:

- composer focus/click triggers current channel read
- channel switch triggers current channel read
- left dialog list refreshes from helix `dialogList` after message projections
- left list visibly shows mention and urgent badges
- sender fallback no longer hard-codes `姜乐乐`; it uses current user id fallback
- debug account panel keeps main identity as `444` and lets `678` drive L2 send, mention, read, urgent actions
- helix dependencies are pinned to `770e79e30ad7153d38aa2215f4755a7bcdebe94a`

## Recommended Closure Order

1. Fix evidence integrity first: UC-1.4 failure harness, UC-10.1 window attribution, L2 per-spec archive preservation.
2. Render read-result bodies for P1: bookmarks, announcements, online status, modules, channel query.
3. Add P2 ergonomic controls only after P0/P1 are evidence-clean.
4. Keep Apifox as HTTP preflight and never use it as DOM/WS/DB proof.

## Verification Plan

Minimum gate after each implementation batch:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run check:static`
- `npm run check:real-chain`
- focused WDIO spec for every UC touched
- for L2 gaps: preserve per-spec run archive and include projection + DOM evidence, not raw WS only

## Execution Guard

- Any implementation that modifies helix must happen in a helix git worktree, not directly in `/System/Volumes/Data/workspace/rust/helix` main checkout.
- Any implementation that modifies `cses-im-server` must happen in a `cses-im-server` git worktree, not directly in `/System/Volumes/Data/workspace/golang/cses-im-server` main checkout.
- Cross-repo worktree branches must keep write scopes disjoint and must not stage unrelated pre-existing untracked files.
- Before starting implementation, review this spec and the paired plan once for scope drift, especially around excluded bot/agent, vote, and average-score domains.

## Non-Goals

- Do not reintroduce Angular business derivation for unread, mention, urgent, member admin, bookmark semantics, or todo semantics.
- Do not cover bot/agent.
- Do not cover vote/average in this spec.
- Do not turn UC-12.1 health into an IM render-proof feature; keep it as infrastructure preflight.
- Do not turn service-only or Java-owned endpoints into LoopForge UI obligations without a separate product decision.

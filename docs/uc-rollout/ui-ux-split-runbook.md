# UI/UX Split Runbook

> Goal: split the current single-file Angular IM shell into smaller UI modules without changing business behavior.
> All interactions must still flow through real UI -> root action -> `ImStoreService` -> Tauri invoke -> helix -> backend -> projection -> DOM.
> No mock data, no fake success state, no local state patching.

## Current Shape

- `src/app/app.component.ts` is the shell root and owns orchestration methods only.
- H/SR/CL/ML/MB/CP/AX are extracted into standalone presentational components under `src/app/im/ui/`.
- `src/app/im/im-store.service.ts` is the only business state module. It owns projection application and Tauri command calls.
- `MessageRow`, channel/member/read-result models stay in `src/app/im/*`.
- E2E contracts bind to `data-testid` and `data-*`; those names are compatibility surface and must not change.

## Split Target

Use standalone Angular components. Keep the root component as orchestration only.

| Area | New component | Interface | Owns business state? | Representative mjs |
|---|---|---|---|---|
| H status | `im-status-bar.component.ts` | `ready`, `activeChannel`, events: `health`, `readChannel` | No | `uc-4.1`, `uc-3.1` |
| SR rail | `im-server-rail.component.ts` | `serverIcons` | No | visual/static only |
| CL channels | `im-channel-list.component.ts` | `channels`, `activeChannel`, events: create/query/online/modules/announcement/sync/team/select/change/close/top | No | `uc-5.1`, `uc-5.4`, `uc-5.5` |
| ML messages | `im-message-list.component.ts` | `rows`, `activeChannel`, events: revoke/read/template/quickReply/forward/topic/urgent/locate/pin/bookmark/announcement/vote/average/resend/loadOlder | No | `uc-1.1`, `uc-1.5`, `uc-2.3`, `uc-8.x` |
| MB members | `im-member-panel.component.ts` | `members`, `membersAttr`, events: load/join/leave/nickname/admin | No | `uc-6.1`, `uc-6.2`, `uc-6.3`, `uc-6.4` |
| CP composer | `im-composer.component.ts` | `activeChannel`, `draft` two-way, events: send/document/urgent/schedule/cancel/read | No | `uc-1.1`, `uc-1.2`, `uc-1.10` |
| AX auxiliary | `im-aux-panel.component.ts` | `bookmarks`, `todos`, `replies`, event: bookmark load | No | `uc-2.4`, `uc-9.x`, `uc-10.1` |

## Rules

1. Root `AppComponent` may keep action methods during phase 1. Child components emit events only.
2. Child components must not inject `ImStoreService` in phase 1. This keeps one business seam and avoids duplicated state knowledge.
3. Child components must preserve every existing `data-testid` and `data-*` attribute exactly.
4. Use Angular `@for (...; track id)` as today. Do not replace track keys with index.
5. Inputs can be plain values/signals read by root; outputs are UI events. No child component should call `window.__lf`, Tauri, helix, or backend.
6. Any new form field must either drive a real command argument or not be added. Do not add decorative controls that imply a fake backend action.
7. Vote/average forms are not allowed to invent card ids. They must use `row.vote` / `row.average` / server id data already present, or stay disabled/fail-loud.
8. Member admin state is projection-owned. Do not synthesize `data-admin` in the component tree; wait for the real broadcast path.

## Phase Order

1. Extract H + SR. Done.
2. Extract MB. Done at component boundary; live UC-6.1/6.2 rerun green with structured hop log enabled.
3. Extract CL. Done at component boundary; live UC-5.x rerun pending.
4. Extract ML. Done at list boundary; message-row subcomponent remains optional later work.
5. Extract CP. Done; `ngModel` lives in `im-composer`, root keeps `draft` and real store handlers.
6. Extract AX. Done; read-result rendering remains rooted in `ImStoreService`.
7. Visual reskin to match `http://pd.cses7.com/message/pages/message/index.html`. Done as global CSS only; semantic DOM unchanged.

## Task 6 Area Evidence

| Area | Command | Result | Archive | Notes |
|---|---|---|---|---|
| CL | `bash scripts/multi-end-loop.sh --area CL` | partial | `/tmp/loopforge/runs/20260702-205658` | `uc-5.1` / `uc-5.4` passed in one area batch; `uc-5.5` only re-verified the top-pin path, and `uc-5.5b` still needs its own rerun before post-pin coverage can be called green. |
| ML | `bash scripts/multi-end-loop.sh --area ML` | green | `/tmp/loopforge/runs/20260702-205744` | `uc-send-1` / `uc-1.5` / `uc-2.3` all passed in one area batch. |
| CP | `bash scripts/multi-end-loop.sh --area CP` | green | `/tmp/loopforge/runs/20260702-210012` | First attempt exposed `uc-1.2` spec drift with real composer draft input; after updating `uc-1.2.e2e.mjs` to type into `compose-input`, rerun passed `uc-send-1` / `uc-1.2` / `uc-1.10` / `uc-1.10-cancel`. |
| AX | `bash scripts/multi-end-loop.sh --area AX` | blocked | `/tmp/loopforge/runs/20260702-210107` | `uc-9.x` and `uc-2.4` passed, but `uc-10.1` failed because `posts/queryTodoList` + `im:todo:updated` landed in `__quiescence__`, while DOM todo rows were already present; this is a self-driven evidence-window/harness issue, not a presentational selector failure. |
| MB | `bash scripts/multi-end-loop.sh --area MB` | green | `/tmp/loopforge/runs/20260702-210208` | `uc-6.1` / `uc-6.2` / `uc-6.3` / `uc-6.4` all passed in one area batch; `uc-6.2` remains L1 outbound-only by design. |

## Verification Gate Per Phase

Run all cheap checks:

```bash
node --check test/specs/<representative>.e2e.mjs
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
git diff --check
```

Run at least one live UC for the touched area:

```bash
bash scripts/run.sh -- --spec test/specs/uc-6.1.e2e.mjs
```

Batch loop:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-6.1.e2e.mjs --spec test/specs/uc-6.2.e2e.mjs
```

For red live runs, use three-way evidence:

- Code: root event -> store method -> Tauri command.
- Effect: WebdriverIO clicked a real element and waited on DOM `data-*`.
- Logs: `/tmp/loopforge/run.jsonl`, `/tmp/loopforge/run-app.log`, `/tmp/cses-im-server.log`.

## MJS Backlog

These specs should be upgraded before counting UI/UX done:

- UC-5.1: create group should click `create-channel-btn` for the SUT action; bridge can remain only for controlled setup.
- UC-1.5: revoke should click `revoke-btn` on a real sent row.
- UC-1.10: schedule and cancel should both click composer buttons and verify schedule badge via WS/projection.
- UC-6.1: now clicks member input + join button; keep it as MB regression gate.
- UC-6.2: now clicks the real member admin button; keep it as MB regression gate and do not let the UI optimistic-flush `data-admin`.
- UC-10.1: current spec expects hello self-driven `queryTodoList` hops to stay inside the named UC window, but Task 6 evidence at `/tmp/loopforge/runs/20260702-210107` shows outbound/projection landed under `__quiescence__` while DOM todo rows were already rendered. Fix this with a harness/bootstrap-window change, not a UI component patch.
- UC-8.x vote/average: downstream operations require real `data-vote` / `data-average` or env `UC8_VOTE_ID` / `UC8_AVERAGE_ID`; no generated ids.

## Visual Evidence Gate

Every UI/UX closure batch must archive:

- desktop screenshot at 1440x1000
- mobile screenshot at 390x844
- `screenshot-summary.md`

The screenshots must preserve machine selectors and show the `pd.cses7.com/message`-style direction: dark top/rail, light message canvas, dense channel list, stable composer.
`scripts/capture-ui-screenshots.mjs` is green only when it actually writes both PNG files; if browser support is unavailable or `http://localhost:1420` is down, it must exit non-zero and record the failure in `screenshot-summary.md`.

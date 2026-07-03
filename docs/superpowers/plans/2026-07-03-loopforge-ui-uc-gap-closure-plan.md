# LoopForge UI UC Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining non-excluded LoopForge UI UC gaps so every covered UC has a real UI entrypoint, real Tauri/helix execution, render-ready DOM state, and recoverable evidence.

**Architecture:** LoopForge stays a pure Angular render shell. User actions call Tauri commands; Tauri injects ticks or debug-only L2 HTTP actions; helix owns business shaping and emits render-ready projections; Angular binds those projections 1:1. Harness changes preserve projection, storage, HTTP, and DOM evidence per spec run.

**Tech Stack:** Angular 20 standalone components, Tauri 2, Rust, helix `helix-im` / `helix-driver-instrument`, WebdriverIO 9, Bash harnesses, `cses-im-server` on port 8066.

## Global Constraints

- Scope excludes bot/agent, vote, average-score, and UC-12.1 health-as-IM-feature closure.
- Search, cross-repo demo, and non-business trace endpoints remain permanently excluded unless a separate product decision changes that scope.
- UC-12.1 remains accepted as infrastructure HTTP preflight only. Existing `data-health` can stay, but it is not used as WS/projection/DOM/DB business proof.
- Apifox green remains HTTP preflight only. It cannot mark WS/projection/DOM/DB proof complete.
- Do not synthesize business state in Angular. Read-body shaping, failed-send terminal state, unread, mention, urgent, admin, bookmark, announcement, online, modules, and channel-query semantics belong in helix render-ready projections.
- UC-1.4 failed rows must come from a real port failure path plus helix projection/storage state. Do not insert fake failed rows in Angular or WDIO.
- L2 actor `678` remains debug/webdriver-only. Main app identity remains `444`.
- Frozen expectations and helix projection contract docs are read-only unless the implementation intentionally updates helix and then updates the contract in the same helix commit.
- If helix source changes, update LoopForge Cargo git revs only after helix tests pass and the new helix commit exists.
- Any helix source change must be made inside a helix worktree branch, not directly in `/System/Volumes/Data/workspace/rust/helix` main checkout.
- Any `cses-im-server` source change must be made inside a `cses-im-server` worktree branch, not directly in `/System/Volumes/Data/workspace/golang/cses-im-server` main checkout.
- Cross-repo worktree agents must declare their write scope and must not stage unrelated pre-existing untracked files.
- Evidence is complete only when the archive contains `run.jsonl`, `wdio-out.log`, `summary.md`, and a DOM snapshot JSON for the spec.

---

## File Structure

LoopForge create:

- `test/helpers/l2-evidence.mjs`
- `docs/uc-rollout/l2-evidence-runbook.md`

LoopForge modify:

- `scripts/run.sh`
- `scripts/multi-end-loop.sh`
- `crates/helix-driver-instrument/src/http.rs`
- `crates/helix-driver-instrument/src/ctx.rs`
- `crates/helix-driver-instrument/src/lib.rs`
- `crates/helix-driver-instrument/tests/roundtrip.rs`
- `test/specs/uc-1.4.e2e.mjs`
- `test/specs/uc-10.1.e2e.mjs`
- `test/specs/uc-3.1-l2.e2e.mjs`
- `test/specs/uc-3.2-l2.e2e.mjs`
- `test/specs/uc-5.3b-l2.e2e.mjs`
- `test/specs/uc-6.1-l2.e2e.mjs`
- `test/specs/uc-6.2-l2.e2e.mjs`
- `test/specs/uc-11.2-l2.e2e.mjs`
- `src/app/im/projection.types.ts`
- `src/app/im/message-row.model.ts`
- `src/app/im/im-store.service.ts`
- `src/app/im/ui/im-aux-panel.component.ts`
- `src/app/im/ui/im-channel-list.component.ts`
- `src/app/app.component.ts`
- `src-tauri/Cargo.toml`
- `crates/helix-driver-instrument/Cargo.toml`

Helix create:

- `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/render_ready_reads.rs`
- `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/render_ready_reads_tests.rs`

Helix modify, only inside `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure`:

- `crates/helix-im/src/lib.rs`
- `crates/helix-im/src/port_reply.rs`
- `crates/helix-im/src/port_reply_emit.rs`
- `crates/helix-im/src/pending_send.rs`
- `crates/helix-im/docs/projection-schema.md`

Verify:

- `cargo test -p helix-im render_ready_reads`
- `cargo test -p helix-im pending_send`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test -p helix-driver-instrument`
- `npm run check:static`
- `npm run check:real-chain`
- Focused WDIO specs listed in Task 8
- `bash scripts/gate.sh`

---

## Cross-Repo Worktrees

Use these worktrees when a task touches another repository:

- Helix: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure`
- Helix branch: `codex/loopforge-ui-uc-gap-closure`
- cses-im-server, only if Task 10 proves a backend defect: `/System/Volumes/Data/workspace/golang/cses-im-server/worktrees/loopforge-ui-uc-gap-backend`
- cses-im-server branch: `codex/loopforge-ui-uc-gap-backend`

Before creating each worktree:

```bash
df -g ~
git check-ignore -q worktrees || printf '/worktrees/\n' >> .gitignore
git status --short --untracked-files=all
```

Do not stage unrelated pre-existing untracked files. If `.gitignore` needs `/worktrees/`, commit that repository-local ignore change before adding the worktree.

---

### Task 1: Preserve Per-Spec DOM Evidence

**Files:**
- Create: `test/helpers/l2-evidence.mjs`
- Create: `docs/uc-rollout/l2-evidence-runbook.md`
- Modify: `scripts/run.sh`
- Modify: `scripts/multi-end-loop.sh`
- Modify: all L2 specs listed in File Structure

**Interfaces:**
- `LOOPFORGE_EVIDENCE_DIR`: directory where WDIO writes DOM snapshots.
- `captureDomEvidence(browser, name, selectors)`: writes one JSON file per spec proof point.

- [ ] **Step 1: Export an evidence directory from `scripts/run.sh`**

In the app launch environment and WDIO environment, set:

```bash
LOOPFORGE_EVIDENCE_DIR="$RUN_LOG_DIR/evidence"
```

Create the directory before `run_wdio`.

- [ ] **Step 2: Copy evidence into per-spec archives**

In `archive_wdio_spec()` in `scripts/multi-end-loop.sh`, copy:

```bash
copy_dir_if_exists "$RUN_LOG_DIR/evidence" "$spec_dir/evidence"
```

Implement `copy_dir_if_exists` next to `copy_if_exists`.

- [ ] **Step 3: Add WDIO helper**

Create `test/helpers/l2-evidence.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

export async function captureDomEvidence(browser, name, selectors) {
  const outDir = process.env.LOOPFORGE_EVIDENCE_DIR || "/tmp/loopforge/evidence";
  fs.mkdirSync(outDir, { recursive: true });
  const snapshot = await browser.execute((entries) => {
    const readNode = (selector) => {
      const nodes = [...document.querySelectorAll(selector)];
      return nodes.map((node) => ({
        selector,
        text: node.textContent?.trim() || "",
        attrs: Object.fromEntries(
          [...node.attributes].map((attr) => [attr.name, attr.value]),
        ),
      }));
    };
    return {
      location: window.location.href,
      ready: document.querySelector("[data-ready]")?.getAttribute("data-ready") || null,
      activeChannel:
        document.querySelector("[data-active-channel]")?.getAttribute("data-active-channel") ||
        null,
      selectors: Object.fromEntries(entries.map((selector) => [selector, readNode(selector)])),
    };
  }, selectors);
  const file = path.join(outDir, `${name}.dom.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}
```

- [ ] **Step 4: Use the helper in L2 specs**

For each L2 spec, capture the observer-side DOM after the L2 action converges:

```js
const { captureDomEvidence } = await import("../helpers/l2-evidence.mjs");
await captureDomEvidence(browser, "uc-6.2-l2-admin-observer", [
  "[data-channel-id]",
  "[data-member-id]",
  "[data-admin]",
]);
```

Use UC-specific selectors:

- UC-3.1 / UC-3.2: `[data-channel-id]`, `[data-unread]`, `[data-read-bits]`, `[data-msg-id]`
- UC-5.3b / UC-11.2: `[data-channel-id]`
- UC-6.1b / UC-6.2b: `[data-member-id]`, `[data-admin]`

- [ ] **Step 5: Document evidence requirements**

In `docs/uc-rollout/l2-evidence-runbook.md`, record:

```markdown
# L2 Evidence Runbook

L2 proof is recoverable only when the per-spec archive contains:

- `run.jsonl`
- `wdio-out.log`
- `summary.md`
- `evidence/*.dom.json`

Raw WS-only proof is diagnostic, not closure proof.
```

- [ ] **Step 6: Verify archive shape**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-3.1-l2.e2e.mjs
```

Expected:

- The current run archive contains `specs/loop-1-uc-3.1-l2/evidence/*.dom.json`.
- `summary.md` mentions the same spec.
- `run.jsonl` exists in the spec directory.

---

### Task 2: Add Real HTTP Failpoint for UC-1.4

**Files:**
- Modify: `crates/helix-driver-instrument/src/http.rs`
- Modify: `crates/helix-driver-instrument/src/ctx.rs`
- Modify: `crates/helix-driver-instrument/src/lib.rs`
- Modify: `crates/helix-driver-instrument/tests/roundtrip.rs`
- Modify: `scripts/run.sh`

**Interfaces:**
- Env var: `LOOPFORGE_FAIL_HTTP_ONCE_URL_SUFFIX`
- Value for UC-1.4: `posts/create`
- Behavior: after outbound tee logging, the first matching HTTP request returns `PortError::Http("loopforge failpoint: posts/create")` and is consumed.

- [ ] **Step 1: Add failpoint state to `InstrumentCtx`**

Store an optional once-only URL suffix read from `LOOPFORGE_FAIL_HTTP_ONCE_URL_SUFFIX`.

Add method:

```rust
pub fn take_http_failpoint_for(&self, url: &str) -> Option<String>
```

It returns the suffix once if `url.ends_with(suffix)`.

- [ ] **Step 2: Apply failpoint in HTTP decorator**

In `Recording<H>::request`, after logging `Facet::Outbound` and before mode dispatch:

```rust
if let Some(suffix) = self.ctx.take_http_failpoint_for(&req.url) {
    return Err(PortError::Http(format!("loopforge failpoint: {suffix}")));
}
```

Do not apply failpoints in `Mode::Replay`.

- [ ] **Step 3: Add instrument tests**

Add tests that prove:

- nonmatching URL passes through
- first matching URL returns `PortError::Http`
- second matching URL passes through
- replay mode ignores the failpoint

- [ ] **Step 4: Wire UC-1.4 launch env**

In `scripts/run.sh`, when WDIO args contain `uc-1.4`, set:

```bash
FAIL_HTTP_ONCE_URL_SUFFIX="posts/create"
```

Pass it into the app process as `LOOPFORGE_FAIL_HTTP_ONCE_URL_SUFFIX`.

- [ ] **Step 5: Verify failpoint alone**

Run:

```bash
cargo test -p helix-driver-instrument http_failpoint
```

Expected:

- all failpoint tests pass.
- no release-only Tauri code path is changed.

---

### Task 3: Emit Failed Send State from Helix

**Files:**
- Modify: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/pending_send.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/port_reply.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/docs/projection-schema.md`
- Modify: `src/app/im/projection.types.ts`
- Modify: `src/app/im/im-store.service.ts`

**Interfaces:**
- Existing DB value: `send_status='unsend'`
- UI render value: `sendStatus='failed'`
- Existing message row channel remains the render surface; no new Angular-only event.

- [ ] **Step 0: Create or enter the helix worktree**

From `/System/Volumes/Data/workspace/rust/helix`:

```bash
df -g ~
git check-ignore -q worktrees || printf '/worktrees/\n' >> .gitignore
git worktree add worktrees/loopforge-ui-uc-gap-closure -b codex/loopforge-ui-uc-gap-closure
cd worktrees/loopforge-ui-uc-gap-closure
```

If `/worktrees/` was added to `.gitignore`, commit only that `.gitignore` change in the helix main checkout before creating the worktree. If the worktree already exists, enter it and verify `git branch --show-current` is `codex/loopforge-ui-uc-gap-closure`.

- [ ] **Step 1: Confirm current timer path**

In the helix worktree, verify `PendingSend::on_timeout` persists `send_status='unsend'`.

- [ ] **Step 2: Add immediate failure persistence on send HTTP error**

In `CorrelationContext::OutboundSendHttp { temporary_id }` error branch, emit the same storage update as timeout:

```rust
send_status = "unsend"
```

Cancel the send timeout if the pending send exists, so the terminal failed state is not delayed for UC-1.4.

- [ ] **Step 3: Emit render-ready failed row update**

Add or reuse a message-item projection so LoopForge receives a row patch with:

```json
{
  "temporaryId": "lf-temp-id",
  "sendStatus": "failed"
}
```

If the existing projection schema has no legal row patch for a temporary-id-only failure, extend helix projection schema with an explicit render-ready event `im:post:send-failed {channelId, temporaryId, sendStatus}` and document it in `projection-schema.md`.

- [ ] **Step 4: Bind in LoopForge without shaping**

If `im:post:send-failed` is introduced, add:

```ts
export const POST_SEND_FAILED_CHANNEL = "im:post:send-failed";
export interface PostSendFailedData {
  channelId: string;
  temporaryId: string;
  sendStatus: "failed";
}
```

In `ImStoreService.onBus`, patch by `temporaryId` using `data.sendStatus` only. Do not infer from error strings.

- [ ] **Step 5: Verify helix failure path**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/helix
cd worktrees/loopforge-ui-uc-gap-closure
cargo test -p helix-im pending_send
```

Expected:

- HTTP error persists failed/unsend state without waiting for wall-clock timeout.
- Projection/event test proves a temporary-id anchored failed state is emitted.

---

### Task 4: Rewrite UC-1.4 as Real Failure Then Resend

**Files:**
- Modify: `test/specs/uc-1.4.e2e.mjs`

**Interfaces:**
- Precondition comes from Task 2 failpoint and Task 3 helix failure projection.
- WDIO flow: send -> wait failed row -> click resend -> wait sent.

- [ ] **Step 1: Remove passive failed-row precondition**

Replace the current "find existing failed row" precondition with an active send:

```js
await composer.setValue(`lf-resend-${Date.now()}`);
await sendBtn.click();
```

- [ ] **Step 2: Wait for the real failed row**

Wait for:

```js
[data-send-status="failed"][data-temporary-id]
```

The row must have nonempty `data-channel-id` and visible text equal to the sent text.

- [ ] **Step 3: Click real resend button**

Click `[data-testid="resend-btn"]` inside the failed row.

- [ ] **Step 4: Assert status flow and four faces**

Assert:

- DOM: failed -> sending -> sent for the same `data-temporary-id`
- outbound: two `posts/create` attempts with the same `temporaryId`
- projection: failed patch and final sent patch are both in the UC window
- storage: failed/unsend upsert and final sent upsert are both present

- [ ] **Step 5: Verify UC-1.4**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-1.4.e2e.mjs
```

Expected:

- spec passes without Angular fake failed-row injection.
- archive contains outbound failure and successful resend evidence.

---

### Task 5: Fix UC-10.1 Bootstrap Attribution

**Files:**
- Modify: `crates/helix-driver-instrument/src/ctx.rs`
- Modify: `scripts/run.sh`
- Modify: `test/specs/uc-10.1.e2e.mjs`

**Interfaces:**
- `LOOPFORGE_BOOTSTRAP_UC=UC-10.1`
- `im:todo:updated` must appear under `uc_id="UC-10.1"` in `run.jsonl`.

- [ ] **Step 1: Add an env bootstrap regression test**

In `ctx.rs`, add a serial-safe unit test that sets `LOOPFORGE_BOOTSTRAP_UC=UC-10.1`, creates `InstrumentCtx`, logs one event, and asserts the event has `uc_id="UC-10.1"`.

- [ ] **Step 2: Confirm `scripts/run.sh` forwards the env**

Keep the existing `uc-10.1` detection and assert in the script comment that the env must be set before `cargo run`.

- [ ] **Step 3: Harden the WDIO assertion**

In `uc-10.1.e2e.mjs`, fail if any matching `im:todo:updated` for the run is under `__quiescence__` while no matching event exists under `UC-10.1`.

- [ ] **Step 4: Verify UC-10.1**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-10.1.e2e.mjs
```

Expected:

- todo outbound/projection is attributed to `UC-10.1`.
- no reducer workaround filters `__quiescence__` as success.

---

### Task 6: Add Helix Render-Ready Projections for P1 Read UCs

**Files:**
- Create: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/render_ready_reads.rs`
- Create: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/render_ready_reads_tests.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/lib.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/port_reply.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/port_reply_emit.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/docs/projection-schema.md`

**Interfaces:**
- Existing `im:read:result {req_id, body}` remains verbatim.
- Additional render-ready events:
  - `im:bookmarks:loaded {reqId, items:[{bookmarkId, postId, channelId}]}`
  - `im:announcements:loaded {reqId, items:[{announcementId, postId, channelId, text}]}`
  - `im:online-status:loaded {reqId, items:[{channelId, userId, online}]}`
  - `im:modules:loaded {reqId, items:[{moduleId, name, label, url}]}`
  - `im:channels:query-result {reqId, items:[{channelId, displayName}]}`

- [ ] **Step 0: Create or enter the helix worktree**

From `/System/Volumes/Data/workspace/rust/helix`:

```bash
df -g ~
git check-ignore -q worktrees || printf '/worktrees/\n' >> .gitignore
git worktree add worktrees/loopforge-ui-uc-gap-closure -b codex/loopforge-ui-uc-gap-closure
cd worktrees/loopforge-ui-uc-gap-closure
```

If `/worktrees/` was added to `.gitignore`, commit only that `.gitignore` change in the helix main checkout before creating the worktree. If Task 3 already created the worktree, reuse it and verify `git branch --show-current` is `codex/loopforge-ui-uc-gap-closure`.

- [ ] **Step 1: Route read replies by command context**

Extend helix read correlation context so the reply handler knows which read command produced the body. Do not infer command kind from `req_id` prefixes.

Use enum shape:

```rust
ReadRenderKind::BookmarkLoad
ReadRenderKind::AnnouncementAcceptList
ReadRenderKind::AnnouncementList
ReadRenderKind::AnnouncementDetail
ReadRenderKind::OnlineStatus
ReadRenderKind::ModulesGetAll
ReadRenderKind::ChannelQuery
ReadRenderKind::None
```

- [ ] **Step 2: Keep verbatim read-result**

Every Ok response still emits:

```rust
crate::read_relay::emit_read_result(req_id, raw_body.as_ref())
```

- [ ] **Step 3: Emit render-ready event next to read-result**

In `port_reply_emit.rs`, add:

```rust
emit_read_render_ready(req_id, kind, raw_body.as_ref(), out)
```

For decode failures, emit empty `items: []` for the render-ready event and preserve the read error.

- [ ] **Step 4: Implement tolerant extractors**

In `render_ready_reads.rs`, parse only stable identifiers and display fields:

- Bookmark: `id`, `postId` / `post_id` / nested post `id`, `channelId` / `channel_id`
- Announcement: `id`, `postId`, `channelId`, `message` / `text`
- Online: `channelId`, `userId`, boolean-ish `online` / `isOnline`
- Modules: `id`, `name`, `label`, `url`
- Channel query: `id` / `channelId`, `displayName` / `display_name` / `name`

This extraction is allowed in helix because helix is the render-ready boundary. Angular must not duplicate it.

- [ ] **Step 5: Add helix tests**

Add tests for each render event:

- valid body emits stable IDs
- empty or malformed body emits empty `items`
- verbatim `im:read:result` remains emitted

- [ ] **Step 6: Update projection schema**

Append the five render-ready events to `projection-schema.md`, stating that `im:read:result` remains the frozen request-response channel.

- [ ] **Step 7: Verify helix**

Run:

```bash
cd /System/Volumes/Data/workspace/rust/helix
cd worktrees/loopforge-ui-uc-gap-closure
cargo test -p helix-im render_ready_reads
cargo test -p helix-im read_relay
git rev-parse HEAD
```

Expected:

- all render-ready read tests pass.
- record the new helix commit SHA for Task 7.

---

### Task 7: Pin LoopForge to the New Helix Commit

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `crates/helix-driver-instrument/Cargo.toml`

**Interfaces:**
- All `helix-*` git dependencies use the same `rev`.
- No mix of old rev and new rev.

- [ ] **Step 1: Commit helix changes**

In `/System/Volumes/Data/workspace/rust/helix`:

```bash
cd worktrees/loopforge-ui-uc-gap-closure
git status --short --untracked-files=all
cargo test -p helix-im render_ready_reads
cargo test -p helix-im pending_send
git add crates/helix-im/src crates/helix-im/docs/projection-schema.md
git commit -m "feat(im): emit read render-ready projections"
git rev-parse HEAD
```

Do not stage unrelated untracked helix docs.

- [ ] **Step 2: Update LoopForge pins**

In both Cargo files, set every helix dependency rev to the new commit from Step 1.

- [ ] **Step 3: Verify single helix source**

Run:

```bash
npm run check:real-chain
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected:

- `check:real-chain` reports one helix rev.
- no duplicate `helix_core` type errors.

---

### Task 8: Bind P1 Render-Ready Events in LoopForge

**Files:**
- Modify: `src/app/im/projection.types.ts`
- Modify: `src/app/im/message-row.model.ts`
- Modify: `src/app/im/im-store.service.ts`
- Modify: `src/app/im/ui/im-aux-panel.component.ts`
- Modify: `src/app/im/ui/im-channel-list.component.ts`
- Modify: `src/app/app.component.ts`
- Modify: `test/specs/uc-9.x.e2e.mjs`
- Modify: `test/specs/uc-5.6r.e2e.mjs`
- Modify: `test/specs/uc-5.7.e2e.mjs`
- Modify: `test/specs/uc-10.3.e2e.mjs`
- Modify: `test/specs/uc-5.8.e2e.mjs`

**Interfaces:**
- Angular consumes only the new render-ready event payloads from Task 6.
- `applyReadResult` remains limited to generic read-result diagnostics and existing health/member routing.

- [ ] **Step 1: Add projection types**

Add constants and interfaces for:

```ts
BOOKMARKS_LOADED_CHANNEL
ANNOUNCEMENTS_LOADED_CHANNEL
ONLINE_STATUS_LOADED_CHANNEL
MODULES_LOADED_CHANNEL
CHANNEL_QUERY_RESULT_CHANNEL
```

- [ ] **Step 2: Add store signals**

Add readonly signals:

- `announcements`
- `onlineStatuses`
- `modules`
- `channelQueryResults`

Keep existing `bookmarks`.

- [ ] **Step 3: Add pure apply methods**

Each `apply*Loaded(data)` maps `data.items` 1:1 into row interfaces. It may drop rows with missing stable IDs, but must not infer business state from raw read-result bodies.

- [ ] **Step 4: Render compact UI surfaces**

In `im-aux-panel.component.ts`, show:

- bookmark chips with `data-bookmark-id`
- announcement chips with `data-announcement-id`
- online chips with `data-online-user-id`
- module chips with `data-module-id`
- channel query chips with `data-query-channel-id`

Use compact panels; no explanatory text blocks.

- [ ] **Step 5: Keep command buttons wired**

Existing buttons remain:

- `data-testid="bookmark-btn"`
- `data-testid="query-channel-btn"`
- `data-testid="online-status-btn"`
- `data-testid="modules-get-all-btn"`
- `data-testid="announcement-list-btn"`

- [ ] **Step 6: Upgrade P1 WDIO specs from ①② to UI proof**

Each spec must assert:

- outbound request exists
- `im:read:result` exists
- render-ready projection exists
- DOM chip exists

- [ ] **Step 7: Verify P1 specs**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-9.x.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.6r.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.7.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-10.3.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.8.e2e.mjs
```

Expected:

- every archive contains render-ready projection and DOM chip evidence.
- `rg "body\\?\\.|as .*ReadResult|announcement.*body|bookmark.*body" src/app/im` does not show Angular body-shaping logic.

---

### Task 9: Re-Run P0 L2 Specs with Full Evidence

**Files:**
- Modify: L2 specs only if Task 1 evidence capture exposed missing DOM waits.

**Interfaces:**
- Existing debug account panel and `im_l2_*` commands.
- Per-spec archives from Task 1.

- [ ] **Step 1: Run focused L2 closure**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-3.1-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-3.2-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.3b-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-6.1-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-6.2-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-11.2-l2.e2e.mjs
```

- [ ] **Step 2: Check evidence directories**

For every run:

```bash
find /tmp/loopforge/runs -path '*loop-1-uc-*-l2*/evidence/*.dom.json' -print | tail
```

Expected:

- each L2 spec has at least one DOM evidence file.
- `run.jsonl` includes helix projection evidence, not raw WS only.

- [ ] **Step 3: Update the spec ledger**

Update `docs/superpowers/specs/2026-07-03-loopforge-ui-uc-gap-spec.md`:

- Move UC-3.1 / UC-3.2 / UC-5.3b / UC-6.1b / UC-6.2b / UC-11.2 from P0 gaps to closed evidence.
- Include archive paths and run timestamps.

---

### Task 10: Close UC-5.6w Announcement Write

**Files:**
- Modify: `test/specs/uc-5.6w.e2e.mjs`
- Modify: `src/app/im/im-store.service.ts` only if helix emits a render-ready announcement write/update projection that is not currently consumed.

**Interfaces:**
- Existing commands:
  - `im_announcement_save`
  - `im_announcement_read`
  - `im_announcement_delete`
- Expected echo path: Go `post_update` -> helix `im:post:updated` -> DOM row patch.

- [ ] **Step 1: Run current focused spec**

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.6w.e2e.mjs
```

- [ ] **Step 2: Classify the failure**

Use the archive:

- no outbound: LoopForge command wiring bug
- outbound ok, no Go echo: backend echo gap
- Go echo ok, no helix projection: helix parser/projection gap
- projection ok, no DOM: LoopForge binding gap

- [ ] **Step 3: Fix only the failing boundary**

If failure is backend echo, record it as a Go server gap instead of faking UI closure.

If failure requires a `cses-im-server` source change, create or enter the backend worktree before editing:

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
df -g ~
git check-ignore -q worktrees || printf '/worktrees/\n' >> .gitignore
git worktree add worktrees/loopforge-ui-uc-gap-backend -b codex/loopforge-ui-uc-gap-backend
cd worktrees/loopforge-ui-uc-gap-backend
```

If `/worktrees/` was added to `.gitignore`, commit only that `.gitignore` change in the backend main checkout before creating the worktree.

Any backend source fix must pass backend-local verification before returning to LoopForge:

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server/worktrees/loopforge-ui-uc-gap-backend
go test ./...
CSES_IM_LISTEN_ADDR=:8066 CSES_IM_LOG_FORMAT=json go run ./cmd/server
curl -fsS http://127.0.0.1:8066/api/cses/health
```

If the server cannot be run because another instance owns `:8066`, stop that instance only if it belongs to this task; otherwise use the existing healthy server for the LoopForge rerun and record the reason in the task report.

If failure is helix parser/projection, fix helix and repin LoopForge as in Task 7.

If failure is DOM binding, bind the existing render-ready projection only.

- [ ] **Step 4: Verify UC-5.6w**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.6w.e2e.mjs
```

Expected:

- save/read/delete outbound proof remains green.
- write echo path is either fully green or documented as a backend gap with evidence.

---

### Task 11: Add P2 Ergonomic Controls After P0/P1

**Files:**
- Modify: `src/app/im/ui/im-channel-list.component.ts`
- Modify: `src/app/im/ui/im-message-list.component.ts`
- Modify: `src/app/im/ui/im-member-panel.component.ts`
- Modify: `src/app/app.component.ts`
- Modify: `src/app/im/im-store.service.ts`
- Add or modify focused WDIO specs for each enabled P2 control.

**Interfaces:**
- Existing Tauri commands should be reused if present.
- Missing helix commands must be recorded in `docs/NEED_HELIX_P2_UI_CONTROLS.md` rather than mocked.

- [ ] **Step 1: Audit command availability**

Run:

```bash
rg -n "enableApproval|change.*permission|change.*picture|change.*props|change.*orient|change.*purpose|change.*notify|remove.*postPinned|load.*postPinned|getSchedule|urgentCancel|approval|notification" src-tauri/src/commands.rs /System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/outbound -S
```

The audit must also cover the P2 holes named in the spec but easy to miss by regex:

- channel info changes
- channel source changes
- historical fallback `posts/get`
- historical fallback `posts/getPostsAfterIndex`

Use this broader grep if the first pass misses them:

```bash
rg -n "enableApproval|change.*(permission|info|source|picture|props|orient|purpose)|change.*notify|remove.*postPinned|load.*postPinned|getSchedule|urgentCancel|approval|notification|posts/get|posts/getPostsAfterIndex|getPostsAfterIndex|im_get_post|im_get_posts_after" src-tauri/src/commands.rs /System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-ui-uc-gap-closure/crates/helix-im/src/outbound -S
```

- [ ] **Step 2: Add controls for commands that already exist**

Use compact icon or mini buttons consistent with existing LoopForge tool surfaces. Required data-testids:

- `enable-approval-btn`
- `channel-info-btn`
- `channel-source-btn`
- `member-notify-btn`
- `post-unpin-btn`
- `post-pinned-load-btn`
- `schedule-list-btn`
- `urgent-cancel-btn`
- `historical-get-post-btn`
- `historical-after-index-btn`
- `approval-action-btn`
- `notification-load-send-btn`
- `notification-load-target-btn`

- [ ] **Step 3: Keep payload construction at the Tauri/helix edge**

Angular may pass IDs and booleans. It must not construct backend-specific nested business maps beyond existing UI input values.

- [ ] **Step 4: Add focused specs**

Each P2 spec must prove at least:

- UI click exists
- Tauri command invoked
- outbound body shape matches current expect JSON or new frozen expect
- render-ready DOM proof exists when the endpoint has a user-visible result

- [ ] **Step 5: Verify P2 batch**

Run the focused specs first, then:

```bash
npm run check:static
npm run check:real-chain
```

Expected:

- P2 controls do not regress P0/P1.
- Missing backend/helix capabilities are documented as NEED files, not marked complete.

---

### Task 12: Final Gate and Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-03-loopforge-ui-uc-gap-spec.md`
- Modify: `docs/uc-rollout/uc-coverage-ledger.md` if this repo already tracks these UC statuses there.
- Modify: `docs/uc-rollout/rollout-checklist.md` if statuses change.

- [ ] **Step 1: Run full local gates**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test -p helix-driver-instrument
npm run check:static
npm run check:real-chain
bash scripts/gate.sh
```

- [ ] **Step 2: Run closure specs**

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-1.4.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-10.1.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-9.x.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.6r.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.7.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-10.3.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.8.e2e.mjs
bash scripts/multi-end-loop.sh --l2
```

- [ ] **Step 3: Update spec status**

For every UC in the original P0/P1/P2 gap lists, set one of:

- closed with archive path
- backend gap with archive path
- helix gap with commit or NEED file
- accepted preflight-only exception, only for UC-12.1 health
- intentionally excluded by scope

- [ ] **Step 4: Final git review**

Run in LoopForge:

```bash
git status --short --untracked-files=all
git diff --stat
```

Run in helix if Task 6/7 changed it:

```bash
cd /System/Volumes/Data/workspace/rust/helix
cd worktrees/loopforge-ui-uc-gap-closure
git status --short --untracked-files=all
git log -1 --oneline
```

Expected:

- no unrelated files staged.
- helix untracked docs that pre-existed remain uncommitted unless explicitly part of this work.

---

## Implementation Order

1. Task 1: evidence archive, because it prevents false closure.
2. Tasks 2-4: UC-1.4 real failure and resend.
3. Task 5: UC-10.1 attribution.
4. Tasks 6-8: P1 helix render-ready plus LoopForge bindings.
5. Task 9: L2 proof reruns.
6. Task 10: announcement write classification/fix.
7. Task 11: P2 ergonomic controls.
8. Task 12: full gate and ledger/spec update.

## Risk Notes

- Task 6 may require a helix commit. Do not update LoopForge pins until helix tests and commit are complete.
- Task 3 may reveal that helix has no legal failed-send projection today. In that case, add an explicit render-ready failed event in helix instead of patching Angular from raw errors.
- L2 tests depend on a healthy `cses-im-server` at `127.0.0.1:8066`.
- P2 endpoints may be service-adjacent rather than user-facing. Missing render-ready output should become a documented gap, not a fake UI pass.

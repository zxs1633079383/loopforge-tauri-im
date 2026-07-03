# LoopForge 全 UC UI/UX 交互补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐所有非排除 UC 的 LoopForge UI/UX 入口、真实 helix/cses-im-server 交互、DOM 状态和自动化证据。

**Architecture:** LoopForge 继续是 Angular 纯渲染壳：组件只展示 signal 和 emit 用户动作，业务语义由 Tauri/helix/cses-im-server 返回 projection/read result 后渲染。右上角账号切换是 debug actor selector，不改变主窗口观察身份；默认 actor 为 `444`，切到 `678` 后发送、@、加急、已读和 L2 动作都走 678 的真实 HTTP 身份。P0 先补证据和 actor 链路，P1 再补 read-result UI surface。

**Tech Stack:** Angular 20 standalone components, Tauri 2, Rust, helix `helix-im`, WebdriverIO 9, Apifox CLI 2.2.5, Bash harnesses, `cses-im-server` on `:8066`.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-07-03-loopforge-all-uc-ui-ux-interaction-spec.md`.
- Excluded: bot / agent domain, `UC-8.x` vote, `UC-8.x` average score.
- `UC-12.1` health remains infrastructure preflight only, not IM UI business closure.
- Apifox suite green proves HTTP only. It must not be reported as WS/projection/DOM/DB proof.
- Real path only: `Angular UI -> ImStoreService -> Tauri invoke -> helix -> cses-im-server -> WS/HTTP -> helix projection/storage -> DOM`.
- Angular must not synthesize business success, failed-send terminal state, unread, mention, urgent, admin, bookmark, announcement, online, modules, or channel-query semantics.
- Main app observation identity remains `444`; sender actor selector defaults to `444` and can switch to `678`.
- When sender actor is `678`, request header/cookie/user must be `678`; changing visible labels alone is a failure.
- Header DOM must expose `data-active-user-id="444"` and `data-sender-user-id="444|678"`.
- Message DOM must expose sender id on the row or avatar as machine-readable `data-user-id`.
- Helix source changes must happen in a helix worktree under `/System/Volumes/Data/workspace/rust/helix/worktrees/`.
- `cses-im-server` source changes must happen in a worktree under `/System/Volumes/Data/workspace/golang/cses-im-server/worktrees/`.
- Before editing any function/class/method, run GitNexus impact for the target symbol and record the blast radius in the task report.
- Every task ends with a focused verification command and a conventional Chinese commit.

---

## File Structure

LoopForge UI and store:

- Modify: `src/app/app.component.ts`  
  Wires sender actor state into status bar/composer actions.
- Modify: `src/app/im/im-store.service.ts`  
  Owns `senderUserId`, actor-aware wrapper methods, and read-result render stores.
- Modify: `src/app/im/ui/im-status-bar.component.ts`  
  Renders right-top `444/678` sender segmented control and debug state data attrs.
- Modify: `src/app/im/ui/im-composer.component.ts`  
  Shows current sender near composer and preserves send/read event contract.
- Modify: `src/app/im/ui/im-message-list.component.ts`  
  Ensures message sender id is machine-readable on each row.
- Modify: `src/app/im/ui/im-aux-panel.component.ts`  
  Renders bookmarks, todos, announcements, modules, channel query results.
- Modify: `src/app/im/ui/im-member-panel.component.ts` and child member components as needed  
  Renders online/member/admin state from projection/read result.
- Modify: `src/app/im/message-row.model.ts`  
  Adds render-only row types for announcements/modules/channel query/online status.

LoopForge Tauri:

- Modify: `src-tauri/src/commands.rs`  
  Makes debug L2 HTTP commands actor-aware with default fallback to `678`.
- Modify: `src-tauri/src/lib.rs` only if new command names are introduced.

LoopForge harness and tests:

- Create: `test/specs/uc-l2-sender-switch.e2e.mjs`
- Create: `test/helpers/dom-evidence.mjs`
- Modify: L2 specs `test/specs/uc-3.1-l2.e2e.mjs`, `uc-3.2-l2.e2e.mjs`, `uc-5.3b-l2.e2e.mjs`, `uc-6.1-l2.e2e.mjs`, `uc-6.2-l2.e2e.mjs`, `uc-11.2-l2.e2e.mjs`
- Modify: P1 specs `test/specs/uc-5.6r.e2e.mjs`, `uc-5.7.e2e.mjs`, `uc-5.8.e2e.mjs`, `uc-9.x.e2e.mjs`, `uc-10.3.e2e.mjs`
- Modify: P0 specs `test/specs/uc-1.4.e2e.mjs`, `uc-10.1.e2e.mjs`
- Modify: `scripts/run.sh`, `scripts/multi-end-loop.sh` only for evidence archive plumbing.
- Modify: `docs/uc-rollout/all-uc-real-chain-status.md`, `docs/uc-rollout/ui-ux-split-runbook.md`, `docs/uc-rollout/l2-evidence-runbook.md`.

Helix, only if LoopForge lacks render-ready events:

- Worktree: `/System/Volumes/Data/workspace/rust/helix/worktrees/loopforge-all-uc-ui-ux`
- Modify: `crates/helix-im/src/port_reply.rs`
- Modify: `crates/helix-im/src/port_reply_emit.rs`
- Modify: `crates/helix-im/docs/projection-schema.md`
- Test: `cargo test -p helix-im read_result`

cses-im-server, only if UC-5.6w proves backend echo is missing:

- Worktree: `/System/Volumes/Data/workspace/golang/cses-im-server/worktrees/loopforge-announcement-echo`
- Expected output: `NEED_CSES_IM_SERVER` resolution commit or an explicit backend-gap report.

---

## Task 1: Sender Actor Contract Tests

**Files:**
- Create: `test/specs/uc-l2-sender-switch.e2e.mjs`
- Modify: `test/specs/uc-3.1-l2.e2e.mjs`
- Modify: `test/specs/uc-3.2-l2.e2e.mjs`

**Interfaces:**
- Consumes existing DOM selectors: `[data-testid="status-bar"]`, `[data-testid="compose-input"]`, `[data-testid="send-btn"]`, `[data-user-id]`.
- Produces failing proof for later tasks: `account-678-btn`, `account-444-btn`, `data-sender-user-id`, actor-aware outbound.

- [ ] **Step 1: Add failing sender-switch WDIO spec**

Create `test/specs/uc-l2-sender-switch.e2e.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";

const jsonl = process.env.HELIX_RUN_JSONL || "/tmp/loopforge/run.jsonl";

function readLines() {
  if (!fs.existsSync(jsonl)) return [];
  return fs.readFileSync(jsonl, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

describe("L2 sender switch · 444/678 真实发送者切换", () => {
  it("默认 444，切到 678 后 composer 以 678 发消息", async () => {
    const status = await $('[data-testid="status-bar"]');
    await status.waitForExist({ timeout: 30000 });

    await browser.waitUntil(
      async () => (await status.getAttribute("data-active-user-id")) === "444",
      { timeout: 10000, interval: 200, timeoutMsg: "status-bar 未暴露 active user 444" },
    );
    assert.equal(await status.getAttribute("data-sender-user-id"), "444");

    await $('[data-testid="account-678-btn"]').click();
    await browser.waitUntil(
      async () => (await status.getAttribute("data-sender-user-id")) === "678",
      { timeout: 10000, interval: 200, timeoutMsg: "发送者未切到 678" },
    );

    const text = `lf-sender-678-${Date.now()}`;
    await $('[data-testid="compose-input"]').setValue(text);
    await $('[data-testid="send-btn"]').click();

    await browser.waitUntil(async () => {
      const rows = await $$(`.msg*=${text}`);
      for (const row of rows) {
        const user = await row.$("[data-user-id]").getAttribute("data-user-id").catch(() => "");
        if (user === "678") return true;
      }
      return false;
    }, { timeout: 30000, interval: 300, timeoutMsg: "678 发送消息未在 DOM 以 sender=678 出现" });

    const outbound = readLines().filter((line) => {
      const textHit = JSON.stringify(line).includes(text);
      const userHit = JSON.stringify(line).includes("678");
      return textHit && userHit && JSON.stringify(line).includes("posts/create");
    });
    assert.ok(outbound.length > 0, "run.jsonl 未记录 678 posts/create 出站");
  });
});
```

- [ ] **Step 2: Run spec and confirm it fails before implementation**

Run:

```bash
node --check test/specs/uc-l2-sender-switch.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-l2-sender-switch.e2e.mjs
```

Expected before implementation: node syntax passes; WDIO fails because `data-sender-user-id` or account switch selector is not implemented.

- [ ] **Step 3: Commit failing test**

```bash
git add test/specs/uc-l2-sender-switch.e2e.mjs
git commit -m "test(im): 增加双账号发送者切换用例"
```

---

## Task 2: Actor-Aware Tauri Debug Commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` only if command registration changes

**Interfaces:**
- Consumes `actorUserId?: string` from Angular for debug-only L2 commands.
- Produces actor-aware commands:
  - `im_l2_send(channelId, text, mentionUserId?, actorUserId?)`
  - `im_l2_read_channel(channelId, actorUserId?)`
  - `im_l2_read_post(channelId, postId, actorUserId?)`
  - `im_l2_urgent_post(channelId, postId, targetIds?, message?, actorUserId?)`

- [ ] **Step 1: Run impact analysis**

Run:

```bash
gitnexus impact --target im_l2_send --direction upstream || true
gitnexus impact --target im_l2_read_channel --direction upstream || true
gitnexus impact --target im_l2_urgent_post --direction upstream || true
```

Record direct callers and risk in the task report. If the CLI is unavailable, run `node .gitnexus/run.cjs impact --target im_l2_send --direction upstream`.

- [ ] **Step 2: Add actor sanitizer in `commands.rs`**

Add near `l2_temp_id()`:

```rust
fn l2_actor(actor_user_id: Option<String>) -> String {
    match actor_user_id.as_deref().map(str::trim) {
        Some("444") => "444".to_string(),
        Some("678") => "678".to_string(),
        _ => "678".to_string(),
    }
}
```

- [ ] **Step 3: Thread actor through debug commands**

Change signatures and hard-coded `"678"` usage:

```rust
pub async fn im_l2_send(
    state: State<'_, AppState>,
    channel_id: String,
    text: String,
    mention_user_id: Option<String>,
    actor_user_id: Option<String>,
) -> Result<String, String> {
    let actor = l2_actor(actor_user_id);
    // existing validation stays the same
    l2_post(&actor, "posts/create", body).await
}
```

Apply the same pattern for read channel, read post, and urgent post. Keep default behavior compatible: missing actor still means `678`.

- [ ] **Step 4: Verify Rust compiles**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check -- src-tauri/src/commands.rs src-tauri/src/lib.rs
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): 支持调试动作指定发送者"
```

---

## Task 3: Right-Top Sender Switch UI

**Files:**
- Modify: `src/app/im/im-store.service.ts`
- Modify: `src/app/im/ui/im-status-bar.component.ts`
- Modify: `src/app/im/ui/im-composer.component.ts`
- Modify: `src/app/im/ui/im-message-list.component.ts`
- Modify: `src/app/app.component.ts`

**Interfaces:**
- Produces `senderUserId(): "444" | "678"` signal.
- Produces `setSenderUserId(userId: "444" | "678"): void`.
- Produces actor-aware store wrappers used by root component:
  - `sendAsSelected(channelId, text)`
  - `readChannelAsSelected(channelId)`
  - `urgentPostAsSelected(channelId, postId, targetIds, message?)`

- [ ] **Step 1: Run impact analysis**

Run:

```bash
gitnexus impact --target ImStoreService --direction upstream || true
gitnexus impact --target ImStatusBarComponent --direction upstream || true
gitnexus impact --target onSend --direction upstream || true
```

- [ ] **Step 2: Add sender signal and actor-aware wrappers**

In `src/app/im/im-store.service.ts`, add:

```ts
type SenderUserId = "444" | "678";

private readonly _senderUserId = signal<SenderUserId>("444");
readonly senderUserId = computed(() => this._senderUserId());

setSenderUserId(userId: SenderUserId): void {
  this._senderUserId.set(userId);
}

async sendAsSelected(channelId: string, text: string): Promise<void> {
  if (this.senderUserId() === "678") {
    return this.l2Send(channelId, text, undefined, "678");
  }
  return this.send(channelId, text);
}
```

Update `l2Send`, `l2ReadChannel`, `l2ReadPost`, and `l2UrgentPost` to accept `actorUserId: "444" | "678" = "678"` and pass it to Tauri.

- [ ] **Step 3: Replace status-bar action buttons with segmented sender control**

In `src/app/im/ui/im-status-bar.component.ts`, expose:

```ts
@Input() senderUserId: "444" | "678" = "444";
@Output() senderUserIdChange = new EventEmitter<"444" | "678">();
```

Set header attrs:

```html
<header
  class="im__hd"
  data-testid="status-bar"
  [attr.data-active-user-id]="currentUserId || '444'"
  [attr.data-sender-user-id]="senderUserId"
>
```

Render buttons:

```html
<button data-testid="account-444-btn" [class.im__acct-active]="senderUserId === '444'" (click)="senderUserIdChange.emit('444')">444</button>
<button data-testid="account-678-btn" [class.im__acct-active]="senderUserId === '678'" (click)="senderUserIdChange.emit('678')">678</button>
```

Keep explicit L2 buttons only if they use current `senderUserId` in labels and events; do not keep hard-coded `678 发` as the primary composer path.

- [ ] **Step 4: Wire root component**

In `src/app/app.component.ts`, pass:

```html
[senderUserId]="store.senderUserId()"
(senderUserIdChange)="store.setSenderUserId($event)"
```

Update `onSend()`:

```ts
onSend(): void {
  const channelId = this.store.activeChannel();
  const text = this.draft.trim();
  if (!channelId || !text) return;
  this.draft = "";
  void this.store.sendAsSelected(channelId, text);
}
```

For `onReadChannel()` and `onSendUrgent()`, use actor-aware wrappers so sender `678` triggers debug L2 HTTP and sender `444` uses existing main identity command.

- [ ] **Step 5: Expose sender in composer and message row**

In `im-composer.component.ts`, add `@Input() senderUserId: "444" | "678" = "444"` and render:

```html
<span class="im__compose-to" [attr.data-composer-sender-user-id]="senderUserId">
  From <strong>{{ senderUserId }}</strong>
</span>
```

In `im-message-list.component.ts`, add row-level sender attr:

```html
[attr.data-user-id]="m.userId ?? null"
```

on the `.msg` root div, not only on the avatar.

- [ ] **Step 6: Verify**

Run:

```bash
npm run check:static
bash scripts/multi-end-loop.sh --spec test/specs/uc-l2-sender-switch.e2e.mjs
```

Expected: spec passes and shows 678 DOM sender plus 678 outbound.

- [ ] **Step 7: Commit**

```bash
git add src/app/app.component.ts src/app/im/im-store.service.ts src/app/im/ui/im-status-bar.component.ts src/app/im/ui/im-composer.component.ts src/app/im/ui/im-message-list.component.ts
git commit -m "feat(ui): 增加右上角发送者账号切换"
```

---

## Task 4: Evidence Archive For UI and L2 Specs

**Files:**
- Create: `test/helpers/dom-evidence.mjs`
- Modify: `scripts/run.sh`
- Modify: `scripts/multi-end-loop.sh`
- Modify: L2 WDIO specs listed in File Structure
- Modify: `docs/uc-rollout/l2-evidence-runbook.md`

**Interfaces:**
- Produces `LOOPFORGE_EVIDENCE_DIR`.
- Produces `captureDomEvidence(browser, name, selectors)`.

- [ ] **Step 1: Add evidence helper**

Create `test/helpers/dom-evidence.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

export async function captureDomEvidence(browser, name, selectors) {
  const outDir = process.env.LOOPFORGE_EVIDENCE_DIR || "/tmp/loopforge/evidence";
  fs.mkdirSync(outDir, { recursive: true });
  const snapshot = await browser.execute((inputSelectors) => {
    const read = (selector) => [...document.querySelectorAll(selector)].map((node) => ({
      text: node.textContent?.trim() || "",
      attrs: Object.fromEntries([...node.attributes].map((attr) => [attr.name, attr.value])),
    }));
    return Object.fromEntries(inputSelectors.map((selector) => [selector, read(selector)]));
  }, selectors);
  const file = path.join(outDir, `${name}.dom.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}
```

- [ ] **Step 2: Export evidence dir in `scripts/run.sh`**

Before WDIO starts:

```bash
export LOOPFORGE_EVIDENCE_DIR="${LOOPFORGE_EVIDENCE_DIR:-$RUN_LOG_DIR/evidence}"
mkdir -p "$LOOPFORGE_EVIDENCE_DIR"
```

- [ ] **Step 3: Preserve evidence in `scripts/multi-end-loop.sh`**

When archiving a spec, copy:

```bash
if [ -d "$RUN_LOG_DIR/evidence" ]; then
  mkdir -p "$spec_dir/evidence"
  cp -R "$RUN_LOG_DIR/evidence/." "$spec_dir/evidence/"
fi
```

- [ ] **Step 4: Add captures to L2 specs**

In each L2 spec after convergence, import and call:

```js
import { captureDomEvidence } from "../helpers/dom-evidence.mjs";

await captureDomEvidence(browser, "uc-3.1-l2-read", [
  "[data-testid='status-bar']",
  "[data-channel-id]",
  "[data-read-bits]",
  "[data-unread]",
]);
```

Use member/admin selectors for UC-6.1/6.2 and channel selectors for UC-5.3/11.2.

- [ ] **Step 5: Verify one L2 archive**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-3.1-l2.e2e.mjs
find /tmp/loopforge -path '*evidence/*.dom.json' -maxdepth 6 -type f | head
```

Expected: at least one `.dom.json` exists for the spec archive.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/dom-evidence.mjs scripts/run.sh scripts/multi-end-loop.sh test/specs/*-l2.e2e.mjs docs/uc-rollout/l2-evidence-runbook.md
git commit -m "test(im): 归档 L2 DOM 证据"
```

---

## Task 5: UC-1.4 Real Failed Send Live Closure

**Files:**
- Modify: `test/specs/uc-1.4.e2e.mjs`
- Modify: `docs/uc-rollout/all-uc-real-chain-status.md`
- Modify: `src-tauri/Cargo.toml` only if helix pin must move to the failed-send fix commit
- Modify: `crates/helix-driver-instrument/Cargo.toml` only if helix pin must move

**Interfaces:**
- Consumes helix failed-send projection `im:post:send-failed`.
- Produces live evidence for failed -> sending -> sent on same temporaryId.

- [ ] **Step 1: Pin LoopForge to helix failed-send commit if needed**

Check current pins:

```bash
rg -n "rev =|helix" src-tauri/Cargo.toml crates/helix-driver-instrument/Cargo.toml
```

If the current rev is older than helix commit containing `im:post:send-failed` with nonempty channelId, update all helix git revs to that commit.

- [ ] **Step 2: Verify UC-1.4 spec uses active failure injection**

The spec must:

```js
const text = `lf-resend-${Date.now()}`;
await $('[data-testid="compose-input"]').setValue(text);
await $('[data-testid="send-btn"]').click();
const failed = await $(`[data-send-status="failed"][data-temporary-id]`);
await failed.waitForExist({ timeout: 30000 });
```

It must click `[data-testid="resend-btn"]` inside the failed row and assert same `data-temporary-id`.

- [ ] **Step 3: Run focused live test**

Run:

```bash
node --check test/specs/uc-1.4.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-1.4.e2e.mjs
```

Expected: archive shows two `posts/create` attempts with the same temporaryId, a failed projection, and final sent row.

- [ ] **Step 4: Update ledger honestly**

Update `docs/uc-rollout/all-uc-real-chain-status.md`:

```markdown
UC-1.4: green when archive contains failed projection + same temporaryId resend + final sent DOM row.
```

- [ ] **Step 5: Commit**

```bash
git add test/specs/uc-1.4.e2e.mjs docs/uc-rollout/all-uc-real-chain-status.md src-tauri/Cargo.toml crates/helix-driver-instrument/Cargo.toml
git commit -m "test(im): 闭环 UC-1.4 真实失败重发"
```

---

## Task 6: UC-10.1 Todo Attribution Closure

**Files:**
- Modify: `test/specs/uc-10.1.e2e.mjs`
- Modify: `test/reducer/four-facet-reducer.mjs` only if the reducer owns UC window attribution
- Modify: `docs/uc-rollout/all-uc-real-chain-status.md`

**Interfaces:**
- Produces UC-window-owned todo evidence, not `__quiescence__`.

- [ ] **Step 1: Identify current attribution**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-10.1.e2e.mjs
rg -n "__quiescence__|UC-10.1|posts/queryTodoList|im:todo:updated" /tmp/loopforge -g '*.jsonl' -g '*.log' -g '*.md'
```

Expected before fix: todo action may be attributed outside UC window.

- [ ] **Step 2: Move UC marker before todo trigger**

In `test/specs/uc-10.1.e2e.mjs`, ensure:

```js
await invokeBridge("set_uc", { uc: "UC-10.1" });
await $('[data-testid="todo-list-btn"]').click();
```

If the UI has no todo button, use the AX panel entry and add the missing selector in Task 7 rather than bridge-only invocation.

- [ ] **Step 3: Adjust reducer only if ownership logic is wrong**

If `run.jsonl` has `UC-10.1` marker before outbound but reducer still assigns `__quiescence__`, update the reducer attribution rule to prefer the latest explicit `set_uc` marker for self-driven read-result flows.

- [ ] **Step 4: Verify**

Run:

```bash
node --check test/specs/uc-10.1.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-10.1.e2e.mjs
```

Expected: summary assigns outbound/projection/DOM to `UC-10.1`.

- [ ] **Step 5: Commit**

```bash
git add test/specs/uc-10.1.e2e.mjs test/reducer/four-facet-reducer.mjs docs/uc-rollout/all-uc-real-chain-status.md
git commit -m "test(im): 修正 UC-10.1 待办归属"
```

---

## Task 7: P1 Read-Result UI Surfaces

**Files:**
- Modify: `src/app/im/message-row.model.ts`
- Modify: `src/app/im/im-store.service.ts`
- Modify: `src/app/im/ui/im-aux-panel.component.ts`
- Modify: `src/app/im/ui/im-member-panel.component.ts`
- Modify: `src/app/im/ui/im-channel-list.component.ts`
- Modify: P1 WDIO specs:
  - `test/specs/uc-5.6r.e2e.mjs`
  - `test/specs/uc-5.7.e2e.mjs`
  - `test/specs/uc-5.8.e2e.mjs`
  - `test/specs/uc-9.x.e2e.mjs`
  - `test/specs/uc-10.3.e2e.mjs`

**Interfaces:**
- Produces render-only rows:
  - `AnnouncementRow { announcementId, postId, title, message }`
  - `ModuleRow { moduleId, name }`
  - `QueryChannelRow { channelId, displayName }`
  - `OnlineStatusRow { channelId, onlineCount }`
- Consumes `im:read:result { req_id, body }`.

- [ ] **Step 1: Add render row models**

In `message-row.model.ts` add exported interfaces with exact string fields and nullable display fields:

```ts
export interface AnnouncementRow {
  announcementId: string;
  postId: string;
  message: string;
}

export interface ModuleRow {
  moduleId: string;
  name: string;
}

export interface QueryChannelRow {
  channelId: string;
  displayName: string;
}

export interface OnlineStatusRow {
  channelId: string;
  onlineCount: number;
}
```

- [ ] **Step 2: Add store signals**

In `ImStoreService`, add signals/computed:

```ts
private readonly _announcements = signal<AnnouncementRow[]>([]);
readonly announcements = computed(() => this._announcements());
private readonly _modules = signal<ModuleRow[]>([]);
readonly modules = computed(() => this._modules());
private readonly _queryChannels = signal<QueryChannelRow[]>([]);
readonly queryChannels = computed(() => this._queryChannels());
private readonly _onlineStatuses = signal<OnlineStatusRow[]>([]);
readonly onlineStatuses = computed(() => this._onlineStatuses());
```

- [ ] **Step 3: Route read results by reqId prefix**

When issuing calls, make request ids deterministic:

```ts
const rid = reqId || `announcement-list-${Date.now()}`;
```

In `applyReadResult`, dispatch by `req_id` prefix:

```ts
if (reqId.startsWith("bookmark-load-")) this.applyBookmarkLoad(body);
if (reqId.startsWith("announcement-list-")) this.applyAnnouncementList(body);
if (reqId.startsWith("modules-get-all-")) this.applyModules(body);
if (reqId.startsWith("channel-query-")) this.applyChannelQuery(body);
if (reqId.startsWith("online-status-")) this.applyOnlineStatus(body);
```

Each apply method only maps response fields to render fields; no business inference.

- [ ] **Step 4: Render AX and MB panels**

In `im-aux-panel.component.ts`, render:

```html
@for (b of bookmarks; track b.bookmarkId) {
  <div data-bookmark-id="{{ b.bookmarkId }}">{{ b.message }}</div>
}
@for (a of announcements; track a.announcementId) {
  <div [attr.data-announcement-id]="a.announcementId" [attr.data-post-id]="a.postId">{{ a.message }}</div>
}
@for (m of modules; track m.moduleId) {
  <div [attr.data-module-id]="m.moduleId">{{ m.name }}</div>
}
@for (c of queryChannels; track c.channelId) {
  <div [attr.data-query-channel-id]="c.channelId">{{ c.displayName }}</div>
}
```

In member panel, render online status:

```html
<span [attr.data-online-count]="onlineCount">{{ onlineCount }}</span>
```

- [ ] **Step 5: Verify P1 specs**

Run:

```bash
npm run check:static
bash scripts/multi-end-loop.sh --spec test/specs/uc-9.x.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.6r.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.7.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-10.3.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.8.e2e.mjs
```

Expected: each spec asserts at least one corresponding `data-*` row or honest empty-state with response evidence.

- [ ] **Step 6: Commit**

```bash
git add src/app/im/message-row.model.ts src/app/im/im-store.service.ts src/app/im/ui/im-aux-panel.component.ts src/app/im/ui/im-member-panel.component.ts src/app/im/ui/im-channel-list.component.ts test/specs/uc-9.x.e2e.mjs test/specs/uc-5.6r.e2e.mjs test/specs/uc-5.7.e2e.mjs test/specs/uc-10.3.e2e.mjs test/specs/uc-5.8.e2e.mjs
git commit -m "feat(ui): 渲染读族结果面板"
```

---

## Task 8: L2 Broadcast Closure

**Files:**
- Modify: L2 specs:
  - `test/specs/uc-3.1-l2.e2e.mjs`
  - `test/specs/uc-3.2-l2.e2e.mjs`
  - `test/specs/uc-5.3b-l2.e2e.mjs`
  - `test/specs/uc-6.1-l2.e2e.mjs`
  - `test/specs/uc-6.2-l2.e2e.mjs`
  - `test/specs/uc-11.2-l2.e2e.mjs`
- Modify: `docs/uc-rollout/all-uc-real-chain-status.md`

**Interfaces:**
- Consumes `captureDomEvidence`.
- Produces projection + DOM L2 archive for each P0 L2 gap.

- [ ] **Step 1: Run all L2 specs individually**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-3.1-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-3.2-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.3b-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-6.1-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-6.2-l2.e2e.mjs
bash scripts/multi-end-loop.sh --spec test/specs/uc-11.2-l2.e2e.mjs
```

- [ ] **Step 2: Classify failures**

For each red spec, classify using exact evidence:

```text
UI selector failure -> fix LoopForge UI/test selector.
Projection missing -> NEED_HELIX with run.jsonl excerpt.
Backend WS missing -> NEED_CSES_IM_SERVER with Go log and request body.
Raw WS only -> add DOM evidence assertion before marking green.
```

- [ ] **Step 3: Update specs to assert DOM evidence**

Each L2 spec must assert a concrete observer DOM state:

```js
assert.ok(fs.existsSync(domEvidenceFile), "L2 DOM evidence file missing");
```

and must fail if expected `data-admin`, `data-read-bits`, `data-channel-id`, or `data-member-id` is absent.

- [ ] **Step 4: Update ledger**

Mark green only when the archive has:

```text
run.jsonl + wdio-out.log + summary.md + evidence/*.dom.json
```

- [ ] **Step 5: Commit**

```bash
git add test/specs/uc-3.1-l2.e2e.mjs test/specs/uc-3.2-l2.e2e.mjs test/specs/uc-5.3b-l2.e2e.mjs test/specs/uc-6.1-l2.e2e.mjs test/specs/uc-6.2-l2.e2e.mjs test/specs/uc-11.2-l2.e2e.mjs docs/uc-rollout/all-uc-real-chain-status.md
git commit -m "test(im): 补齐 L2 广播 DOM 证据"
```

---

## Task 9: UC-5.6w Announcement Write Decision

**Files:**
- Modify: `test/specs/uc-5.6w.e2e.mjs`
- Modify: `docs/uc-rollout/all-uc-real-chain-status.md`
- Create if backend is missing: `NEED_CSES_IM_SERVER_announcement_echo.md`

**Interfaces:**
- Produces either green real echo evidence or a backend-gap document with exact request/response/log.

- [ ] **Step 1: Run focused announcement write**

Run:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-5.6w.e2e.mjs
```

- [ ] **Step 2: If green, assert UI echo**

Ensure the spec asserts:

```js
await $(`[data-announcement-id][data-post-id="${postId}"]`).waitForExist({ timeout: 30000 });
```

or equivalent projection-driven post update DOM.

- [ ] **Step 3: If backend echo is absent, write NEED file**

Create `NEED_CSES_IM_SERVER_announcement_echo.md`:

```markdown
# NEED_CSES_IM_SERVER: UC-5.6w announcement echo

Gap: post/announcement/save accepts HTTP but no observable WS/projection echo reaches LoopForge.

Expected:
- request: post/announcement/save
- actor: cookieId 444
- channelId: <real channel id from run>
- response: HTTP success
- follow-up: WS post_update or equivalent event carrying announcement post state

Evidence:
- run.jsonl archive: <path>
- Go log excerpt: <path or pasted short excerpt>
```

- [ ] **Step 4: Commit**

```bash
git add test/specs/uc-5.6w.e2e.mjs docs/uc-rollout/all-uc-real-chain-status.md NEED_CSES_IM_SERVER_announcement_echo.md
git commit -m "test(im): 裁定 UC-5.6w 公告写回显"
```

---

## Task 10: Full UI, Apifox, and Visual Closure

**Files:**
- Modify: `docs/uc-rollout/all-uc-real-chain-status.md`
- Modify: `docs/uc-rollout/ui-ux-split-runbook.md`
- Modify: `docs/uc-rollout/apifox-http-suite-runbook.md`

**Interfaces:**
- Produces final report separating HTTP green from UI/WS/DOM proof.

- [ ] **Step 1: Run static and area gates**

```bash
npm run check:static
bash scripts/multi-end-loop.sh --area CL
bash scripts/multi-end-loop.sh --area ML
bash scripts/multi-end-loop.sh --area CP
bash scripts/multi-end-loop.sh --area MB
bash scripts/multi-end-loop.sh --area AX
```

- [ ] **Step 2: Run full WDIO suite**

```bash
bash scripts/multi-end-loop.sh --all
```

Expected: excluded UC-8.x and UC-12.1 IM proof remain excluded/preflight; all non-excluded UI specs pass or have explicit backend/helix NEED file.

- [ ] **Step 3: Run Apifox HTTP suite**

```bash
APIFOX_PROFILE=go-only APIFOX_TOKEN="$APIFOX_TOKEN" bash scripts/run-apifox-go-only.sh
```

Expected: Apifox report has zero failed Go HTTP cases. If `APIFOX_TOKEN` is absent, mark blocked as `missing secure APIFOX_TOKEN`; do not fake a green report.

- [ ] **Step 4: Capture UI screenshots**

```bash
node scripts/capture-ui-screenshots.mjs --out /tmp/loopforge/ui-final
ls -lh /tmp/loopforge/ui-final/desktop.png /tmp/loopforge/ui-final/mobile.png
```

Expected: both PNG files exist and are non-empty.

- [ ] **Step 5: Update final docs**

In `docs/uc-rollout/all-uc-real-chain-status.md`, each non-excluded UC must be one of:

```text
green
partial: NEED_HELIX <file>
partial: NEED_CSES_IM_SERVER <file>
night-only: UC-1.3 upload
excluded: bot/agent/vote/average/UC-12.1 IM proof
```

- [ ] **Step 6: Commit**

```bash
git add docs/uc-rollout/all-uc-real-chain-status.md docs/uc-rollout/ui-ux-split-runbook.md docs/uc-rollout/apifox-http-suite-runbook.md
git commit -m "docs(im): 汇总全 UC UI 交互闭环证据"
```

---

## Self-Review

Spec coverage:

- Right-top 444/678 sender switch: Task 1, Task 2, Task 3.
- UC-1.4 failed resend: Task 5.
- UC-10.1 todo attribution: Task 6.
- L2 read/member/admin/quit evidence: Task 4 and Task 8.
- P1 read-result surfaces: Task 7.
- Announcement write backend decision: Task 9.
- Apifox HTTP boundary and final UI gates: Task 10.

Placeholder scan:

- The plan intentionally avoids placeholder steps and generic deferred work wording.
- Backend/helix uncertainty is handled by concrete NEED files with required evidence fields.

Type consistency:

- Sender actor is consistently represented as `"444" | "678"`.
- Tauri debug commands consistently accept optional `actorUserId`.
- DOM selectors align with the spec: `data-active-user-id`, `data-sender-user-id`, `data-user-id`.

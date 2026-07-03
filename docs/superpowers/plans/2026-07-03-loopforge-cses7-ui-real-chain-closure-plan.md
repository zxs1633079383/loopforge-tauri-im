# LoopForge CSES7 UI + Real-Chain Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the current real-chain green path, rerun Apifox go-only through safe token injection, and start the cses7 message-page UI reskin with a finer MB member-area component split.

**Architecture:** Keep Angular as a pure render shell. Root `AppComponent` remains the store/Tauri edge; MB child components only bind inputs and emit outputs. Harness changes wrap existing `multi-end-loop.sh` rather than duplicating the live UI/Tauri/helix/Go path.

**Tech Stack:** Angular 20 standalone components, Tauri 2, WebdriverIO 9, Bash harnesses, Apifox CLI, Node 22 scripts, `cses-im-server` on port 8066.

## Global Constraints

- Real path only: Angular UI -> ImStoreService -> Tauri invoke -> helix -> cses-im-server -> helix projection/storage -> DOM.
- No mock data, no fake success state, no debug patch, no random fake server id.
- Apifox token must come from `APIFOX_TOKEN`; never commit or echo a real token.
- Apifox profile for this round is `go-only`; vote and average-score Java scenarios stay excluded.
- UC-3.1 / UC-6.2 / UC-11.2 keep current L2 boundary and must not be upgraded to four-facet L1.
- Child UI components must not inject `ImStoreService`, call Tauri, call helix, or apply business rules.
- Existing expect JSON and frozen upstream contracts are read-only.
- CSES7 visual baseline is `http://pd.cses7.com/message/pages/message/index.html`, with captured evidence `/tmp/cses7-message-desktop.png` and `/tmp/cses7-message-mobile.png`.

---

## File Structure

Create:

- `src/app/im/ui/im-member-panel-header.component.ts`  
  Header row: title, member count, load button.

- `src/app/im/ui/im-member-actions.component.ts`  
  Member id input plus join/leave buttons.

- `src/app/im/ui/im-member-row.component.ts`  
  One member row, preserving member data attributes and emitting nickname/admin changes.

- `src/app/im/ui/im-member-empty.component.ts`  
  Empty state only; no fake member rows.

- `scripts/run-apifox-go-only.sh`  
  Safe wrapper around `scripts/multi-end-loop.sh --apifox` with `APIFOX_PROFILE=go-only`.

Modify:

- `src/app/im/ui/im-member-panel.component.ts`  
  Convert to composition shell.

- `src/app/app.component.ts`  
  Import no new store logic; update styles to match cses7 visual tokens and new MB class names.

- `package.json`  
  Add `apifox:go-only` convenience script.

- `docs/uc-rollout/apifox-http-suite-runbook.md`  
  Document safe token injection and go-only rerun command.

Test:

- `node --check scripts/uc-spec-list.mjs`
- `node --check scripts/scan-real-chain-violations.mjs`
- `bash scripts/run-apifox-go-only.sh --dry-run`
- `npm run check:static`
- `npm run check:specs`
- `npm run check:real-chain`
- `bash scripts/gate.sh`
- `bash scripts/multi-end-loop.sh --area MB`

---

### Task 1: Safe Apifox Go-Only Wrapper

**Files:**
- Create: `scripts/run-apifox-go-only.sh`
- Modify: `package.json`
- Modify: `docs/uc-rollout/apifox-http-suite-runbook.md`

**Interfaces:**
- Consumes: `APIFOX_TOKEN` from environment.
- Produces: `APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox` execution without embedding secrets.

- [ ] **Step 1: Add wrapper script**

Create `scripts/run-apifox-go-only.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "--dry-run" ]; then
  echo "APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox"
  exit 0
fi

if [ -z "${APIFOX_TOKEN:-}" ]; then
  echo "APIFOX_TOKEN is required. Export it in the shell environment; do not put it in this script or git-tracked files." >&2
  exit 2
fi

export APIFOX_PROFILE=go-only
exec bash "$ROOT/scripts/multi-end-loop.sh" --apifox "$@"
```

- [ ] **Step 2: Make wrapper executable**

Run:

```bash
chmod +x scripts/run-apifox-go-only.sh
```

- [ ] **Step 3: Add npm script**

Add to `package.json` scripts:

```json
"apifox:go-only": "bash scripts/run-apifox-go-only.sh"
```

- [ ] **Step 4: Update runbook**

Add a section to `docs/uc-rollout/apifox-http-suite-runbook.md`:

```markdown
## Go-only safe rerun

Current closure profile excludes Java vote and average-score scenarios:

```bash
export APIFOX_TOKEN=<PAT from secure shell/session secret>
npm run apifox:go-only
```

The token must stay in process environment only. Do not write the real token into scripts, docs, command history examples, or committed files.
```

- [ ] **Step 5: Verify wrapper**

Run:

```bash
bash scripts/run-apifox-go-only.sh --dry-run
```

Expected:

```text
APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox
```

---

### Task 2: MB Member Area Component Split

**Files:**
- Create: `src/app/im/ui/im-member-panel-header.component.ts`
- Create: `src/app/im/ui/im-member-actions.component.ts`
- Create: `src/app/im/ui/im-member-row.component.ts`
- Create: `src/app/im/ui/im-member-empty.component.ts`
- Modify: `src/app/im/ui/im-member-panel.component.ts`

**Interfaces:**
- Consumes: `MemberRow` from `src/app/im/message-row.model.ts`.
- Produces: same public `ImMemberPanelComponent` inputs and outputs as before.

- [ ] **Step 1: Create header component**

`ImMemberPanelHeaderComponent` inputs/outputs:

```ts
@Input() count = 0;
@Output() loadMembersClick = new EventEmitter<void>();
```

It must render the existing `data-testid="load-members-btn"` button.

- [ ] **Step 2: Create actions component**

`ImMemberActionsComponent` outputs:

```ts
@Output() memberChange = new EventEmitter<{ action: MemberChangeAction; memberId: string }>();
```

It must preserve:

- `data-testid="change-member-input"`
- `data-testid="change-member-btn"`
- `data-testid="kick-member-btn"`

- [ ] **Step 3: Create row component**

`ImMemberRowComponent` inputs/outputs:

```ts
@Input({ required: true }) member!: MemberRow;
@Output() nicknameChange = new EventEmitter<{ memberId: string; nickname: string }>();
@Output() managerChange = new EventEmitter<{ memberId: string; set: boolean }>();
```

It must preserve:

- `data-member-id`
- `data-admin`
- `data-nickname`
- `data-testid="change-nickname-input"`
- `data-testid="change-nickname-btn"`
- `data-testid="change-manger-btn"`

- [ ] **Step 4: Create empty component**

Render a small empty state with class `mem-empty`. It must not emit events and must not create any `data-member-id` row.

- [ ] **Step 5: Compose in panel**

`ImMemberPanelComponent` keeps:

```ts
@Input() members: readonly MemberRow[] = [];
@Input() membersAttr = "";
@Output() loadMembersClick = new EventEmitter<void>();
@Output() memberChange = new EventEmitter<{ action: MemberChangeAction; memberId: string }>();
@Output() nicknameChange = new EventEmitter<{ memberId: string; nickname: string }>();
@Output() managerChange = new EventEmitter<{ memberId: string; set: boolean }>();
```

The outer `<aside>` must keep:

- `data-testid="member-list"`
- `[attr.data-member-count]="members.length"`
- `[attr.data-members]="membersAttr || null"`

- [ ] **Step 6: Verify Angular compile**

Run:

```bash
npm run check:static
```

---

### Task 3: CSES7 Visual Reskin

**Files:**
- Modify: `src/app/app.component.ts`

**Interfaces:**
- Consumes: existing class names from child component templates.
- Produces: same DOM data attributes and test ids, updated visual layout.

- [ ] **Step 1: Update design tokens**

Align root CSS variables to cses7 baseline:

```css
--top: #2c2a3a;
--rail: #413f50;
--canvas: #F5F7FB;
--active: #E6E8ED;
--pinned: #F4F6F9;
--accent: #4857e2;
--cyan: #00baa0;
```

- [ ] **Step 2: Update channel and message layout**

Keep the left channel width as:

```css
width: clamp(240px, 30vw, 330px);
```

Keep message area as `#F5F7FB`, white bubbles, compact 12-16px typography, no marketing-card layout.

- [ ] **Step 3: Update MB styles**

Add styles for:

- `.mem-panel__head`
- `.mem-panel__title`
- `.mem-panel__count`
- `.mem-panel__actions`
- `.mem-empty`

Do not hide MB on mobile because UC tests rely on `member-list`.

- [ ] **Step 4: Verify screenshot path still works**

Run:

```bash
node --check scripts/capture-ui-screenshots.mjs
```

---

### Task 4: Boundary and Gate Verification

**Files:**
- No source edits unless a gate reports a real defect.

**Interfaces:**
- Consumes: changes from Tasks 1-3.
- Produces: command evidence and archive paths.

- [ ] **Step 1: Static gates**

Run:

```bash
npm run check:static
npm run check:specs
npm run check:real-chain
bash scripts/gate.sh
```

- [ ] **Step 2: MB real-chain gate**

Run:

```bash
bash scripts/multi-end-loop.sh --area MB
```

- [ ] **Step 3: Apifox go-only**

Only run when `APIFOX_TOKEN` exists in the environment:

```bash
npm run apifox:go-only
```

If `APIFOX_TOKEN` is absent, mark Apifox as `blocked: missing secure env token`, not green.

- [ ] **Step 4: Boundary scan**

Confirm docs/specs still state UC-3.1, UC-6.2, UC-11.2 L2 boundaries:

```bash
rg -n "UC-3\\.1|UC-6\\.2|UC-11\\.2|L2" docs/superpowers/specs/2026-07-03-loopforge-cses7-ui-real-chain-closure-spec.md test/expect/uc-3.1.expect.json test/expect/uc-6.2.expect.json test/expect/uc-11.2.expect.json
```

Expected: all three UCs show L2 boundary wording.

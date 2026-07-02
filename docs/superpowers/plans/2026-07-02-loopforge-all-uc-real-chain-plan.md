# LoopForge All-UC Real-Chain Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete LoopForge all-UC closure pipeline: status ledger, multi-end harness, UI/UX visual gates, L1/L2 WDIO execution, Apifox HTTP gate, and final truthful report.

**Architecture:** Keep Angular as a pure render shell. Keep `ImStoreService` as the only UI state/business edge. Use `scripts/multi-end-loop.sh` as the orchestrator for static gates, live WDIO specs, Apifox, screenshots, and log archiving. Use docs under `docs/uc-rollout/` as the human and machine-readable ledger.

**Tech Stack:** Angular 20 standalone components, Tauri 2, WebdriverIO 9, Node 22 scripts, Bash harnesses, Apifox CLI, Rust helix path/git dependency, Go `cses-im-server` on port 8066.

## Global Constraints

- Real path only: Angular UI -> ImStoreService -> Tauri invoke -> helix -> cses-im-server -> HTTP/WS -> helix projection/storage -> DOM.
- No mock data, no fake success state, no debug patch, no random fake server id.
- Child UI components must not inject `ImStoreService`, call Tauri, call helix, or apply business rules.
- Apifox green means HTTP preflight green only; it must never be reported as WS/DOM/client full green.
- `test/expect/*.expect.json`, projection schema, and true wire contract docs are read-only unless a human approves a contract update.
- Every red/green UC result must be backed by `/tmp/loopforge/run.jsonl`, WDIO output, Tauri/helix log, Go log, Apifox report, or a documented N/A reason.
- L2 broadcast/read/admin/member results require a real second connection.
- Existing user changes in the worktree must not be reverted.

---

## File Structure

Create:

- `docs/uc-rollout/all-uc-real-chain-status.md`  
  Machine-readable and human-readable status ledger for all UC, with L0/L1/L2/HTTP/style status.

- `docs/uc-rollout/reports/README.md`  
  Explains where full-run reports and screenshots are archived.

- `docs/uc-rollout/reports/.gitkeep`  
  Keeps the reports directory present without committing bulky artifacts.

- `scripts/uc-spec-list.mjs`  
  Produces deterministic L1/L2/spec-area lists consumed by `multi-end-loop.sh`.

- `scripts/scan-real-chain-violations.mjs`  
  Scans source/tests for banned debug hooks, fake server ids, and suspicious random id usage.

- `scripts/capture-ui-screenshots.mjs`  
  Uses the browser automation available in this project environment or a documented fallback command to capture desktop/mobile screenshots.

- `scripts/summarize-run-report.mjs`  
  Reads archived logs and produces a short JSON/Markdown summary.

Modify:

- `scripts/multi-end-loop.sh`  
  Add `--all`, `--area`, `--l2`, `--apifox`, `--screenshot`, `--archive-dir`, Go log health checks, report archiving, and deterministic spec selection.

- `scripts/gate.sh`  
  Add the real-chain violation scan and spec list validation.

- `docs/uc-rollout/rollout-checklist.md`  
  Align stale UC status wording and final statistics.

- `docs/uc-coverage-ledger.md`  
  Align stale current truth, especially all-UC count, UC-1.4, UC-6.1, UC-6.2, UC-8.x, and Apifox boundaries.

- `docs/uc-rollout/coverage-crossmap.md`  
  Align endpoint coverage labels with real L1/L2/HTTP-only meanings.

- `docs/uc-rollout/ui-e2e-real-flow-runbook.md`  
  Replace current known red/non-complete entries after each phase validates.

- `docs/uc-rollout/ui-ux-split-runbook.md`  
  Mark area representative runs as they pass.

- `package.json`  
  Add convenience scripts for static gates, spec checks, all-UC loop, screenshots, and scans.

Test:

- `node --check scripts/uc-spec-list.mjs`
- `node --check scripts/scan-real-chain-violations.mjs`
- `node --check scripts/capture-ui-screenshots.mjs`
- `node --check scripts/summarize-run-report.mjs`
- `bash scripts/multi-end-loop.sh --list`
- `bash scripts/multi-end-loop.sh --area MB`
- `bash scripts/gate.sh`

---

### Task 1: Establish The All-UC Status Ledger

**Files:**
- Create: `docs/uc-rollout/all-uc-real-chain-status.md`
- Create: `docs/uc-rollout/reports/README.md`
- Create: `docs/uc-rollout/reports/.gitkeep`
- Modify: `docs/uc-rollout/rollout-checklist.md`
- Modify: `docs/uc-coverage-ledger.md`
- Modify: `docs/uc-rollout/coverage-crossmap.md`
- Modify: `docs/uc-rollout/ui-e2e-real-flow-runbook.md`
- Modify: `docs/uc-rollout/ui-ux-split-runbook.md`

**Interfaces:**
- Consumes: Spec file `docs/superpowers/specs/2026-07-02-loopforge-all-uc-real-chain-spec.md`.
- Produces: `docs/uc-rollout/all-uc-real-chain-status.md` with one row per UC and these columns: `UC`, `Area`, `Level`, `Status`, `Spec`, `Expect`, `Required Evidence`, `Current Evidence`, `Next Action`.

- [ ] **Step 1: Create the ledger skeleton**

Add `docs/uc-rollout/all-uc-real-chain-status.md` with this exact header and table shape:

```markdown
# All-UC Real-Chain Status

> This file is the execution ledger for all LoopForge UC closure work.
> Status values are: `green`, `partial`, `l2-required`, `http-only`, `night-only`, `blocked`, `excluded`, `not-run`.
> Apifox results are recorded as HTTP preflight only and never replace WDIO/reducer evidence.

## Summary

| Gate | Status | Evidence |
|---|---|---|
| L0 static/unit | not-run | Run `bash scripts/gate.sh` and static commands |
| L1 WDIO | not-run | Run `bash scripts/multi-end-loop.sh --all` |
| L2 WDIO | not-run | Run `bash scripts/multi-end-loop.sh --l2` |
| Apifox HTTP | not-run | Run `bash scripts/multi-end-loop.sh --apifox` |
| UI style | not-run | Run `bash scripts/multi-end-loop.sh --screenshot` |

## UC Rows

| UC | Area | Level | Status | Spec | Expect | Required Evidence | Current Evidence | Next Action |
|---|---|---|---|---|---|---|---|---|
```

- [ ] **Step 2: Fill UC rows from the spec**

Populate rows for every UC listed in section 8 of the spec. Use existing spec and expect file paths when present. Use `not-run` for rows not verified in this task. For UC-6.1 and UC-6.2, record current evidence from the recent runs:

```markdown
| UC-6.1 | MB | L1 | green | `test/specs/uc-6.1.e2e.mjs` | `test/expect/uc-6.1.expect.json` | ①②③④ | `scripts/multi-end-loop.sh --spec test/specs/uc-6.1.e2e.mjs` passed; run.jsonl showed `im_channel_member_change` -> `channel/member/change` -> `im:channel:members` -> DOM | Keep as MB regression gate |
| UC-6.2 | MB | L1 | partial | `test/specs/uc-6.2.e2e.mjs` | `test/expect/uc-6.2.expect.json` | ①; ②③④ L2 | `scripts/multi-end-loop.sh --spec test/specs/uc-6.2.e2e.mjs` passed outbound-only L1; admin DOM forbidden as optimistic fake | Keep L2 `uc-6.2-l2.e2e.mjs` as authority for admin DOM |
```

- [ ] **Step 3: Add reports directory docs**

Create `docs/uc-rollout/reports/README.md`:

```markdown
# UC Run Reports

Large runtime artifacts are archived under directories named like `/tmp/loopforge/runs/20260702-153000/`.
This directory stores small committed summaries only.

Committed report files must include:

- command that was run
- pass/fail counts
- linked runtime archive path
- Apifox report path when used
- screenshot paths when used
- final status line
```

Create `docs/uc-rollout/reports/.gitkeep` as an empty file.

- [ ] **Step 4: Repair stale UC wording**

Edit the existing rollout and ledger docs so they do not claim:

```text
UC-6.2 data-admin green by optimistic UI
debugMarkFailed/debugLocatePost/debugSetManger are valid closure paths
Apifox proves WS or DOM
```

Use this replacement wording wherever the old meaning appears:

```text
UC-6.2 L1 proves only real outbound `channel/add/manger`; `data-admin` is L2-only and must come from backend/helix member projection. UI optimistic admin is forbidden.
```

- [ ] **Step 5: Verify the docs compile as plain Markdown**

Run:

```bash
rg -n "乐观刷|debugMarkFailed|debugLocatePost|debugSetManger|Apifox.*全链路|全链路.*Apifox" docs/uc-rollout docs/uc-coverage-ledger.md
```

Expected: only historical deprecation wording or forbidden-rule wording remains. No line should present these as accepted success paths.

- [ ] **Step 6: Commit Task 1**

```bash
git add docs/uc-rollout/all-uc-real-chain-status.md docs/uc-rollout/reports/README.md docs/uc-rollout/reports/.gitkeep docs/uc-rollout/rollout-checklist.md docs/uc-coverage-ledger.md docs/uc-rollout/coverage-crossmap.md docs/uc-rollout/ui-e2e-real-flow-runbook.md docs/uc-rollout/ui-ux-split-runbook.md
git commit -m "docs: 统一全 UC 真实链路台账口径"
```

---

### Task 2: Add Deterministic Spec Lists

**Files:**
- Create: `scripts/uc-spec-list.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `test/specs/*.e2e.mjs`.
- Produces CLI:
  - `node scripts/uc-spec-list.mjs --list all`
  - `node scripts/uc-spec-list.mjs --list l1`
  - `node scripts/uc-spec-list.mjs --list l2`
  - `node scripts/uc-spec-list.mjs --area MB`

- [ ] **Step 1: Create the spec list script**

Create `scripts/uc-spec-list.mjs` with this implementation:

```javascript
#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SPEC_DIR = "test/specs";

const AREA_SPECS = {
  CL: [
    "test/specs/uc-5.1.e2e.mjs",
    "test/specs/uc-5.4.e2e.mjs",
    "test/specs/uc-5.5.e2e.mjs",
  ],
  ML: [
    "test/specs/uc-send-1.e2e.mjs",
    "test/specs/uc-1.5.e2e.mjs",
    "test/specs/uc-2.3.e2e.mjs",
  ],
  MB: [
    "test/specs/uc-6.1.e2e.mjs",
    "test/specs/uc-6.2.e2e.mjs",
    "test/specs/uc-6.3.e2e.mjs",
    "test/specs/uc-6.4.e2e.mjs",
  ],
  CP: [
    "test/specs/uc-send-1.e2e.mjs",
    "test/specs/uc-1.2.e2e.mjs",
    "test/specs/uc-1.10.e2e.mjs",
    "test/specs/uc-1.10-cancel.e2e.mjs",
  ],
  AX: [
    "test/specs/uc-9.x.e2e.mjs",
    "test/specs/uc-2.4.e2e.mjs",
    "test/specs/uc-10.1.e2e.mjs",
  ],
};

const EXCLUDED_FROM_L1 = new Set([
  "uc-1.5-offline-setup.e2e.mjs",
  "uc-1.5-offline.e2e.mjs",
  "uc-3.1-l2.e2e.mjs",
  "uc-3.2-l2.e2e.mjs",
  "uc-5.3b-l2.e2e.mjs",
  "uc-6.1-l2.e2e.mjs",
  "uc-6.2-l2.e2e.mjs",
  "uc-11.2-l2.e2e.mjs",
  "uc-us17-l2.e2e.mjs",
]);

function allSpecs() {
  return readdirSync(SPEC_DIR)
    .filter((name) => name.endsWith(".e2e.mjs"))
    .sort()
    .map((name) => join(SPEC_DIR, name));
}

function l1Specs() {
  return allSpecs().filter((path) => !EXCLUDED_FROM_L1.has(path.split("/").pop()));
}

function l2Specs() {
  return allSpecs().filter((path) => {
    const name = path.split("/").pop();
    return name.includes("-l2") || name === "uc-us17-l2.e2e.mjs";
  });
}

function parseArgs(argv) {
  const out = { list: "all", area: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--list") out.list = argv[++i] ?? "all";
    else if (argv[i] === "--area") out.area = argv[++i] ?? "";
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/uc-spec-list.mjs --list all",
    "  node scripts/uc-spec-list.mjs --list l1",
    "  node scripts/uc-spec-list.mjs --list l2",
    "  node scripts/uc-spec-list.mjs --area MB",
  ].join("\n");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  let specs;
  if (args.area) {
    const key = args.area.toUpperCase();
    specs = AREA_SPECS[key];
    if (!specs) throw new Error(`unknown area: ${args.area}`);
  } else if (args.list === "all") specs = allSpecs();
  else if (args.list === "l1") specs = l1Specs();
  else if (args.list === "l2") specs = l2Specs();
  else throw new Error(`unknown list: ${args.list}`);

  for (const spec of specs) console.log(spec);
} catch (error) {
  console.error(String(error?.message ?? error));
  console.error(usage());
  process.exit(2);
}
```

- [ ] **Step 2: Make it executable**

Run:

```bash
chmod +x scripts/uc-spec-list.mjs
```

- [ ] **Step 3: Add package scripts**

Modify `package.json` scripts to include these entries while preserving existing entries:

```json
{
  "check:static": "tsc -p tsconfig.app.json --noEmit && ng build",
  "check:specs": "for f in test/specs/*.e2e.mjs; do node --check \"$f\" || exit 1; done",
  "check:real-chain": "node scripts/scan-real-chain-violations.mjs",
  "uc:list": "node scripts/uc-spec-list.mjs --list all",
  "uc:list:l1": "node scripts/uc-spec-list.mjs --list l1",
  "uc:list:l2": "node scripts/uc-spec-list.mjs --list l2",
  "uc:loop:mb": "bash scripts/multi-end-loop.sh --area MB",
  "uc:loop:all": "bash scripts/multi-end-loop.sh --all"
}
```

- [ ] **Step 4: Verify output**

Run:

```bash
node --check scripts/uc-spec-list.mjs
node scripts/uc-spec-list.mjs --area MB
node scripts/uc-spec-list.mjs --list l2
```

Expected MB output:

```text
test/specs/uc-6.1.e2e.mjs
test/specs/uc-6.2.e2e.mjs
test/specs/uc-6.3.e2e.mjs
test/specs/uc-6.4.e2e.mjs
```

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/uc-spec-list.mjs package.json
git commit -m "test: 增加全 UC 规格列表入口"
```

---

### Task 3: Upgrade The Multi-End Loop Harness

**Files:**
- Modify: `scripts/multi-end-loop.sh`
- Create: `scripts/summarize-run-report.mjs`
- Modify: `docs/uc-rollout/reports/README.md`

**Interfaces:**
- Consumes: `scripts/uc-spec-list.mjs`.
- Produces:
  - `bash scripts/multi-end-loop.sh --list`
  - `bash scripts/multi-end-loop.sh --area MB`
  - `bash scripts/multi-end-loop.sh --all`
  - `bash scripts/multi-end-loop.sh --l2`
  - Archives under `/tmp/loopforge/runs/YYYYmmdd-HHMMSS/`.

- [ ] **Step 1: Add run archive variables**

In `scripts/multi-end-loop.sh`, add these variables after `RUN_LOG_DIR`:

```bash
RUN_ID="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/tmp/loopforge/runs}"
ARCHIVE_DIR="${ARCHIVE_DIR:-$ARCHIVE_ROOT/$RUN_ID}"
RUN_APIFOX=0
RUN_SCREENSHOT=0
RUN_ALL=0
RUN_L2=0
LIST_ONLY=0
AREA=""
```

- [ ] **Step 2: Extend arg parsing**

In the arg parsing `case`, add:

```bash
    --all)
      RUN_ALL=1
      shift
      ;;
    --l2)
      RUN_L2=1
      shift
      ;;
    --area)
      AREA="${2:-}"
      shift 2
      ;;
    --apifox)
      RUN_APIFOX=1
      shift
      ;;
    --screenshot)
      RUN_SCREENSHOT=1
      shift
      ;;
    --archive-dir)
      ARCHIVE_DIR="${2:-}"
      shift 2
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
```

- [ ] **Step 3: Add spec expansion**

After arg parsing and loop validation, add:

```bash
append_specs_from_cmd() {
  local mode="$1"
  while IFS= read -r spec; do
    [ -n "$spec" ] && SPECS+=("$spec")
  done < <(cd "$ROOT" && node scripts/uc-spec-list.mjs $mode)
}

if [ -n "$AREA" ]; then
  append_specs_from_cmd "--area $AREA"
fi
if [ "$RUN_ALL" = 1 ]; then
  append_specs_from_cmd "--list l1"
fi
if [ "$RUN_L2" = 1 ]; then
  append_specs_from_cmd "--list l2"
fi

if [ "$LIST_ONLY" = 1 ]; then
  printf '%s\n' "${SPECS[@]}"
  exit 0
fi
```

- [ ] **Step 4: Add Go log and health gate**

Before static gates, add:

```bash
echo
echo "== backend health =="
if curl -sS -o "$RUN_LOG_DIR/cses-health.json" -w "%{http_code}" http://127.0.0.1:8066/api/cses/health | grep -q '^200$'; then
  echo "cses-im-server health OK"
else
  echo "cses-im-server health failed; start it with:" >&2
  echo "cd $CSES_IM_ROOT && CSES_IM_LISTEN_ADDR=:8066 CSES_IM_LOG_FORMAT=json go run ./cmd/server > $CSES_LOG 2>&1" >&2
  exit 1
fi
if [ ! -f "$CSES_LOG" ]; then
  echo "warning: $CSES_LOG is missing; Go server is healthy but runtime log is not redirected"
fi
mkdir -p "$ARCHIVE_DIR"
```

- [ ] **Step 5: Add Apifox optional gate**

After live WDIO specs finish inside each loop, add:

```bash
  if [ "$RUN_APIFOX" = 1 ]; then
    echo
    echo "== loop ${i}/${LOOPS}: Apifox HTTP suite =="
    if [ -z "${APIFOX_TOKEN:-}" ]; then
      echo "APIFOX_TOKEN is required for --apifox" >&2
      exit 2
    fi
    (cd "$ROOT" && python3 scripts/apifox-suite-create.py | tee "$ARCHIVE_DIR/apifox-create.log")
    APIFOX_CMD="$(grep -E '^apifox ' "$ARCHIVE_DIR/apifox-create.log" | tail -1)"
    if [ -z "$APIFOX_CMD" ]; then
      echo "scripts/apifox-suite-create.py did not print an apifox run command" >&2
      exit 1
    fi
    (cd "$ROOT" && bash -lc "$APIFOX_CMD" | tee "$ARCHIVE_DIR/apifox-run.log")
  fi
```

- [ ] **Step 6: Add screenshot optional gate**

After Apifox optional gate, add:

```bash
  if [ "$RUN_SCREENSHOT" = 1 ]; then
    echo
    echo "== loop ${i}/${LOOPS}: UI screenshots =="
    (cd "$ROOT" && node scripts/capture-ui-screenshots.mjs --out "$ARCHIVE_DIR")
  fi
```

- [ ] **Step 7: Archive logs**

Before evidence tails, add:

```bash
copy_if_exists() {
  local src="$1"
  local dst="$2"
  [ -f "$src" ] && cp "$src" "$dst" || true
}

copy_if_exists "$RUN_LOG_DIR/run-ng.log" "$ARCHIVE_DIR/run-ng.log"
copy_if_exists "$RUN_LOG_DIR/run-app.log" "$ARCHIVE_DIR/run-app.log"
copy_if_exists "$RUN_LOG_DIR/run.jsonl" "$ARCHIVE_DIR/run.jsonl"
copy_if_exists "$RUN_LOG_DIR/wdio-out.log" "$ARCHIVE_DIR/wdio-out.log"
copy_if_exists "$CSES_LOG" "$ARCHIVE_DIR/cses-im-server.log"
(cd "$ROOT" && node scripts/summarize-run-report.mjs --archive "$ARCHIVE_DIR" --out "$ARCHIVE_DIR/summary.md")
echo "archive: $ARCHIVE_DIR"
```

- [ ] **Step 8: Create summary script**

Create `scripts/summarize-run-report.mjs`:

```javascript
#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { archive: "", out: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--archive") args.archive = argv[++i] ?? "";
    else if (argv[i] === "--out") args.out = argv[++i] ?? "";
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  if (!args.archive || !args.out) throw new Error("--archive and --out are required");
  return args;
}

function includes(file, text) {
  const path = join(file.dir, file.name);
  return existsSync(path) && readFileSync(path, "utf8").includes(text);
}

const args = parseArgs(process.argv.slice(2));
const files = { dir: args.archive, name: "wdio-out.log" };
const wdioPass = includes(files, "Spec Files:") && includes(files, "passed");
const apifoxPath = join(args.archive, "apifox-run.log");
const apifoxRan = existsSync(apifoxPath);
const apifoxPass = apifoxRan && !readFileSync(apifoxPath, "utf8").match(/failed|失败|error/i);

const lines = [
  "# LoopForge Run Summary",
  "",
  `Archive: \`${args.archive}\``,
  "",
  "| Gate | Result |",
  "|---|---|",
  `| WDIO | ${wdioPass ? "pass" : "not-pass-or-not-run"} |`,
  `| Apifox HTTP | ${apifoxRan ? (apifoxPass ? "pass" : "not-pass") : "not-run"} |`,
  `| Angular log | ${existsSync(join(args.archive, "run-ng.log")) ? "archived" : "missing"} |`,
  `| Tauri/helix log | ${existsSync(join(args.archive, "run-app.log")) ? "archived" : "missing"} |`,
  `| run.jsonl | ${existsSync(join(args.archive, "run.jsonl")) ? "archived" : "missing"} |`,
  `| Go log | ${existsSync(join(args.archive, "cses-im-server.log")) ? "archived" : "missing"} |`,
  "",
];

writeFileSync(args.out, lines.join("\n"));
```

- [ ] **Step 9: Verify harness commands**

Run:

```bash
node --check scripts/summarize-run-report.mjs
bash scripts/multi-end-loop.sh --list --area MB
bash scripts/multi-end-loop.sh --area MB
```

Expected:

- `--list --area MB` prints the four MB specs.
- `--area MB` runs static gates and live MB specs.
- `archive: /tmp/loopforge/runs/...` is printed.

- [ ] **Step 10: Commit Task 3**

```bash
git add scripts/multi-end-loop.sh scripts/summarize-run-report.mjs docs/uc-rollout/reports/README.md
git commit -m "test: 扩展多端全 UC 验证循环"
```

---

### Task 4: Add Real-Chain Violation Scan

**Files:**
- Create: `scripts/scan-real-chain-violations.mjs`
- Modify: `scripts/gate.sh`

**Interfaces:**
- Produces CLI: `node scripts/scan-real-chain-violations.mjs`.
- Gate fails on banned debug hooks and fake server-id patterns.

- [ ] **Step 1: Create scanner script**

Create `scripts/scan-real-chain-violations.mjs`:

```javascript
#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const forbidden = [
  {
    pattern: "debugMarkFailed|debugLocatePost|debugSetManger",
    paths: ["src/app", "test/specs"],
    reason: "debug hooks must not patch UI state",
  },
  {
    pattern: "fake(Server|Vote|Average|Channel|Post)?Id|mock(Server|Vote|Average|Channel|Post)?Id",
    paths: ["src/app", "test/specs", "src-tauri"],
    reason: "fake/mock ids cannot drive UC closure",
  },
  {
    pattern: "data-admin.*乐观|乐观.*data-admin",
    paths: ["docs", "src/app", "test"],
    reason: "admin DOM must come from backend/helix projection",
  },
];

function rg(pattern, paths) {
  try {
    return execFileSync("rg", ["-n", pattern, ...paths], { encoding: "utf8" }).trim();
  } catch (error) {
    if (error.status === 1) return "";
    throw error;
  }
}

const failures = [];
for (const rule of forbidden) {
  const out = rg(rule.pattern, rule.paths);
  if (out) failures.push({ rule, out });
}

const randomOut = rg("Math\\.random", ["src/app", "test/specs"]);
const suspiciousRandom = randomOut
  .split("\n")
  .filter(Boolean)
  .filter((line) => /vote|average|server|channelId|postId|msgId/i.test(line));
if (suspiciousRandom.length) {
  failures.push({
    rule: {
      reason: "Math.random may create only unique client text/temp ids; it must not create server ids or card ids",
    },
    out: suspiciousRandom.join("\n"),
  });
}

if (failures.length) {
  for (const f of failures) {
    console.error(`\n[real-chain violation] ${f.rule.reason}`);
    console.error(f.out);
  }
  process.exit(1);
}

console.log("real-chain scan passed");
```

- [ ] **Step 2: Add scanner to gate**

In `scripts/gate.sh`, before clippy, add:

```bash
step "10 real-chain 禁 mock/fake/debug 扫描"
if node scripts/scan-real-chain-violations.mjs >/tmp/lf-gate-real-chain.log 2>&1; then
  ok "$(cat /tmp/lf-gate-real-chain.log)"
else
  cat /tmp/lf-gate-real-chain.log
  bad "real-chain 扫描红（禁止 debug patch/mock/fake id/乐观 admin）"
fi
```

- [ ] **Step 3: Verify scanner**

Run:

```bash
node --check scripts/scan-real-chain-violations.mjs
node scripts/scan-real-chain-violations.mjs
```

Expected: either `real-chain scan passed` or actionable violations. If violations are in historical documentation, rewrite the text to say they are forbidden/deprecated without matching the banned pattern.

- [ ] **Step 4: Commit Task 4**

```bash
git add scripts/scan-real-chain-violations.mjs scripts/gate.sh docs/uc-rollout docs/uc-coverage-ledger.md
git commit -m "test: 增加真实链路禁区扫描"
```

---

### Task 5: Add UI Screenshot Gate

**Files:**
- Create: `scripts/capture-ui-screenshots.mjs`
- Modify: `scripts/multi-end-loop.sh`
- Modify: `docs/uc-rollout/ui-ux-split-runbook.md`

**Interfaces:**
- Consumes: dev server at `http://localhost:1420`.
- Produces:
  - `desktop.png`
  - `mobile.png`
  - `screenshot-summary.md`

- [ ] **Step 1: Create screenshot script**

Create `scripts/capture-ui-screenshots.mjs`:

```javascript
#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { out: "/tmp/loopforge" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i] ?? args.out;
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

const summary = [
  "# UI Screenshot Gate",
  "",
  "Capture these screenshots with the project browser tool or Playwright-capable local environment:",
  "",
  `- desktop: \`${join(args.out, "desktop.png")}\` at 1440x1000`,
  `- mobile: \`${join(args.out, "mobile.png")}\` at 390x844`,
  "",
  "Required visual checks:",
  "",
  "- dark top/rail and light message canvas match target message page direction",
  "- channel list, message list, member/aux area, and composer are visible",
  "- no text overlap",
  "- no test control is hidden at mobile width",
  "- DOM `data-testid` elements used by representative specs remain interactable",
  "",
  "If this script runs in an environment without browser screenshot support, use the summary as the manual capture checklist and attach the two images to the archive directory.",
  "",
];

writeFileSync(join(args.out, "screenshot-summary.md"), summary.join("\n"));
console.log(`screenshot checklist written to ${join(args.out, "screenshot-summary.md")}`);
```

- [ ] **Step 2: Wire screenshot gate**

The `multi-end-loop.sh --screenshot` hook from Task 3 already calls this script. Verify it writes `screenshot-summary.md` into the archive.

- [ ] **Step 3: Run screenshot gate**

Run:

```bash
node --check scripts/capture-ui-screenshots.mjs
node scripts/capture-ui-screenshots.mjs --out /tmp/loopforge/screenshot-smoke
cat /tmp/loopforge/screenshot-smoke/screenshot-summary.md
```

Expected: summary file exists and lists desktop/mobile screenshot requirements.

- [ ] **Step 4: Record target style in runbook**

Append this to `docs/uc-rollout/ui-ux-split-runbook.md`:

```markdown
## Visual Evidence Gate

Every UI/UX closure batch must archive:

- desktop screenshot at 1440x1000
- mobile screenshot at 390x844
- `screenshot-summary.md`

The screenshots must preserve machine selectors and show the `pd.cses7.com/message`-style direction: dark top/rail, light message canvas, dense channel list, stable composer.
```

- [ ] **Step 5: Commit Task 5**

```bash
git add scripts/capture-ui-screenshots.mjs scripts/multi-end-loop.sh docs/uc-rollout/ui-ux-split-runbook.md
git commit -m "test: 增加 UI 风格截图验收门"
```

---

### Task 6: Run And Fix UI Area Gates

**Files:**
- Modify as needed:
  - `src/app/app.component.ts`
  - `src/app/im/ui/*.ts`
  - `src/app/im/im-store.service.ts`
  - `test/specs/*.e2e.mjs`
  - `docs/uc-rollout/ui-ux-split-runbook.md`
  - `docs/uc-rollout/all-uc-real-chain-status.md`

**Interfaces:**
- Consumes: `bash scripts/multi-end-loop.sh --area CL`, `--area MB`, `--area CP`, `--area AX`.
- Produces: one green representative run per UI area.

- [ ] **Step 1: Run CL area**

Run:

```bash
bash scripts/multi-end-loop.sh --area CL
```

Expected: UC-5.1, UC-5.4, UC-5.5 either pass or fail with a clear reducer/log reason.

- [ ] **Step 2: Fix CL failures using this rule**

If failure is DOM/selector/CSS:

- Preserve every existing `data-channel-*`.
- Fix `app-im-channel-list` or root event binding.
- Do not patch store state.

Run again:

```bash
bash scripts/multi-end-loop.sh --area CL
```

- [ ] **Step 3: Run ML area**

Run:

```bash
bash scripts/multi-end-loop.sh --area ML
```

If failure is message row interaction:

- Fix `app-im-message-list`.
- Preserve every `data-msg-*`, `data-send-status`, `data-read-bits`, `data-vote`, `data-average`.
- Do not generate fake vote/average ids.

- [ ] **Step 4: Run CP area**

Run:

```bash
bash scripts/multi-end-loop.sh --area CP
```

If failure is composer input:

- Fix `app-im-composer` inputs/outputs.
- Ensure draft text drives real store command arguments.
- Do not add decorative controls that do not map to commands.

- [ ] **Step 5: Run AX area**

Run:

```bash
bash scripts/multi-end-loop.sh --area AX
```

If failure is auxiliary rendering:

- Fix `app-im-aux-panel`.
- Preserve bookmark/todo/reply `data-*`.
- Keep read-result parsing in `ImStoreService` or helix; do not parse business wire in presentational component.

- [ ] **Step 6: Re-run MB area**

Run:

```bash
bash scripts/multi-end-loop.sh --area MB
```

Expected: UC-6.1 and UC-6.2 remain green by the current evidence model.

- [ ] **Step 7: Update area status docs**

In `docs/uc-rollout/ui-ux-split-runbook.md`, mark each area as green only after its representative command passes and archive path is known.

In `docs/uc-rollout/all-uc-real-chain-status.md`, update affected UC `Current Evidence` cells with exact command names and archive path.

- [ ] **Step 8: Commit Task 6**

```bash
git add src/app/app.component.ts src/app/im/ui src/app/im/im-store.service.ts test/specs docs/uc-rollout/ui-ux-split-runbook.md docs/uc-rollout/all-uc-real-chain-status.md
git commit -m "test: 回归 UI 区域真实链路"
```

---

### Task 7: Run Full L1 Suite And Triage Failures

**Files:**
- Modify as failure evidence dictates:
  - loopforge UI/store/spec/reducer files
  - helix files in `/System/Volumes/Data/workspace/rust/helix` only when logs prove helix is at fault
  - docs status files

**Interfaces:**
- Consumes: `bash scripts/multi-end-loop.sh --all`.
- Produces: L1 pass/fail report and fixed L1 suite.

- [ ] **Step 1: Run full L1**

Run:

```bash
bash scripts/multi-end-loop.sh --all
```

Expected: all L1 specs run in deterministic list order. If a spec fails, the command exits non-zero after preserving archive logs.

- [ ] **Step 2: Classify first failure**

Use this command to locate the failure:

```bash
ARCHIVE="$(ls -td /tmp/loopforge/runs/* | head -1)"
rg -n "FAILED|Error:|断在|✖|not-pass" "$ARCHIVE" /tmp/loopforge/wdio-out.log /tmp/loopforge/run.jsonl
```

Classify using the spec red-light matrix:

```text
UI click missing -> loopforge UI
inbound present/outbound missing -> Tauri or helix command registry
outbound body wrong -> helix outbound builder
HTTP 000 -> Go runtime
HTTP success/no WS -> backend broadcast or L2 classification
WS present/no projection -> helix parser/gate
projection present/no DOM -> loopforge binding
reducer wrong only -> reducer/corr-key
```

- [ ] **Step 3: Fix one failure signature**

Make the smallest fix for the first unique failure signature. Do not batch unrelated UC failures in one patch.

- [ ] **Step 4: Re-run focused spec**

Run:

```bash
FAILED_SPEC="$(rg -o 'test/specs/[A-Za-z0-9._-]+\.e2e\.mjs' /tmp/loopforge/runs -g 'summary.md' -g 'wdio-out.log' | tail -1 | sed 's/.*test/test/')"
test -n "$FAILED_SPEC"
bash scripts/multi-end-loop.sh --spec "$FAILED_SPEC"
```

Use the exact failed spec path from Step 2.

- [ ] **Step 5: Re-run full L1 after focused pass**

Run:

```bash
bash scripts/multi-end-loop.sh --all
```

- [ ] **Step 6: Quarantine repeated structural gaps**

If the same signature fails three times and logs prove it needs backend/helix/L2 work outside current scope, update `docs/uc-rollout/all-uc-real-chain-status.md` with:

```text
Status: blocked
Current Evidence: archive path + failing hop
Next Action: concrete repo and file/function to fix
```

Do not mark it green.

- [ ] **Step 7: Commit each resolved signature**

For a loopforge-only fix:

```bash
git status --short
git add src/app src-tauri test/specs test/expect test/reducer scripts docs/uc-rollout docs/uc-coverage-ledger.md
git diff --cached --name-only
git commit -m "fix: 修复真实链路断点"
```

For a docs-only classification:

```bash
git add docs/uc-rollout/all-uc-real-chain-status.md docs/uc-rollout/rollout-checklist.md docs/uc-coverage-ledger.md
git commit -m "docs: 记录真实链路结构性缺口"
```

---

### Task 8: Run L2 Broadcast Suite

**Files:**
- Modify as needed:
  - `test/specs/*-l2.e2e.mjs`
  - `test/expect/*-l2.expect.json`
  - `scripts/l2-act.sh`
  - `docs/uc-rollout/all-uc-real-chain-status.md`

**Interfaces:**
- Consumes: `bash scripts/multi-end-loop.sh --l2`.
- Produces: L2 pass/fail report for second-connection UC.

- [ ] **Step 1: Confirm L2 actor script exists**

Run:

```bash
test -x scripts/l2-act.sh
```

Expected: exit code 0. If it is not executable, run:

```bash
chmod +x scripts/l2-act.sh
```

- [ ] **Step 2: Run L2 suite**

Run:

```bash
bash scripts/multi-end-loop.sh --l2
```

- [ ] **Step 3: Classify L2 failures**

Use:

```bash
ARCHIVE="$(ls -td /tmp/loopforge/runs/* | head -1)"
rg -n "FAILED|Error:|断在|channel_member_update|post_read|channel_member_role_updated|post" "$ARCHIVE"
```

Classify failures as:

```text
L2 actor did not send -> scripts/l2-act.sh or backend HTTP
A did not receive WS -> backend broadcast/routing
A received WS but no projection -> helix parser/gate
projection but no DOM -> loopforge binding
```

- [ ] **Step 4: Update UC statuses**

For each L2 UC, update `docs/uc-rollout/all-uc-real-chain-status.md` with one of:

```text
green
blocked
l2-required
```

Use archive paths for evidence.

- [ ] **Step 5: Commit Task 8**

```bash
git add test/specs test/expect scripts/l2-act.sh docs/uc-rollout/all-uc-real-chain-status.md
git commit -m "test: 跑通 L2 广播真实链路"
```

---

### Task 9: Run Apifox HTTP Gate

**Files:**
- Modify as needed:
  - `scripts/apifox-suite-create.py`
  - `.apifox/**`
  - `docs/uc-rollout/apifox-http-suite-runbook.md`
  - `docs/uc-rollout/all-uc-real-chain-status.md`
  - `docs/uc-rollout/reports/*.md`

**Interfaces:**
- Consumes: `APIFOX_TOKEN`.
- Produces: Apifox report under `.apifox/reports/` or archive path printed by CLI.

- [ ] **Step 1: Verify token**

Run:

```bash
test -n "${APIFOX_TOKEN:-}"
```

Expected: exit code 0. If it fails, export a Personal Access Token before continuing.

- [ ] **Step 2: Generate or update suite**

Run:

```bash
python3 scripts/apifox-suite-create.py | tee /tmp/loopforge-apifox-create.log
```

Expected: output contains one `apifox ...` run command.

- [ ] **Step 3: Run suite through harness**

Run:

```bash
bash scripts/multi-end-loop.sh --apifox
```

- [ ] **Step 4: Confirm report is HTTP-only**

In `docs/uc-rollout/all-uc-real-chain-status.md`, set Apifox summary to:

```text
HTTP preflight green
```

Do not change L1/L2 WDIO status based only on Apifox.

- [ ] **Step 5: Fix Apifox failures if any**

If Apifox fails due to assertion or runtime variable:

- Fix `scripts/apifox-suite-create.py`.
- Preserve real dependency order.
- Extract ids only from real responses.
- Do not weaken assertions to force pass.

Re-run:

```bash
bash scripts/multi-end-loop.sh --apifox
```

- [ ] **Step 6: Commit Task 9**

```bash
git add scripts/apifox-suite-create.py .apifox docs/uc-rollout/apifox-http-suite-runbook.md docs/uc-rollout/all-uc-real-chain-status.md docs/uc-rollout/reports
git commit -m "test: 接入 Apifox HTTP 回归门"
```

---

### Task 10: Final Gate And Report

**Files:**
- Create: `docs/uc-rollout/reports/all-uc-real-chain-final.md`
- Modify: `docs/uc-rollout/all-uc-real-chain-status.md`
- Modify: `docs/uc-rollout/rollout-checklist.md`
- Modify: `docs/uc-coverage-ledger.md`

**Interfaces:**
- Consumes:
  - full L1 archive
  - L2 archive
  - Apifox archive
  - screenshot archive
  - `bash scripts/gate.sh`
- Produces: final report and terminal status line.

- [ ] **Step 1: Run final static gate**

Run:

```bash
bash scripts/gate.sh
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/ng build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Run final all-UC gate**

Run:

```bash
bash scripts/multi-end-loop.sh --all --l2 --apifox --screenshot
```

Expected:

- L1 specs run.
- L2 specs run.
- Apifox HTTP suite runs.
- screenshot summary is archived.
- archive path is printed.

- [ ] **Step 3: Write final report**

Create `docs/uc-rollout/reports/all-uc-real-chain-final.md` with this structure:

```markdown
# All-UC Real-Chain Final Report

## Commands

- `bash scripts/gate.sh`
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`
- `./node_modules/.bin/ng build`
- `git diff --check`
- `bash scripts/multi-end-loop.sh --all --l2 --apifox --screenshot`

## Results

| Gate | Result | Evidence |
|---|---|---|
| L0 static/unit | pass | command output |
| L1 WDIO | pass | archive path |
| L2 WDIO | pass | archive path |
| Apifox HTTP | pass | Apifox report path |
| UI style | pass | desktop/mobile screenshot paths |

## Honest Exceptions

List only UC rows that are not green, with level and reason.

## Final Status

`DONE line will be written after the final command set passes.`
```

After writing the report, replace the final status sentence with a concrete line:

```text
✅ DONE loopforge all-UC real-chain closure @$(date -Iseconds) | L0/L1/L2/Apifox/style accounted | loopforge-tauri-im
```

- [ ] **Step 4: Verify no stale report language remains**

Run:

```bash
rg -n "Apifox.*All UC|All UC.*Apifox|乐观刷.*admin|debugMarkFailed.*有效|debugLocatePost.*有效|debugSetManger.*有效" docs
```

Expected: no matches that present these as accepted success paths.

- [ ] **Step 5: Commit Task 10**

```bash
git add docs/uc-rollout/reports/all-uc-real-chain-final.md docs/uc-rollout/all-uc-real-chain-status.md docs/uc-rollout/rollout-checklist.md docs/uc-coverage-ledger.md
git commit -m "docs: 出账全 UC 真实链路收口报告"
```

---

## Execution Order

Run tasks in this order:

```text
Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8 -> Task 9 -> Task 10
```

Do not start Task 7 before Task 3 is complete; full L1 needs the upgraded harness.

Do not start Task 9 before Go server health and logs are stable; Apifox failures are noisy when backend logging is missing.

Do not mark final completion before Task 10 passes.

---

## Self-Review

Spec coverage:

- All-UC status ledger: Task 1.
- Multi-end harness and logs: Task 2, Task 3.
- No mock/fake/debug patch: Task 4.
- UI style and screenshots: Task 5, Task 6.
- All UI/E2E verification: Task 6, Task 7, Task 8.
- Apifox HTTP full green with boundary: Task 9.
- Final accounting: Task 10.

Placeholder scan:

- This plan uses concrete filenames, commands, and scripts.
- Angle-bracket placeholders are avoided in commands; shell variables are used where runtime values are required.

Type and interface consistency:

- `scripts/uc-spec-list.mjs` produces spec paths consumed by `scripts/multi-end-loop.sh`.
- `scripts/summarize-run-report.mjs` consumes the archive created by `scripts/multi-end-loop.sh`.
- `scripts/scan-real-chain-violations.mjs` is called by `scripts/gate.sh`.
- `scripts/capture-ui-screenshots.mjs` is called by `scripts/multi-end-loop.sh --screenshot`.

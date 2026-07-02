# LoopForge Go-Only Apifox Green Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LoopForge's Go-only Apifox suite green while preserving honest HTTP-only semantics, then verify automated UI tests and unit/static/Rust gates.

**Architecture:** Add a profile boundary to the existing Apifox suite generator instead of deleting Java scenarios. Keep `scripts/multi-end-loop.sh` as the orchestrator and make `APIFOX_PROFILE=go-only` the hard HTTP gate for this round. Use archive evidence and Go logs to fix remaining Go failures through reproduce -> diagnose -> patch -> rerun loops.

**Tech Stack:** Python 3 Apifox suite generator, Bash multi-end harness, Apifox CLI JSON reporter, Node report summarizer, Angular 20, Tauri 2, WebdriverIO 9, Rust cargo checks, Go `cses-im-server` on `:8066`.

## Global Constraints

- Exclude only `UC-8.x 投票 CRUD` and `UC-8.x 平均分 CRUD`.
- Keep `UC-10.1 待办列表` in the Go-only gate.
- Do not use Java `:3399` in the Go-only closure gate.
- Do not mock, fake ids, fake success, weaken Go assertions, or patch UI state.
- Apifox green is HTTP-only; do not report it as WS/DOM/storage/business green.
- Real UI validation remains UI -> store -> Tauri -> helix -> cses-im-server -> helix -> DOM.
- Contract files and expect oracle files are read-only unless the user explicitly approves a contract change.
- Every Go failure fix must have before/after evidence in a concrete archive path printed by `scripts/multi-end-loop.sh`, such as `/tmp/loopforge/runs/20260702-225010/`.

---

## File Structure

Modify:

- `scripts/apifox-suite-create.py`  
  Add `APIFOX_PROFILE`, skip only vote/average in `go-only`, print skipped scenarios, and name the suite according to profile.

- `scripts/multi-end-loop.sh`  
  Echo the selected Apifox profile, pass the environment through, and record it in the archive log.

- `scripts/summarize-run-report.mjs`  
  Ensure the summary surfaces Apifox failed scenarios and skipped Java scenarios clearly.

- `package.json`  
  Add convenience commands for go-only Apifox and full closure if local script naming already follows this convention.

Create:

- `docs/uc-rollout/reports/go-only-apifox-closure.md`  
  Small committed report containing final command list, exclusions, archive path, pass/fail status, and residual risks.

Optional only if existing Apifox JSON lacks response bodies:

- `scripts/apifox-failure-probes.md`  
  A short operator note documenting which failed steps need manual curl reproduction and the exact request bodies copied from the generated suite.

Test:

- `python3 -m py_compile scripts/apifox-suite-create.py`
- `bash scripts/gate.sh`
- `npm run check:static`
- `npm run check:specs`
- `cargo check -p helix-driver-instrument`
- `cargo check -p loopforge-tauri-im`
- `APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox`
- `bash scripts/multi-end-loop.sh --all`

---

### Task 1: Add Go-Only Apifox Profile

**Files:**
- Modify: `scripts/apifox-suite-create.py`
- Modify: `scripts/multi-end-loop.sh`

**Interfaces:**
- Consumes: environment variable `APIFOX_PROFILE`.
- Produces:
  - `APIFOX_PROFILE=full`: current behavior.
  - `APIFOX_PROFILE=go-only`: excludes only vote and average-score scenarios.

- [ ] **Step 1: Add profile constants to the Apifox generator**

In `scripts/apifox-suite-create.py`, below `TEAM_ID = ...`, add:

```python
APIFOX_PROFILE = os.environ.get("APIFOX_PROFILE", "full").strip().lower() or "full"
VALID_APIFOX_PROFILES = {"full", "go-only"}
if APIFOX_PROFILE not in VALID_APIFOX_PROFILES:
    print(f"ERROR: APIFOX_PROFILE must be one of {sorted(VALID_APIFOX_PROFILES)}, got {APIFOX_PROFILE!r}")
    sys.exit(2)

GO_ONLY_EXCLUDED_SCENARIOS = {
    "UC-8.x 投票 CRUD",
    "UC-8.x 平均分 CRUD",
}
```

- [ ] **Step 2: Filter `UC_TABLE` through a profile helper**

Below `UC_TABLE`, add:

```python
def selected_uc_table() -> list[tuple[str, str, int, list]]:
    if APIFOX_PROFILE == "full":
        return UC_TABLE
    return [row for row in UC_TABLE if row[0] not in GO_ONLY_EXCLUDED_SCENARIOS]


def skipped_scenario_names() -> list[str]:
    if APIFOX_PROFILE == "full":
        return []
    return [row[0] for row in UC_TABLE if row[0] in GO_ONLY_EXCLUDED_SCENARIOS]
```

- [ ] **Step 3: Use the selected table in `main()`**

In `main()`, after the banner prints `TEAM_ID`, add:

```python
    selected_rows = selected_uc_table()
    skipped_rows = skipped_scenario_names()
    print(f"APIFOX_PROFILE: {APIFOX_PROFILE}")
    if skipped_rows:
        print("Skipped scenarios:")
        for skipped in skipped_rows:
            print(f"  - {skipped}")
```

Replace the suite creation name and description:

```python
    suite_name = "loopforge-im-go-only" if APIFOX_PROFILE == "go-only" else "loopforge-im-full"
    suite_desc = (
        "loopforge-tauri-im Go-only HTTP regression suite; excludes vote and average-score Java legacy scenarios"
        if APIFOX_PROFILE == "go-only"
        else "loopforge-tauri-im 全 UC + 全 HTTP 端点回归套件"
    )
    print(f"\n[2/4] 创建测试套件 {suite_name} …")
    suite_r = af("test-suite", "create",
                 "--name", suite_name,
                 "--description", suite_desc)
```

Replace the loop count and table iteration:

```python
    print(f"\n[3/4] 创建 {len(selected_rows)} 个 UC 场景 …")
    for name, desc, priority, steps in selected_rows:
```

Replace final count:

```python
        print(f"\n  ✅ 套件装配完成：{len(items)} 个阶段组，{len(scenario_ids)} 个场景")
```

Keep this line but make the denominator selected:

```python
    print(f"  ✅ 成功创建场景: {len(scenario_ids)}/{len(selected_rows)}")
```

- [ ] **Step 4: Keep stage grouping honest**

Do not delete `UC-8.x 投票` or `UC-8.x 平均` from `STAGE_GROUPS`. The selected table removes their scenario ids, so their stage group contributes no scenarios in go-only mode. This preserves full mode without a second stage list.

- [ ] **Step 5: Echo profile in the harness**

In `scripts/multi-end-loop.sh`, before running `python3 scripts/apifox-suite-create.py`, add:

```bash
    echo "APIFOX_PROFILE=${APIFOX_PROFILE:-full}"
```

The existing environment inheritance is enough; do not hardcode `go-only` inside the script.

- [ ] **Step 6: Verify profile filtering without running Apifox**

Run:

```bash
python3 -m py_compile scripts/apifox-suite-create.py
APIFOX_PROFILE=bad python3 scripts/apifox-suite-create.py
```

Expected:

```text
ERROR: APIFOX_PROFILE must be one of ['full', 'go-only'], got 'bad'
```

Do not run the create command without a real token in this step.

- [ ] **Step 7: Commit Task 1**

```bash
git add scripts/apifox-suite-create.py scripts/multi-end-loop.sh
git commit -m "test: 增加 Apifox go-only 套件边界"
```

---

### Task 2: Improve Apifox Failure Evidence

**Files:**
- Modify: `scripts/summarize-run-report.mjs`
- Optional create: `scripts/apifox-failure-probes.md`

**Interfaces:**
- Consumes: `$ARCHIVE_DIR/apifox-reports/apifox-report.json` and `$ARCHIVE_DIR/apifox-run.log`.
- Produces: `$ARCHIVE_DIR/apifox-status.json` and `$ARCHIVE_DIR/summary.md` with failed scenario names, step names, and Go/Java classification.

- [ ] **Step 1: Inspect existing Apifox JSON shape**

Run against the latest archive:

```bash
node -e 'const fs=require("fs"); const p="/tmp/loopforge/runs/20260702-225010/apifox-reports/apifox-report.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); console.log(Object.keys(j)); console.log(JSON.stringify(j,null,2).slice(0,3000));'
```

Expected: printed JSON includes enough structure to find failed scenarios. If response bodies are present, use them. If response bodies are absent, continue with step 4 and use logs plus manual curl reproduction for bodies.

- [ ] **Step 2: Add scenario classification helper**

In `scripts/summarize-run-report.mjs`, add a helper near the Apifox parsing code:

```javascript
function classifyApifoxScenario(name = "", url = "") {
  const text = `${name} ${url}`;
  if (text.includes("UC-8.x 投票") || text.includes("/vote/")) return "excluded-java-vote";
  if (text.includes("UC-8.x 平均") || text.includes("/average/")) return "excluded-java-average";
  if (text.includes("localhost:3399") || text.includes("127.0.0.1:3399")) return "java";
  return "go";
}
```

Use the helper when writing `apifox-status.json`.

- [ ] **Step 3: Add required summary fields**

Ensure `apifox-status.json` has this shape:

```json
{
  "profile": "go-only",
  "passed": false,
  "stats": {
    "stepsTotal": 0,
    "stepsFailed": 0,
    "goFailures": 0,
    "excludedJavaFailures": 0
  },
  "failures": [
    {
      "class": "go",
      "scenario": "UC-1.10 定时消息",
      "step": "POST posts/createSchedule",
      "message": "status expected SUCCESS"
    }
  ],
  "excluded": [
    "UC-8.x 投票 CRUD",
    "UC-8.x 平均分 CRUD"
  ]
}
```

Use the actual existing parser fields from the report; keep missing fields as empty strings, not `undefined`.

- [ ] **Step 4: Add manual failure probes only if JSON lacks bodies**

If the Apifox JSON does not contain response bodies, create `scripts/apifox-failure-probes.md` with exact curl command templates for the current red groups:

```markdown
# Apifox Failure Probes

Use these only when Apifox JSON does not include response bodies.

## Prerequisites

Run a fresh go-only suite first so `groupChannelId` and `postId` are known from Apifox runtime variables or copied from `apifox-run.log`.

## Probe Template

```bash
GROUP_CHANNEL_ID="$(
  curl -sS 'http://127.0.0.1:8066/api/cses/channel/create' \
    -H 'content-type: application/json' \
    -H 'cookieId: 444' \
    -H 'companyId: 64118eebd2b665246b7880eb' \
    --data '{"teamId":"64118eebd2b665246b7880eb","displayName":"loopforge-probe-group","orient":"","type":"P","users":[{"id":"444","teamId":"64118eebd2b665246b7880eb","role":"CREATOR"},{"id":"678","teamId":"64118eebd2b665246b7880eb","role":"MEMBER"}],"picturetype":"USER","picture":{"userIds":["444","678"]},"forceCreate":true}' \
  | node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{const r=JSON.parse(s); console.log(r.data?.id || r.data?.channelId || r.data);});'
)"
curl -sS -i 'http://127.0.0.1:8066/api/cses/posts/createSchedule' \
  -H 'content-type: application/json' \
  -H 'cookieId: 444' \
  -H 'companyId: 64118eebd2b665246b7880eb' \
  --data '{"channelId":"'"$GROUP_CHANNEL_ID"'","message":"定时消息测试","type":"TEXT","scheduleTime":1782990000,"userId":"444","teamId":"64118eebd2b665246b7880eb"}'
```

```bash
curl -sS -i 'http://127.0.0.1:8066/api/cses/channel/member/snapshot' \
  -H 'content-type: application/json' \
  -H 'cookieId: 678' \
  -H 'companyId: 64118eebd2b665246b7880eb' \
  --data '{"channelId":"'"$GROUP_CHANNEL_ID"'","page":0,"pageSize":50}'
```
```

- [ ] **Step 5: Verify summary generation**

Run:

```bash
node scripts/summarize-run-report.mjs --archive /tmp/loopforge/runs/20260702-225010 --write-apifox-status /tmp/loopforge/runs/20260702-225010/apifox-status.next.json
node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/loopforge/runs/20260702-225010/apifox-status.next.json","utf8")); console.log(j.stats); console.log(j.failures.slice(0,3));'
```

Expected: output separates excluded Java vote/average from Go failures.

- [ ] **Step 6: Commit Task 2**

```bash
git add scripts/summarize-run-report.mjs scripts/apifox-failure-probes.md
git commit -m "test: 增强 Apifox 失败证据归档"
```

If `scripts/apifox-failure-probes.md` was not needed, omit it from `git add`.

---

### Task 3: Run Baseline Go-Only Suite

**Files:**
- Runtime only: `/tmp/loopforge/runs/` latest archive directory.

**Interfaces:**
- Consumes: running `cses-im-server` health on `http://127.0.0.1:8066/api/cses/health`.
- Produces: a fresh archive containing `apifox-create.log`, `apifox-run.log`, `apifox-reports/`, `apifox-status.json`, and `summary.md`.

- [ ] **Step 1: Verify Go backend health**

Run:

```bash
curl -sS -o /tmp/cses-health.json -w "%{http_code}\n" http://127.0.0.1:8066/api/cses/health
cat /tmp/cses-health.json
```

Expected:

```text
200
{"status":"OK"}
```

- [ ] **Step 2: Run go-only Apifox**

Run with the user's local token already available in the environment:

```bash
APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox
```

Expected before fixes: exit 1 if Go failures remain. The archive path is printed as:

```text
archive: /tmp/loopforge/runs/20260702-230000
```

- [ ] **Step 3: Extract failure matrix from the latest archive**

Run:

```bash
LATEST_APIFOX_ARCHIVE="$(ls -dt /tmp/loopforge/runs/* | head -1)"
node -e 'const fs=require("fs"); const p=process.argv[1]+"/apifox-status.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); console.table(j.failures.map(f=>({class:f.class, scenario:f.scenario, step:f.step, message:f.message})));' "$LATEST_APIFOX_ARCHIVE"
```

Expected: no `excluded-java-vote` or `excluded-java-average` failures appear in go-only profile. `UC-10.1 待办列表` appears in the suite output and is not skipped.

- [ ] **Step 4: Commit only if Task 3 changed committed files**

Task 3 normally changes no committed files. If it only created `/tmp` artifacts, do not commit.

---

### Task 4: Fix Go Failures By State Group

**Files:**
- Modify as evidence dictates:
  - `scripts/apifox-suite-create.py`
  - Go files under `/System/Volumes/Data/workspace/golang/cses-im-server` only when response/log evidence proves a backend defect
  - Rust files under `/System/Volumes/Data/workspace/rust/helix` only when UI/helix tests, not Apifox HTTP, prove an engine defect

**Interfaces:**
- Consumes: `apifox-status.json`, `apifox-run.log`, `cses-im-server.log`, generated suite request bodies.
- Produces: one commit per fixed failure group.

- [ ] **Step 1: Message state chain diagnosis**

For these failures:

```text
UC-1.10 定时消息 / POST posts/createSchedule
UC-1.5 撤回消息 / POST posts/get [方向A 验证撤回]
UC-3.2 单条已读 / POST post/read/list [read-back]
UC-3.3 模板已收到 / POST post/templateReceived
UC-2.3 按postId定位 / POST posts/getPostsAfterIndex
```

Compare request bodies against the last known good `postId` extraction in `steps_uc11()`. If a later step mutates `postId` into a revoked, scheduled, SYS, NOTICE, or non-text post, add a fresh text-post helper scenario before the first destructive operation.

Implement the helper in `scripts/apifox-suite-create.py`:

```python
def create_text_post_steps(prefix: str, message: str, post_var: str = "postId") -> list[dict]:
    body_str = (
        '{"viewers":["all"],"message":"' + message + '","mentions":[],'
        '"temporaryId":"{{$randomUUID}}","type":"TEXT","simpleMessage":"' + message + '",'
        '"channelId":"{{groupChannelId}}","userId":"' + COOKIE_ID + '",'
        '"teamId":"' + TEAM_ID + '",'
        '"userSnapshot":{"orgName":"test","deptName":"test","userName":"test",'
        '"userId":"' + COOKIE_ID + '","teamId":"' + TEAM_ID + '"},'
        '"id":"","props":{},"topicId":"","revoke":false}'
    )
    post_id_expr = (
        "Array.isArray(r.data) "
        "? ((r.data.find(p => p && p.userId !== 'SYS' && p.type !== 'NOTICE') || r.data[0] || {}).id "
        "|| (r.data.find(p => p && p.userId !== 'SYS' && p.type !== 'NOTICE') || r.data[0] || {}).postId) "
        ": (r.data?.id || r.data?.postId)"
    )
    return [
        http_step(prefix + "create", "POST posts/create (fresh text)", "post", "/api/cses/posts/create", body=body_str),
        script_step(prefix + "create_assert", "fresh text post SUCCESS"),
        delay_step(prefix + "delay", 800),
        http_step(prefix + "latest", "GET posts/getLatestPost [fresh text read-back]",
                  "post", "/api/cses/posts/getLatestPost",
                  body='{"channelId":"{{groupChannelId}}"}'),
        script_step(prefix + "latest_assert", "fresh text read-back SUCCESS",
                    expect_data=True,
                    extract={post_var: post_id_expr}),
    ]
```

Use the helper only before destructive or read-back-sensitive scenarios. Do not use random fake ids.

- [ ] **Step 2: Verify message group**

Run a fresh go-only suite:

```bash
APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox
```

Expected: the five message-state failures are gone or reduced to a response-body-proven backend defect.

- [ ] **Step 3: Commit message group fix**

```bash
git add scripts/apifox-suite-create.py
git commit -m "test: 稳定 Apifox 消息状态链"
```

- [ ] **Step 4: Channel notice and announcement diagnosis**

For these failures:

```text
UC-5.4 群属性修改 / POST channel/change/notice
UC-5.6w 公告写族 / POST post/announcement/save
UC-5.6w 公告写族 / POST post/announcement/read
```

Use response bodies to choose exactly one of these fixes:

```text
missing post/channel state -> create fresh text post before announcement write
wrong field name -> correct request body field to match Go response error
permission/member state -> move scenario before member destructive UC-6.1/UC-5.3
backend 5xx/panic -> patch cses-im-server and add Go test there
```

Do not soften `status == SUCCESS` unless the endpoint is explicitly reclassified by the user.

- [ ] **Step 5: Verify channel notice and announcement group**

Run:

```bash
APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox
```

Expected: `UC-5.4` and `UC-5.6w` no longer appear in Go failures.

- [ ] **Step 6: Commit channel/announcement fix**

```bash
git add scripts/apifox-suite-create.py
git commit -m "test: 稳定 Apifox 公告与群属性链路"
```

If the patch is in Go server, commit in `/System/Volumes/Data/workspace/golang/cses-im-server` with:

```bash
git add $(git diff --name-only)
git commit -m "fix: 修复公告与群属性接口兼容性"
```

- [ ] **Step 7: Member/admin diagnosis**

For these failures:

```text
UC-6.4 成员快照/全量 / POST channel/member/snapshot
UC-6.2 设/撤管理员 / POST channel/add/manger
UC-6.2 设/撤管理员 / POST channel/remove/manger
L2-6.1b 拉人后对端更新 / POST channel/member/snapshot [B侧read-back]
L2-6.2b admin 广播到他人 / POST channel/add/manger [A设B为admin]
L2-6.2b admin 广播到他人 / POST channel/member/snapshot [B侧 read-back 验证role]
L2-6.2b admin 广播到他人 / POST channel/remove/manger [A撤B admin]
```

First fix ordering and membership state in the suite:

- `UC-6.4` must run before any scenario removes or closes the active channel.
- `UC-6.2` must target a user that is currently a member of `groupChannelId`.
- `L2-6.2b` must run before `L2-5.3b` removes B, or it must re-add B immediately before admin operations.
- `UC-6.1` may test leave/remove, but it must not poison later admin/member checks.

If ordering alone is insufficient, add a fresh group setup helper for member/admin checks instead of reusing the destructive `groupChannelId`.

- [ ] **Step 8: Verify member/admin group**

Run:

```bash
APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox
```

Expected: member/admin Go failures disappear or reduce to a response-body-proven Go backend defect.

- [ ] **Step 9: Commit member/admin fix**

```bash
git add scripts/apifox-suite-create.py
git commit -m "test: 稳定 Apifox 成员管理员状态"
```

If the patch is in Go server, commit in `/System/Volumes/Data/workspace/golang/cses-im-server` with:

```bash
git add $(git diff --name-only)
git commit -m "fix: 修复成员管理员接口状态处理"
```

- [ ] **Step 10: Increment fallback diagnosis**

For:

```text
UC-4.5 陌生 channel 兜底 / POST channel/load/incrementByChannelId
```

Use the response body to verify the accepted request field:

```text
If error says missing/invalid fromSeq -> use {"channelId":"{{groupChannelId}}","fromSeq":0}
If error says missing/invalid seq -> use {"channelId":"{{groupChannelId}}","seq":0}
If error says channel missing -> move scenario before channel close or create fresh channel
If 5xx/panic -> patch cses-im-server and add Go test there
```

- [ ] **Step 11: Verify increment fallback**

Run:

```bash
APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox
```

Expected: `UC-4.5` no longer appears in Go failures.

- [ ] **Step 12: Commit increment fallback fix**

```bash
git add scripts/apifox-suite-create.py
git commit -m "test: 修正 Apifox 陌生频道增量兜底"
```

If the patch is in Go server, commit in `/System/Volumes/Data/workspace/golang/cses-im-server` with:

```bash
git add $(git diff --name-only)
git commit -m "fix: 修复频道增量兜底接口"
```

---

### Task 5: Run Full Go-Only And Automated Gates

**Files:**
- Create: `docs/uc-rollout/reports/go-only-apifox-closure.md`
- Modify: `package.json` only if convenience scripts are added

**Interfaces:**
- Consumes: all commits from Tasks 1-4.
- Produces: committed final closure report and clean test evidence.

- [ ] **Step 1: Run static/unit/Rust gates**

Run:

```bash
bash scripts/gate.sh
npm run check:static
npm run check:specs
cargo check -p helix-driver-instrument
cargo check -p loopforge-tauri-im
for f in scripts/loop-engine/*.test.mjs test/orchestration/render-board.test.mjs test/reducer/four-facet-reducer.test.mjs; do node --test "$f"; done
```

Expected: every command exits 0.

- [ ] **Step 2: Run final go-only Apifox**

Run:

```bash
APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox
```

Expected:

```text
CURRENT_STAGE="complete"
detail=all requested gates passed
```

The generated `apifox-status.json` must have:

```json
{
  "profile": "go-only",
  "passed": true,
  "stats": {
    "goFailures": 0
  },
  "excluded": [
    "UC-8.x 投票 CRUD",
    "UC-8.x 平均分 CRUD"
  ]
}
```

- [ ] **Step 3: Run automated UI tests**

Run:

```bash
bash scripts/multi-end-loop.sh --all
```

Expected: all selected L1 WDIO specs exit 0 and archive their logs under the latest `/tmp/loopforge/runs/20*/specs/` directory.

If the branch claims L2 closure, also run:

```bash
bash scripts/multi-end-loop.sh --l2
```

Expected: all selected L2 WDIO specs exit 0.

- [ ] **Step 4: Write final report**

Create `docs/uc-rollout/reports/go-only-apifox-closure.md`:

```markdown
# Go-Only Apifox Closure Report

Date: 2026-07-02

## Scope

Included: all Go `:8066` Apifox scenarios, including `UC-10.1 待办列表`.

Excluded:

- `UC-8.x 投票 CRUD`
- `UC-8.x 平均分 CRUD`

Reason: both are Java legacy `:3399` scenarios and are out of scope for this closure round.

## Evidence

| Gate | Command | Result | Archive |
|---|---|---|---|
| Static/harness | `bash scripts/gate.sh` | pass | local console |
| Angular static | `npm run check:static` | pass | local console |
| Spec syntax | `npm run check:specs` | pass | local console |
| Rust instrument | `cargo check -p helix-driver-instrument` | pass | local console |
| Rust Tauri | `cargo check -p loopforge-tauri-im` | pass | local console |
| Apifox Go-only | `APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox` | pass | paste the concrete `/tmp/loopforge/runs/20...` archive printed by the command |
| UI L1 | `bash scripts/multi-end-loop.sh --all` | pass | paste the concrete `/tmp/loopforge/runs/20...` archive printed by the command |

## Caveat

Apifox green is HTTP-only. WS fanout, helix projection, DOM, and storage closure are covered by WDIO/reducer/runtime evidence, not by Apifox alone.
```

Use concrete archive paths copied from the command output; do not write symbolic tokens in the committed report.

- [ ] **Step 5: Commit final report and convenience script changes**

```bash
git add docs/uc-rollout/reports/go-only-apifox-closure.md package.json
git commit -m "docs: 记录 Go-only Apifox 收口证据"
```

If `package.json` did not change, omit it from `git add`.

---

### Task 6: Final Git And Merge Readiness

**Files:**
- No code files expected unless previous tasks produced fixes.

**Interfaces:**
- Consumes: clean local commits from all touched repos.
- Produces: merge-ready status for `loopforge-tauri-im`; separate commit references for `cses-im-server` if backend fixes were required.

- [ ] **Step 1: Show touched repos**

Run:

```bash
git -C /System/Volumes/Data/workspace/rust/loopforge-tauri-im status --short
git -C /System/Volumes/Data/workspace/golang/cses-im-server status --short
git -C /System/Volumes/Data/workspace/rust/helix status --short
```

Expected: no uncommitted changes except intentionally generated runtime artifacts outside git.

- [ ] **Step 2: Show commit ranges**

Run:

```bash
git -C /System/Volumes/Data/workspace/rust/loopforge-tauri-im log --oneline main..HEAD
git -C /System/Volumes/Data/workspace/golang/cses-im-server log --oneline main..HEAD
git -C /System/Volumes/Data/workspace/rust/helix log --oneline main..HEAD
```

Expected: loopforge has profile, evidence, fix, and report commits. Go/helix have commits only if they were actually changed.

- [ ] **Step 3: Stop before merging**

Do not merge to `main` until the user confirms after seeing:

- final gate list,
- final archive paths,
- commit ranges,
- any residual non-Go exclusions.

---

## Self-Review

Spec coverage:

- Java boundary is covered by Tasks 1 and 5.
- Go failure diagnosis and fixes are covered by Tasks 2-4.
- UI/unit/static/Rust validation is covered by Task 5.
- Merge readiness is covered by Task 6.

Placeholder scan:

- The plan does not use deferred-work markers or open-ended “fix later” language.
- Unknown Go root causes are handled through explicit response-driven decision rules.

Type consistency:

- `APIFOX_PROFILE`, `GO_ONLY_EXCLUDED_SCENARIOS`, `selected_uc_table()`, and `skipped_scenario_names()` are introduced before use.
- `go-only` is used consistently as the profile value.

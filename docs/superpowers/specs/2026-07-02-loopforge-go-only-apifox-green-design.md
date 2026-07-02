# LoopForge Go-Only Apifox Green Gate Design

> 日期：2026-07-02
> 范围：`loopforge-tauri-im` + `helix` + `cses-im-server` + Apifox HTTP suite
> 决议：本轮只排除投票和平均分；`todolist/Todo` 继续纳入 Go 收口范围。

## Goal

Build an honest Go-only green gate for LoopForge:

```text
Apifox HTTP go-only green
+ automated UI tests green
+ unit/static/Rust gates green
= current closure pass
```

Apifox green only proves HTTP request/response coverage. It does not prove WebSocket fanout, helix projection, DOM, storage, or business UX. Those remain covered by WDIO, reducer, and runtime logs.

## Scope

In scope:

- Keep Java old backend out of this closure round.
- Exclude only `UC-8.x 投票 CRUD` and `UC-8.x 平均分 CRUD`, because both use `base_url_java = http://localhost:3399`.
- Keep every Go `:8066` Apifox scenario in the go-only suite, including `UC-10.1 待办列表`.
- Fix all remaining Go Apifox failures with real state, real ids, real requests, and real server responses.
- Preserve UI -> store -> Tauri -> helix -> cses-im-server for UI/E2E validation.
- Run automated UI tests, unit/static tests, and Rust checks before claiming closure.

Out of scope:

- Java `:3399` startup, debugging, vote endpoints, and average-score endpoints.
- Treating Apifox as proof of WS/DOM/storage correctness.
- Weakening assertions to make red steps green.
- Introducing mock data, fake ids, random server ids, debug state patching, or UI-only business success.

## Current Evidence

Latest archived Apifox run:

```text
/tmp/loopforge/runs/20260702-225010
```

Observed total:

```text
95 steps
69 passed
26 failed
```

Excluded failures:

- `UC-8.x 投票 CRUD`
- `UC-8.x 平均分 CRUD`

Remaining Go failures are grouped by domain:

| Group | Failing scenarios |
|---|---|
| Message state chain | `UC-1.10`, `UC-1.5`, `UC-3.2`, `UC-3.3`, `UC-2.3` |
| Channel notice / announcement | `UC-5.4`, `UC-5.6w` |
| Member / admin state | `UC-6.4`, `UC-6.2`, `L2-6.1b`, `L2-6.2b` |
| Increment fallback | `UC-4.5` |

## Design

### 1. Apifox Profiles

Add a profile switch to `scripts/apifox-suite-create.py`:

```text
APIFOX_PROFILE=full
APIFOX_PROFILE=go-only
```

`full` keeps the existing all-scenario behavior.

`go-only` removes only these two scenario names from suite creation and stage grouping:

```text
UC-8.x 投票 CRUD
UC-8.x 平均分 CRUD
```

The script must print the selected profile and skipped scenario names. The green gate for this round is `APIFOX_PROFILE=go-only`.

### 2. Failure Evidence

Every failed Apifox HTTP step must leave enough evidence to diagnose:

- scenario name
- step name
- HTTP status code
- response body
- active runtime variables used by the step

The output can be in `apifox-run.log`, generated report JSON, or an additional archive artifact under the current run directory. The first implementation should prefer the least invasive path: improve `scripts/summarize-run-report.mjs` and add readable failure extraction from existing Apifox JSON if the reporter already stores bodies. If bodies are unavailable, add per-step postProcessor logging for failures.

### 3. Go Failure Fix Policy

Use systematic debugging for every Go red:

1. Reproduce the failing Go scenario in `APIFOX_PROFILE=go-only`.
2. Capture request body, variables, response status, response body, and Go server log tail.
3. Compare against the closest green scenario in the same suite.
4. Patch the smallest real cause:
   - suite ordering,
   - per-UC fresh state,
   - variable extraction,
   - request body field names,
   - Go server behavior when evidence proves backend defect.
5. Re-run the affected scenario group.
6. Re-run the full go-only Apifox suite.

Do not patch frozen expect files or replace failed business behavior with soft assertions unless the endpoint is explicitly documented as HTTP-only or backend-gap by human decision.

### 4. UI And Unit Closure

After Go-only Apifox is green, run:

```bash
bash scripts/gate.sh
npm run check:static
npm run check:specs
cargo check -p helix-driver-instrument
cargo check -p loopforge-tauri-im
bash scripts/multi-end-loop.sh --all
```

Run L2 as a hard gate when the current branch claims L2 closure:

```bash
bash scripts/multi-end-loop.sh --l2
```

## Success Criteria

The task is complete only when all of the following are true:

- `APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox` exits 0.
- The Apifox report has no failed Go `:8066` request.
- The report explicitly records that vote and average-score scenarios are excluded in go-only mode.
- `UC-10.1 待办列表` remains included.
- Static, unit/spec syntax, Rust, and UI automation gates pass.
- Final report states: Apifox is HTTP-only and does not prove WS/DOM/business closure by itself.

## Rejected Alternatives

### Mark Java Scenarios As Soft Pass

Rejected because it would make a single report look green while hiding the fact that Java endpoints were not exercised.

### Remove All UC-8.x And Todo

Rejected because the approved boundary is narrower: only vote and average-score are excluded. Todo remains in scope unless future evidence proves it is Java-only.

### Fix Java Old Backend First

Rejected for this round. The user explicitly said not to care about Java now.


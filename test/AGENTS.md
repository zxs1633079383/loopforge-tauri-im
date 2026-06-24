# test/ — 四面 oracle + e2e（W3）

> 就近局部指令（渐进式披露）。本目录是 LoopForge 的「契约一致性自动化夹具」测试侧：
> 四面 reducer（读 run.jsonl → 聚 corr_key → 与期望 diff → 出「断在哪一跳」报告）+ send-message e2e。

## 布局

```
test/
├── reducer/
│   ├── corr-key.mjs                  领域键规则（ch/tmp/sid/seq；与装饰器 extract_corr_key 对齐）
│   ├── four-facet-reducer.mjs        四面 reducer（纯函数·零依赖）
│   └── four-facet-reducer.test.mjs   reducer 单测（39 断言·含可证伪对偶，node 直跑）
├── expect/
│   └── uc-send-1.expect.json         UC-send-1 四面期望（🚫 只读契约·见下）
├── fixtures/
│   └── uc-send-1.sample.jsonl        reducer 自测样例 JSONL（金标束 + 静默噪声）
└── specs/
    └── uc-send-1.e2e.mjs             WebdriverIO e2e（直连 4445；读 run.jsonl 过 reducer）
```

## 跑

- **reducer 单测（现在就能跑·零依赖）**：`node test/reducer/four-facet-reducer.test.mjs`
- **e2e（需 W1/W4 就绪）**：debug app 起（4445 webdriver + 1420 前端）→ `wdio run wdio.conf.mjs`
  - `run.jsonl` 路径经 env `HELIX_RUN_JSONL` 暴露（W1 LogSink.to_file 落点），缺省回退 `src-tauri/run.jsonl`。

## 四面 ↔ facet/hop（`crates/helix-driver-instrument/src/event.rs` schema）

| 面 | facet | hop | reducer 取 |
|---|---|---|---|
| ① 出站命令体 | `outbound` | `http-req` / `ws-send` | `{method,url,body}` |
| ② 投影 envelope | `projection` | `projection` | `{event,data}`（冻结字段集）|
| ④ DB 落库行 | `storage` | `storage` | `{op,table,rows}` |
| WsRecv（输入）| `ws-recv` | `ws-recv` / `http-resp` | 串 corr_key（echo 帧带 sid）|
| ③ DOM | — | — | e2e 注入（读 `[data-temporary-id]` 行 data-*）|

## 只读契约铁律（contract-readonly-autofix.md §1）

- 🚫 `expect/*.expect.json`（四面期望）+ `fixtures/*.tape.json`（金标 tape）= **只读 oracle**。
  自动修复 agent 禁改它们让红变绿；红只能靠改 **helix 引擎实现 / 本仓渲染壳**。
- 契约真过时（go 改 wire / 投影真要变）→ 出「契约变更提案 + 证据」交人审，禁自改。
- 抽键规则（`corr-key.mjs`）属契约族，改它须同步 spec §2 + 装饰器 `extract_corr_key`。

## 可证伪铁律（HX-C011）

reducer 单测每个「绿」断言配「破坏即红」对偶（故意改坏某面 → 必报红 + 断点定位正确）。
e2e 时序一律 `waitUntil` 等条件，禁固定 pause 猜 settle；超时=真 bug 不掩盖。

> 真源（只读）：helix `projection-schema.md`（②）· `真机curl真源.md`（①）· spec `send-message-vertical-slice.md`（③④）。

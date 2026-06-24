# RUNBOOK — record / replay / run / dev-loop

> W4 harness 操作手册。脚本在 `scripts/`，共享公共库 `scripts/_lib.sh`。
> 全部 fail-loud（前置检查不过立即非 0 退出 + 中文原因）。
> 上游真源：[竖切 spec](spec/send-message-vertical-slice.md) §6/§7/§9 · [golden-replay-determinism](../rules/golden-replay-determinism.md) · [contract-readonly-autofix](../rules/contract-readonly-autofix.md)。

---

## 0. 三轨一图

| 脚本 | 轨 | 连真 go？ | 确定性？ | 何时用 |
|---|---|---|---|---|
| `record.sh` | Record | ✅ 连真 go | ❌（go 在线） | 建/重录金标帧 tape（人审后冻结） |
| `replay.sh` | Replay | ❌ 喂 tape | ✅ 字节级复现 | 日常确定性闭环 / 自动修复验证 |
| `run.sh`    | Live（默认） | ✅ 连真 go | ❌ | 从零到四面报告（开发/手测，`cargo run` 边构建边起） |
| `dev-loop.sh` | 跨两 repo 闭环 | 经 Replay | ✅ | 改 helix 引擎 → 重建 → 重跑 → 读 diff → 循环 |

四面断言（oracle）：① 出站命令体（vs `真机curl真源.md`）② 投影 envelope（vs `projection-schema.md`）③ DOM `data-*` ④ DB 落库行。任一面偏离即 fail。

---

## 1. 端口与产物落点

| 项 | 默认 | 覆盖 env |
|---|---|---|
| 前端（ng serve） | `1420` | `FRONTEND_PORT` |
| webdriver（tauri-plugin，仅 debug） | `4445` | `WEBDRIVER_PORT` |
| 金标帧 tape | `test/fixtures/uc-send-1.tape.json` | `TAPE_FILE` |
| wdio 配置 | `wdio.conf.mjs`（仓根） | `WDIO_CONF` |
| debug app 二进制 | `src-tauri/target/debug/loopforge-tauri-im` | `APP_BIN` / `APP_BIN_NAME` |
| 运行日志 | `/tmp/loopforge/*.log` | `RUN_LOG_DIR` |
| 结构化 hop 日志（app 写 / reducer 读） | `/tmp/loopforge/run.jsonl` | `HELIX_RUN_JSONL` |
| wdio 控制台抓存（含「断在哪一跳」） | `/tmp/loopforge/wdio-out.log` | `WDIO_OUT` |
| helix checkout（dev-loop 改引擎处） | `/Users/mac28/workspace/rustWorkspace/helix` | `HELIX_ROOT` |

---

## 2. 环境变量

| 变量 | 用途 | 谁读 |
|---|---|---|
| `HELIX_DEVICE_ID` | 连真 go 的**真实设备身份**。Record **必填**；Live（run.sh）建议设。 | record.sh / run.sh → 透传给 app 组装根 |
| `HELIX_HTTP_MAX_INFLIGHT` | HTTP 在途上限（就绪 probe 的 inflight==0 语义相关）。 | record/run → 透传给 app |
| `LOOPFORGE_MODE` | `live\|record\|replay`，组装根据此选 `Recording<P>` 模式（默认 live）。 | 脚本经此 env 把模式传给 debug app |
| `HELIX_RUN_JSONL` | 结构化 hop 日志落点。脚本统一设它 → app(LogSink 写) 与 wdio spec(reducer 读)看同一份。 | 脚本 → app + wdio |
| `DEVLOOP_FIX_HOOK` | dev-loop `loop` 子命令的「据 diff 改 helix 实现」可执行钩子（loop 驱动器注入）。 | dev-loop.sh |

> **reducer / JSONL 接缝**（与 W1/W3 对齐）：W1 的 LogSink 把每跳 `{run_id,uc_id,corr_key,facet,hop,payload}` 写到 `HELIX_RUN_JSONL`；W3 的 reducer 在 wdio spec 内 `runFourFacet({jsonl,expect,dom})` 聚 corr_key 出「断在哪一跳」，打到 wdio 控制台。脚本统一 `HELIX_RUN_JSONL` 让两端看同一份，并 tee wdio 控制台到 `WDIO_OUT` 供 dev-loop 收 diff。**W1 LogSink 必须读 `HELIX_RUN_JSONL` env 选落点**（见集成 TODO）。

> 模式开关约定：脚本把 `LOOPFORGE_MODE=<mode>` 注入 app 进程环境；组装根（W1 src-tauri，debug 构建）读它决定用 `Mode::Live/Record/Replay` 拼 `InstrumentCtx`。W1 落地后若 env 名不同，改 `_lib.sh` 的 `MODE_ENV_VAR` 一处即可。

### 2.1 部署配置 profile（creds/端点真源 · 替掉 env 指定 creds）

身份（cookieId/deviceId）+ 端点（apiBase/wsUrl）+ 租户（companyId）走 **配置文件 profile**，不再散落 env：

| profile | 文件 | 何时选 | creds |
|---|---|---|---|
| `dev-local` | `config/dev-local.json` | **debug 构建默认** | 含本地联调实值（cookieId/deviceId） |
| `pre` | `config/pre.json` | 仅 active-profile 覆盖时 | 留空（运行时真鉴权注入） |
| `prod` | `config/prod.json` | **release 构建默认** | **必须留空**（运行时真鉴权注入） |

- **profile 选择优先级**：① `config/active-profile`（纯文本一行，如 `pre`，本地覆盖、不入仓）→ ② 否则 `cfg!(debug_assertions)`：debug→`dev-local`、release→`prod`。
- 三套 `config/*.json` 编译期 `include_str!` 内嵌（bundle 后无外部目录依赖）；`active-profile` 运行时读盘（切 profile 不必重编，读不到则按构建态默认）。
- **🔴 铁律：`prod.json` 不得带 dev creds**（cookieId/deviceId 必须空字符串）——生产身份由真鉴权链路运行时注入，配置文件硬编码 dev creds = 越权 / 泄漏。仅 `dev-local.json` 含联调实值，仅本地使用。
- 占位域名（`im-pre.example.com` / `im.example.com` + `TODO-*-company-id`）上线前替真值。
- 运行模式开关（`HELIX_RUN_JSONL` / `LOOPFORGE_MODE` / `HELIX_HTTP_MAX_INFLIGHT`）**不是 creds/端点**，仍走 env，不进 profile。

---

## 3. 怎么 record（建金标帧）

> 连真 go 跑 UC-send-1 一次，把「go 帧 + 时钟 + id + 随机」录进 tape（确定性三要素，缺一即非确定）。

```bash
# 必须连真 go：设真实设备身份
HELIX_DEVICE_ID=<真实设备id> scripts/record.sh

# 可选：限 HTTP 在途 + 透传 wdio 参数
HELIX_DEVICE_ID=<id> HELIX_HTTP_MAX_INFLIGHT=4 scripts/record.sh -- --spec test/specs/uc-send-1.e2e.mjs
```

脚本做什么：前置检查（device 必填 / app 已构建 / 端口空闲）→ 起前端(1420) + 起 debug app(Record 连真 go) → 等双就绪 → wdio 跑 UC-send-1 一遍 → app 在 Record 模式下 `ctx.save_tape()` 落 `test/fixtures/uc-send-1.tape.json` → 提示人审。

**人审冻结（必须）**：审 tape（inbound/clock/ids/randoms 完整、无敏感数据）→ `git add` 提交 → 此后视为**只读金标帧**（禁自动修复 agent 改它，见 `rules/contract-readonly-autofix.md`）。已存在 tape 会自动备份 `.bak.<时间>` 防误覆盖。

---

## 4. 怎么 replay（日常确定性闭环）

> 喂冻结 tape，不碰网络，经真实 Tauri+WKWebView+WebdriverIO 跑 → 四面断言。秒级、无 go flaky。

```bash
scripts/replay.sh          # 跑 1 次
scripts/replay.sh 3        # 重跑 3 次做确定性自检（同 tape 结果须一致，守 HX-C011）
```

脚本做什么：前置检查（tape 存在 / app 已构建）→ 起前端一次 → 每轮重起 app(Replay 喂 tape) + 跑 wdio → 汇总 `N 绿 / M 红`。有红即非 0 退出，提示「改 helix 实现 / 渲染壳，禁改 tape/期望」。

---

## 5. 怎么 run（从零到四面报告，Live 真 go）

> 开发/手测：`cargo run` 边构建边起 + 前端 + wait-on + wdio 一条命令串起。

```bash
HELIX_DEVICE_ID=<id> scripts/run.sh
HELIX_DEVICE_ID=<id> scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs
LOOPFORGE_MODE=record HELIX_DEVICE_ID=<id> scripts/run.sh   # 也可借 run.sh 录（但建议用 record.sh）
```

与 record/replay 区别：run.sh 用 `cargo run`（开发态，首次冷构建数分钟，webdriver 就绪超时给到 600s）；record/replay 用预构建 `$APP_BIN`（求快/确定）。

---

## 6. 怎么 dev-loop（跨两 repo 自动修复闭环）

> 改 helix 引擎实现 → 重建 testbed → 确定性重跑 → 读 reducer「断在哪一跳」diff → 循环。

```bash
scripts/dev-loop.sh once          # 跑一轮：rebuild testbed + replay + 收 diff，人看结果
scripts/dev-loop.sh loop 5        # 循环骨架 ≤5 轮
DEVLOOP_FIX_HOOK=/path/to/fix.sh scripts/dev-loop.sh loop 5   # 注入「据 diff 改实现」钩子
```

一轮闭环：`assert_two_repos`（helix + testbed 都在）→ `rebuild_testbed`（src-tauri 拉 helix path dep 改动重编）→ `rerun_replay`（复用 replay.sh，四面断言）→ `collect_reducer_diff`（从 `$WDIO_OUT` 抠「四面报告 / 断在哪一跳」行落 `/tmp/loopforge/reducer-diff.txt`）。绿则停，红则下一轮。

**两个 loop 驱动器接缝（TODO，留给 helix-loop-engine skill / Workflow / /loop）**：
- 接缝①「据上轮 diff 改 helix 实现」：循环顶部调 `DEVLOOP_FIX_HOOK`（未注入则只验证当前状态，不自动改代码）。
- 接缝⑤「据 diff 决策继续/换策略/早停」：当前默认红则进下一轮；驱动器可据 diff 判同一跳连续 N 轮不动 = 卡死告警 → break。

**契约只读护栏**：闭环只允许改 helix 实现 + 渲染壳，**禁改** tape / 四面期望 / `projection-schema.md` / `真机curl真源.md`（红转绿只能靠改实现；契约真过时 → 出「契约变更提案 + 证据」交人审）。

---

## 7. 故障速查

| 症状 | 原因 | 解 |
|---|---|---|
| `⛔ 端口 1420/4445 已被占用` | 上轮链路没收干净 | `pkill -f target/debug/loopforge-tauri-im`；`lsof -ti:1420 \| xargs kill` |
| `⛔ 未找到 debug app 二进制` | W1 src-tauri 未构建 | `cargo build --manifest-path src-tauri/Cargo.toml`（W1 落地后） |
| `⛔ 未找到 wdio 配置 / node_modules 缺失` | W2/W3 未落地 | `pnpm install` + 等 W3 wdio.conf.mjs / specs |
| `⛔ 金标帧 tape 不存在`（replay） | 还没 record | 先 `HELIX_DEVICE_ID=<id> scripts/record.sh` |
| `⛔ HELIX_DEVICE_ID 未设`（record） | Record 必须连真 go | 设真实设备身份 |
| webdriver 60s/600s 超时 | app 没起来 / 还在冷构建 | 看 `/tmp/loopforge/*-app.log`；run.sh 首次构建久属正常 |
| `Replay 有红` | 实现 bug（四面某面偏离） | 读 wdio「断在哪一跳」reducer 报告 → 改 helix 实现（禁改 tape/期望） |

---

## 8. 依赖前置（W1–W3 落地后才全绿）

W4 脚本是 harness 编排层，依赖兄弟工作流产物：
- **W1 src-tauri**：debug app 二进制 + `LOOPFORGE_MODE` 读取选模式 + `HELIX_RUN_JSONL` 选 LogSink 落点 + Record 模式 `ctx.save_tape($TAPE_FILE)` + 就绪 probe。
- **W2 前端**：`package.json`(pnpm start) + `node_modules` + Tauri 接线。
- **W3 测试**：`wdio.conf.mjs`(仓根，已落地) + `test/specs/uc-send-1.e2e.mjs`（已落地，reducer 在 spec 内跑读 `HELIX_RUN_JSONL`，「断在哪一跳」打控制台）。

未落地时脚本会在对应前置检查处 fail-loud 指明缺什么——这是设计，不是 bug。

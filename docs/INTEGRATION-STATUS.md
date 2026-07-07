# INTEGRATION-STATUS — 竖切 UC-send-1 四工作流集成核对

> 生成：集成综合阶段（Integrate）。输入 = W1–W4 四工作流并行落地后的结构化报告 + 实际代码交叉核对。
> 真源：[`docs/spec/send-message-vertical-slice.md`](spec/send-message-vertical-slice.md) · [`CLAUDE.md`](../CLAUDE.md) §2 五不变量。
> 契约只读护栏：本文件只**报告**缝对齐状态，不改任何冻结契约（projection-schema / 真机curl真源 / expect JSON / golden tape）。

---

## 1. 四工作流文件清单概览

| WS | 范围 | 关键文件 | 自报状态 |
|---|---|---|---|
| **W1** | src-tauri 宿主（Rust + Tauri 2，内嵌 helix） | `src-tauri/src/{lib,engine,commands,state}.rs` · `Cargo.toml` · `tauri.conf.json` · `capabilities/default.json` | PASS（`cargo check` + `--no-default-features` 双绿，引擎零改） |
| **W2** | 前端薄壳（Angular 20） | `src/app/im/{tauri-bridge.service,im-store.service,projection.types,message-row.model}.ts` · `src/app/app.component.ts` · `wdio.conf.mjs` | PASS（pnpm build 绿，266kB） |
| **W3** | 四面 reducer + e2e + 期望 | `test/reducer/{corr-key,four-facet-reducer}.mjs` · `test/expect/uc-send-1.expect.json` · `test/specs/uc-send-1.e2e.mjs` · `test/fixtures/uc-send-1.sample.jsonl` | PASS（reducer 单测 39/39 绿；e2e 静待 W1/W4） |
| **W4** | 录放 + run/dev-loop 脚本 | `scripts/{_lib,record,replay,run,dev-loop}.sh` · `docs/RUNBOOK.md` · `test/fixtures/.gitkeep` | PASS（bash -n + 前置检查离线验证；真链路待 W1/W2 产物） |

仪表层（既有，零重写）：`crates/helix-driver-instrument/`（`Recording<P>` + `HopEvent`/`LogSink`/`Tape`/`InstrumentCtx`）。

---

## 2. 契约缝核对表（W1 emit ↔ W2 渲染 ↔ W3 断言 ↔ 装饰器 schema）

| 缝 | W1（Rust 宿主） | W2（前端薄壳） | W3（reducer / e2e） | 对齐？ |
|---|---|---|---|---|
| **invoke `im_send`** | `commands.rs` `im_send(channel_id,text,temporary_id)` | `im-store.service.ts` `invoke('im_send',{channelId,text,temporaryId})` | e2e `invokeBridge('im_send',{channelId,text,temporaryId})` | ✅（Tauri 自动 snake↔camel） |
| **invoke `im_ready`** | `commands.rs` `im_ready()->bool` | `im-store` 250ms 轮询 `invoke('im_ready')` | — | ✅ |
| **invoke `set_uc`** | `commands.rs`（`#[cfg(feature=webdriver)]`） | 未在 UI 暴露（按需直调） | e2e `invokeBridge('set_uc',{uc})` | ✅ 命令存在，但**经 `__lf` 桥调用 → 见 ❌-A** |
| **event `im:__bus__`** | `engine.rs` `app.emit(BUS_CHANNEL,&envelope)`；envelope=`{channel,payload:{event,data}}` | `tauri-bridge` `listen('im:__bus__')` → `onBus(env)` 读 `env.channel`/`env.payload.data` | — | ✅ |
| **HopEvent schema** | `event.rs`：`{run_id,uc_id,corr_key?,facet(kebab),hop(kebab),seq,payload}`，`LogSink` 一行一条 | — | `four-facet-reducer.mjs` `parseJsonl` 读同字段；facet 名 `outbound/projection/storage/ws-recv` | ✅（sample JSONL 即按此 schema） |
| **projection facet payload** | `engine.rs` tee `payload_from_bytes(&ev.0)` = 原始 `{event,data}` | — | `actualProjection` 读 `payload.event`/`payload.data` | ✅ |
| **tape 路径** | lib.rs 当前 `Mode::Live`，**未** save_tape | — | e2e 不直引 tape（只读 fixtures sample） | W4 `_lib.sh` `TAPE_FILE=test/fixtures/uc-send-1.tape.json` | ⚠️ 路径已约定，但**录放缝未接**（见 ❌-E） |
| **run.jsonl env 名** | `lib.rs` 读 **`LOOPFORGE_RUN_JSONL`** | — | e2e + `_lib.sh` 读/写 **`HELIX_RUN_JSONL`** | ❌-B **env 名不一致** |
| **DOM `data-temporary-id`** | — | app 渲染 `[attr.data-temporary-id]` | e2e 锚 `[data-temporary-id="t"]` | ✅ |
| **DOM `data-msg-id/send-status/event-seq/read-bits/channel-id`** | — | app 全渲染 | e2e/reducer 读 | ✅ |
| **DOM `data-ready`** | `im_ready` 驱动 | app `[attr.data-ready]` | e2e before 轮询 `[data-ready=true]` | ✅ |
| **DOM `[data-active-channel]`** | — | **app 无此属性**；channelId 硬编码 `demo-channel` 不上 DOM | e2e `before` 读它取 `CHANNEL_ID` | ❌-C **缺属性** |
| **DOM `[data-role="composer-input"]`** | — | app 用 **`data-testid="compose-input"`** | e2e `$('[data-role="composer-input"]')` | ❌-D **选择器名不一致** |
| **`window.__lf.invoke` 桥** | — | **前端无任何 `__lf` 注入**（grep 空） | e2e `invokeBridge` 硬依赖 `window.__lf.invoke` | ❌-A **桥缺失（致命）** |
| **outbound facet ①** | **未 tee**（native EngineConfig 非泛型，装饰 Http 不可注入引擎） | — | reducer `diffOutbound` 必读 outbound hop | ❌-F **facet ① 无观测点** |
| **storage facet ④** | **未 tee**（同上，Storage 装饰不可注入） | — | reducer `diffStorage` 必读 storage hop | ❌-F **facet ④ 无观测点** |

---

## 3. Blocker 排序（按「竖切跑通前必接」从高到低）

> 排序原则：先解「整条 e2e 起不来 / reducer 读错文件」的硬阻塞，再解「四面有面无观测」的对账阻塞，最后录放确定性。

### 🔴 P0 — 不修则 e2e 连第一步都跑不动

- **B0-A · `window.__lf.invoke` 桥缺失**。e2e 的 `set_uc` / `im_send` 全经 `window.__lf.invoke(cmd,args)` 透传；W2 前端从未注入 `window.__lf`。
  → 修：W2 在 `main.ts`（或 AppComponent ngOnInit）注入 `window.__lf = { invoke: (c,a)=>bridge.invoke(c,a) }`（仅 Tauri 环境）。`TauriBridgeService.invoke` 已就绪，只差挂全局。
- **B0-B · run.jsonl env 名不一致**。W1 读 `LOOPFORGE_RUN_JSONL`，W3/W4 统一用 `HELIX_RUN_JSONL`。不统一 → app 写 A 文件、reducer 读 B 文件 → reducer 永远读到空/旧 → 四面全红。
  → 修（二选一，单点）：W1 `lib.rs:27` 改读 `HELIX_RUN_JSONL`（推荐，跟 W3/W4 既有约定 + host-cli 同 key 前缀）；或 W4 `_lib.sh` 改用 `LOOPFORGE_RUN_JSONL`。**推荐改 W1**（W3 e2e + W4 三脚本三处引用，改面小）。
- **B0-C · DOM `[data-active-channel]` 缺失**。e2e `before` 读它取 `CHANNEL_ID`，缺 → `CHANNEL_ID=null` → `im_send` channelId 为空 → W1 `im_send` 直接 `Err("channelId 为空")`。
  → 修：W2 在 `<main>` 或 list 容器加 `[attr.data-active-channel]="channelId"` 并把 `channelId` 暴露（当前 private 硬编码 `demo-channel`）。
- **B0-D · 输入框选择器名不一致**。e2e `$('[data-role="composer-input"]')`；app 是 `data-testid="compose-input"`。选择器找不到元素 → `setValue` 抛错。
  → 修（二选一）：W2 input 加 `data-role="composer-input"`；或 W3 e2e 改选 `[data-testid="compose-input"]`。**推荐改 W2**（DOM 契约对齐 spec §4 语义；e2e 是契约族，优先稳定）。

### 🟠 P1 — e2e 能起来，但四面对账注定红（facet 无观测点）

- **B1-F · outbound（①）+ storage（④）facet 未 tee**。W1 现实边界：native `EngineConfig` 字段是具体 ports（`NativeStorage`/`NativeHttp`），非泛型 → `Recording<P>` 装饰 port 无法注入引擎（注入需改 helix，违零改铁律）。当前只 tee 了 projection（②）。
  → reducer 的 `diffOutbound`/`diffStorage` 拿不到 hop → 必 fail（「断在 outbound/storage 这跳」）。
  → **这是结构性缺口，不是接线 bug**。三条出路（择一交人审，守零改铁律）：
    1. **helix 开「tape 缝」**（推荐）：仿 `helix-driver-host` 既有 `BatchSink` 泛型示范，把 native `EngineConfig` / `run_engine_loop_with_transports` 改成接受 `impl Storage/HttpRequester/EventSink/Clock`（泛型化）→ 可注入被装饰 port → ①④+Clock/IdSource tape 全通。**属 helix 侧改动，需独立 issue + ADR 走人审**（零改铁律的合法松绑，对齐 W1 integration_todo「独立 helix tape 缝 issue 提案」）。
    2. **host 侧旁路观测**：outbound 改由 Go 端抓包/access log 兑现 ①；storage 改由 reducer 直接查 SQLite（`HELIX_DB`）兑现 ④。绕开引擎注入，但 ① 失去「装饰器逐字 body」精度。
    3. **竖切先收窄到②③**：先让 projection（②）+ DOM（③）两面绿跑通 walking skeleton，①④标 `pending`，待出路 1 落地补齐。**不冒充四面全绿**（守 HX-C011 可证伪 / 契约只读：不改 expect 让红变绿）。

### 🟡 P2 — 确定性与出货

- **B2-E · tape 录放缝未接**。lib.rs 固定 `Mode::Live`；Record/Replay 需 `InstrumentCtx` 用对应 mode + tape 注入 + 装饰 port 进引擎 —— 与 B1-F 同根（泛型缝）。在 B1-F 出路 1 落地前，replay 确定性回放不可达，e2e 只能连真 Go（flaky）。
  → 短期：竖切先用真 Go 一轮验证链路通；replay 确定性待 tape 缝。
- **B2-G · release 出货 flag**。webdriver/set_uc/录放经 `webdriver` feature（默认开）；release 必须 `cargo build --release --no-default-features`。W4 打包脚本须显式带该 flag（否则带 4445 自动化接口，违 CLAUDE.md §2.4）。

---

## 4. 有序 next-steps（让竖切「②③两面」先跑通 walking skeleton）

> 目标分两段：**先 walking skeleton（②③绿 + ①④pending）**，再**补齐四面（解 B1-F）**。

**第一段 · 接线修复（P0，全部在白名单内，无 helix 改动，~小时级）**
1. **W2**：`main.ts` 注入 `window.__lf={invoke}`（仅 `bridge.isTauri()` 时）→ 解 B0-A。
2. **W1 或 W4**：统一 run.jsonl env 名（推荐 W1 `lib.rs` 改读 `HELIX_RUN_JSONL`）→ 解 B0-B。
3. **W2**：AppComponent 暴露 `channelId` + 加 `[attr.data-active-channel]` → 解 B0-C。
4. **W2**：input 加 `data-role="composer-input"`（与 `data-testid` 并存）→ 解 B0-D。
5. 跑 `scripts/run.sh`（真 Go 一轮）→ e2e 起得来 + ②③两面应绿（乐观上屏 + echo 覆写 + projection 字段集对齐）。

**第二段 · 补齐 ①④四面（P1，需人审决策）**
6. 出「**helix tape 缝**变更提案 + 证据」（B1-F 出路 1）：泛型化 `EngineConfig`/`run_engine_loop_with_transports`，对照 `helix-driver-host::BatchSink` 既有泛型先例 → 交人审（零改铁律的合法松绑，独立 issue + ADR）。
7. 缝落地后：W1 把 `Recording<Http>`/`Recording<Storage>`/`Recording<Clock>`/`Recording<IdSource>` 注入引擎 → ①④+tape 全通。
8. 补 tape 录放（B2-E）：Record 模式跑 UC-send-1 → `ctx.save_tape("test/fixtures/uc-send-1.tape.json")` → 人审冻结 → Replay 确定性回放。
9. e2e 四面全绿 + Replay ≥3 次一致 → 竖切通过 → 解锁 UC rollout。

**贯穿 · 就绪 probe 精度（非阻塞）**
- 当前 `im_ready` 用「bus 静默窗口 1500ms」近似 `inflight==0`（W1 诚实标注非精确）。接 B1-F tape 缝后可换精确 inflight 计数；当前不冒充精确（守可证伪）。

---

## 5. 竖切 DoD（Definition of Done）还差什么

对照旧竖切验收 checklist（已由 `docs/uc-rollout/README.md` / `docs/README.md` 路由替代）：

| DoD 项 | 状态 | 还差 |
|---|---|---|
| W1–W4 各自验收绿 | ✅ 四工作流自验收均 PASS | — |
| **四面跨缝接线对齐** | ❌ | B0-A/B/C/D 四处接线 mismatch（§3 P0），修完才能跑 e2e |
| UC-send-1 ② 投影字段集对齐 | 🔶 可达 | 接线修完 + 真 Go 一轮即可验（projection facet 已 tee） |
| UC-send-1 ③ DOM tmp→server 覆写 | 🔶 可达 | 同上（W2 渲染逻辑已就位） |
| UC-send-1 ① body 对齐真机curl真源 | 🔒 阻塞 | B1-F：outbound facet 无观测点，需 helix tape 缝（人审） |
| UC-send-1 ④ message 落行 + cursor 推进 | 🔒 阻塞 | B1-F：storage facet 无观测点，需 helix tape 缝（人审） |
| Replay 确定性 ≥3 次一致 | 🔒 阻塞 | B2-E：tape 录放缝未接（与 B1-F 同根） |
| reducer 报告无「断点」 | 🔒 阻塞 | 依赖四面齐（①④补齐后） |
| 契约只读护栏生效 | ✅ | expect/golden/schema 全程只读，红只靠改实现/壳 |
| 全程 mac 跑通（WKWebView 4445） | 🔶 未验 | 接线修完后真跑一轮确认 |

**一句话 DoD 差距**：竖切离「②③两面 walking skeleton 跑通」只差 **4 处接线修复（P0，全在本仓白名单内，小时级）**；离「①④四面全绿 + Replay 确定性」差 **1 个 helix 侧 tape 缝（泛型化 EngineConfig）—— 属零改铁律的合法松绑，需独立 issue + ADR 走人审**，不可在本仓单方面绕过。

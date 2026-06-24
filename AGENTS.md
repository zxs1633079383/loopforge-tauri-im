# loopforge-tauri-im — 项目指令（每次会话开局必读）

> **一句话**：UI 精简、功能五脏俱全的轻量 IM 成品客户端，**内嵌真实 helix 引擎**，经真实 Tauri + WKWebView 跑端到端自动化测试，喂「自动测试 → 自动修复 → 自动验证」闭环。
>
> 不取代 cses-client：cses-client = 生产渲染宿主；本仓 = 最小可测宿主。两者消费**同一个 helix 引擎 + 同一份冻结 `projection-schema.md`**，本仓是「契约一致性自动化夹具」，cses-client 是「生产渲染端」，同在冻结契约下游，不重复不打架。
>
> 📋 **完整需求 → [`docs/PRD.md`](docs/PRD.md)**（12 决策点 + 22 User Stories + 实现/测试决策 + Out of Scope）。开局必读。

> 🔁 **指令文件同步铁律**：本仓所有同目录 `CLAUDE.md` 与 `AGENTS.md` 是镜像文件；任何修改必须同时落到两者，内容完全同步。

---

## 0. helix 上游（path dep · 不在本仓内）

本仓**独立于 helix 仓**，Rust 侧 dev 期用本地 path dep 指向 helix checkout：

- helix workspace：`/Users/mac28/workspace/rustWorkspace/helix`（`helix-core` / `helix-im` / `helix-driver-native`）
- 行为/契约真源在 helix 仓，**不在本仓复制**：
  - 投影契约：`helix/crates/helix-im/docs/projection-schema.md`（21 投影工厂字段集，冻结）
  - outbound 真源：`helix/crates/helix-im/docs/csesapi-migration/真机curl真源.md`（真抓包 body+头）
  - 落地真相：`helix/crates/helix-im/docs/sync-v2-能力与缺口状态.md`
- release 期改 path dep 为 pin git rev（求隔离）。

---

## 1. 三层架构（铁律）

```
前端薄壳（Angular 20 + Tauri 2）         简化语义 DOM：消息行 data-* 直映投影字段，不追组件/像素保真
    ▲ Tauri invoke（89 命令）/ listen（im:__bus__ 21 投影）
Tauri Rust 后端（src-tauri）             内嵌 helix-driver-native + helix-im（真接管引擎）；debug 注入 tauri-plugin-webdriver
    ▲ 组装根 debug 构建包 Recording<P> 装饰器
仪表层 crates/helix-driver-instrument    Recording<P> 装饰 Transport/EventSink/Storage/Clock/IdSource —— 日志/录制/回放三合一
    ▲ 只依赖 helix-core 的 port trait（path dep）
helix 引擎（上游 path dep）              helix-core 零改 · helix-im 零改 · helix-driver-native 零改（sans-IO 守住）
```

**唯一新缝 = port 装饰器**（最高点）；复用既有缝 = WebdriverIO ↔ tauri-plugin-webdriver 内嵌 W3C server。

---

## 2. 五条核心不变量（违反即拒）

1. **helix 引擎零改**：本仓不改 helix-core/helix-im/helix-driver-native；仪表化只在 `helix-driver-instrument` 用 Decorator 包 port，组装根 debug 构建包一层（守 helix HX-C001 sans-IO）。
2. **契约只读**（自动修复护栏）：自动修复 agent **只能改 helix 引擎实现 + 本仓渲染壳**；冻结契约（projection-schema / 真机curl真源 / golden tape / 四面期望文件）**一律只读**。红转绿只能靠改实现。契约过时 → 出「契约变更提案 + 证据」交人审，禁自改。对齐 helix HX-C009/C011/C012。
3. **四面契约断言**：每 UC 同一 corr_key 串四面 —— ① 出站命令体（vs 真机curl真源）② 投影 envelope（vs projection-schema）③ DOM data-* ④ DB 落库行。任一面偏离即 fail。
4. **录放 test-only**：`tauri-plugin-webdriver` + 金标帧录放 **只进 debug/test 构建**；release 绝不带 webdriver server、绝不带录放代码。
5. **测试可证伪**（helix HX-C011）：破坏即 fail；禁墙钟下界断言；用结构化/计数证不变量。

---

## 3. 测试分层（v1 = L1）

| 层 | 形态 | oracle | v1 |
|---|---|---|---|
| **L1 per-UC 契约** | 串行 + 静默窗口 + 领域键认领 | 四面契约断言 | ✅ 先行 |
| **L2 并发场景** | 冷启动风暴/交错收发/重连补洞 | 不变量（cursor 单调·inflight 有界·不丢帧·终态收敛·无死锁） | ⏸ 跳过，L1 稳后叠 |

**就绪/静默 probe（L1 前置）**：`increment_channel_end` 收齐 **且** HTTP inflight==0 **且** cursor 稳（cursor 稳是最后确认步）。
**认领**：窗口内帧/投影归该 UC，再用领域键（channelId + tmp_id/server_id + event_seq）绑四面。

**首条竖切**：发消息 round-trip（UI 输入→invoke send→出站 HTTP→go→WS post echo→parser→gate→tmp_id→server_id 对账→投影→DOM 行+DB 行）。见 [`docs/spec/send-message-vertical-slice.md`](docs/spec/send-message-vertical-slice.md)。竖切通过 → 按 UC 顺序铺开，覆盖全 HTTP+WS + 命令集（89 命令/19 WS/27+ UC）。

---

## 4. 双轨确定性源

- **金标帧（日常·确定性·秒级）**：真 go 跑一次 → Transport/Clock/IdSource 装饰器录 tape（含 go 帧 + 时钟/id）→ 回放经真实 Tauri+WKWebView+WebdriverIO（输入端确定性，验整个客户端栈）。
- **真 go（夜间/按需）**：连真 go 抓后端漂移。

---

## 5. 日志（agent 的眼睛）

- 结构化 **JSONL hop 事件**：装饰器每跳吐 `{run_id, uc_id, corr_key, facet, hop, payload}`（hop ∈ outbound/ws-recv/projection/storage/dom）。
- **reducer** 把同 corr_key 四面聚成一束 + 与期望 diff → 出「断在哪一跳」报告。agent 读 diff 报告，不啃原始流（原始流保留备深挖）。

---

## 6. 编译 / 测试 cadence

- Rust：改完模块 / commit 前 `cargo check -p helix-driver-instrument` 一次；禁「改一行→check」循环。
- 前端：`pnpm start`（1420）+ debug app（4445 webdriver）→ `wdio run`。
- **autonomous / agent 模式**：自跑验证回报；**单任务 prompt 模式**：输出命令让用户决定（除非用户说"你跑"）。

---

## 7. 提交规范

Conventional Commits（中文 description/body）；触发结构化 body 条件命中时按 5 段（影响范围/改动影响面/功能改进/Harness 更新/验证）。禁 `wip`/`update xxx`，禁 attribution。

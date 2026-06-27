# 自动化研发闭环流水线 + gap-to-issue 发射器设计

> **一句话**：把现有「设计→开发→三端联调→全UC(http+ws)」的**前向**流水线,通过一个 **gap-to-issue 发射器**接成**闭环**——oracle(四面 reducer + tauri-plugin-webdriver)不只输出红/绿,而是输出「结构化缺口」,缺口自动变成带 triage 标签的 GitHub issue 从流水线前端重入。
>
> 产出于 2026-06-26 `/remote-control` 纯分析会话。前置真源:根 `CLAUDE.md` §8/§9 · `docs/uc-rollout/autonomous-runbook.md` · `docs/agents/{issue-tracker,triage-labels,domain}.md` · harness C001-C013。

---

## Part 1 — 闭环分析(沉淀)

### 1.1 Matt Pocock 流程的 3 条工程哲学

| 哲学 | 做法 | 解决 |
|---|---|---|
| **① Artifact 即记忆** | 每阶段产**持久文件**(spec→PRD→issue),不靠对话上下文传 | LLM 上下文会丢,文件不会;换 session/换人/换 AI 读文件即接力 |
| **② 每 issue 一个 fresh session** | `/implement` 在干净上下文跑单 issue | 避免上下文污染(对应本仓「每 issue 新会话」) |
| **③ 先审问后动手** | `/grill` 逼问榨 spec;`/prototype`(抛弃式) vs `/handoff`(生产)分叉 | 80% 返工源于需求没榨干 |

**主线**:`grill`→`to-prd`→`to-issues`→ 每 issue `implement`(新会话)→ 拿不准 `ask-matt`。
**底物无关**:artifact 既人可读又 agent 可消费 →「AI/人都能跑同一流程」是直接推论;`triage-labels` 是分流接缝。

### 1.2 现有零件铺在流水线上

```
设计 ──────── 开发 ────────── 三端联调 ──────── 全UC http+ws
grill/to-prd  to-issues       run.sh           coverage-crossmap
docs/PRD.md   +/implement     +三段日志        (124HTTP/19WS×UC)
ui-plan.md    GitHub #7-#41   loopforge+helix  uc-coverage-ledger
  ▲                           +cses-im-server         │
  │            四面 reducer(oracle) + tauri-plugin-webdriver + 金标帧
  │            ①出站HTTP ②投影 ③DOM ④DB · C009 绿由 reducer 裁定
  └────────── ← ← 反馈弧 (gap-to-issue 发射器) ← ← ───────┘
```

成熟度:开发/三端联调/全UC账本/**oracle** 已 🟢;**设计** 🟡(纯文本,无设计工具);**反馈弧** 🔴(种子在,没接成回路)。

### 1.3 开环 vs 闭环

当前是**前向流水线**(测试红→人眼发现→人手开 issue = 开环)。
**闭环** = oracle 输出结构化缺口 → 缺口自动生成 triage issue → 从前端重入。
四颗现成种子:reducer「断在哪一跳」· C004 契约变更提案 · NEED_*.md 跨项目协调 · triage 标签路由。接起来即闭环。

### 1.4 三条反馈弧

| 弧 | 触发 | 现状 | 自动化度 |
|---|---|---|---|
| **A 测试红→修复** | reducer 报断点 | ✅ 已闭(三段日志+确认即修+复跑) | 🟢 全自动 |
| **B 契约过时→提案→人审** | 四面与冻结契约失配 + 多 UC 佐证 | 🟡 机制在(C004),生成靠手 | 🟡 半自动(设计上人闸) |
| **C 缺UI→回设计** | UC 需 ④DOM 面但缺 data-* / 语义区 | 🔴 靠人眼 | 🟡 探测全自动,设计用 pencil MCP |

### 1.5 tauri-plugin-webdriver 的角色

不是测试工具,是**驱动闭环的 oracle**:① 四面全绿 = 机器可判的 DoD(C009 防自产自判);② 金标帧确定性 = 可重复/可 CI/可 cron 触发;③ 可证伪(C008)= 裁判不可糊弄。**它把「研发完成」从主观判断变客观信号 = 把人从验证环节拿掉的基石。** 弧C 能闭也靠它——「缺UI」从「人觉得少了点」降级成「reducer 报 dom facet 缺 data-X」的文件事实。

### 1.6 AI vs 人切分(人闸闭环,非永动机)

| 环节 | AI 全自动 | 人闸 |
|---|---|---|
| 前向 spine + 弧A + 弧C探测 + 弧C设计(pencil) | ✅ | — |
| 弧B 契约变更拍板 | 生成提案 ✅ | 🔒 改冻结契约需人审(C004) |
| merge main / 发布 | — | 🔒 留 PR 给人 |

`triage-labels` = 这张表的物理实现:`ready-for-agent` 走无人区,`ready-for-human` 停人闸。

> **本仓特例(2026-06-26 用户授权)**:用户不关心 UI、全权授权 → 弧C「缺UI 设计」也归 `ready-for-agent`,由 agent 直接调 **pencil MCP** 设计+快速迭代,不停人闸。详见 [[autonomous-rollout-authority]]。

---

## Part 2 — gap-to-issue 发射器接口设计

### 2.1 定位与不变量

发射器**只分类 + 路由 + 去重**,**不判绿/红**(绿由 reducer 裁定,C009)。它消费 reducer 裁决,产出 triage issue。落点固定可 grep(`docs/uc-rollout/gap-ledger.jsonl`),对齐全局「终态行可查」铁律。

**铁律**:① 不自判绿红(消费 reducer verdict);② 同一 gap 不重复发 issue(签名去重);③ UC 转四面全绿 → 自动关其衍生 gap issue;④ 丢弃/去重的 gap 必 `log()` 出账(C011 诚实)。

### 2.2 输入(读什么)

| 源 | 文件 | 取什么 |
|---|---|---|
| reducer 裁决 | `/tmp/loopforge/run.jsonl`(四面 hop)+ reducer 报告 | per-UC 每面 verdict + 断在哪一跳 + diff |
| 覆盖账本 | `docs/uc-rollout/coverage-crossmap.md` | 哪些 HTTP/WS 没绑 UC(coverage-hole) |
| 四面台账 | `docs/uc-coverage-ledger.md` | per-UC 四面状态(交叉校验) |
| 后端健康 | `curl localhost:8066/api/cses/health` | 区分 backend-down(不发 issue,发告警) |
| 去重台账 | `docs/uc-rollout/gap-ledger.jsonl` | 已发 gap 的签名↔issue# 映射 |

### 2.3 核心数据形状

```jsonc
// GapSignal — 发射器内部统一信号
{
  "uc_id": "UC-3.2",
  "corr_key": "ch_abc#tmp_17",        // 串四面;coverage-hole 时为 null
  "facet": "dom",                      // outbound|projection|dom|storage|coverage
  "kind": "ui-design",                 // 见 2.4 GapKind
  "evidence": {
    "hop": "dom",
    "missing": "data-pin-state",       // 缺的 token / 字段 / endpoint
    "reducer_diff": "expect data-pin-state on MessageRow, DOM absent",
    "crossmap_row": "POST /api/cses/.../pin → UC-3.2",
    "corroboration": 1                 // 同 divergence 命中的 UC 数(契约判据用)
  },
  "signature": "sha1(uc_id|facet|kind|norm(missing))"  // 去重键
}
```

```jsonc
// gap-ledger.jsonl 一行 — 去重 + 回归检测 + 终态可 grep
{"sig":"a1b2…","uc":"UC-3.2","facet":"dom","kind":"ui-design",
 "issue":52,"state":"open","first_seen":"<ts>","last_seen":"<ts>"}
```

### 2.4 分类决策树(发射器的心脏)

```
对 reducer 报告里每个非绿 facet verdict:
  health != 200            → backend-down   ⟹ 发 ops 告警, 不开 issue(走 runbook §6.1)
  facet == coverage(无UC绑) → coverage-hole
  facet == dom:
     投影有该字段 but DOM 缺元素:
        语义区已存在(data-region 在) → ui-bind     // 只差绑定(C013:壳加 1:1 绑定)
        语义区不存在                  → ui-design   // 需新结构 ⟹ pencil MCP
     投影里根本没该字段              → logic-red(facet=projection)  // C013:缺投影,不是缺UI
  facet ∈ {outbound, projection, storage}:
     与冻结契约 diff:
        corroboration ≥ N(默认2) 且 cses-im-server 健康一致回此值 → contract-stale
        否则                                                     → logic-red  // 默认改实现(C004)
```

> **契约判据(C004/[[c004-contract-vs-env-decision]])**:单次失配 = `logic-red`(默认改实现/改环境);只有**≥2 个 UC 命中同一 divergence 且后端默认对**才升 `contract-stale`。优先级:改环境 > 改机器件 > 改冻结契约。

### 2.5 路由表(kind → 标签 → 弧 → runner)

| GapKind | triage 标签 | gap 标签(新建) | 弧 | runner |
|---|---|---|---|---|
| `logic-red` | `ready-for-agent` | `gap:logic` | A | 自动(修 helix/loopforge) |
| `contract-stale` | `ready-for-human` | `gap:contract` | B | 人闸(契约变更提案) |
| `ui-bind` | `ready-for-agent` | `gap:ui-bind` | C | 自动(壳加绑定) |
| `ui-design` | `ready-for-agent` | `gap:ui-design` `needs-pencil` | C | 自动(**pencil MCP** 设计+迭代) |
| `coverage-hole` | `ready-for-agent` | `gap:coverage` | 前端 | 自动(author spec+expect) |
| `backend-down` | — | — | ops | 仅告警 |

需 `gh label create`:`gap:logic gap:contract gap:ui-bind gap:ui-design gap:coverage needs-pencil`。

### 2.6 发射流程(5 阶段)

```
collect  → 解析 run.jsonl + reducer 报告 + crossmap + health
classify → 每非绿 facet 走 2.4 决策树 → GapSignal[]
dedup    → 算 sig;查 gap-ledger.jsonl:
             sig 存在 & issue open  → bump last_seen, skip(log "deduped")
             sig 存在 & issue closed & 又复现 → gh issue reopen + comment "regression", state=open
             sig 新                 → 进 emit
emit     → gh issue create:
             title: "[gap] UC-3.2 facet:dom missing data-pin-state"
             label: <triage> + <gap:*> (+ needs-pencil)
             body : 结构化(证据/分类/建议弧/blocked-by/<!-- gap-key:sig -->)
           → 追加 gap-ledger.jsonl 一行
reconcile→ 该 UC 四面全绿(reducer 裁定) → 关其所有 open gap issue + ledger state=closed
           + log 出账:emitted=N created=X deduped=Y reopened=Z closed=W dropped=0
```

### 2.7 issue body 模板

```markdown
<!-- gap-key: a1b2c3 -->
**UC**: UC-3.2 | **facet**: dom | **kind**: ui-design | **arc**: C

## 证据
- corr_key: `ch_abc#tmp_17`
- reducer 断点: dom hop — expect `data-pin-state` on MessageRow, DOM absent
- crossmap: `POST /api/cses/channels/:id/pin → UC-3.2`
- corroboration: 1 UC

## 建议
- 语义区不存在 → 需新 UI 结构 → 调 pencil MCP 设计 `data-pin-state` 展示位
- 受 C013 约束:壳只做 1:1 绑定;若投影无 pin 状态字段 → 先去 helix-im 补投影(转 gap:logic)

## Blocked by
- (无 / #N)
```

### 2.8 调用与触发

- **批后触发**:`scripts/run.sh` 跑完 spec 批 → 调 `scripts/gap-emit.sh`(读最新 run.jsonl)。
- **独立**:`bash scripts/gap-emit.sh [--dry-run]`(dry-run 只打印不开 issue,审分类用)。
- **闭环驱动**:autonomous-runbook 每 UC 红 → reducer 报 → 发射器开 gap issue → 下一轮(或同轮)按弧处置 → 转绿 → reconcile 关 issue。loop-until-dry:连续 K 轮无新 gap = 收敛。
- **进 gate.sh**(可选):gap-ledger 与 open issue 一致性自检(无悬挂 sig)。

### 2.9 与现有不变量的对齐

| 不变量 | 发射器如何遵守 |
|---|---|
| C009 绿由 reducer 裁定 | 发射器不自判绿红,只消费 verdict |
| C004 契约只读 | `contract-stale` 走 `ready-for-human` 提案,不自改冻结 oracle(本仓特例:仍人闸) |
| C011 诚实出账 | dedup/drop 数全 `log()`;ledger sig 数 = issue 数 |
| C013 纯渲染壳 | dom gap 先分 ui-bind(绑定) vs logic-red(缺投影→去 helix);不在壳写业务 |
| 全局终态行 | reconcile 关 issue 时写 `✅ DONE` 行到 ledger/log |

---

## Part 3 — 业界实践对照 · 边界条件 · 验收标准(2026-06-26 联网研究硬化)

> 4 路并行研究:spec-driven agentic dev(AI Hero / GitHub Spec-Kit / AWS Kiro / Anthropic context engineering)· closed-loop 自愈(MAPE-K / 控制论 / 熔断)· test oracle & 机器可判 DoD · 自动 issue 去重 + HITL 护栏。

### 3.0 总判

架构与 2025-26 主流高度一致(背书);但 v1 把闭环写成"发 gap→修→重跑",**最大缺口 = loop controller**(收敛/震荡/再生/预算失速)。**reframe:要的是带整定 + 熔断的 MAPE-K 控制器,发射器只是 Monitor+Analyze。**

### 3.1 设计 vs 业界(已对 ✅ / 缺 🔴🟡)

| 维度 | 我的件 | 判 |
|---|---|---|
| 前向 spine / 独立 oracle(C009)/ 契约只读(C004)/ 多面断言 / 回归 reopen / HITL 边界 | 全有 | ✅ 对齐 |
| 确定性回放"耗尽响亮失败" | 金标帧 C010 缺显式断言 | 🟡 |
| 去重 sig"剥离易变量" | sig 未规定 | 🟡 |
| **闭环控制(整定/迟滞/再生隔离/双预算/软失败/控制面禁触)** | 只有 loop-until-dry | 🔴 |
| 验收标准质量(EARS / 分歧测试 / `[NEEDS CLARIFICATION]`=0) | gap issue 无 checkable DoD | 🔴 |

### 3.2 边界条件(硬化)

**🔴 闭环控制器(v1 全缺)**
1. **整定/不动点**:终止 = error<ε **且** 状态不变(非"还有 action")。每轮需可测进度(gap↓/绿面↑),否则判 livelock 停。
2. **软失败检测**:跑但零进度(烧钱空转)= 危险态 → 进度看门狗。
3. **再生隔离**:同 gap 第 N 次复燃 → quarantine 转 `ready-for-human`。
4. **震荡/迟滞**:同 UC 重整改间加 cooldown + dead-band。
5. **双预算熔断**:绝对上限 + **速率**上限(tok/min · $/hr),速率抓失控螺旋。
6. **重复/连败上限**:≤3 同质 call 无进度 / 同步连败 3 → 跳闸终止。
7. **控制面禁触**:只改 data-plane(spec/issue/壳/expect);**绝不**自动改 control-plane(gate.sh / 冻结契约 / CLAUDE.md 不变量 / 标签策略)。
8. **熔断在 agent 外**:controller 是脚本不是 agent 自律。
9. **降级安全模式**:闸破 → 只读 + 禁外写 + 需人重授权。

**🟡 验收质量**:每 gap issue 带机器可判 DoD(四面 expect);过分歧测试(两 agent 会否分歧→收紧);ui-design 调 pencil 前 `[NEEDS CLARIFICATION]` 记 ADR 不静默猜。

**🟡 确定性/门**:回放耗尽响亮失败;diff/fingerprint 前 mask tmp_id/时间戳;flaky → 重试一次再查,gap **复现≥N(`for:` debounce)才 emit**。

**🟡 去重**:sig 剥离 ID/时间戳;ledger sig 唯一约束兜并发;UC≈31 增长可忽略仍标有界。

### 3.3 验收标准(每 stage gate · block 非 warn)

| Gate | 阻断条件 |
|---|---|
| spec→dev | `[NEEDS CLARIFICATION]`=0 · 每 UC 有 EARS/四面 expect · 过分歧测试 |
| dev→test(RED 门)| 测试已写 + 确认先 FAIL 才写实现 · 真后端非 mock |
| test→绿(oracle 门)| 四面 reducer 全绿(C009)· 回放无耗尽 · 无墙钟下界 |
| gap→issue(emit 门)| 复现≥N · sig 去易变量 · ledger 唯一约束 |
| loop→收口(整定门)| error<ε 且 状态不变 · 每轮有进度 · 未触再生隔离/熔断 |
| issue→close | 四面绿才关 · 复发 reopen 同记录 |
| merge/契约(人闸)| 不可逆/控制面/契约改 → 必 HITL |

> 「warn nobody reads ≠ gate」:上表是 block;低危才 warn-with-comment。

### 3.4 已有护栏 = 业界 constitution

Spec-Kit `constitution.md`(不可变原则 + 预实现门)= 本仓 **CLAUDE.md §2 六不变量 + harness C001-C013**。不缺宪法,缺的是 **loop controller 每轮机器校验它(尤其控制面禁触)**。

### 3.5 升格为新不变量候选(达三铁律则建 harness card)

- **C014 候选**:闭环 controller 整定条件 + 再生隔离 + 双预算熔断 + 控制面禁触(借鉴 MAPE-K/控制论)。
- **C015 候选**:emit 门 flaky debounce(复现≥N 才发)+ sig 去易变量(借鉴 Sentry/Alertmanager)。

### 3.6 主要来源

AI Hero skills · GitHub spec-kit `spec-driven.md` · AWS Kiro · Anthropic effective-context-engineering / measuring-agent-autonomy · arXiv 2605.07062(From Assistance to Agency)· IEEE TSE Oracle Problem Survey · Google Testing Blog(flaky / no-more-e2e)· Sentry grouping/fingerprint · Prometheus Alertmanager grouping。

---

## Part 4 — loop Engineer:从「控制单次回路」到「工程化整个回路系统」

> 概念升级(2026-06-26 用户):要的不是单轴 **Controller**,是 **loop Engineer**。Controller 调节单次 run(回设定点);Engineer 跨 run 让回路本身越跑越好(双环学习 + 自优化 + 知识沉淀 + 上游工程 + 编排)。**Controller 是 Engineer 的 ① 子层**;Part 3 的"controller"按此重新理解。

### 4.0 本质差

| | Controller | loop Engineer |
|---|---|---|
| 时域 | 单 run | 跨 run/sprint |
| 目标 | 收敛到设定点 | 回路自身越跑越好 |
| 学习 | 无(固定增益) | 双环(Argyris):改"产生错的规则" |
| 触不变量 | 不碰 | **提案**改宪法(人批)+ 沉淀知识 |

支撑:MAPE-K self-* 不止 self-healing,含 self-optimizing/self-configuring;自适应控制(增益自调须有硬包络);autonomy escalation(权限蠕变)是头号失稳源 → 把"人工干预频率"当指标。

### 4.1 关键发现:本仓全局 CLAUDE.md 即 loop Engineer 章程

30-min 复盘 = Retrospector;往前收敛 = 双环学习;harness 三铁律 = Learner;"重复 pattern 单调下降" = Engineer 成功单一指标;worktree 决策树 = Scheduler。**这些此前由 main 对话手工做;loop Engineer = 让它们成为回路一等公民、自动执行。**

### 4.2 六层模型

```
loop Engineer (meta · 跨 run)
├─ ① Controller   单 run:整定/迟滞/熔断/再生隔离     ← Part 3
├─ ② Retrospector 量回路健康 → 喂 Optimizer           ← 30-min 复盘
├─ ③ Optimizer    据观测率自调增益(有包络)           ← 自适应控制
├─ ④ Learner      双环:修复配方→harness/skill 沉淀    ← harness 三铁律 + Trace2Skill
├─ ⑤ Architect    工程上游:一类缺UI→新语义区/新投影   ← 缺UI→回设计弧升格
└─ ⑥ Scheduler    编排 work-list:依赖序/并行/预算      ← worktree 决策树
```

### 4.3 每层:边界 + 验收指标 + 复用资产

| 层 | 触发 | 边界(新) | 健康指标(验收) | 复用 |
|---|---|---|---|---|
| ① Controller | 每轮 | Part 3.2 九条 | error<ε 且 状态不变 | gate.sh/reducer |
| ② Retrospector | 每N轮/30min | 只读;不自评成功 | 再生率↓·收敛时长↓·人工干预频率平稳(蠕变告警) | 复盘规则 + java/logs |
| ③ Optimizer | retro 后 | 增益自调有硬包络(N∈[2,5]/ε/cooldown/预算速率);改包络=HITL | 假阳 emit↓ 且 不引震荡 | 自适应控制 |
| ④ Learner | 同根因≥3/用户拍板 | 触不变量=提案(C014/15)交人批;不自动改宪法;卡须有可执行 §4 Verification | harness 卡↑·**重复 pattern 单调↓** | harness 铁律·Trace2Skill·evolve-loop |
| ⑤ Architect | 一类 gap 反复 | 守 C013(壳只绑定);改契约/投影=helix 提案 | 同类 gap 复发→0 | pencil MCP·helix-im·ui-plan |
| ⑥ Scheduler | 每批前 | 依赖序;并行用 worktree 决策树;预算池共享 | 阻塞等待↓·吞吐↑ | warm-stack·worktree·budget |

### 4.4 元稳定性护栏(Engineer 比 Controller 更危险)

1. **不改宪法只提案**:数据面(spec/issue/壳/expect/增益参数)自动;控制面(gate.sh/冻结契约/六不变量/标签策略/**增益包络本身**)→ HITL。data/control 分割升到元层。
2. **增益自调有界**:Optimizer 只在硬包络内调;无界自调=元层震荡。
3. **autonomy escalation 闸**:人工干预频率蠕变即告警(头号失稳)。
4. **Learner 双环不得自证**:沉淀卡须有可执行 Verification(§9 已有铁律)。
5. **降级**:元层闸破 → 退回纯 Controller(只保收敛,停学习/优化/架构),需人重授权恢复 meta 权。

### 4.5 落地顺序

```
P0 ① Controller                先保命:单 run 不失控
P1 ② + ③ Retro+Optimizer       最便宜高值:量健康+调参→自稳
P2 ④ Learner                   接 Trace2Skill/evolve-loop:知识累积
P3 ⑤ + ⑥ Architect+Scheduler   结构根治 + 编排智能
```

**Engineer 成功单一指标 = CLAUDE.md 既定目标:重复 pattern 数随时间单调下降。升不降 → Engineer 失效,报警问用户调工作流。**

---

## 实现状态

- [ ] **loop Engineer P0 = Controller**(MAPE-K + 整定 + 熔断 + 再生隔离 · Part 3.2 / 4.5)— 未实现 ⚠️ 最优先
- [ ] P1 Retrospector + Optimizer(健康指标 + 增益自调有界 · Part 4.3)— 未实现
- [ ] P2 Learner(Trace2Skill/evolve-loop 沉淀)/ P3 Architect + Scheduler — 未实现
- [ ] `scripts/gap-emit.sh` — 未实现(本文档为接口设计)
- [ ] `docs/uc-rollout/gap-ledger.jsonl` — 未创建
- [ ] `gh label create gap:* needs-pencil` — 未建
- [ ] `scripts/gate.sh` 加 gap-ledger 一致性自检 — 未接

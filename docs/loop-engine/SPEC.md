# loop-Engineer — 全链路自治研发引擎 SPEC

> **一句话**:吃任意一句需求 → grill→PRD→issues→implement→三端联调→test→close,缺 UI 自己设计回流,全链路自治闭环。**不是单轴 Controller,是会自我改进的 loop Engineer**(六层)。
> 产出:2026-06-26-27 `/remote-control` grilling 会话(10 问全锁)。配套设计:`docs/agents/pipeline-closed-loop.md`(Part 1-4 分析 + emitter 接口)。
> 真源依赖:根 `CLAUDE.md` §1-9 六不变量 + harness C001-C014 · `docs/uc-rollout/autonomous-runbook.md` · `docs/agents/{issue-tracker,triage-labels,domain}.md`。

---

## 0. 定位与范围(Q1)

**通用 R&D 引擎**:吃任意需求跑全链路到收敛。UC rollout(issues #7-#41)= **第一个 workload**(有界、可验收的试金石),但**六层接口 workload-agnostic**——先用真 workload 逼出真实行为,再抽象 workload 插槽(避免过早抽象 · Spec-Kit Simplicity 门)。

## 1. 架构:控制面/数据面分离(Q2)

**底座 = Workflow 工具**(phase 级;单任务不开 workflow,走直接 agent)。选它因 `claude -p` headless 每账号限额,Workflow agent 跑在**会话共享 token 预算池**,配额高效。

**硬约束**:Workflow 脚本**无文件系统访问**。故:
- **控制面(确定性·在 JS)**:预算门 / 熔断 / 整定 / 再生隔离 / cooldown / 拓扑调度 / 增益包络。agent 改不了 = 「控制在 agent 外」(研究铁律,防权限蠕变)。
- **数据面 + 所有 IO(在 agent)**:读三端日志 / 读写 events.jsonl / 跑 run.sh / 改代码 / 调 pencil。agent 有 fs。

## 2. 回路形状:loop-until-budget + 磁盘 checkpoint + resume(Q3)

```
loop-engine workflow（一次 run = 一段推进）:
  bootstrap agent → 折叠 events.jsonl → 快照(open issues+blockers+phase / gap-ledger / metrics / log cursor)
  for phase of 待办 phases:                         # phase 间 barrier 串行(§8 + C006)
    frontier = readySet(phase)                       # Scheduler: blockers 全绿才入(拓扑前沿)
    while frontier && budget.remaining()>15% && noProgress<2:   # Controller 守卫
       pipeline(frontier 独立项,
          s1 author/implement(自治grill·自适应验证)
          s2 run.sh + reducer 裁决
          s3 classify + 三端日志诊断 → 绿|gap|park)
       每 issue → checkpoint agent 追加 events.jsonl
       每 N issue → Retrospector agent 读指标 → Optimizer(JS·硬包络内调阈值)
       frontier = readySet(phase)                    # 新绿解锁 → 重算前沿
    phase 全绿 → tag agent(barrier);否则 park 余下 break
  wind-down agent → 写 STATUS.md + 终态行 + resume manifest
```

**跨天自治**:预算耗尽 → wind-down 落盘 → 下一 turn `resumeFromRunId`(journal 缓存)+ bootstrap 重读 events.jsonl → 断点续。**磁盘 events.jsonl 才是真状态,Workflow run 只是一段推进。**

## 3. 自治边界:两入口 + 可逆性人线(Q4 · Q5)

**两入口**:
- **入口①(人门·净新需求)**:人 + 自治 grill → PRD → issues。grill **接地优先**(能从三仓代码/契约/git 查到的就查,不问人——grilling skill 自带原则);接不到证据的残渣才 park 给人。出口门:`[NEEDS CLARIFICATION]`=0。
- **入口②(自治环·通宵)**:ready-for-agent issues → implement → test → 绿|gap → gap 自动开新 issue 回流 → 再入。全无人。缺 UI gap 因全权+pencil → 引擎自己设计回流。

**人线 = 可逆性(不是"难不难")**:
- **可逆**(改代码/UI,回得来)→ **引擎自决 + 记账**(events.jsonl `assumption` 事件,可被后续 challenge)。
- **不可逆**(删数据 / 发对外契约即合 helix main / 对外发送)→ **park 给人**。
- 夜间遇需人决策 → **不阻塞**:写 `NEEDS_HUMAN_<topic>.md` + 标 `ready-for-human` + 跳下一个 ready-set,白天人批回流。
- **自问自答 grill 允许**(= C 路径的机制):动态循环换角度自审(不同 prompt 走设计树),每个自答**必须接地(provenance)+ 对抗验证**(§7);靠工程消灭幻觉,**不靠禁止自审**。接不到证据的残渣才 park。

## 4. 诊断与修复路由(Q6 · 你的核心需求)

reducer「断在哪一跳」+ 三端日志 grep(`/tmp/loopforge/run-app.log`·`cses-im-server.log`·`run.jsonl`)→ 定位哪一仓 → 逐项逐仓修:

| reducer/信号 | 日志特征 | 判定 | 动作 | 可逆 |
|---|---|---|---|---|
| ①出站 红 | 出站 body 缺字段 | wire 构造缺陷(C013→helix-im) | helix 分支修 + re-pin | ✅ 自决 |
| ②投影/③DOM/④落库 红 | helix tracing 投影缺 | helix 投影/业务缺陷 | helix 分支修 + re-pin | ✅ 自决 |
| ③DOM 红·投影有该字段 | DOM 缺 data-* | 壳绑定缺(C013 壳职责) | loopforge 修绑定 / 缺语义区→pencil(§6) | ✅ 自决 |
| health 000 / 出站全 000 | cses-im-server.log 无 listening | 后端未起/挂 | 重启 cses-im-server(不改其逻辑) | ✅ 自决(仅重启) |
| 四面 diff·后端默认对·≥2 UC 佐证 | 契约≠真源 | 契约可能过时 | 契约变更提案 park | ⚠️ park |
| 单次红·重跑绿 | 时序抖动 | flaky | 重试 1 次再判,不开 gap | — |

**helix 边界**:分支修 + loopforge re-pin = 可逆 → **自决**(runbook §6);**合 helix main = 发布给 cses-client(其他消费者)= 不可逆 → park**。cses-im-server 永远只重启不改逻辑(别人的 Go 后端,默认对)。

## 5. 状态模型(Q7)

**机器真相 = `docs/loop-engine/events.jsonl`**(append-only 事件日志,不就地改):

```jsonl
{"ts","type":"issue_ready","issue":10,"phase":2,"blockers":[8]}
{"ts","type":"issue_green","issue":10,"corr_key":"...","facets":"4/4"}
{"ts","type":"gap_emit","sig":"a1b2","issue":52,"kind":"ui-design"}
{"ts","type":"assumption","issue":10,"decision":"字段叫 pin_state","provenance":"projection-schema.md:L42","reversible":true}
{"ts","type":"parked","issue":23,"reason":"contract-stale","need":"NEEDS_HUMAN_xxx.md"}
{"ts","type":"quarantine","sig":"a1b2","regen":3}
{"ts","type":"fix","repo":"helix","branch":"fix/...","issue":10,"facet":"outbound"}
{"ts","type":"metrics","pass":7,"regen_rate":0.1,"convergence_min":12,"pattern_count":4}
{"ts","type":"phase_tag","phase":2,"tag":"v0.x-phase2-..."}
```

**为何 append-only**:幂等(重放不重副作用)· 全程审计可回溯(HITL 护栏)· 任何快照折叠日志算出(永不失配)· 同构「事件流单调 cursor」+ 确定性回放 · Workflow 无 fs → bootstrap agent 折叠喂 `args`。

**人读快照 = `docs/loop-engine/STATUS.md`**(每 pass 重生成):resume manifest + 终态行 + 重复 pattern 趋势 + 缺 UI 截图,给早上一眼审。

## 6. UI 缺失流程(Q8)

缺 UI → **pencil MCP 设计**(只设计缺失区域·加法式不动已绿 UC·angular-ui-plan) → **转项目用 Angular 组件**(export_html/nodes → .ts/.html) → 接 MessageRow data-* 全集 → reducer ④DOM 验。

- **门 = ④DOM 绿 + 可演示/可手测**(本仓现在也是 demo MVP + 手测面,非纯语义壳·见 CLAUDE.md §1 已改)。
- **视觉无硬门**(完全可逆):pencil 尽力 + 截图落 STATUS.md → 早上人审,丑了再调。
- 守 C013:好看 = 纯展示格式化,不掺业务。**生成物只服务本仓,不为 cses-client**(pencil 风格≠cses-client 审美)。

## 7. 反幻觉验证:自适应(Q9)

引擎自产物(spec/决策/修复)验证深度**随爆炸半径/可逆性缩放**:

- **默认(中)**:provenance 闸(每条断言带出处 `file:line`/契约/commit,**无出处禁进**)+ N-skeptic 对抗 panel(多数反驳=打回)+ 分歧测试(两 verifier 分歧→收紧)。
- **高爆炸半径自动升重**(改 helix / 契约提案):多路独立生成 → 裁判 panel 选最优 → 合成。
- **C009 升到 spec 层**:生成 agent ≠ 验证 agent,禁自评。

## 8. 安全阀 + meta-DoD(Q10)

| 阀 | 值 | 作用 |
|---|---|---|
| 预算储备 | `remaining()<15%` 停 | 留余量落盘+写 STATUS,不丢状态 |
| 单 issue 连败上限 | 3 → park 跳下个 | 防卡死一个 issue 整夜 |
| 再生隔离 | 同 sig 第 3 次复燃 → quarantine→ready-for-human | 防"修了又裂"无限再生 |
| 整定/收敛 | 连 2 pass 无新绿且无新 gap → 停 | 不动点,别空转 |
| 防震荡 | 同 UC 一 pass 内最多碰 1 次 | 防 X↔Y 来回改 |
| flaky | 红→重试 1 次仍红才当 gap | 抖动不污染 |
| 控制面禁触 | 引擎绝不自动改 gate.sh/冻结契约/六不变量/标签策略/增益包络 | data/control 分割 |

**meta-DoD 三层**:① 单 run:STATUS 终态行(`✅ N 绿/M park/K quarantine + pattern 趋势`)。② workload:全 ready-for-agent issue 四面绿关闭+覆盖全 UC/HTTP/WS(排除项除外·runbook §7)。③ **引擎自身(终极)**:**重复 pattern 数随时间单调下降**;升不降 → 引擎失效报警问人调工作流。

## 9. 六层 ↔ Workflow 原语映射

| 层 | 在哪 | 触发 | 复用资产 |
|---|---|---|---|
| ① Controller | JS while 守卫 | 每轮 | 安全阀(§8)/gate.sh/reducer |
| ② Retrospector | agent 读 events 指标 | 每 N issue | 30-min 复盘规则 |
| ③ Optimizer | JS 硬包络内调阈值(N∈[2,5]/K) | retro 后 | 自适应控制 |
| ④ Learner | 同根因≥3 → 沉淀 harness card | 命中三铁律 | harness 铁律 · Trace2Skill · evolve-loop |
| ⑤ Architect | classify 出"一类 gap 反复" → pencil/helix 提案 | gap 类复发 | pencil MCP · helix-im · ui-plan |
| ⑥ Scheduler | JS 每 pass 算拓扑前沿 | 每 pass 顶 | warm-stack · worktree 决策树 · budget |

**元护栏**:Engineer 不改宪法只提案(增益包络改=HITL)· 增益自调有界(防元层震荡)· autonomy escalation 闸(人工干预频率蠕变即告警)· 闸破降级回纯 Controller。

## 10. 数据 schema(agent I/O · 实现锚点)

- `STATE_SCHEMA`(bootstrap 返回):`{phasesRemaining[], issues:[{n,phase,blockers[],state}], gapLedger:[{sig,issue,state,regen}], metrics:{...}, gainEnvelope:{N,K,...}, logCursor}`
- `CLASSIFY_SCHEMA`(s3 返回):`{issue, verdict:"green"|"gap"|"park"|"flaky", facet?, gapKind?, faultRepo?, reversible?, provenance[]}`
- `RETRO_SCHEMA`:`{pass, regen_rate, convergence_min, override_freq, pattern_count, recommendation:{N?,K?}}`
- gap 分类/路由表 = `pipeline-closed-loop.md` Part 2.4/2.5。

## 11. 落地里程碑

```
P0 ① Controller + emitter   保命:单 run 不失控(安全阀§8 + gap emit + events.jsonl + STATUS.md)
P1 ②③ Retro+Optimizer       自稳:指标 + 增益自调(有界)
P2 ④ Learner                累积:接 Trace2Skill/evolve-loop 沉淀修复配方
P3 ⑤⑥ Architect+Scheduler   根治 + 编排智能(pencil 设计回流 + 拓扑调度成熟)
```

## 12. 与现有不变量对齐 / 开放项

- 对齐:C004(契约只读·park)· C008(可证伪·无墙钟)· C009(独立 reducer 裁定·禁自评,升到 spec 层)· C010(金标帧)· C011(诚实出账·STATUS)· C013(纯壳·UI 好看=纯展示)· C014(每-UC 状态隔离)。
- 新不变量候选:**C015 闭环 controller 整定+熔断+再生隔离+控制面禁触**;**C016 emit flaky debounce + sig 去易变量**(达三铁律则建卡)。
- 开放项:Workflow 无"成本速率"门(只有 total budget)→ 速率失速靠 per-pass budget delta 近似,待实测;pencil→Angular 转换保真度待 P3 实测;入口① grill 的"接地 vs park 残渣"比例待真 workload 标定。

# loop-Engine 当前执行全流程(基于落地代码·2026-06-28)

> 真源 = `scripts/loop-engine/*.mjs`(feat/loop-engine·288 node:test 绿)。本文档描述**当前真实代码**的执行流,非 SPEC 愿景。配图:`flow.mmd`(mermaid)。
> 图例:**✅ 控制面**=确定性 JS·真实现可跑(agent 改不了)。**▼ 数据面**=adapters 注入点·当前 stub·真 run 由 Workflow agent 注入。

---

## 0. 控制面 / 数据面切分(SPEC §1 硬约束·代码已落实)

| 面 | 在哪 | 当前状态 |
|---|---|---|
| ✅ 控制面 | `runEngine`/`processIssue` 编排 + scheduler/controller/diagnosis-router/verifier/gap-emitter/state-ledger/retrospector/optimizer | **真实现·288 测试绿** |
| ▼ 数据面 | `makeStubAdapters()` 的 9 个注入点 | **stub(全绿基线)·待接真 agent** |

9 个数据面注入点(`run.mjs:128 makeStubAdapters`):
`authorImplement`(grill+改码)· `runReduce`(run.sh+reducer 断在哪一跳)· `applyFix`(helix 分支修/loopforge 绑定/重启后端/pencil)· `checkpoint`(写 events.jsonl)· `tag`(phase barrier)· `retro`(读指标→增益推荐)· `proposeHarnessCard`(Learner 沉淀)· `proposeDesign`(Architect 提案)· `writeStatus`(wind-down 写 STATUS.md)。

---

## 1. 主编排生命周期 `runEngine(opts)`(`run.mjs:323`)

```
① bootstrap (LE-1 state-ledger)
   - events = opts.events ?? []
   - 若空 + 有 opts.issues → 逐个 seed `issue_ready`(+green 的 seed `issue_green`)
   - state = foldState(events)        # 事件流折叠成快照(SPEC §5·事件是真相)

② 图完整性校验 (LE-2 validateGraph)
   - 重复 n / 缺 n / 自阻塞 / 缺 blocker 引用 / 环 → 任一即 ⛔ 拒绝推进 → wind-down 返回

③ phase 串行循环 (LE-2 phasesInOrder·SPEC §2 barrier)
   for phase in [0..7]:
     while(true):                     # 一个 phase 内多 pass
       ④ loopGuard 守卫 (LE-3 controller)
          - 预算储备 <15% → 跳闸 break outer (stoppedBy=budget)
          - settled:连 2 pass 无新绿无新 gap → 收敛 break outer
       ⑤ frontier = readySet(phase, issues)   # 拓扑前沿:blockers 全绿才入
          - frontier 空 → break(去 barrier 判定)
       ⑥ for n in frontier:
          - antiThrash:同 UC 一 pass 内碰过 → skip(防震荡)
          - processIssue(n)  →→→ 见 §2
          - 统计 newGreen/newGap
          - 若 gap:rootCauseCounts[sig]++ · gapKindSigs[gapKind].add(sig)
                   → fireLearnerArchitect()  →→→ 见 §3
          - state = foldState(events)         # 每步重折叠(永不失配)
          - 每 retroEveryN(=增益N) 个 issue → runRetro() →→→ 见 §4
       passes.push({newGreen,newGap})
     ⑦ phaseBarrier(phase) (LE-2)
        - 全绿 → append `phase_tag` + ▼tag() → 记 tagged → 进下一 phase
        - 未全绿 → park 余下 + break outer(不跳级·SPEC §2)

⑧ wind-down (LE-1)
   - state = foldState(events)
   - status = renderStatus(state)            # STATUS.md 人读快照
   - resumeManifest = buildResumeManifest()   # 跨天续跑锚点(logCursor/phasesRemaining/openGaps)
   - finalLine = finalStatusLine(state)       # ✅ N绿/M park/K quarantine·pattern 趋势
   - ▼writeStatus(status, resumeManifest)
   - return {events, state, status, resumeManifest, finalLine, 统计...}
```

---

## 2. 单 issue 流水线 `processIssue(issue, ctx)`(`run.mjs:194`)

```
s1 ▼authorImplement(issue) → {blastRadius, claim, votes}      # 数据面:grill+改码
   │
   ├─ Verifier verifyDepth(blastRadius) (LE-6)                 # 爆炸半径→light|medium|tournament
   │
   └─ 若带 claim+votes → verifyClaim (LE-6·SPEC §7·C009 禁自评)
        - provenance 闸(无出处 block)+ skeptic panel(多数反驳 block)+ 作者自评票剔除
        - !admitted → bumpFailure → return {rejected}

s2 ▼runReduce(issue) → {rawVerdict, brokenFacet, logFeatures, corr_key}   # 数据面:run.sh+reducer
   └─ rawVerdict==red → flakyGate (LE-3)
        - action==retry → ▼runReduce(attempt 1)
        - 重跑绿 → rerunGreen=true(= flaky)

s3 route(reducerVerdict, logFeatures) (LE-4 diagnosis-router)  # 控制面诊断路由
   └─ decision = {verdict, action, faultRepo, reversible, gapKind}

应用裁决:
   ├─ GREEN  → append issue_green · resetFailure · ▼checkpoint        → return green
   ├─ FLAKY  → ▼checkpoint(不开 gap·C008 抖动不污染)                  → return flaky
   ├─ PARK   → append parked + NEEDS_HUMAN_<kind>_#n.md · ▼checkpoint → return park
   └─ FIX(可逆自决):
        - buildGapSignal → emitGap (LE-5)                              # classify+sig去易变量+dedup+gh issue
            · 同 sig open → 跳过 / closed 复现 → reopen
        - append gap_emit
        - regenQuarantine(bumpRegen sig) (LE-3) → 第3次复燃 → append quarantine
        - ▼applyFix(decision, issue)                                   # 数据面:helix分支/壳绑定/重启/pencil
            · faultRepo 非 restart → append fix
        - failureCap(bumpFailure n) (LE-3) → 第3次 → append parked(failure-cap)
        - ▼checkpoint                                                  → return gap|park
```

**六安全阀位置(LE-3)**:`loopGuard`(预算/收敛·④)· `antiThrash`(防震荡·⑥)· `flakyGate`(抖动·s2)· `regenQuarantine`(再生隔离·FIX)· `failureCap`(连败·FIX)· `settled`(收敛·loopGuard 内)。

---

## 3. 元层:Learner / Architect `fireLearnerArchitect()`(`run.mjs:513`)

```
每出一个 gap → 计数累积:
  learnerDecide(rootCauseCounts, ≥3)        # 同一 sig 反复 ≥3 → 结构性根因
    → 未 fired → ▼proposeHarnessCard(hit)    # LE-11:沉淀 harness card
  architectDecide(gapKindSigs, ≥2)           # 同一 gapKind 跨 ≥2 不同 sig → 类缺口
    → 未 fired → ▼proposeDesign(hit)         # LE-12:pencil/helix 设计提案
```

判定逻辑真实现(测过);产卡/提案执行是注入点。

---

## 4. 自优化:Retro + Optimizer `runRetro()`(`run.mjs:534`)

```
每 N issue:
  computeMetrics → {pass, regen_rate, convergence_min, pattern_count}   # LE-9 Retrospector
  ▼retro(metrics) → recommendation(增益推荐·缺省 null)                  # 数据面
  clampEnvelope(envelope, rec) (LE-10 Optimizer)                        # 硬包络夹取 N∈[2,5]·防元层震荡
  append metrics 事件
  → 下一批用新 gainEnvelope(= retroEveryN)
```

---

## 5. dry-run 路径 `planDryRun(issues)`(`run.mjs:580`·不真改码)

```
validateGraph → phasesInOrder
模拟逐波转绿:for phase → while readySet 非空 → 记 wave → 全转绿 → 重算 → barrier 过则停
routingSamples = route(SAMPLE_VERDICTS 8 样例)   # 覆盖六路诊断分支
renderPlan → 人读计划文本
```

CLI:`node run.mjs --dry-run [--fixture <p>] [--from-gh]`。`--from-gh` 拉真 `gh issue list` #7-#41 + parse `Blocked by`。

---

## 6. 当前能跑 / 待接(诚实)

- ✅ **能跑**:dry-run(真重建 #7-#41 DAG + 路由样例)· 全控制面逻辑 · 288 测试 · gate.sh 第9段一致性。
- ▼ **待接**:9 个数据面 adapters 接真 agent → 才能真 autonomous run(L3 首证 = 接 `runReduce`+`applyFix` 把一个真 red UC 自驱到四面绿)。
- 真 run 入口:`runEngine({adapters: <真 adapters>, issues, budget, ...})`,由 Workflow harness 注入(CLI 不自跑数据面·守 SPEC §1)。

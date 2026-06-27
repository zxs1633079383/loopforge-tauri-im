# loop-Engine — 实现落地状态（IMPL-STATUS）

> 真实落地快照（人读）。机器真相在 `events.jsonl`（含 `impl_done` 终态行）。
> 生成时间：2026-06-28T07:33+0800 · 分支 `feat/loop-engine` · baseline `01c69e1`。
> SPEC 真源：`docs/loop-engine/SPEC.md`。Epic 拆分见 issue #58。

## 0. 总览

- **12/12 LE-* issue 全部真代码落地**（非骨架）：六深模块（LE-1..6）+ 基建（LE-7）+ 编排器（LE-8）+ 四元层（LE-9/10/11/12）。
- **测试**：`node --test scripts/loop-engine/*.test.mjs` → **288 pass / 0 fail**（11 个 `*.test.mjs`）。
- **dry-run**：`node scripts/loop-engine/run.mjs --dry-run` → 输出合法依赖图 + 8 phase 顺序 + 逐波拓扑前沿 + 路由决策样例。
- **gate**：`bash scripts/gate.sh` → 全部通过（唯一 ⚠️ = 4 个既有大文件行数警告，与 loop-engine 无关·属预期）。
- **events.jsonl**：append-only，已写入 `impl_done` 终态行；gate step9 一致性 ✅。

## 1. 逐 LE 状态

| LE | issue | 模块 | 文件 | 测试文件 | 落地承载 commit | 状态 |
|---|---|---|---|---|---|---|
| LE-1 | #60 | State Ledger（events append/fold + STATUS render） | `state-ledger.mjs` | `state-ledger.test.mjs` | `d248d7d` | ✅ 真代码绿 |
| LE-2 | #61 | Scheduler（拓扑前沿 + phase barrier + 环检测） | `scheduler.mjs` | `scheduler.test.mjs` | `3502986` | ✅ 真代码绿 |
| LE-3 | #62 | Controller / 6 安全阀（预算/连败/再生隔离/收敛/防震荡/flaky） | `controller.mjs` | `controller.test.mjs` | `caca9db` | ✅ 真代码绿 |
| LE-4 | #63 | Diagnosis Router（三端日志 + reducer 断点→仓路由） | `diagnosis-router.mjs` | `diagnosis-router.test.mjs` | `3502986`（随 LE-2 提交） | ✅ 真代码绿 |
| LE-5 | #64 | Gap Emitter（classify + dedup sig + route label） | `gap-emitter.mjs` | `gap-emitter.test.mjs` | `be6505f` | ✅ 真代码绿 |
| LE-6 | #65 | Verifier（自适应：provenance 闸 + skeptic panel） | `verifier.mjs` | `verifier.test.mjs` | `3502986`（随 LE-2 提交） | ✅ 真代码绿 |
| LE-7 | #59 | 基建（gh 标签 + 目录脚手架 + gate.sh 集成 + events 一致性自检） | `events-consistency.mjs` + `scripts/gate.sh` step9 | `events-consistency.test.mjs` | `5e7e03d` | ✅ 真代码绿 |
| LE-8 | #66 | 编排器（loop-until-budget + resume·串起 LE-1..6 控制面） | `run.mjs` | `run.test.mjs` | `9c4d044` | ✅ 真代码绿 |
| LE-9 | #67 | Retrospector（回路健康四指标 → metrics 事件） | `retrospector.mjs` | `retrospector.test.mjs` | `ecce817` | ✅ 真代码绿 |
| LE-10 | #68 | Optimizer（增益自调·硬包络） | `optimizer.mjs` | `optimizer.test.mjs` | `6a729df` | ✅ 真代码绿 |
| LE-11 | #69 | Learner（同根因 ≥3 → 沉淀 harness） | `run.mjs::learnerDecide` | `run.test.mjs`（Learner 用例 ×2） | `9c4d044` | ✅ 真代码绿 |
| LE-12 | #70 | Architect（同类 gap 跨 ≥2 sig → 设计提案） | `run.mjs::architectDecide` | `run.test.mjs`（Architect 用例） | `9c4d044` | ✅ 真代码绿 |

> 备注：LE-4 / LE-6 的实现文件随 LE-2 的 commit `3502986` 一并入库（commit 边界与 issue 边界未一一对齐），但二者均为独立深模块 + 独立测试文件，功能完整。LE-11 / LE-12 作为元层判定函数内置于编排器 `run.mjs`，由 `run.test.mjs` 真断言覆盖（阈值边界 2 不触 / 3 触）。

## 2. 文件清单（`scripts/loop-engine/`）

实现模块（11）：
- `state-ledger.mjs` (LE-1) · `scheduler.mjs` (LE-2) · `controller.mjs` (LE-3)
- `diagnosis-router.mjs` (LE-4) · `gap-emitter.mjs` (LE-5) · `verifier.mjs` (LE-6)
- `events-consistency.mjs` (LE-7) · `run.mjs` (LE-8 + LE-11 + LE-12)
- `retrospector.mjs` (LE-9) · `optimizer.mjs` (LE-10)
- `README.md`（模块导览） + `fixtures/`（dry-run 调度夹具）

测试（11，与实现一一对应）：
- `state-ledger.test.mjs` · `scheduler.test.mjs` · `controller.test.mjs`
- `diagnosis-router.test.mjs` · `gap-emitter.test.mjs` · `verifier.test.mjs`
- `events-consistency.test.mjs` · `run.test.mjs` · `retrospector.test.mjs` · `optimizer.test.mjs`

文档与状态（`docs/loop-engine/`）：
- `SPEC.md`（六层架构真源） · `STATUS.md`（LE-1 renderStatus 重生成的人读快照）
- `IMPL-STATUS.md`（本文件） · `events.jsonl`（机器真相·含 impl_done 终态行）

## 3. 验证结果（全部真跑）

- 单测：`node --test scripts/loop-engine/*.test.mjs` → **tests 288 / pass 288 / fail 0**（duration ~133ms）。
- dry-run：`node scripts/loop-engine/run.mjs --dry-run` → 34 issues · 依赖图 ✅ 合法 · phase 顺序 `0→1→…→7` · 逐 phase barrier 与拓扑前沿波次正确 · 路由决策样例齐全。
- gate：`bash scripts/gate.sh` → **✅ 全部通过**（镜像/harness 索引/录放 feature 闸/reducer 自测 189 通过/expect JSON/helix 单版本/C013 禁区 0/events.jsonl 一致性；唯一 ⚠️ = 既有 5 大文件行数警告，非 loop-engine 引入）。

## 4. 边界声明

- 本批为 **loop-Engine 自身实现**（控制面 JS），**未对 UC rollout issues #7-#41 真跑一遍引擎**。故 `STATUS.md` 终态行诚实显示 `0 绿 / 0 park / 0 quarantine`——这是真实快照，非橡皮章（C011 诚实出账）。首个真实引擎 pass 跑完后 wind-down 会覆写 STATUS.md 为带 issue 行的快照。
- 控制面无 fs 写（除 events.jsonl 的 append-only 与 STATUS.md 重生成），符合 SPEC §1/§8「控制在 agent 外」。
- 本任务**禁 merge main · 禁 push**（worktree 隔离收口）。

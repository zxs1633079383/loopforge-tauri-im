# Conductor — 动态 loop reactor（控制面）

> 2026-06-26 grilling 拍板。Conductor = 一个**动态 loop**（ScheduleWakeup 自调步），是 B/A1/A2 之间的
> **通信总线 + 调度器 + 你的统筹窗**。它自己不干活，每 tick 读 3 信号 log + git status，
> 算出 runnable 集 → 派活 → 双闸自动 merge → 排下一次 wakeup。

---

## 1. reactor 循环（每 tick）

```
tick:
  1. 读 docs/migration/{NEED_HELIX,HELIX_READY,BOUND_GREEN}.log（从 main·always current）
     + ls worktrees/*/NEED_*_FIX.md + git status
  2. 算 runnable：
       rows_pending      = 台账全行 − HELIX_READY.log          → 喂 B（续/派 helix 迁移）
       rows_unlocked     = HELIX_READY.log − BOUND_GREEN.log     → 派 A2 解锁批 workflow
       needs_from_a2     = NEED_HELIX.log 未被 B 消费的           → 插队喂 B（互相补齐反向边）
       cross_repo_gap    = worktrees/*/NEED_CSES_IM_SERVER_FIX.md → fork cses-im-server 协调 worktree
  3. 派活：
       B 不在跑 且 (rows_pending 或 needs_from_a2 非空) → 续 B 长 loop（background agent）
       rows_unlocked 非空 且 A2 空闲                    → Workflow(ui-a2-bind, {rows: rows_unlocked})
       A1 未启动                                         → Workflow(ui-a1-design)（t0 一次）
  4. 双闸自动 merge：
       对每个 worktree branch：git diff --name-only main..<branch> 交集为空
         ∧ 四面 reducer 该 UC 裁绿 → git merge --no-ff；否则不 merge
       硬停：NEED_*_FIX.md 跨仓 gap ∨ reducer 红 → 挂状态板 + 通知人·不强 merge
  5. 状态窗：输出一行
       📊 PENDING n / 🟦 待绑 m / 🟩 绿 k / ⚠️ 卡点 / ⏱ 预算
  6. 排下一次 wakeup（动态）
```

---

## 2. 动态 pacing（贴全局 §5：事件驱动 + 异常闸门，砍固定空转）

- **首选事件驱动**：harness 在 B（background agent）/ A2（Workflow）**完成时自动唤醒 Conductor** → 完成信号不靠轮询。
- **wakeup 仅做兜底心跳**：
  - 解锁在流（rows_unlocked 持续增长）→ `270s`（缓存热·别踩 300s）
  - B 卡在 NEED_FIX / 假死 → `1200~1800s`（省 cache·一次 miss 换长等）
  - 全空闲等外部（cses-im-server 重启 / 协调 worktree）→ 按那个外部状态变化速率选
- **异常闸门**：`HEAD 超 30min 不动 ∧ git status 有未提交 .rs/.ts/.go` → 疑似中断留半成品 → 告警长输出；否则一行心跳带过。

---

## 3. 骨架（伪码 · 实际由主对话持有的动态 loop 承载，非 Workflow 脚本）

```js
// Conductor 不是 Workflow 脚本——它是主对话的动态 loop（ScheduleWakeup 驱动）。
// 每次 fire 执行下述一个 tick，然后 ScheduleWakeup 排下次。
async function tick() {
  const need   = readLog('docs/migration/NEED_HELIX.log')
  const ready  = readLog('docs/migration/HELIX_READY.log')
  const green  = readLog('docs/migration/BOUND_GREEN.log')
  const ledger = ALL_ROWS // 19 条渲染路径（台账 §4）

  const pending  = ledger.filter(r => !ready.has(r))
  const unlocked = [...ready].filter(r => !green.has(r))
  const fixGaps  = glob('worktrees/*/NEED_CSES_IM_SERVER_FIX.md')

  if (fixGaps.length)      return halt('cross-repo gap', fixGaps)   // 硬停
  if (!bRunning && (pending.length || need.size)) continueB(pending, need)
  if (unlocked.length && a2Idle) dispatch('ui-a2-bind', { rows: unlocked })
  if (!a1Started) dispatch('ui-a1-design')

  for (const wt of worktrees()) {
    if (diffDisjoint(wt) && reducerGreen(wt)) mergeNoFF(wt)   // 双闸
  }

  emitStatusLine({ pending: pending.length, unlocked: unlocked.length, green: green.size })
  scheduleNext(pickDelay({ unlocked, bStuck, idle }))         // 270s 热 / 1200s+ 卡
}
```

---

## 4. 与 helix-loop-engine 的关系

B 内部用 `helix-loop-engine` skill 跑「代码↔三端日志↔结果」自驱闭环（每行：找缺口→补 helix→re-pin→重跑 spec→读三端日志→reducer 裁判）。Conductor **不替代** B 的 loop——它只在外层调度 B 何时跑、把 B 的产出（HELIX_READY.log）转给 A2、把 A2 的反向需求（NEED_HELIX.log）插队回 B。两层 loop：外层 reactor（调度）+ 内层 helix-loop-engine（三端 debug）。

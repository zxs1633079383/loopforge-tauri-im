---
id: C009
title: 自动修复 agent 禁自产自判——红转绿由独立 reducer 裁定，修复方只改实现（堵 GIGO 后门）
status: active
created: 2026-06-24
recurrence_count: 1
inline_target: 候选 ~/.claude/rules/common/agents.md
---

## §1 触发场景
派/跑「自动修复」agent（red→fix→verify）/ night-loop / 让修复方自己判「四面绿了吗」/ 修复方想改 expect 或 reducer。

## §2 背景（why）
借鉴 helix `HX-C009 漏洞7（GIGO 后门）` + `HX-C012` + 哲学长文：写 EXPECT 和判「是否偏离」若同一 agent → 可把判定写松使其永远 PASS（自评自判）。loopforge 的自动修复闭环正是最危险的自产自判场景——让修复 agent 自判红转绿 = 鼓励它改 oracle / 写假绿。CLAUDE.md §2 #2「自动修复护栏」需工程化。

## §3 Required / Forbidden
✅ 红转绿判定**移出修复方**：由独立 `test/reducer/four-facet-reducer.mjs`（四面聚束 + 与冻结 expect diff）裁定绿/红，修复 agent 不参与判定。
✅ 修复 agent **只能改 helix 引擎实现 / 本仓渲染壳**（当前 helix 只标记不改，见 C004 → 只改本仓壳/reducer 形态）。
✅ 实质任务开局先写可证伪期望（四面 expect 具体断言），禁事后补记（事后补≈自评）。
❌ 修复 agent 改 `test/expect/*.json` 已验证冻结面 / 改 reducer diff 逻辑迁就实现，让红变绿。
❌ 修复方自己 console「我觉得修好了」当通过。

## §4 Verification
- 修复闭环里：通过判定来自 reducer 退出码/报告，非 agent 自述。
- `node test/reducer/four-facet-reducer.test.mjs` → 39/0（裁判本身可信）。
- 修复 commit 的 diff 不含 test/expect 已冻结面改动（grep diff）。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | aadf8d6+ | 借鉴 helix HX-C009/C012 立卡 | loopforge autofix 闭环缺自产自判护栏 |

## §6 关联
- 上游：CLAUDE.md §2 #2 契约只读自动修复护栏 · helix HX-C009 漏洞7 / HX-C012
- 兄弟卡：C004(契约只读·helix 只标记不改)·C008(可证伪)
- 下游：自动修复 agent / night-loop

## §7 历史与演进
- drafting→active：2026-06-24（借鉴 helix）

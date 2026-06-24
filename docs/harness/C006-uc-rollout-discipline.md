---
id: C006
title: UC rollout 依赖序 + 每阶段全绿→tag+补用例（闭环收口）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
铺任一 UC / 推进 rollout / 阶段完成 / 打 tag / 补 e2e 用例。

## §2 背景（why）
2026-06-24 用户拍板（CLAUDE.md §8 已立）：UC 必须按依赖序铺（没有群聊无法发消息，后序复用前序真实数据）；每阶段全绿打 tag + 补该阶段用例。本卡是 §8 的可执行展开。helix 只标记不改见 C004。

## §3 Required / Forbidden
✅ 依赖序：阶段0 就绪(4.1)→1 建频道(5.1/5.2)→2 发消息→3 对消息操作→4 历史→5 频道/成员→6 杂项→7 teams/运维→L2 双账号。
✅ 每 UC 闭环：接最简 UI → `run.sh -- --spec test/specs/uc-X.e2e.mjs`(seeded db·C003) → reducer 断面 → 修 → 复跑全绿 → 翻台账 ✅ + 勾 checklist + commit。
✅ 每阶段全部 UC 四面全绿 → 打 tag `v0.x-phaseN-<slug>`（带覆盖范围+UC列表+验证）+ 补全该阶段每 UC 的 spec+expect（真跑过）。
❌ 跳序铺（如频道未建先铺成员管理）。❌ 阶段全绿不打 tag / 不补用例就进下一阶段。

## §4 Verification
- 计划/勾选：`docs/uc-rollout/rollout-checklist.md`（依赖序+勾选）·端点账 `coverage-crossmap.md`·契约 `uc-coverage-ledger.md`。
- 阶段全绿后：`git tag -l 'v0.*-phase*'` 有对应 tag。
- 该阶段每 UC：`ls test/specs/uc-X.e2e.mjs test/expect/uc-X.expect.json` 存在且 e2e 跑过。
- 台账绿数与 checklist 勾数一致。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | 55028ab | 立策略 + v0.1-basic tag | 用户拍板 rollout 纪律 |

## §6 关联
- 上游：CLAUDE.md §8 UC Rollout 纪律（绑定规则）
- 兄弟卡：C003(seeded db)·C004(契约只读)·C005(reducer 归一)
- 下游：所有后续 UC 铺开

## §7 历史与演进
- drafting→active：2026-06-24 commit 55028ab + tag v0.1-basic

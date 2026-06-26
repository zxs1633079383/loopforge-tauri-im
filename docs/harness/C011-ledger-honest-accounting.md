---
id: C011
title: UC 四面台账诚实出账——分级图例 + 禁橡皮章借证据冒充 + 误诊主动纠错（借鉴 helix ledger）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
翻台账 `docs/uc-coverage-ledger.md` 状态 / 标某 UC ✅ / 写覆盖率 / partial/untested 出账 / 端点账 coverage-crossmap。

## §2 背景（why）
借鉴 helix `docs/review/uc-coverage-ledger.md`：状态分级到极细（e2e-verified / data-dep / wire-bug / untested / harness-gap / verified-by-proxy / verified-not-a-capability），且铁律「**禁橡皮章借别的 UC 证据冒充·如实 harness-gap**」「误诊主动纠错并标注」。loopforge 覆盖 89 命令/19 WS/27+ UC，绝不能把 false-green 当背书写进 ledger。

## §3 Required / Forbidden
✅ 只有 `run.sh` 经真 Tauri+WKWebView 四面 oracle 全绿才标 ✅ four-facet-verified；其余如实 ⬜pending/🟡partial/⛔unreachable/🌙按需，理由逐条记账。
✅ 误诊（如自echo 误判 / 墙钟 flaky）主动纠错 + 标注，不掩盖。
✅ 覆盖率脚本读台账算（不靠记忆）；crossmap 端点级逐个对 UC（已建 coverage-crossmap.md）。
❌ 借 UC-A 的证据橡皮章冒充 UC-B 绿。❌ 把 false-green/partial 当 ✅ 写进 ledger。❌ 改契约让红转绿冲覆盖率（违 C004 护栏）。

## §4 Verification
- 台账 ✅ 数 == 真跑过 run.sh 全绿的 UC 数（与 commit/tag 对得上：当前 3 = UC-1.1/1.2/1.5）。
- `grep -c "✅ four-facet-verified" docs/uc-coverage-ledger.md` 与 checklist `[x]` 数一致。
- crossmap 每行触发 UC verbatim 自 checklist/ledger（可回溯）。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | aadf8d6+ | 借鉴 helix ledger 诚实纪律立卡 | 防 false-green 写进台账 |

## §6 关联
- 上游：CLAUDE.md §3 四面契约 · helix uc-coverage-ledger.md
- 兄弟卡：C006(rollout 收口)·C009(禁自产自判)
- 下游：每次翻台账 / 算覆盖率

## §7 历史与演进
- drafting→active：2026-06-24（借鉴 helix）

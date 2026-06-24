---
id: C003
title: live 验证须用 seeded DB（清 DB 无 active channel·send 族全卡）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
跑 `run.sh -- --spec` live 验证 / e2e 报「乐观行未上屏·断在 click→store.send」/ activeChannel 为空 / 新机器首次 live。

## §2 背景（why）
2026-06-24：最简壳 activeChannel 只能从增量流或 dialog-list 冒；增量是严格 cursor delta —— **fresh DB(0 cursor) 啥都不增量 → 本地 channel 表空 → dialog bootstrap 拉不到 → activeChannel 为空 → send 族全部无发送目标**。seeded DB（`/tmp/loopforge-im.db` 有 77 channel 行）才有决定性 active channel（修复链 31bae3c dialog bootstrap）。

## §3 Required / Forbidden
✅ live 跑用 **seeded DB**：默认 `HELIX_DB` 不设即用 `/tmp/loopforge-im.db`（本地 channel 表已有行）；`scripts/run.sh -- --spec test/specs/uc-X.e2e.mjs`。
✅ 壳就绪后 `im_query_dialog_list` bootstrap 设 activeChannel（src/app/im/im-store.service.ts）。
❌ 用 fresh/空 DB 跑 send 族 live（必无 active channel）。
❌ 删 dialog bootstrap（去掉 = 退回无 active channel）。

## §4 Verification
- `sqlite3 "/tmp/loopforge-im.db?mode=rwc" "SELECT count(*) FROM channel;"` > 0（seeded）。
- `grep -n "im_query_dialog_list\|bootstrapDialogList" src/app/im/im-store.service.ts` 命中。
- run.sh live UC-1.1 → `✅ UC-send-1 四面全绿`。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | 31bae3c | 乐观行未上屏·activeChannel 空 | fresh DB 无 cursor·增量空·dialog 拉空 |

## §6 关联
- 上游：CLAUDE.md §4 双轨确定性源（金标帧未录时靠 seeded live）
- 兄弟卡：C002（就绪）
- 下游：所有 send 族 UC live 验证

## §7 历史与演进
- drafting→active：2026-06-24 commit 31bae3c

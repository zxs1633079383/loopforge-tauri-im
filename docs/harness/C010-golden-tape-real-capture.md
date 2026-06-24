---
id: C010
title: 金标帧 = 现网真抓非手写猜测（头注释+JSON体·补帧 playbook）借鉴 helix golden fixtures
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
录/补金标 tape（test/fixtures/*.tape.json）/ 设计 replay 帧 / 想手写测试帧。

## §2 背景（why）
借鉴 helix `tests/fixtures/real_go_frames/README.md`：最大坑是 parser 按猜测写 action 名 `"posted"`，真帧其实 `"post"`——「测试帧手写猜的、和现网 wire 漂移，CI 也测不出」。loopforge 双轨确定性源（CLAUDE.md §4）金标帧正是这套：真 go 跑一次录 tape → 回放经真实 Tauri+WKWebView。**当前 tape 尚未录**（live 走 seeded db，见 C003）；录时必须真抓不手写。

## §3 Required / Forbidden
✅ tape 帧 = 真 go 下发**原文**（`scripts/record.sh` 连真 go 录），头注释带抓帧日期/形态/抓法，格式「`//` 头注释 + JSON 体」。
✅ 补帧 playbook 固化：record 模式连真 go → 录 Transport/Clock/IdSource → 人审标 immutable → 加回放断言 → 跑 replay。
✅ 配 valid-JSON 守护（剥头注释后 JSON.parse 不报错）。
❌ 手写/猜测 action 名、字段、seq（必和现网漂移）。
❌ 改已审冻结 tape 迁就实现（属契约只读 C004）。

## §4 Verification
- `ls test/fixtures/*.tape.json` 存在时：头注释含抓帧日期 + 剥注释后 `JSON.parse` 通过。
- `grep -rn "action" test/fixtures/*.tape.json` 的 action 名能在 helix `5--backend-ws-events.md` 19 真源里找到（非臆造）。
- record.sh 用 `APP_BIN`（C 已修工作区根 target）连真 go。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | aadf8d6+ | 借鉴 helix golden fixtures 立卡 | tape 未录·录时须防手写猜测漂移 |

## §6 关联
- 上游：CLAUDE.md §4 双轨确定性源 · helix real_go_frames/README
- 兄弟卡：C003(seeded live·tape 未录时的替代)·C004(契约只读)
- 下游：replay.sh / golden 回放 spec

## §7 历史与演进
- drafting→active：2026-06-24（借鉴 helix·tape 录制时启用）

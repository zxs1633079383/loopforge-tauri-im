---
id: C002
title: 就绪 probe 判据与具体投影名解耦（禁硬编 name.contains("increment")）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
改 `src-tauri/src/engine.rs` spawn_bus_bridge / 就绪 probe / helix 升 rev 后 e2e before-hook 卡「就绪 probe 未通过」/ 投影事件改名。

## §2 背景（why）
2026-06-24：helix 工作树本会话内被另一 workflow 从 round3(413c4a8) 移到 round6(248fc84)，round6 增量投影实际名为 `im:channels:loaded` / `im:post:received` / `im:channel:created`，**无一含 "increment"** → 原判据 `name.contains("increment")` 致 `increment_seen` 恒 0 → probe 永不亮 → 所有 UC 的 before-hook 30s 超时（修复 commit b40388c）。

## §3 Required / Forbidden
✅ 就绪 = 收到任意**非连接生命周期**领域事件（排除 `im:connection:*`）作「同步活动」+ 静默窗口达成。与投影名解耦。
❌ 用任一具体投影名子串（"increment"/"post"/…）当就绪硬判据 —— helix 改名即失效。

## §4 Verification
- `grep -n 'name.contains("increment")' src-tauri/src/engine.rs` → 应为 0。
- `grep -n 'starts_with("im:connection")' src-tauri/src/engine.rs` → 应命中（解耦判据）。
- run.sh live 任一 UC before-hook 就绪 probe 通过（不超时）。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | b40388c | before-hook「就绪 probe 未通过」30s 超时 | 判据硬编 increment 子串·round6 投影改名 |

## §6 关联
- 上游：CLAUDE.md §3 就绪/静默 probe
- 兄弟卡：C001（helix rev 漂移同根）
- 下游：所有 e2e spec 的 before 就绪等待

## §7 历史与演进
- drafting→active：2026-06-24 commit b40388c

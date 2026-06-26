---
id: C008
title: 测试可证伪铁律——破坏即 fail · 禁墙钟下界 · 禁 tautology（借鉴 helix HX-C011）
status: active
created: 2026-06-24
recurrence_count: 1
inline_target: 候选 ~/.claude/rules/common/testing.md
---

## §1 触发场景
写/改四面断言 reducer、L1 四面 spec、L2 并发不变量（cursor 单调 / inflight 有界 / 不丢帧 / 终态收敛 / 无死锁）/ 声称任何不变量的测试。

## §2 背景（why）
借鉴 helix `HX-C011-test-falsifiability.md`（recurrence 3）：「**测了 ≠ 证明了。false-green 比没测更危险——给假信心**」。loopforge 核心使命是「自动测试→自动修复→自动验证」，false-green 会让修复 agent 拿假绿背书。CLAUDE.md §2 #5 已要求可证伪，但缺 gate 落地。

## §3 Required / Forbidden
✅ 每条声称不变量的测试必须可证伪：临时破坏不变量（删 guard / 改坏一面 expect / 注入回退值）→ 测试必 FAIL；还原 → PASS。reducer 自测已含「可证伪对偶」（每面破坏即红 + 断点定位）——新增断言须配对偶。
✅ commit body 记录关键不变量的「破坏→FAIL→还原→PASS」证明。
❌ 墙钟**下界**断言（`assert wall >= X`·快路径 flaky）。
❌ tautology（顺序写递增值后断言终态==max·删 guard 照过）。
❌ 无 assert 只 console.log 的判据。

## §4 Verification
- `node test/reducer/four-facet-reducer.test.mjs` → 39/0 且输出含「可证伪对偶」。
- 改坏任一 expect 一面 → 对应 spec/reducer 必红（手动抽验）。
- `grep -rn "toBeGreaterThan.*Date.now\|>= .*wallclock\|>= .*elapsed" test/` → 应空（无墙钟下界）。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | aadf8d6+ | 借鉴 helix HX-C011 立卡 | loopforge 缺可证伪 gate |

## §6 关联
- 上游：CLAUDE.md §2 #5 测试可证伪 · helix HX-C011
- 兄弟卡：C004(契约只读)·C009(禁自产自判)·C005(reducer 归一)
- 下游：所有四面/并发不变量测试

## §7 历史与演进
- drafting→active：2026-06-24（借鉴 helix）

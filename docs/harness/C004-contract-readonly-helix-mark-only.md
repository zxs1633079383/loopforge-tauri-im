---
id: C004
title: 四面契约只读·红转绿改实现不改 oracle（helix/loopforge 缺陷确认即修+验证）
status: active
created: 2026-06-24
recurrence_count: 1
---

## §1 触发场景
e2e 四面某面红 / 想改 expect 让红转绿 / 想改 helix 源码 / autofix。

## §2 背景（why）
CLAUDE.md §2 不变量②③：冻结契约（projection-schema / 真机curl真源 / golden tape / 四面 expect）只读；红转绿只能改 helix 引擎实现或本仓渲染壳。2026-06-24 用户裁决：当前 **helix 只标记不改**（另一条 workflow 正在改 helix 仓）→ loopforge 当 bug feeder，红出「断在哪一跳+证据」报告，绝不动 helix 仓。
**例外（非作弊）**：Phase1 agent authoring 的 **草拟 expect** 实测后校正对齐真相（如 UC-1.5 storage.op update→batch_update）是正常流程 —— 草拟未验证，校正成真实正确行为 ≠ 改冻结 oracle。

## §3 Required / Forbidden
✅ 红 → 读 reducer「断在哪一跳」+ 四段日志定位哪一端 → **确认即修+验证**：loopforge 本仓缺陷改本仓；**helix 引擎缺陷在 helix 仓修 + 复跑验证**；go-server 默认对，仅 gRPC/诡异才怀疑（gRPC 见 runbook §6.1）。
✅ 草拟 expect 与实测真相不符 → 校正草拟（注明 Phase2 实测校正）。
✅ 绿由独立 reducer 裁定（C009·非自评自判）。
❌ 改已验证的**冻结 expect/tape/契约真源**（真机curl真源/projection-schema）让红变绿 —— 契约只读·**永久不变量**。

〔策略演进：早先「不改 helix 仓·只标记」是另一 workflow 在改 helix 时的临时约束（2026-06-24），**已解除**；现确认 helix 缺陷可直接修+验证，但**冻结 oracle 仍只读**。〕

## §4 Verification
- `cd /Users/mac28/workspace/rustWorkspace/helix && git status --short` → loopforge 会话期间应无本会话改动。
- 本仓 tools/gate 若有 contract-readonly-gate：跑过。
- reducer 自测 `node test/reducer/four-facet-reducer.test.mjs` → 39/0（可证伪对偶在）。

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-24 | f3b3a92 | UC-1.5 storage 草拟 update vs 实测 batch_update | Phase1 草拟契约不准·校正非作弊 |

## §6 关联
- 上游：CLAUDE.md §2 五不变量 / §5 日志（reducer diff 报告）
- 兄弟卡：C006（rollout 闭环收口）
- 下游：每个 UC 的红转绿处置

## §7 历史与演进
- drafting→active：2026-06-24（用户裁决 helix 只标记不改）

# scripts/loop-engine/ — loop-Engine 模块布局

> loop-Engine = 全链路自治研发引擎（六层控制面/数据面分离）。SPEC 真源：
> [`../../docs/loop-engine/SPEC.md`](../../docs/loop-engine/SPEC.md)。

## 约定

- **运行时**：纯 ESM（`.mjs`）· **零新依赖** · 仅 Node 内置（`node:test` / `node:fs` / `node:child_process`）。
- **模块** = `scripts/loop-engine/<name>.mjs`；**测试** = `scripts/loop-engine/<name>.test.mjs`（`node --test`）。
- **控制面纯函数优先**：可裁决的逻辑写成无 IO 纯函数（便于 node:test 真断言·C008），
  IO（读盘 / 调 gh / 跑 run.sh）收敛到文件末尾 CLI 入口。
- **机器真相** = [`../../docs/loop-engine/events.jsonl`](../../docs/loop-engine/events.jsonl)（append-only 事件日志·禁就地改·SPEC §5）。
- **人读快照** = [`../../docs/loop-engine/STATUS.md`](../../docs/loop-engine/STATUS.md)（每 pass 由 wind-down 重生成）。

## 模块清单

| 模块 | 职责 | 层（SPEC §9） |
|---|---|---|
| `events-consistency.mjs` | events.jsonl ↔ open gap issue 一致性自检：gap_emit 的 sig 须对应仍 open 的 issue，无悬挂；坏 JSON / 缺 sig / 缺 issue 即 fail。纯函数 + CLI（被 `scripts/gate.sh` 调用，gh 不可用时降级为结构校验）。 | ① Controller / gate |
| `verifier.mjs` | 反幻觉验证深模块（自适应）：`provenanceGate`（无出处禁进）+ `verifyDepth`（爆炸半径 → light\|medium\|tournament，helix/契约/不可逆 → tournament）+ `panelVerdict`（N-skeptic 多数反驳 = block，C009 剔除作者自评）+ `divergenceTest`（两 verifier 分歧 → 收紧）+ `verifyClaim` 端到端编排。纯逻辑零 IO。 | ⑤ Architect / 验证 |
| `retrospector.mjs` | 回路健康指标（LE-9）：读 events 算 `regen_rate`（再生 churn）/`convergence_min`（ready→green 中位耗时）/`override_freq`（人工干预占比）/`pattern_count`（反复再生 distinct sig 数）→ `recommend`（Optimizer 硬包络内调 N/K）→ `retrospect` 产 metrics 事件。纯函数 + CLI（`--append` 以 append-only 追加 metrics 事件）。 | ② Retrospector / ③ Optimizer |

> 后续 LE-* issue 逐步补：bootstrap（折叠 events→快照）、emitter（追加事件）、reducer 裁决、
> scheduler（拓扑前沿）、retrospector/optimizer（指标+增益自调）等。每个新模块在此表登记一行。

## 跑测试

```bash
# 单模块
node --test scripts/loop-engine/events-consistency.test.mjs
# 全部 loop-engine 测试
node --test scripts/loop-engine/*.test.mjs
```

## 一致性自检（手动）

```bash
node scripts/loop-engine/events-consistency.mjs docs/loop-engine/events.jsonl
```

`scripts/gate.sh` 已集成该自检（见 gate 第 9 段）。

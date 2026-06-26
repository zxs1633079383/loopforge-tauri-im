# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**Layout: single-context.** loopforge-tauri-im 是单一内聚的测试夹具客户端（Angular 薄壳 +
src-tauri Rust 壳 + crates/helix-driver-instrument 仪表层 = 同一领域：四面契约自动化测试）。
helix 引擎是外部 path-dep（行为真源在 helix 仓），不算本仓 context。

## Before exploring, read these

- **`CONTEXT.md`** at the repo root（懒创建·见下）。
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- 本仓既有真源也优先读：`docs/PRD.md`、`docs/spec/send-message-vertical-slice.md`、
  `docs/uc-coverage-ledger.md`、`docs/uc-rollout/`、`docs/harness/`（12 卡 + README）、根 `CLAUDE.md`。

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest
creating them upfront. `/domain-modeling`（经 `/grill-with-docs` 与 `/improve-codebase-architecture`
触达）会在术语/决策真正被解决时懒创建 `CONTEXT.md` / ADR。

## File structure (single-context)

```
/
├── CONTEXT.md            ← 懒创建（domain-modeling 产出）
├── docs/adr/             ← 架构决策记录
└── src/ src-tauri/ crates/
```

## Use the glossary's vocabulary

When your output names a domain concept (issue title, refactor proposal, hypothesis, test name),
use the term as defined in `CONTEXT.md` / 既有文档（如「四面契约」「投影 envelope」「corr_key」
「seeded DB」「金标帧」「就绪 probe」）。Don't drift to synonyms.

If the concept isn't in the glossary yet, that's a signal — either you're inventing language the
project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR or CLAUDE.md 五不变量 / §8 rollout 纪律 / harness 卡，
surface it explicitly rather than silently overriding:

> _Contradicts CLAUDE.md §2 #2（契约只读）— but worth reopening because…_

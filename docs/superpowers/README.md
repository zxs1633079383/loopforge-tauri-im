# Superpowers 文档入口

`specs/` 与 `plans/` 记录设计和执行过程，不是当前 runtime 事实源。

## 当前参考入口

| 文档 | 主题 | 当前事实需要回到 |
|---|---|---|
| `specs/2026-07-02-loopforge-all-uc-real-chain-spec.md` | 全 UC real-chain 设计 | `docs/uc-rollout/all-uc-real-chain-status.md` |
| `specs/2026-07-02-loopforge-go-only-apifox-green-design.md` | Apifox / Go-only HTTP | `docs/uc-rollout/apifox-http-suite-runbook.md`，且只代表 HTTP |
| `specs/2026-07-03-loopforge-cses7-ui-real-chain-closure-spec.md` | UI real-chain closure | `docs/uc-rollout/README.md` |
| `specs/2026-07-06-loopforge-global-trace-design.md` | global trace | `docs/trace/otel-trace-gate.md`；运行状态另看当前 checkout 存在的 `.loop-engine/runs/*/next.md` |

## 规则

- `plans/*.md` 是任务拆分，不能自动代表完成。
- spec 中的 green 示例必须通过 reviewer + collector 重新确认。
- 涉及 UC 状态时，一律回到 `docs/uc-rollout/README.md` 的 current facts 入口。
- 不在本 checkout 中存在的 `.loop-engine` run 或未落盘 spec，不写成固定路由。

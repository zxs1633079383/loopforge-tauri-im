# LoopForge 文档入口

本目录是 LoopForge Tauri IM 的文档路由入口。先从这里找当前事实源，避免历史计划、Apifox HTTP 预检、worker report 混成 runtime green。

## 当前事实入口

| 文档 | 角色 |
|---|---|
| `docs/uc-rollout/README.md` | UC / real-chain 状态入口和证据边界 |
| `docs/uc-rollout/all-uc-real-chain-status.md` | UC-by-UC 当前状态 ledger |
| `docs/纯渲染壳-铁律与helix迁移台账.md` | 纯渲染壳迁移台账 |
| `docs/harness/README.md` | active harness 约束索引 |
| `docs/trace/otel-trace-gate.md` | trace gate 文档入口 |
| `docs/loop-engine/SPEC.md` | Loop Engine 设计规格 |

## 主题路由

| 主题 | 入口 | 注意 |
|---|---|---|
| UC real-chain | `docs/uc-rollout/README.md` | Apifox 只能作为 HTTP preflight |
| UI / 纯渲染壳 | `docs/纯渲染壳-铁律与helix迁移台账.md`、`docs/ui-指令映射全景.md` | 不把 UI shaping 当 helix projection |
| Loop Engine | `docs/loop-engine/`、`.loop-engine/runs/*/next.md` | worker report 不是 green |
| 编排规划 | `docs/orchestration/README.md` | 长 loop / migration 计划，非当前 runtime 状态 |
| superpowers | `docs/superpowers/README.md` | spec/plan provenance |
| 历史成果 | `docs/0628全链路最终成果.md`、`docs/RUNBOOK.md`、`docs/INTEGRATION-STATUS.md` | 保留历史，引用当前状态时回到 UC 入口 |

## Evidence Guardrail

- Apifox HTTP green 不是 DOM/WS/projection/storage green。
- HTTP 成功不是 WS/projection/storage/bus 成功。
- worker DONE、fixture-only、manifest-only、declared-only 不能写成 runtime success。

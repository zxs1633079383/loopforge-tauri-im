# UC Rollout 文档入口

本目录记录 LoopForge UC/real-chain 收口过程。读取顺序固定如下，避免把历史执行计划、Apifox HTTP 预检或 worker report 误当当前 green。

## 当前事实入口

1. `all-uc-real-chain-status.md`
   - 当前 UC-by-UC 状态 ledger。
   - 明确区分 `green`、`partial`、`l2-required`、`http-only`、`blocked`、`not-run`。
2. `reports/all-uc-real-chain-final.md`
   - 某次收口的最终报告/异常摘要。
   - 只能代表报告生成时刻，不代表今天未重跑也 green。
3. `.loop-engine/runs/*/next.md`
   - 当前 Loop Engineer 状态线索。
   - worker report 不能直接当 green；green 仍需 reviewer approved + collector evidence。

## 历史/支撑材料

- `rollout-checklist.md`：铺设计划和历史勾选清单，不是当前 go/no-go。
- `apifox-http-suite-runbook.md`：HTTP preflight runbook；Apifox green 不证明 WS/projection/storage/DOM green。
- `coverage-crossmap.md`、旧成果文档、superpowers plans/specs：保留 provenance，进入当前判断前必须回到上面的事实入口。

## Evidence Guardrail

- Apifox HTTP green 不是 LoopForge DOM/WS real-chain green。
- HTTP 成功不是 WS/projection/storage/bus 成功。
- 历史 archive、worker DONE、declared-only / fixture-only / manifest-only 不能提升为 runtime success。

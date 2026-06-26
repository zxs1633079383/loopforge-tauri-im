# NORTH-STAR — 项目当前目标 + 北极星指标

> 由架构 review 自动蒸馏（最近更新 2026-06-25）。源：`docs/PRD.md`、`docs/uc-rollout/rollout-checklist.md`、`docs/uc-coverage-ledger.md`、`docs/CHECKLIST.md`、`docs/INTEGRATION-STATUS.md`。
> 本文件**覆盖式更新**（不追加历史副本）。陈旧内容直接重写。

---

## 当前唯一目标（single next concrete goal）

**把 L1 rollout 剩余的 7 个 `[ ]` UC 推到「四面契约全绿」（或诚实标注 partial/unreachable），完成阶段 0–7 全部 31 个可管理 UC 的 L1 收口。**

依赖序铁律下，阶段 0–5 主路径已基本收口（22 个 `[x]` 四面全绿）。剩余待铺的 7 个 `[ ]` UC，按依赖序为：

- **阶段 6 余项**：10.1 待办列表、4.2 按需 sync notify、10.2 系统通知
- **阶段 7（teams/运维）**：5.8 条件查频道、11.1 维护公司大群、11.2 退出公司、12.1 健康探针（①连通性 1 面）

闭环纪律不变（CLAUDE §8）：接最简 UI → `scripts/run.sh -- --spec test/specs/uc-X.e2e.mjs`（seeded DB）→ 四面 reducer 断面 → 修实现/壳（契约只读）→ 复跑全绿 → 翻台账 + 勾 checklist + commit + 每阶段全绿打 tag。L1 全绿后再叠 L2 双账号广播（4 个 `[2]` UC）。

---

## 北极星指标（North Star metric）

**L1 四面契约全绿 UC 数 / 31（可管理 UC 总数）。**

- **定义**：经真 Tauri + WKWebView + WebdriverIO 跑过四面 oracle（① 出站体逐字 + ② 投影字段集 + ③ DOM data-* + ④ DB 落行/cursor）**全绿**、由独立 reducer 裁定、在 `rollout-checklist.md` 打 `[x]` 的 UC 数量。
- **当前值**：**22 / 31 全绿（`[x]`）**；另有 8 个 `[~]` partial（主路径绿、广播子项 L2 阻塞）、7 个 `[ ]` 待铺、1 个 `[n]` 按需、4 个 `[2]` L2 专批。
- **目标值**：31 / 31（L1 可管理 UC 全部四面全绿或诚实标注），随后解锁 L2。

### 为什么是这个指标

本仓的存在理由（PRD/CLAUDE 一句话）是「契约一致性自动化夹具」——价值不在功能多寡，而在**有多少 UC 的端到端客户端栈被四面契约真实证伪过**。四面全绿 UC 数直接度量这个使命：每 +1 就意味着「自动测试 → 自动修复 → 自动验证」闭环又多覆盖一条真实链路。它可证伪（破坏即掉绿，守 HX-C011/C008）、不可橡皮章（由独立 reducer 裁定，守 C009/C011），且与依赖序 rollout 一一对应，是最贴合北极星定义的单一进度量。

> 辅助护栏指标（非北极星，但掉绿即红灯）：`bash scripts/gate.sh` 全闸常绿（镜像/harness 索引/录放 feature/reducer 自测/expect JSON/helix 单版本/行数/clippy）。

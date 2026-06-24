# Rule — 自动修复护栏：引擎可改 · 契约只读 · 改契约需人审

> 根 CLAUDE.md §2.2 展开。核心：**防 gaming oracle —— 自动修复 agent 不许靠改期望/golden 把红变绿。**

## 1. 权限矩阵

| 资产 | 自动修复 agent | 说明 |
|---|---|---|
| helix 引擎实现（helix 仓 Rust） | ✅ 可改 | 红转绿的唯一合法途径 |
| 本仓渲染壳（前端 + src-tauri 拼装） | ✅ 可改 | 渲染/接线 bug |
| `helix-driver-instrument` 装饰器 | ✅ 可改 | 仪表 bug |
| **projection-schema.md**（helix 上游） | 🚫 只读 | 投影契约冻结 |
| **真机curl真源.md**（helix 上游） | 🚫 只读 | outbound 契约冻结 |
| **golden tape**（tests/fixtures） | 🚫 只读 | 确定性源，改它=改题 |
| **四面期望文件**（每 UC） | 🚫 只读 | oracle 本体 |

## 2. 契约过时怎么办

agent 判定是契约本身过时（go 真改了 wire / 投影真要变）：

- ❌ 禁自改契约让测试过。
- ✅ 产出「契约变更提案」：一句话 gap + 证据（真抓包 / go 源码行 / 双端日志）+ 期望新契约 → 交人审。
- ✅ 人审通过后由人改契约（或单独的契约更新流程），再让 agent 跟改实现。

## 3. 对齐 helix 铁律

- HX-C009 预期对账闭环（DRIFT-PRED 真接入·EXPECT 可证伪·偏离不自产自判）。
- HX-C011 测试可证伪（破坏即 fail）。
- HX-C012 实质任务开局写 🎯 EXPECT。

## 4. 跨 repo loop 编排

自动修复闭环跨两 repo：`改 helix 仓 Rust → 重建 testbed → 重跑端到端 → 读 reducer diff → 改实现 → 重跑`。loop 驱动器（helix-loop-engine / Workflow / /loop）须同时知道 helix checkout + testbed 两路径。

# Harness 运营流水（append-only）

> 每次新建/升级/退役 card、或踩坑但未达沉淀门槛的，追加一行。grep 友好。

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-06-24 | harness Engine 初始化 | 建 docs/harness/（TEMPLATE/README/log）+ 初始 7 卡 C001-C007，源自 UC rollout 本会话踩坑 |
| 2026-06-24 | 踩坑（未立卡·process） | 派 authoring 子任务误用 Explore agent（只读·不能 Write/Edit）→ 14 个里 2 个没落盘。**派写文件子任务必须用 general-purpose/写型 agent，不用 Explore**。单次+流程类，记 log 不立卡 |
| 2026-06-24 | 踩坑（未立卡·已并 C001） | cargo workspace 产物落**工作区根** target/debug/ 非 src-tauri/target/；_lib.sh APP_BIN 已修（commit 5b19498） |
| 2026-06-25 | ✅ DONE issue #46 Angular UI 骨架 | 6 语义区(H/CL/ML/MB/CP/AX)+消息行 data-* 全集(冻结8+待加8)+27 占位方法(C007)+store 区域信号占位 @2026-06-25 \| commit bb3a5ec \| 4 文件 +596/-29 \| feat/uc-rollout \| ng build PASS·gate.sh 绿·冻结集字节一致未回退 |
| 2026-06-25 | ⚠️ PARTIAL issue #7 UC-4.1 hello 全量增量 | 契约 expect/uc-4.1.expect.json + spec uc-4.1.e2e.mjs 从冻结真源 author(① increment_http_trigger·② emit_channel_increment·④ batch_upsert channel)+CL 区频道行填充接 UI(applyChannelIncrement/Update·tsc PASS·gate 绿) @2026-06-25 \| 卡在 live 四面全绿 \| 剩：①冷全栈 infra(go+java+隧道 sudo+seeded DB 0 字节失) ②① batch-outbound 无单 channel corr_key 结构 gap(待人审 reducer batch 面/装饰器 cursors 探针) \| feat/uc-rollout \| issue #7 留开·ledger UC-4.1 标 🟡 |

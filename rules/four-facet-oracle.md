# Rule — 四面契约断言 + 认领

> 根 CLAUDE.md §2.3 / §3 展开。核心：**每个 UC 用同一 corr_key 串四面，任一面偏离即 fail。**

## 1. 四面

| 面 | 来源 | 契约真源 |
|---|---|---|
| ① 出站命令体 | Transport 装饰器抓 | helix `真机curl真源.md`（真抓包 body+头） |
| ② 投影 envelope | EventSink 装饰器抓 | helix `projection-schema.md`（21 工厂字段集，冻结） |
| ③ DOM data-* | WebdriverIO 读 | UC 期望文件 |
| ④ DB 落库行 | Storage 装饰器抓 / 直接查 | UC 期望文件 |

每 UC 一份**声明式期望文件**（四面期望），**只读**（见 contract-readonly-autofix）。

## 2. 认领（L1：串行 + 静默窗口 + 领域键）

- **静默/就绪 probe（每 UC 前置）**：`increment_channel_end` 收齐 **且** HTTP inflight==0 **且** cursor 稳（cursor 稳 = 最后确认步）。未就绪不开跑。
- **窗口归属**：就绪后开窗口，窗口内所有帧/投影归该 UC。
- **领域键绑定**：窗口内用 `channelId + tmp_id/server_id + event_seq` 把四面同一逻辑事件精确绑定。**不改协议、不注入测试专用 corr-id**（避免侵入 go / 偏离生产 wire）。

## 3. 铁律

- ❌ 禁并发跑 L1 UC（串扰下四面误绑）。
- ❌ 禁靠墙钟 sleep 代替静默 probe（flaky）。
- ✅ 异步 WS 推送（别人消息/increment 帧）落在静默窗口外 → 不归任何 UC，由 probe 吸收。
- ✅ L2 并发场景不做逐帧认领，只断言不变量（v1 跳过）。

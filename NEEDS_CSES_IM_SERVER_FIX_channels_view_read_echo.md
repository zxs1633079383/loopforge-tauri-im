# NEEDS_CSES_IM_SERVER_FIX — channels/view 会话已读不广播 post_read echo（阻 L2 #15 UC-3.1）

> 协调件（让 main 协调 cses-im-server）。loop-Engine 数据面 drive·2026-06-28。

## 一句话 gap
`POST channels/view`（会话已读·整频道标已读）**不广播 post_read echo** 给消息作者，而 `POST post/read`（单条已读·#14 已绿）**会**。故 UC-3.1 会话已读的 ②(im:post:read) / ④(read_bits) 在 channels/view 路径结构上不产出。

## 实证（raw-WS observe 444）
A=444 发消息 → B=678 `POST channels/view {channels:[{id}]}` → 444 raw-WS **零 post_read 帧**（仅 join + 自身 echo）。对照：B=678 `POST post/read` → 444 收 post_read（#14 已绿·实证）。

## 期望后端改动
channels/view（会话已读）标整频道已读后，对该频道**每条被标已读消息的作者**广播 post_read echo（与 post/read 单条同机制·带 data.channelId + readMap）。或确认会话已读的 read 回执走不同机制并补文档。

## 现状
- issue #15（UC-3.1 会话已读）**已 closed**（早先 ①③ 绿·②④ 标 L2-pending）。本会话复验 ②④ 仍不可达（channels/view 不 echo）→ 台账诚实记 ⏸park·不重开。
- harness 就绪：`test/specs/uc-3.1-l2.e2e.mjs` + `test/expect/uc-3.1-l2.expect.json`·后端补 channels/view→post_read echo 后 `harness.sh spec 3.1-l2` 即转绿（守可证伪：现红在 ② waitUntil im:post:read 超时）。

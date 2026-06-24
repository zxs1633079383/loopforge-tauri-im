# UC Rollout Plan — 竖切之后按 UC 顺序铺开（有序台账）

> 状态：blueprint（蓝图 / 台账，**不含代码**）
> 前置：竖切 `UC-send-1`（`docs/spec/send-message-vertical-slice.md`）通过 = 整台机器打通（四面契约 + 装饰器录放 + tmp_id 认领 + JSONL/reducer + 自动修复闭环）。本台账是竖切通过后的铺开蓝图。
> UC 全集真源（helix）：
> - `helix/crates/helix-im/docs/csesapi-migration/full-map/00-README-index.md`（总索引）
> - `…/full-map/30-capability-gap-matrix.md`（缺口矩阵 covered 86 / partial 30 / missing 7）
> - `…/full-map/partials/6--client-usecases.md`（42 用例，10 集合）
> - `…/full-map/partials/8--client-tauri-im.md`（src-tauri 14 用例集 + sync wire 契约）
> - `…/full-map/partials/7--client-ui-rendering.md`（UI 渲染字段契约）
>
> **重要前提**：所有 HTTP+WS 协议**已被 helix 接管**。薄壳（loopforge-tauri-im）不重实现协议——每个 UC 只是「触发命令（invoke）→ 断言四面」。铺开 = 复用竖切搭好的同一台机器（装饰器 / reducer / corr_key / golden-tape / 四面期望文件），逐 UC 翻台账。

---

## 0. 四面契约骨架（每个 UC 的断言模板）

每个 UC 一行台账，四面期望骨架引用如下真源（与竖切 `§2 四面契约` oracle 同构）：

| 面 | 抓取点（port 装饰器 / 驱动） | 期望真源 | 一句话断言 |
|---|---|---|---|
| ① 出站命令体（outbound） | `Transport` 装饰器 | `真机curl真源.md`（send/makeTopic/revoke/create/member-change/close/createPosts 7 条逐字 body）+ `partials/6` 各 UC 的 `POST /api/cses/…` path/body | method+url+body 逐字对齐；camelCase；非 Pulsar 兜底 |
| ② 投影 envelope（projection） | `EventSink` 装饰器 | `projection-schema.md` §1 的 21 投影工厂 + §1.1-1.4 的 4 个非投影通道（reconnect / read:result / older_loaded / todo） | `data` 键集完全一致（缺/多即 fail）；message-row fat / channel-row thin / 透传类 三态 |
| ③ DOM（data-*） | WebdriverIO 读真实 WKWebView | 竖切 `§4 DOM 契约`（消息行 data-* 语义最小集）+ 本台账每 UC 标注的 data-* | 语义 DOM 节点 data-* 直映投影字段；tmp→server 覆写 / read-bits / send-status |
| ④ DB 落库行（storage） | `Storage` 装饰器 / 查库 | `partials/8` §6 表清单（`message` PK=temporary_id / `channel` / `channel_event_cursor` / `channel_member` / `todo`）| 命中表落行 + cursor 推进（单调不回退） |

> 「四面期望文件」是冻结契约（agent 只读）：① 锚 `真机curl真源.md` ② 锚 `projection-schema.md` ③ 锚本台账 DOM 契约 ④ 锚 helix message/channel 表列。红转绿只能改 helix 实现，不能改 oracle（PRD User Story 7）。

---

## 1. 铺开有序台账（按域分组 · 内含优先级序号）

> 列：`P# = 推荐铺开优先级` / `UC-id（partials/6 编号）` / `触发（invoke 命令 → helix outbound）` / `① 出站真源` / `② 投影工厂` / `③ DOM data-*` / `④ DB 表` / `认领难度`。
> WS 回声 action 已被 helix 接管为 `im:*` 投影 channel（见 `projection-schema.md` §1）；本台账 ② 列写投影工厂名。
> 「认领难度」：S=自发回流单连接窗口可证（竖切机器直接复用）/ M=需 increment 静默就绪 / D=需双账号广播或物理资源（标 untested 见 §2）。

### 域 A — posts（消息收发 / 历史 / 已读）— 最高优先级（竖切机器复用度最高）

| P# | UC-id | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 认领 |
|---|---|---|---|---|---|---|---|
| **1** | UC-1.1 发文本消息 | `im_send`→`posts/create` | `真机curl真源 §1`（camelCase 全字段）| `emit_post_received`(fat) + `emit_post_sending` | `data-msg-id`(tmp→server) `data-send-status`(sending→sent) `data-event-seq` | `message`(id=server,temp_id) + cursor+1 | S |
| **2** | UC-3.1 会话已读 | `im_channel_read`→`channels/view` | `partials/6 UC-3.1`（`{channels:[{id}]}`）| `emit_post_read`(fat) / `emit_channel_read_echo`(fat) | `data-read-bits`(self 位 '1') | `message.read_bits` 单调覆盖 | S/M |
| **3** | UC-1.5 撤回消息 | `im_revoke`→`posts/revoke` | `真机curl真源 §3`(`{postId}` ✅) | `emit_post_batch_updated`(在线) / `emit_post_deleted`(离线 fat) | `data-revoke=1` / 行移除 | `message` mark_revoked(revoke=1) | S |
| **4** | UC-1.6 编辑消息 | `im_send`(id 非空)→`posts/create` | `真机curl真源 §1` + id 非空(update 语义) | `emit_post_updated`(fat) | `data-msg-id` 内容更新 | `message` update_content(保留 read_bits) | S |
| **5** | UC-2.1 切群首屏 | `im_query_messages_by_channel`(本地) / too_long 兜底 `posts/getLatestPost` | `partials/8 http.rs:72`(`{channelId}`) | `query::emit_message_query_result`(透传 messages 行) | N 个消息行 data-msg-id | `Scan message` | S |
| 6 | UC-1.2 发文档消息 | `im_send`(type=DOCUMENT)→`posts/create` | `真机curl真源 §1` + `props.document` | `emit_post_received`(fat) | 同 UC-1.1 + data-type=DOCUMENT | `message` | S |
| 7 | UC-1.4 重发失败消息 | `im_send`(temp_id 复用)→`posts/create` | `真机curl真源 §1` | `emit_post_sending`→`emit_post_received` | data-send-status: failed→sending→sent | `message` upsert 覆盖 | S |
| 8 | UC-1.7 转发消息 | `im_create_posts`→`posts/createPosts` | `真机curl真源 附录A`(camelCase `{posts,channelIds}` ✅) | 各目标 channel `emit_post_received` | 多 channel 消息行 | `message` ×N | M |
| 9 | UC-2.3 按 postId 定位 | `posts/getPostsAfterIndex`(`{postIds:postId}`) | `partials/6 UC-2.3` | `query::emit_message_query_result`(透传) | data-msg-id 命中高亮 | `Scan message` | S |
| 10 | UC-2.2 上拉更早历史 | `im_load_older_context`→多轮 `posts/postContext` | `partials/8 http.rs:89`(`{postId,before}`) | `older_context::emit_older_loaded`(§1.3 透传) | prepend 更早消息行 | `message` upsert prepend | M |
| 11 | UC-2.4 一级/二级回复 | `posts/getReplies` / `posts/getReplyBranch` | `partials/6 UC-2.4` | `query::emit_read_result`(§1.2 读族透传) | 回复抽屉 data-reply-id | `Scan message`(回复链) | M |
| 12 | UC-3.2 单条已读 | `im_post_read`→`post/read` | `partials/6 UC-3.2` | `emit_post_read`(fat) | data-read-bits | `message.read_bits` | S |
| 13 | UC-3.3 模板已收到 | `templateReceived`→`post/templateReceived` | `partials/6 UC-3.3`(`{postId,channelId}` camel) | `emit_post_updated` / read:result | data-template-received | `message` | S |
| 14 | UC-1.8 快捷回复 emoji | `posts/quickReply` | `partials/6 UC-1.8`(`{userId,postId,emoji}`) | `emit_post_updated`(fat) | data-reactions | `message.props` | S |
| 15 | UC-1.9 加急 + 加急已读 | `posts/urgentPost` / `posts/urgentConfirm` | `partials/6 UC-1.9` | `emit_post_updated`(fat, expedite 归一) | data-urgent | `message.props`(expedite) | M |
| 16 | UC-1.10 定时消息 | `posts/createSchedule` / `cancelSchedule` / `getSchedule` | `partials/6 UC-1.10` | `emit_schedule_created` / `emit_schedule_canceled`(`{channelId,hasSchedulePost}`) | data-has-schedule | `channel.has_schedule_post` | M |
| 17 | UC-1.3 发图片/文件 | (上传) + `im_send`→`posts/create` | `真机curl真源 §1` + `props.file` | `emit_post_received`(fat) | data-send-status: uploading→sent | `message` | **D**(物理文件上传，见 §2) |

### 域 B — channel/sync（离线同步 / 频道管理）— 次高优先级（认领需 increment 就绪 probe）

| P# | UC-id | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 认领 |
|---|---|---|---|---|---|---|---|
| **18** | UC-4.1 hello 根群全量增量 | (WS hello 自动) / `channels/load/increment` | `partials/8 http.rs:25`(`{timestamp,cursors:[{channelId,fromSeq}]}`) | `emit_channels_loaded`(items) + `emit_channel_increment` + `emit_channel_update` | data-ready 标志 + channel 行 | `channel` + `channel_event_cursor` | M(就绪 probe 锚点) |
| 19 | UC-4.2 按需 sync notify | `im_sync_channels`→`channel/sync/notify` | `partials/8 §2.1`(`{cursors:[{channelId,fromSeq}]}` camel; SyncEntryKind snake) | `emit_post_received`/`updated`/`deleted` + `emit_channel_update_by_post`(thin) | 增量消息行 + badge | `message` + cursor 跳空洞 | M |
| 20 | UC-4.3 too_long 重拉 | (gate 自驱) → `posts/getLatestPost` | `partials/8 http.rs:72` | `emit_sync_too_long`(`{channelId,resetTo}`) | 清表重渲首屏 | `message` 清+重拉; cursor=resetTo-1 | M |
| 21 | UC-5.1 创建群聊 | `im_create_channel`→`channel/create` | `真机curl真源 §4`(`type:P`/users role/picture/forceCreate) | `emit_channel_created`(`{channel_id,channel}`) | data-channel-id 新行 | `channel` 新行 | M |
| 22 | UC-5.2 创建话题 | `im_make_topic`→`posts/makeTopic` | `真机curl真源 §2`(rootId/users CREATOR/picture/forceCreate) | `emit_channel_created`(type=T) | data-channel-id(topic) | `channel`(type=T) | M |
| 23 | UC-5.3 关闭/退出群 | `im_channel_close`→`channel/close` / `member/leave` | `真机curl真源 §6`(`{channelId}` ✅) | `emit_channel_closed`(`{channelId,deleteAt}`) | channel 行移除 | `channel` 软删 | M |
| 24 | UC-5.4 群属性修改 | `channel/change/{displayName,notice,purpose,orient,permission,top}` / `member/change/notify` | `partials/6 UC-5.4` | `emit_channel_update`(thin `{channel_id}`) | data-channel-* 回读刷新 | `channel` patch 列 | M |
| 25 | UC-5.5 消息置顶 | `channel/add/postPinned` / `remove/postPinned` / `load/postPinned` | `partials/6 UC-5.5` | `query::emit_read_result`(读族) / `emit_channel_update` | data-pinned | `channel` / `message.props` | M |
| 26 | UC-4.5 独立窗口陌生 channel 兜底 | `ensure_channel_loaded`→`channel/load/incrementByChannelId` | `partials/8 http.rs:47`(`{channelId}`) | `emit_channel_increment` | 单 channel 增量渲染 | `channel` + cursor | M |
| 27 | UC-5.6 群公告 | `post/announcement/{list,save,delete,read}` | `partials/6 UC-5.6` | `query::emit_read_result`(读族透传) | data-announcement | `message`(公告) | M |
| 28 | UC-5.7 在线状态/分组 | `channel/onlineStatus` / `modules/getAll` | `partials/6 UC-5.7` | `query::emit_read_result`(读族) | data-online-status | (内存/透传) | **D**(在线状态 P1-2 真阻塞缺失，见 §2) |
| 29 | UC-4.4 心跳 gap 补偿 | (Rust ping/pong piggyback 自驱) | `partials/8 §5.7`(`{cursors,allHash}` FNV-1a 锚定向量) | (补偿走 §19 sync 投影) | (间接，无独立 DOM) | `channel_event_cursor` | **D**(纯 Rust 自驱，DOM 不可达，见 §2) |

### 域 C — user-misc（成员管理 / 搜索 / 待办）— 第三优先级

| P# | UC-id | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 认领 |
|---|---|---|---|---|---|---|---|
| 30 | UC-6.1 拉/踢人 | `channel/member/change`(join/leave) | `真机curl真源 §5`(`{channelId,joinUsers/leaveUsers}`) | `emit_channel_member_updated`(`{channel_id,channel}`) | data-members 回读 | `channel_member` | M |
| 31 | UC-6.2 设/撤管理员 | `channel/add/manger` / `remove/manger` | `partials/6 UC-6.2` | `emit_channel_member_updated` / `emit_channel_update` | data-admin | `channel_member` | M |
| 32 | UC-6.3 改群昵称 | `channel/member/change/nickname` | `partials/6 UC-6.3` | `emit_member_nickname`(`{channelId,userId,nickName}`) | data-nickname | `channel_member` | M |
| 33 | UC-6.4 成员快照/全量 | `channel/member/snapshot` / `channels/member/byIds` | `partials/6 UC-6.4` | `query::emit_read_result`(读族) | data-member-count | `channel_member` 自愈覆盖 | M |
| 34 | UC-9.x 书签 | `post/bookmark/{create,delete,load}` | `partials/6 集合九` | `query::emit_read_result`(读族透传) | data-bookmark | `message`(书签) | M |
| 35 | UC-10.1 待办列表 | (hello 收尾自驱) `posts/queryTodoList` | `partials/8 http.rs:67` | `todo::emit_todo_updated`(§1.4 `{items}`) | data-todo 列表 | `todo` 表 | M |
| 36 | UC-7.x 搜索（全局/会话/分类） | `Im/search/{global,searchByChannel,…}`(走 api 非 imHttp) | `partials/6 集合七` | `query::emit_read_result`(读族) | data-search-result | (ES 透传无落库) | **D**(P2-1 search app 层空桩，见 §2) |

### 域 D — bot-agent / 互动卡片 — 最低优先级（依赖外部接通 / 非 message-v3 主链）

| P# | UC-id | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 认领 |
|---|---|---|---|---|---|---|---|
| 37 | UC-8.x 投票 CRUD | `vote/{createVote,vote,readVote,closeVote,deleteVote}`(走 api) | `partials/6 集合八` | `emit_post_updated`(fat) | data-vote | `message.props`(vote 卡) | M |
| 38 | UC-8.x 平均分 CRUD | `average/{publish,attend,read,close,delete}`(走 api) | `partials/6 集合八` | `emit_post_updated`(fat) | data-average | `message.props` | M |
| 39 | UC-10.2 系统通知 | (WS 帧触发，无独立 HTTP) | — | `emit_post_received`/`updated`(系统消息) | data-system-notice | `message`(SYSTEN 类型) | M |
| — | bot / agent 召唤 | (message-v3 service 层无独立 bot 端点) | — | — | — | — | **D**(BotAgentWebhookEvent Pulsar fanout P1-3 未接 + 客户端无 service 方法，见 §2) |

---

## 2. 物理够不到 / 诚实记 untested 的 UC

> 这些 UC 在 testbed（loopforge-tauri-im 薄壳 + golden-tape 日常闭环）下**物理够不到**或**后端真阻塞缺失**，铺开时标 `untested`，不计入「绿台账」，理由逐条记账（对齐 PRD「Out of Scope」+ 缺口矩阵 P1/P2 真阻塞）。

| UC | 够不到原因 | 缺口矩阵对应 | 处置 |
|---|---|---|---|
| UC-1.3 发图片/文件 | 物理文件选择 + 上传进度链需真实文件系统 + 上传服务；golden-tape 只录 WS/HTTP 帧不录文件 IO；④ DB 落 message 可测，但 ① 上传 hop 不可确定性回放 | （非缺口，物理限制）| 文本路径(UC-1.1)覆盖发送链；文件上传单独标 untested，真 go 夜间按需 |
| UC-5.7 在线状态 / UC-7.x 搜索 | `users/status/ids`（P1-2 真阻塞缺失）依赖 mattermost statusCache；`Im/search/*`（P2-1）app 层全空桩恒返空 + data 形态偏离源 | 矩阵 P1-2 / P2-1 | 后端裁决迁移前标 untested；不能红转绿（改契约才能过 = 违护栏） |
| UC-4.4 心跳 gap 补偿 | 纯 Rust ping/pong 自驱（8s piggyback），无前端 invoke 触发、无独立 DOM；③ 面物理不可达 | （Rust 内部，partials/8 §5.7）| 三面（①②④ + cursor 不变量）可测；③ DOM 标 N/A，靠 `all_hash` 锚定向量 + 补偿后 sync 投影间接证 |
| bot / agent 召唤 | message-v3 service 层无独立 bot 端点（客户端无对应 invoke）；BotAgentWebhookEvent Pulsar fanout（P1-3）未接 | 矩阵 P1-3 + partials/6 末注 | 客户端侧无用例 → 整域标 untested（如需覆盖从服务端 csesapi 侧梳理，超 testbed 范围）|
| UC（依赖双账号广播）：他人发消息收推送（PRD US-17）、拉人后对端实时更新 | 单 testbed 单账号，跨账号广播需第二个真实连接 | （认领难度 D）| L1 单账号窗口认领自发回流即可（竖切策略）；广播类 UC 标 untested 或留 L2（PRD Out of Scope L2 并发层）|

---

## 3. 推荐前 5 个 UC 顺序（铺开起手式）

1. **UC-1.1 发文本消息**（= 竖切本身，已通；铺开第一块复用其全套机器，验台账格式可翻台）
2. **UC-3.1 会话已读**（read_bits 链路，自发回流单连接可证；解锁所有「已读」类断言）
3. **UC-1.5 撤回消息**（在线 `posts_update` / 离线 gate 双路径，验 ② 投影双工厂 + ④ revoke 落库）
4. **UC-1.6 编辑消息**（`emit_post_updated` fat + update_content 保留 read_bits，验 fat 完整字段集证伪点）
5. **UC-2.1 切群首屏**（本地 SQLite 优先 + too_long 兜底，验 ④ Scan + ② query_result 透传类，打通历史读路径）

> 起手 5 个全在域 A、认领难度 S/M、复用竖切机器度最高、依赖链最浅——先把「单连接自发回流窗口」吃透，再升域 B（需 increment 就绪 probe）。理由展开见 `01-priority-rationale.md`。

---

## 4. UC 总数 / 分组统计

| 域 | UC 条目（本台账） | 其中 untested | partials/6 来源集合 |
|---|---|---|---|
| A posts（收发/历史/已读） | 17（P1-17） | 1（UC-1.3 文件）| 集合一/二/三 |
| B channel/sync（同步/频道管理） | 12（P18-29） | 2（UC-5.7 在线 / UC-4.4 心跳）| 集合四/五 |
| C user-misc（成员/搜索/待办/书签） | 7（P30-36） | 1（UC-7.x 搜索）| 集合六/七/九/十 |
| D bot-agent / 互动卡片 | 3 + 1 untested 域（P37-39 + bot）| 1 域（bot）| 集合八/十 |
| **合计** | **39 条**（38 invoke-driven UC + 1 bot 域 untested）| **5 untested + 1 整域** | 10 集合 |

> 对齐 PRD US-14「89 命令 / 19 WS 事件 / 27+ UC 台账」：本台账 39 条覆盖 message-v3 service 42 用例的可触发子集；39 ≥ 27 满足「27+ UC」，余者为 untested（物理/后端阻塞）或归 L2 并发层（Out of Scope）。

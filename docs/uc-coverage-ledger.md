# UC 覆盖台账（主台账）—— LoopForge 客户端四面契约 e2e 验证状态

> **这是 LoopForge rollout 的验证真源 + 进度台账。** 逐 UC 记**全流程四面契约当断言**
> （① 出站 HTTP+WS · ② 投影 · ③ DOM · ④ 落库）。每铺一个 UC 验绿 → 翻 `✅ four-facet-verified`。
>
> **当前真相（诚实）**：竖切 **UC-1.1（发文本消息）四面已全绿**（实证，见 `docs/spec/send-message-vertical-slice.md`）。
> 其余 UC 契约已逐条列出，状态为 `⬜ pending`（待 rollout 实现/验证）或 `⛔ unreachable`（物理够不到，诚实标注）。
> **不虚标绿**——只有真跑过四面 oracle 的 UC 才标 ✅。

---

## 0. 状态图例

| 图例 | 含义 |
|---|---|
| `✅ four-facet-verified` | LoopForge `run.sh` 经真 Tauri+WKWebView 跑过四面 oracle **全绿**（① 出站体逐字对齐 + ② 投影字段集一致 + ③ DOM data-* tmp→server 覆写 + ④ message/channel 落行 + cursor 推进）。**当前仅 UC-1.1**。 |
| `🟡 partial` | 部分面可验（如 ①②④ 可证、③ DOM 物理不可达走间接证），或单连接窗口可证主路径但广播子项够不到。 |
| `⬜ pending` | 契约已列、四面期望可写，但 rollout 尚未实现 testbed 触发/断言（命令在 helix 已 wired，缺 LoopForge 侧 invoke 接线 + e2e 剧本 + 四面期望文件）。 |
| `⛔ unreachable` | 在 LoopForge testbed（单窗口薄壳 + golden-tape 闭环）下**物理够不到**（文件上传需真上传管线 / 在线状态依赖 mattermost statusCache / 纯 Rust 自驱无 DOM / 后端 app 层空桩）。诚实标注理由，不计入「绿台账」。参照 helix ledger 的 UC-1.3 标注法。 |

> **认领难度**（沿用 rollout-plan）：`S` = 单连接自发回流窗口可证（竖切机器直接复用）/ `M` = 需 increment 静默就绪 probe / `D` = 需双账号广播或物理资源（多标 ⛔ 或 🟡 子项）。

---

## 0.1 本台账 与 helix ledger 的关系（两个 e2e 视角，共享 wire 契约）

| 维度 | helix `docs/review/uc-coverage-ledger.md` | **本台账（LoopForge）** |
|---|---|---|
| 视角 | **服务端 wire e2e**（host-cli 直连真 Go，抓 RAW WS action 回声断言）| **客户端四面 e2e**（真 Tauri+WKWebView，断言出站/投影/DOM/落库四面）|
| 测什么 | helix-im outbound 命令体 + Go WS 回声 wire 是否正确 | 整条客户端栈：DOM 操作 → invoke → 出站 → Go → WS → parser → gate → 投影 → DOM 渲染 → DB 落行 |
| 共享真源 | `真机curl真源.md`（出站体）· `projection-schema.md`（投影字段集）· full-map partials（端点/事件/UI 契约）| **同一份**（本台账契约**引用** helix 真源，不自编 wire 字段）|
| ③ DOM 面 | 无（host-cli 无渲染层）| **有**（这是 LoopForge 独有的接缝：投影 → DOM data-* 直映）|
| 当前绿数 | 33 UC `✅ e2e-verified`（服务端 wire 视角）| **1 UC**（UC-1.1，客户端四面视角）|

> **关键**：helix ledger 的 `✅ e2e-verified` ≠ 本台账的 `✅ four-facet-verified`。
> helix 那条只证「出站 + WS 回声 wire 对”——本台账还要再证「投影字段齐 + DOM 真渲染 + DB 真落行”这后三面，
> 经真实 WKWebView 跑出来。**helix 绿 = LoopForge 该 UC 的 ① 面有底气**，但 ②③④ 仍需 LoopForge 跑过才翻 ✅。

---

## 0.2 四面契约骨架（每个 UC 的断言模板）

> 与 `docs/uc-rollout/00-rollout-plan.md §0` + 竖切 `§2 四面契约` oracle 同构。四面期望文件是冻结契约（agent 只读）。

| 面 | 抓取点（port 装饰器 / 驱动）| 期望真源 | 一句话断言 |
|---|---|---|---|
| ① 出站 HTTP | `Transport`/Http 装饰器 | `真机curl真源.md` 逐字 body + full-map partials 各 UC `POST /api/cses/…` path/body | method+url+body 逐字对齐；camelCase；非 Pulsar 兜底；含 bodyForbidden 陷阱 |
| ① WS 推送（若有）| WsRecv 输入帧 | full-map partial 5（19 WS action 真源 + `event_seq` 注入铁律）| 触发的 WS action（`post`/`post_update`/`post_read`/…）+ 关键字段断言**当成断言记录在案** |
| ② 投影 envelope | `EventSink` 装饰器 | `projection-schema.md` §1 的 22 工厂 + §1.1-1.4 的 4 个非投影通道 | `im:*` channel + `data` 键集完全一致（缺/多即 fail）；message-row fat / channel-row thin / 透传三态 |
| ③ DOM（data-*）| WebdriverIO 读真 WKWebView | 竖切 `§4 DOM 契约` + 本台账每 UC 标注 data-* | 语义 DOM 节点 data-* 直映投影字段；tmp→server 覆写 / read-bits / send-status |
| ④ DB 落库行 | `Storage` 装饰器 / 查库 | `projection-schema.md §4` DB 列 + full-map partial 8 §6 表清单 | 命中表落行（`message` PK=temporary_id / `channel` / `channel_event_cursor` / `channel_member` / `todo`）+ cursor 单调不回退 |

> **红转绿只能改 helix 实现，不能改 oracle**（PRD User Story 7）。契约本身过时（go 真改 wire）→ 产「契约变更提案 + 证据」交人审（US-8）。

---

## 1. 域 A — posts（消息收发 / 历史 / 已读）

> 复用竖切机器度最高（认领 S/M）。① 出站锚 `真机curl真源 §1`（send body 全字段）。

### UC-1.1 发送文本/富文本消息 — `✅ four-facet-verified`（认领 S）

> **竖切本身，已实证全绿**（`docs/spec/send-message-vertical-slice.md`）。helix ledger 同条 ✅ e2e-verified（RAW WS action=`post` self-echo）。

- **① 出站 HTTP**：`POST /api/cses/posts/create`，body 逐字对齐 `真机curl真源 §1`——**全 camelCase + 必填集**：`{viewers:["all"], message, mentions:[], temporaryId, type:"TEXT", simpleMessage, channelId, userId, teamId, userSnapshot{...}, id:"", props:{}, topicId:"", revoke:false}`。**非 Pulsar 兜底**（body 不对 = Go 收下不推回声，真因 = 体不对）。响应 HTTP200。
- **① WS 推送**：action=**`post`**（**不是 `posted`**·真源 §1 用户明确）；self-echo 发送者自己连接会收（self-omit 已被 helix Round-3 证伪）；帧含 `temporaryId` + server `id` + `userId` + `event_seq`。
- **② 投影**：`im:post:received`（**fat**·`emit_post_received`）= `{channel_id, event_seq, msg_id, temporaryId, channelId, userId, type, message, props, createAt, updateAt, readBits, viewers}`（缺一字段即漂移·spec06 FixB）+ 乐观期 `im:post:sending` = `{channel_id, temporary_id}`。
- **③ DOM**：`<div data-msg-id data-temporary-id data-channel-id data-event-seq data-send-status data-read-bits>`；乐观插入 `data-msg-id=temporaryId` + `data-send-status=sending` → echo 覆写 `data-msg-id=server_id` + `data-send-status=sent` + 补 `data-event-seq`。
- **④ 落库**：`message` 表 1 行（PK=`temporary_id`，id=server_id，`read_bits` 预置）+ `channel_event_cursor` 推进（单调不回退）。

### UC-3.1 会话已读 — `⬜ pending`（认领 S/M）

- **① 出站 HTTP**：`POST /api/cses/channels/view`，body `{channels:[{id}]}`（待核·指向 full-map partial 6 UC-3.1）。
- **① WS 推送**：action=`post_read`，data.postId + readMap/readBits + seq（helix ledger UC-3.1 实证 readMap=100·seq=72）。
- **② 投影**：`im:post:read`（**fat**·同 `emit_post_received` 完整集）/ 离线路径 `im:channel:read_echo`（**fat**）。
- **③ DOM**：`data-read-bits`（self 位置 1）。
- **④ 落库**：`message.read_bits` 单调覆盖（**禁前端算 readBits**·projection-schema §3）。

### UC-3.2 单条已读 — `⬜ pending`（认领 S）

- **① 出站 HTTP**：`POST /api/cses/post/read`（待核·partial 6 UC-3.2）。
- **① WS 推送**：action=`post_read`，data.postId 命中（helix ledger UC-3.2 实证 seq=62）。
- **② 投影**：`im:post:read`（fat）。
- **③ DOM**：`data-read-bits`。
- **④ 落库**：`message.read_bits`。

### UC-3.3 模板已收到 — `⬜ pending`（认领 S）

- **① 出站 HTTP**：`POST /api/cses/post/templateReceived`（**`/post` 单数前缀**·camelCase `{postId, channelId}`·helix Round-3 c7a840c 修 casing）。
- **① WS 推送**：action=`post_update`，data.id 命中·`updateAt` bump·`updateBy=SYS`·**`props.template.userIds` 含 self userId**（Go 把我写进已收回执列表，helix ledger 实证）。
- **② 投影**：`emit_post_updated`（fat）/ 读族 `im:read:result`（待核 helix 走哪条）。
- **③ DOM**：`data-template-received`。
- **④ 落库**：`message`（props.template patch）。

### UC-1.2 发送 DOCUMENT 消息 — `⬜ pending`（认领 S）

- **① 出站 HTTP**：`POST /api/cses/posts/create`，同 UC-1.1 + `type:"DOCUMENT"`（**type 原样透传非降级 TEXT**·helix P1 修后实证·`send_build.rs` 读 cmd type 默认 TEXT/DOCUMENT 透传真值）+ `props.document`（待核）。
- **① WS 推送**：action=`post`，data.type=`DOCUMENT` 原样回声。
- **② 投影**：`im:post:received`（fat）+ data.type=DOCUMENT。
- **③ DOM**：同 UC-1.1 + `data-type=DOCUMENT`。
- **④ 落库**：`message`（type=DOCUMENT）。

### UC-1.4 重发失败消息 — `⬜ pending`（认领 S）

- **① 出站 HTTP**：`POST /api/cses/posts/create`，temporaryId 复用（重发 = 重走 posts/create·helix ledger 实证 RAW action=`post` self-echo 命中）。
- **① WS 推送**：action=`post`。
- **② 投影**：`im:post:sending` → `im:post:received`（fat）。
- **③ DOM**：`data-send-status: failed→sending→sent`。
- **④ 落库**：`message` upsert 覆盖（PK=temporary_id）。

### UC-1.5 撤回消息 — `⬜ pending`（认领 S，需先沉淀可读 post）

- **① 出站 HTTP**：`POST /api/cses/posts/revoke`，body `{postId}`（✅ helix 现状符合·`真机curl真源 §3`）。
- **① WS 推送**：action=`post_update`（在线）·data.revoke=true（helix ledger 标 data-dep：需先沉淀可读 post 再撤方能观测广播）。
- **② 投影**：`im:post:batch-updated`（在线·`{channel_id, posts}`）/ `im:post:deleted`（离线 fat·撤回 PostFields 稀疏→多空串）。
- **③ DOM**：`data-revoke=1` / 行移除。
- **④ 落库**：`message` mark_revoked（revoke=1）。

### UC-1.6 编辑消息 — `⛔ unreachable`（verified-not-a-capability·产品无此能力）

> **helix Round-5 真相调查定论**：**现网消息正文不可改·无编辑端点**（不是 wire-bug·helix 无命令可加）。
> ① 行为真源 cses-client `message-v3/service/claude.md:299` 明文「消息正文不可改」；UI「编辑」= `reEdit()` 回填输入框重发 + 定时消息取消重建（均非正文改）。
> ② Go 全 posts 路由无 posts/update·`CreateCsesPost→PreSave` 无 update 分支·`SavePostsBySend` CreateBulk 无 OnConflict → id 复用 = 重复 PK 冲突报错零推送。
> ③ helix e2e 复用 postId 再发实测**零 post/post_update 回声**。
> **LoopForge 处置**：标 ⛔ unreachable（目标端点根本不存在，testbed 无可触发的编辑链路）；rollout-plan 原 P4「编辑」条作废，不再列为可铺 UC。

### UC-1.7 转发/合并转发消息 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`POST /api/cses/posts/createPosts`（**双段复数**·camelCase `{posts:[<Post>], channelIds:[<id>]}`·`真机curl真源 附录A` 三方证据定论·✅ helix 现状一致）。
- **① WS 推送**：各目标 channel action=`post` 广播（helix ledger：host-cli 物理够不到 = harness-gap·HTTP200 为转发执行硬证）。
- **② 投影**：各目标 channel `im:post:received`（fat）。
- **③ DOM**：多 channel 消息行 data-msg-id。
- **④ 落库**：`message` ×N（每目标 channel 一行）。

### UC-1.8 快捷回复 emoji — `⬜ pending`（认领 S）

- **① 出站 HTTP**：`POST /api/cses/posts/quickReply`，body `{userId, postId, emoji}`（待核·partial 6 UC-1.8）。
- **① WS 推送**：action=`post_update`，data 带 `quickReply:[{emoji, userIds:[self]}]`（helix ledger 实证 emoji👍·userIds:[444]）。
- **② 投影**：`emit_post_updated`（fat）。
- **③ DOM**：`data-reactions`。
- **④ 落库**：`message.props`。

### UC-1.9 加急 + 加急已读 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`POST /api/cses/posts/urgentPost` / `posts/urgentConfirm`（待核·partial 6 UC-1.9）。
- **① WS 推送**：action=`post_update`，data 带 `expediteMap.recipients{...}` + sender（helix ledger 实证 recipients{555,678}+sender 444）。
- **② 投影**：`emit_post_updated`（fat·expedite 归一）。
- **③ DOM**：`data-urgent`。
- **④ 落库**：`message.props`（expedite）。

### UC-1.10 定时消息 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`POST /api/cses/posts/createSchedule` / `cancelSchedule` / `getSchedule`（待核·partial 6 UC-1.10）。
- **① WS 推送**：action=`post_schedule_created` + `post_schedule_canceled`（helix ledger 双回声命中）。
- **② 投影**：`emit_schedule_created` / `emit_schedule_canceled` = `{channelId, hasSchedulePost}`。
- **③ DOM**：`data-has-schedule`。
- **④ 落库**：`channel.has_schedule_post`。

### UC-2.1 切群首屏 — `⬜ pending`（认领 S，依赖发消息累积）

- **① 出站 HTTP**：本地优先 `im_query_messages_by_channel`（本地 Scan）/ too_long 兜底 `posts/getLatestPost`（待核·partial 8 http.rs:72 `{channelId}`）。
- **② 投影**：`im:messages:query_result`（`{channel_id, messages}`·`query::emit_message_query_result` 透传本地 DB 行）。
- **③ DOM**：N 个消息行 data-msg-id。
- **④ 落库**：Scan `message`（读路径，不写）。
- **注**：依赖 UC-2.2 的 accept 闸修复 — helix UC-2.2 揪出全 4 query 族命令经真命令路径不可达（见下）。

### UC-2.2 上拉更早历史 — `⬜ pending`（认领 M）🔴 **helix 侧 wire-bug 待修**

> **helix ledger 当前唯一 wire-bug**：`acl/from_tick.rs::accepts_tick` Command 臂漏 `query::is_query()`·
> `im_load_older_context` 经真命令路径 accept()==false **静默丢弃**·拖累全 4 query 族命令（load_older/query_messages/query_dialog/delete_all_dialogs）不可达。
> 修 = Command 臂补 `|| crate::query::is_query(name)`。**LoopForge ① 面要等 helix 此修复才能验**。

- **① 出站 HTTP**：多轮 `posts/postContext`，body `{postId, before}`（待核·partial 8 http.rs:89·moving anchor ≤8 轮）。
- **② 投影**：`im:messages:older_loaded`（§1.3 透传·`{channelId, messages, hasMore}`·messages=严格更早 wire Post 升序数组）。
- **③ DOM**：prepend 更早消息行。
- **④ 落库**：`message` upsert prepend。

### UC-2.3 按 postId 定位 — `⬜ pending`（认领 S）

- **① 出站 HTTP**：`posts/getPostsAfterIndex`，body `{postIds:postId}`（待核·partial 6 UC-2.3）。
- **② 投影**：`im:messages:query_result`（透传）。
- **③ DOM**：`data-msg-id` 命中高亮。
- **④ 落库**：Scan `message`。

### UC-2.4 一级/二级回复 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`posts/getReplies` / `posts/getReplyBranch`（待核·partial 6 UC-2.4）。
- **② 投影**：`im:read:result`（读族透传·§1.2 `{req_id, body}`）。
- **③ DOM**：回复抽屉 `data-reply-id`。
- **④ 落库**：Scan `message`（回复链）。

### UC-1.3 发送图片/文件 — `⛔ unreachable`（物理够不到·需真上传管线）

> **物理够不到**：host-cli/testbed 无文件上传 / `processMessageFiles` 上传管线·无法构造 multipart/文件预处理链。
> 物理文件选择 + 上传进度链需真实文件系统 + 上传服务；golden-tape 只录 WS/HTTP 帧不录文件 IO。
> posts/create 底层路径已由 UC-1.1/1.2/1.4 post 回声**间接验证**；UI 上传链路需真前端 e2e（真 go 夜间按需）。
> 参照 helix ledger UC-1.3 同标注法。④ DB 落 message 可测，但 ① 上传 hop 不可确定性回放 → 整 UC 标 ⛔。

---

## 2. 域 B — channel/sync（离线同步 / 频道管理）

> 认领需 increment 就绪 probe（M）。① 出站锚 `真机curl真源 §4/§6` + full-map partial 8 sync wire 契约。

### UC-4.1 hello 根群全量增量 — `⬜ pending`（认领 M·就绪 probe 锚点）

- **① 出站 HTTP**：WS hello 自动 / `channels/load/increment`，body `{timestamp, cursors:[{channelId, fromSeq}]}`（待核·partial 8 http.rs:25）。
- **① WS 推送**：hello + channels + `increment_channel`（data 携 `lastEventSeq`·helix ledger 实证真推）+ `increment_channel_end`（批次结束·就绪 probe 锚）。
- **② 投影**：`emit_channels_loaded`（`{items}`）+ `emit_channel_increment`（`{channel_id, increment}`）+ `emit_channel_update`（`{channel_id}`·thin·批次结束触发）。
- **③ DOM**：`data-ready` 标志 + channel 行。
- **④ 落库**：`channel` + `channel_event_cursor`。

### UC-4.2 按需 sync notify — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`channel/sync/notify`，body `{cursors:[{channelId, fromSeq}]}`（camel·SyncEntryKind snake·待核 partial 8 §2.1·helix ledger 实证 needSync=true 真帧）。
- **② 投影**：`emit_post_received`/`updated`/`deleted` + `emit_channel_update_by_post`（thin·`{channel_id, event_seq, msg_id}`）。
- **③ DOM**：增量消息行 + badge。
- **④ 落库**：`message` + cursor 跳空洞。

### UC-4.5 独立窗口陌生 channel 兜底 — `🟡 partial`（认领 M·WS 自动注册主路径已 helix 独立证）

- **① 出站 HTTP**：`ensure_channel_loaded` → `channel/load/incrementByChannelId`，body `{channelId}`（待核·partial 8 http.rs:47·helix ledger：HTTP 读 → im:read:result relay 在非 info 级 LOG 未显式可见·子项 data-dep）。
- **① WS 推送**：`increment_channel` 命中本地未知 channel → `entry().or_insert_with(Channel::new(_,0))` 自动注册（helix ledger 实证 73 帧 increment 全自动注册·入站=emit=73 零丢·主路径已独立证）。
- **② 投影**：`emit_channel_increment`（`{channel_id, increment}`）。
- **③ DOM**：单 channel 增量渲染。
- **④ 落库**：`channel`（自动注册行）+ cursor。

### UC-5.1 创建群聊 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`POST /api/cses/channel/create`，body 锚 `真机curl真源 §4`——`{teamId, displayName, orient:"", type:"P", users:[{id,teamId,role}]（自己 CREATOR + 他人 MEMBER）, picturetype:"USER", picture:{userIds}, forceCreate:true}`。
- **① WS 推送**：action=`channel_created`（type:P·data.id 命中·helix ledger 实证）+ `channel_member_update` + `post`。
- **② 投影**：`emit_channel_created`（`{channel_id, channel}`·透传帧 channel 对象）。
- **③ DOM**：`data-channel-id` 新行。
- **④ 落库**：`channel` 新行。

### UC-5.2 创建话题 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`POST /api/cses/posts/makeTopic`，body 锚 `真机curl真源 §2`——`{rootId, teamId, postId, displayName, type:"T", users:[{id,role:CREATOR/MEMBER,teamId}], picturetype:"USER", picture:{userIds}, forceCreate:true}`（头带 `Cses-Track-Id`）。
- **① WS 推送**：action=`channel_created`（type:T·displayName·rootId 关联·helix ledger 实证）+ `post_update` 旁推。
- **② 投影**：`emit_channel_created`（type=T）。
- **③ DOM**：`data-channel-id`（topic）。
- **④ 落库**：`channel`（type=T）。

### UC-5.3 关闭/退出群 — `🟡 partial`（认领 M·主动作 self 收·member-leave 广播子项 ⛔）

- **① 出站 HTTP**：`POST /api/cses/channel/close`，body `{channelId}`（✅ helix 现状符合·`真机curl真源 §6`）/ 退群走 `channel/member/change` leaveUsers（待核映射·真源 §5）。
- **① WS 推送**：action=`channel_close`（self 收·helix ledger 实证）·member-leave 广播给被增减目标（**非 self = broadcast-dep 子项·单账号 ⛔**）。
- **② 投影**：`emit_channel_closed`（`{channelId, deleteAt}`）。
- **③ DOM**：channel 行移除。
- **④ 落库**：`channel` 软删。

### UC-5.4 群属性修改 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`channel/change/{displayName,notice,purpose,orient,permission,top}` / `member/change/notify`（待核·partial 6 UC-5.4）。
- **① WS 推送**：改名简介 → action=`update_channel`（全频道对象刷新）·改公告 → action=`update_channel_notice`（content.text 逐字·helix ledger 实证 marker 窗内归因）。
- **② 投影**：`emit_channel_update`（thin·`{channel_id}`·channel-row 故意留瘦）。
- **③ DOM**：`data-channel-*` 回读刷新（batch 结束低频回读）。
- **④ 落库**：`channel` patch 列。

### UC-5.5 置顶 — `🟡 partial`（频道置顶可证·消息置顶 ⛔ data-dep）

- **① 出站 HTTP**：频道置顶 `channel/change/top`（change_top）·消息置顶 `channel/add/postPinned` / `remove/postPinned` / `load/postPinned`（待核·partial 6 UC-5.5）。
- **① WS 推送**：频道置顶 → action=`update_channel`（channelIsTop:true·userId·per-member 定向·helix ledger 实证）·消息置顶 → pin 回声依赖 Go 落库后投影（**host-cli/testbed 物理够不到·全 log `*pin*` action=0·⛔ data-dep**）。
- **② 投影**：`emit_channel_update`（频道置顶）/ `query::emit_read_result`（消息置顶读族）。
- **③ DOM**：`data-pinned`。
- **④ 落库**：`channel` / `message.props`。

### UC-5.6 群公告 — `⛔ unreachable`（data-dep·回声不可观测）

> **物理够不到**：`post/announcement/{list,save,delete,read}` body verbatim 出站已发·窗内仅 increment 洪泛无公告专属 WS 帧·announcement/list 读族走 HTTP sync reply 不产 WS push·testbed 不打印 HTTP status → 回声不可观测（helix ledger 同标 data-dep）。
> **② 投影**：`query::emit_read_result`（读族透传）；**③ DOM**：`data-announcement`；**④ 落库**：`message`（公告）。读族 reply 可在 ②④ 间接证，但 ① WS 回声面够不到 → 整 UC 不计绿。

### UC-5.7 在线状态/分组 — `⛔ unreachable`（后端真阻塞·P1-2）

> **后端真阻塞缺失**：`users/status/ids`（缺口矩阵 P1-2）依赖 mattermost statusCache·迁移裁决前不能红转绿（改契约才能过 = 违护栏）。`channel/onlineStatus` / `modules/getAll`（待核·partial 6 UC-5.7·helix ledger status_change 真帧已观测但 status app 层 goBlocked）。后端裁决迁移前标 ⛔。

### UC-4.3 too_long 重拉 — `⛔ unreachable`（harness-gap·触发态够不到）

> **物理/数据够不到（非 wire-bug·代码侧实现完整有单测）**：testbed 无「注入本地落后 cursor」入口·冷启动 cursor=0 走 increment 不进 too_long 分支·也无法把本地 cursor 顶到远落后服务端 seq 的态（helix ledger 同标 harness-gap）。
> **② 投影**：`emit_sync_too_long`（`{channelId, resetTo}`·channel.rs:223 emit / module.rs:760 清表·由 helix-im 单测覆盖）；**③ DOM**：清表重渲首屏；**④ 落库**：`message` 清+重拉·cursor=resetTo-1。e2e 触发态待 testbed 加注入入口或服务端构造超阈 gap。

### UC-4.4 心跳 gap 补偿 — `🟡 partial`（认领 D·③ DOM 物理不可达·纯 Rust 自驱）

> **纯 Rust ping/pong 自驱**（8s piggyback）·无前端 invoke 触发·无独立 DOM → ③ 面物理不可达（helix ledger ✅ 但属服务端 wire 视角·LoopForge 客户端四面只能 ①②④ + cursor 不变量 + 间接证）。

- **① 出站**：ping piggyback `{cursors, allHash}`（FNV-1a 锚定向量·待核 partial 8 §5.7）·**出站 ping 帧体 host 不落日志** → 以服务端 pong 回声 `seq_reply` 锚定为往返证据（helix ledger 实证 seq_reply 逐一锚定 ping seq）。
- **① WS 推送**：pong `{status:OK, seq_reply, data:{gaps, hashMismatch}}`（hashMismatch:true 触发全量根群对账补偿）。
- **② 投影**：补偿走 sync 投影（§UC-4.2）·无独立投影。
- **③ DOM**：N/A（间接·靠 `all_hash` 锚定向量 + 补偿后 sync 投影间接证）。
- **④ 落库**：`channel_event_cursor`。

---

## 3. 域 C — user-misc（成员管理 / 搜索 / 待办 / 书签）

> 认领 M。① 出站锚 `真机curl真源 §5`（member change）+ full-map partial 6。

### UC-6.1 拉/踢人 — `🟡 partial`（认领 M·留存成员 RX 需双连接）

- **① 出站 HTTP**：`POST /api/cses/channel/member/change`，body 锚 `真机curl真源 §5`——`{channelId, joinUsers:[{id,teamId,role}]}` 加人 / `{channelId, leaveUsers:[...]}` 踢人（两者可同时非 nil·**新 endpoint·不是 member/leave**）。
- **① WS 推送**：留存成员 RX 收 action=`post` props.type=`leave` users:[{id}] operator + event_seq（helix ledger 实证 444 踢 555·留存 678 第二连接收·Go 把成员变更广播为 type=leave 的 post·**留存成员确收 = 需第二连接·单 testbed 子项**）。
- **② 投影**：`emit_channel_member_updated`（`{channel_id, channel}`·透传帧 channel 对象）。
- **③ DOM**：`data-members` 回读。
- **④ 落库**：`channel_member`。

### UC-6.2 设/撤管理员 — `🟡 partial`（member_role 可证·add_manger 次路径 ⛔ data-dep）

- **① 出站 HTTP**：`channel/add/manger` / `remove/manger`（待核·partial 6 UC-6.2）。
- **① WS 推送**：action=`channel_member_role_updated`，data `{role:ADMIN, userIds:[...]}` 逐字（broadcast 到 channelId·操作者收·helix ledger 实证 678→ADMIN）·add_manger 次路径（窗内仅 increment 洪泛无独立 echo·**⛔ data-dep**）。
- **② 投影**：`emit_channel_member_updated` / `emit_channel_update`。
- **③ DOM**：`data-admin`。
- **④ 落库**：`channel_member`。

### UC-6.3 改群昵称 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`channel/member/change/nickname`（待核·partial 6 UC-6.3）。
- **① WS 推送**：action=`update_channel_member_nickName`（camelN·data.channelId 命中·helix ledger 实证）。
- **② 投影**：`emit_member_nickname`（`{channelId, userId, nickName}`）。
- **③ DOM**：`data-nickname`。
- **④ 落库**：`channel_member`。

### UC-6.4 成员快照/全量 — `⬜ pending`（认领 M）

- **① 出站 HTTP**：`channel/member/snapshot` / `channels/member/byIds`（待核·partial 6 UC-6.4·helix ledger 直连 curl POST /channel/member/snapshot HTTP200 data[{userIds:[444,678,555]}]）。
- **① WS 推送**：`channel_created` 携 `memberChange.join` 全员快照（helix ledger 实证）。
- **② 投影**：`query::emit_read_result`（读族·helix ledger emit im:read:result bytes=155 OutboundReadReply 透传回灌）。
- **③ DOM**：`data-member-count`。
- **④ 落库**：`channel_member` 自愈覆盖。

### UC-9.x 书签 — `⬜ pending`（认领 M·读族三命令）

- **① 出站 HTTP**：`post/bookmark/{create,delete,load}`——create `{channelId, userId, postIds:[postId]}` / load `PageOpts 扁平 camelCase` / delete `{userId, postId}`（待核·partial 6 集合九·helix ledger 独立 curl HTTP200 SUCCESS 真落库往返双证）。
- **② 投影**：`query::emit_read_result`（读族透传·helix ledger create bytes=101 / load bytes=679 含真书签列表 / delete bytes=98 + re-load 空证真删）。
- **③ DOM**：`data-bookmark`。
- **④ 落库**：`message`（书签·真落库非橡皮章）。

### UC-10.1 待办列表 — `⬜ pending`（认领 M·hello 收尾自驱）

- **① 出站 HTTP**：（hello 收尾自驱·非前端命令）`posts/queryTodoList`（待核·partial 8 http.rs:67·global `increment_channel_end` 触发·helix ledger 实证 hello 收尾触发 queryTodoList）。
- **② 投影**：`todo::emit_todo_updated`（§1.4·`{items:[{id, channel, post, type, canDel}]}`·**禁裸数组**·helix ledger emit bytes=226447·反证空信封仅 47B → 真装配非空 items）。
- **③ DOM**：`data-todo` 列表。
- **④ 落库**：`todo` 表。

### UC-7.x 搜索（全局/会话/分类）— `⛔ unreachable`（后端真阻塞·P2-1）

> **后端真阻塞缺失**：`Im/search/{global,searchByChannel,…}`（走 api 非 imHttp·缺口矩阵 P2-1）app 层全空桩恒返空 + data 形态偏离源。后端裁决迁移前标 ⛔（不能红转绿·改契约才能过 = 违护栏）。helix fullmap-coverage.sh 亦排除 search 集合七。
> **② 投影**：`query::emit_read_result`（读族）；**③ DOM**：`data-search-result`；**④ 落库**：（ES 透传无落库）。

---

## 4. 域 D — bot-agent / 互动卡片

> 最低优先级（依赖外部接通 / 非 message-v3 主链）。投票/平均分走 api（第二网关 :3399）。

### UC-8.x 投票 CRUD — `🟡 partial`（average/read 可证·vote/readVote ⛔ data-dep）

- **① 出站 HTTP**：`vote/{createVote,vote,readVote,closeVote,deleteVote}` / `average/{publish,attend,read,close,delete}`（走 api·第二网关 :3399·待核 partial 6 集合八）。
- **① WS 推送**：average/read 读族（helix ledger ✅·im:read:result 回灌·身份头+session 通过到 :3399）·vote/readVote（REQ 达 :3399·身份头通过非 401·**HTTP500 与直 curl ground-truth 一致 = 坏 id 恒 500·需真 vote id 方见 200·⛔ data-dep**）。
- **② 投影**：`emit_post_updated`（fat·投票卡）/ `query::emit_read_result`（读族·helix ledger bytes=190 对齐响应）。
- **③ DOM**：`data-vote` / `data-average`。
- **④ 落库**：`message.props`（vote/average 卡）。

### UC-10.2 系统通知 — `⬜ pending`（认领 M）

- **① 出站**：（WS 帧触发·无独立 HTTP）。
- **① WS 推送**：系统消息帧（messageType=SYSTEM·**注意 SYSTEN 拼写陷阱保真透传**·projection-schema §6）。
- **② 投影**：`emit_post_received`/`updated`（系统消息）。
- **③ DOM**：`data-system-notice`。
- **④ 落库**：`message`（SYSTEM/SYSTEN 类型）。

### bot / agent 召唤 — `⛔ unreachable`（后端真阻塞·P1-3·客户端无 service 方法）

> **物理够不到 + 后端真阻塞**：message-v3 service 层无独立 bot 端点（客户端无对应 invoke）·`BotAgentWebhookEvent` Pulsar fanout（缺口矩阵 P1-3）未接。客户端侧无用例 → 整域标 ⛔（如需覆盖从服务端 csesapi 侧梳理·超 testbed 范围）。

---

## 5. 物理够不到 / 后端真阻塞汇总（⛔ 理由逐条记账）

| UC | ⛔ 原因 | 缺口矩阵 / 真源 | 与 helix ledger 对照 |
|---|---|---|---|
| UC-1.3 发图片/文件 | 物理文件选择 + 上传进度链需真上传管线·golden-tape 不录文件 IO | （物理限制）| helix ledger UC-1.3 ⬜ untested 同标 |
| UC-1.6 编辑 | 现网消息正文不可改·无编辑端点（产品无此能力）| cses-client claude.md:299 + Go 无 posts/update 路由 | helix ledger ✅ verified-not-a-capability |
| UC-4.3 too_long 重拉 | testbed 无注入落后 cursor 入口·触发态够不到（代码侧完整有单测）| harness-gap | helix ledger ⬜ harness-gap 同标 |
| UC-5.6 群公告 | 读族 reply 走 HTTP 不产 WS push·testbed 不打印 HTTP status 回声不可观测 | data-dep | helix ledger ⏭ data-dep |
| UC-5.7 在线状态 | `users/status/ids` 依赖 mattermost statusCache·后端真阻塞 | 矩阵 P1-2 | status goBlocked |
| UC-7.x 搜索 | `Im/search/*` app 层空桩恒返空 + 形态偏离·后端真阻塞 | 矩阵 P2-1 | helix fullmap 排除集合七 |
| bot/agent 召唤 | 客户端无 service 方法·`BotAgentWebhookEvent` Pulsar fanout 未接 | 矩阵 P1-3 | — |
| 广播类子项（拉踢留存收 / close member-leave / 消息置顶 / vote 真 id / add_manger）| 单 testbed 单账号·跨账号广播需第二真实连接 / 依赖 Go 落库后投影 | 认领难度 D | helix ledger 多标 broadcast-dep / data-dep |

---

## 6. 覆盖率统计 + scripts 接口

### 当前计数（2026-06-24·本台账初版）

> 分母 = 39 invoke-driven UC（域 A 17 + B 12 + C 7 + D 3）；bot/agent 召唤是「整域 ⛔」不计入 39 分母（单列）。

| 域 | UC 条目 | `✅ four-facet-verified` | `🟡 partial` | `⬜ pending` | `⛔ unreachable` |
|---|---|---|---|---|---|
| A posts（收发/历史/已读）| 17 | **1**（1.1）| 0 | 14 | 2（1.3 文件 / 1.6 编辑）|
| B channel/sync（同步/频道管理）| 12 | 0 | 4（4.4 / 4.5 / 5.3 / 5.5）| 5（4.1 / 4.2 / 5.1 / 5.2 / 5.4）| 3（4.3 / 5.6 / 5.7）|
| C user-misc（成员/搜索/待办/书签）| 7 | 0 | 2（6.1 / 6.2）| 4（6.3 / 6.4 / 9.x / 10.1）| 1（7.x 搜索）|
| D bot-agent / 互动卡片 | 3 | 0 | 1（8.x）| 1（10.2）| 1（8.x vote 子项归 8.x partial 母项·不单计）+ — |
| **合计（39 分母）** | **39** | **1** | **7** | **24** | **7** |
| bot/agent 召唤（整域，不计入 39）| 1 域 | — | — | — | 1 域（⛔）|

> 精确分类（按本台账每节标题图例为准·1+7+24+7=39）：
> - **✅ four-facet-verified = 1**：UC-1.1。
> - **🟡 partial = 7**：UC-4.4 心跳 / UC-4.5 陌生 channel / UC-5.3 关群 / UC-5.5 置顶 / UC-6.1 拉踢 / UC-6.2 管理员 / UC-8.x 投票平均分。
> - **⬜ pending = 24**：3.1 / 3.2 / 3.3 / 1.2 / 1.4 / 1.5 / 1.7 / 1.8 / 1.9 / 1.10 / 2.1 / 2.2 / 2.3 / 2.4 / 4.1 / 4.2 / 5.1 / 5.2 / 5.4 / 6.3 / 6.4 / 9.x / 10.1 / 10.2（注：UC-2.2 ① 面 blocked on helix wire-bug 修复，仍列 pending）。
> - **⛔ unreachable = 7**（39 分母内）：UC-1.3 文件 / UC-1.6 编辑 / UC-4.3 too_long / UC-5.6 公告 / UC-5.7 在线 / UC-7.x 搜索·另 bot/agent 整域 ⛔（不计入 39 分母）。

> ⚠️ **诚实声明**：全 39 UC 中唯一经真 Tauri+WKWebView 四面 oracle 跑绿的是 **UC-1.1**。`🟡 partial` 表示 helix ledger 已证服务端 wire 但 LoopForge 客户端四面尚未实跑（标 partial 是为标记「有可证主路径 + 部分子项物理够不到」，**不等于 LoopForge 已验**）。rollout 实跑前，唯一 ✅ 的就是 UC-1.1。

### scripts 接口（仿 helix `fullmap-coverage.sh` 思路·留接口注释·不真写脚本）

```bash
# 未来 scripts/uc-coverage.sh（仿 helix/scripts/fullmap-coverage.sh）读本台账算客户端四面覆盖率：
#   verified = grep -c '✅ four-facet-verified' docs/uc-coverage-ledger.md   # 节标题图例
#   total    = 39（域 A 17 + B 12 + C 7 + D 3·bot 域不计入分母）
#   unreachable = grep -c '⛔ unreachable' （从分母剔除·诚实，不计入"绿台账"分母）
#   reachable_total = total - unreachable  # 真正可达的 UC 数（算覆盖率分母）
#   coverage = verified / reachable_total
#   退出码：0 = reachable 全绿（可判 rollout DONE）/ 1 = 未全绿（rollout 续）/ 2 = 台账格式异常
# 与 helix fullmap-coverage.sh 的区别：helix 算「服务端 wire e2e」覆盖；本脚本算「客户端四面 e2e」覆盖。
```

---

## 7. 维护铁律

- **只翻 ✅ 当真跑过四面 oracle 全绿**：LoopForge `run.sh` 真 Tauri+WKWebView 跑过 + reducer 报告无断点 + 四面期望文件全 match。不虚标。
- **契约引用不自编**：① 锚 `真机curl真源.md` / ② 锚 `projection-schema.md` / ④ 锚 projection-schema §4 DB 列。拿不准的标「待核·指向 helix 真源 X」，不臆造 wire 字段。
- **⛔ 诚实记账**：物理够不到 / 后端真阻塞逐条记理由（§5 表），从覆盖率分母剔除，不计入绿台账。
- **每铺一个 UC 验绿 → 翻图例 + 更新 §6 计数表**；新增 UC → 加一节 + §6 加一行。
- **本台账与 helix ledger 不打架**：两者共享 wire 契约，helix ledger = 服务端 wire 视角，本台账 = 客户端四面视角；helix ✅ ≠ 本台账 ✅（本台账还要再证投影/DOM/落库后三面）。
</content>
</invoke>

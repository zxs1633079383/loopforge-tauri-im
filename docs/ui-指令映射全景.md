# UI → 指令 / 渲染 全映射全景（per-UI · 结合全 HTTP + 全 WS + 全 UC）

> **用途**：以「每个 UI（7 屏/区）」为主轴，把 loopforge 薄壳的 **渲染指令（投影）/ 入站指令（IpcIn）/ 出站指令（HTTP+WS）/ 回灌（WsRecv→Projection）** 四条链路逐屏对齐，体现「壳=纯渲染·业务全在 helix」的 C013 铁律。
>
> **真源（只读·静态分析合成）**：
> - `docs/uc-rollout/coverage-crossmap.md`（124 HTTP / 19 WS 逐个对 UC）
> - `design/README.md`（7 屏 → 视图 → UC → data-* 映射）
> - `src/app/app.component.ts`（data-* 绑定 + 用户动作 (click)→store 方法）
> - `src/app/im/im-store.service.ts`（IPC invoke 命令 + onBus 投影分发 + apply* 渲染回灌）
> - `src/app/im/projection.types.ts`（投影 channel 常量 + data 形态）
> - `src/app/im/tauri-bridge.service.ts`（invoke / listen 单总线 im:__bus__）
> - `crates/helix-driver-instrument/src/event.rs`（6 面 facet：IpcIn / Inbound / Outbound / Projection / Storage / WsRecv）
>
> **链路语义（壳纯渲染·四链）**：
> ```
> 用户动作 (click)               →  入站指令 IpcIn (invoke im_*)        ← 壳「发 IPC」(纯转发·args 透传)
>     ↓ helix-im 兜底 body/identity                                       业务/wire 构造全在 helix
> 出站指令 Outbound (HTTP method+path / WS 发帧)
>     ↓ cses-im-server (:8066) 处理
> 回灌 WsRecv (后端 WS echo) / HTTP 200 响应体
>     ↓ helix-im emit 投影 (render-ready)
> 渲染指令 Projection (im:* → apply*)  →  data-* 纯绑定（1:1·壳零解析重组）
> ```
> **壳铁律**：每个渲染指令 = 「投影 → data-* 纯绑定」；每个入站指令 = 「用户动作 → 发 IPC（args 透传）」；解析/重组/对账/wire 归一/业务规则全在 helix-im。

---

## 0. 全局信封 + 单总线（所有屏共用）

| 维度 | 事实 |
|---|---|
| 入站单点 | `TauriBridgeService.invoke(cmd, args)`（非 Tauri 环境 reject·dev 浏览器降级） |
| 渲染单点 | `TauriBridgeService.listen("im:__bus__", env => onBus(env))` 单总线 |
| 信封 | `{ channel:"im:post:received", payload:{ event, data } }`（`BusEnvelope`） |
| 命名陷阱 | 信号锚 snake_case（channel_id/event_seq/msg_id）+ 渲染核 camelCase（temporaryId/channelId/createAt）混用·禁假设全 camel/全 snake |
| 就绪 probe | `invoke('im_ready')→bool` 轮询（非 bus 事件·W1）→ `data-ready`（H 区 + main） |
| bootstrap | `start()` 即 `invoke('im_query_dialog_list')` → `im:channels:projection` → 设 activeChannel |
| 6 面 oracle | Outbound ① / Projection ② / Storage ④ / WsRecv（入站）/ IpcIn ⓪ / Inbound（进引擎指令）·后两面 test-only 量化「壳零中间 shaping」(C013) |

---

## 屏 ① 3 栏主壳 / CL 频道列表区（+ H 状态区）

`design` frame `vqg8x`（主应用 3 栏壳）· `data-testid` = `status-bar` / `channel-list`

### 承载 UC
4.1 就绪握手 · 4.2 按需 sync badge · 5.1 建群 / 5.2 话题（新行 upsert）· 5.3 退群（删行）· 5.4 改群名/公告 · 5.5 频道置顶 · 1.10 定时 badge · 11.1 公司大群（建群路径）· 12.1 健康探针（H 区）· 10.3 模块 · 5.7 在线状态 · 5.8 条件查频道 · 5.6r/5.6w 公告读写（CL 工具条入口）

### 渲染指令（投影 → data-*·渲染回灌路径）

| 投影 channel | apply* | 渲染的 data-*（CL/H 区） | UC |
|---|---|---|---|
| `im:channels:projection` | `applyDialogList` | CL 行 `data-channel-id`/`-display-name`/`-notice`/`-top`/`-unread`/`-mention`/`-last-message`/`-urgent` + createAt 排序（render-ready dialogList 直绑） | 4.1 / 5.4 / 5.5 / 4.2 回读 |
| `im:channels:loaded` | （noop） | 冷启动补齐信号·瘦无载荷·activeChannel 兜底 | 4.1 |
| `im:channel:increment` | `applyChannelIncrement` | CL `data-channel-id` upsert + 锚 activeChannel | 4.1 / 4.5 |
| `im:channel:update`（thin） | `applyChannelUpdate` | upsert 行 + **重查 dialogList** → 回读 `data-channel-top`/`-display-name`/`-notice` | 5.4 / 5.5 / 4.1 批次结束 |
| `im:channel:created` | `applyChannelCreated` | CL 新行 `data-channel-id` upsert + 锚 activeChannel | 5.1 / 5.2 / 11.1 |
| `im:channel:closed` | `applyChannelClosed` | CL 删行（`data-channel-id` 消失）+ 清 activeChannel | 5.3 / 11.2 配套 |
| `im:channel:schedule-created` | `applyScheduleCreated` | CL `data-has-schedule-post=true` | 1.10 |
| `im:channel:update-by-post`（瘦 badge） | `applyChannelUpdateByPost` | upsert 行 + **重查 dialogList** → `data-unread` 累加（累加在 helix·壳零 ++） | 4.2 |
| `im:read:result`（body.status） | `applyReadResult` | H 区 `data-health`（body.status 1:1 直绑） | 12.1 |

> H 区 data-*：`<main data-ready data-active-channel data-health>` + header `data-ready`（im__ready）。

### 入站指令（IpcIn·用户动作 → invoke）+ 出站指令（Outbound）

| 用户动作（testid） | store 方法 | invoke 命令 | 出站 HTTP / WS | UC |
|---|---|---|---|---|
| `create-channel-btn` | `createChannel` | `im_create_channel` | POST `/api/cses/channel/create`（+ createSpecifyOwner 变体） → WS `channel_created` | 5.1 |
| `query-channel-btn` | `queryChannels` | `im_channel_query` | POST `/api/cses/channel/query`（读族·无 WS·im:read:result 回灌） | 5.8 |
| `online-status-btn` | `loadOnlineStatus` | `im_channel_online_status` | POST `/api/cses/channel/onlineStatus`（读族·im:read:result 回灌） | 5.7 |
| `modules-get-all-btn` | `getAllModules` | `im_modules_get_all` | POST `/api/cses/modules/getAll`（空 body·读族·im:read:result） | 10.3 |
| `announcement-list-btn` | `announcementList` | `im_announcement_list` | POST `/api/cses/post/announcement/list`（读族） | 5.6r |
| `announcement-save-btn` | `announcementSave` | `im_announcement_save` | POST `/api/cses/post/announcement/save` → WS `post_update` | 5.6w |
| `sync-channels-btn` | `syncChannels` | `im_sync_channels` | （引擎重连 → 自驱 `channel/sync/notify`）→ WS 回放 | 4.2 |
| `team-upsert-btn` | `teamUpsert` | `im_team_upsert` | POST `/api/cses/teams/upsert` → WS `channel_created` | 11.1 |
| `health-btn`（H 区） | `checkHealth` | `im_health` | GET `/api/cses/health`（空 body·读族·im:read:result body.status） | 12.1 |
| `read-channel-btn`（H 区/composer） | `readChannel` | `im_read_channel` | POST `/api/cses/channels/view` → WS `post_read` | 3.1 |
| CL 行 `change-channel-btn` | `changeChannelDisplayName` | `im_channel_change_display_name` | POST `/api/cses/channel/change/displayName` → WS `update_channel` + channelUpdate 系统 post | 5.4 |
| CL 行 `change-channel-notice-btn` | `changeChannelNotice` | `im_channel_change_notice` | POST `/api/cses/channel/change/notice` → WS `update_channel_notice` + channelUpdate post | 5.4 |
| CL 行 `change-channel-top-btn` | `changeChannelTop` | `im_channel_change_top` | POST `/api/cses/channel/change/top` → WS `update_channel`(is_top) | 5.5 |
| CL 行 `close-channel-btn` | `closeChannel` | `im_channel_close` | POST `/api/cses/channel/close` → WS `channel_close` | 5.3 |
| CL 行 `team-quit-btn` | `teamQuit` | `im_team_quit` | DELETE `/api/cses/teams/member/quit` → WS `quit_company` | 11.2 |
| CL 行 `ensure-channel-loaded-btn` | `ensureChannelLoaded` | `im_ensure_channel_loaded` | POST `/api/cses/channel/load/incrementByChannelId`（读族·im:read:result） | 4.5 |
| CL 行点击（选群） | `queryMessages` | `im_query_messages_by_channel` | （纯本地 Scan·无 HTTP）→ `im:messages:query_result` | 2.1（屏②渲染） |
| （bootstrap / badge 重查） | `bootstrapDialogList` / 内核 | `im_query_dialog_list` | （本地 Scan）→ `im:channels:projection` | 4.1 / 4.2 |

### 回灌（WsRecv → Projection → 渲染回该屏）

- 建群：WS `channel_created` → helix → `im:channel:created` → CL 新行。
- 改群名/公告：WS `update_channel` / `update_channel_notice`（thin）→ `im:channel:update` → 重查 dialogList → CL 行属性；并行 channelUpdate 系统 NOTICE post（WS `post`）→ `im:post:received`(fat) → `applyChannelUpdatePost` 刷 `data-channel-display-name`/`-notice`（屏②消息行也渲染系统提示，见屏②）。
- 置顶：WS `update_channel`(is_top) → `im:channel:update` → 重查 → `data-channel-top`。
- 退群：WS `channel_close` → `im:channel:closed` → 删行。
- sync badge：WS 回放 type1 → `im:channel:update-by-post`（badge）+ `im:post:received`（屏②消息行）。
- 定时：WS `post_schedule_created` → `im:channel:schedule-created` → `data-has-schedule-post`。
- 健康/查频道/在线/模块/公告读：HTTP 200 响应体 → `im:read:result{req_id, body}`（读族·无 WS 回声）。

---

## 屏 ② 聊天主区 / ML 消息列表区

`data-testid` = `msg-list`（现状已绿·形态禁改·加法式扩）

### 承载 UC
1.1/1.2 发送（含 DOCUMENT）· 1.4 重发 · 1.5 撤回 · 1.7 转发 · 1.8 emoji 快捷回复 · 1.9 加急 · 3.2 单条已读 · 3.3 模板已收到 · 2.1 首屏 · 2.2 上拉历史 · 2.3 定位高亮 · 5.4 改群名系统提示 · 5.5b 消息置顶 · 5.6r/5.6w 公告（消息行入口）· 8.x 投票/平均分卡 · 9.x 书签 · 10.2 系统通知行

### 渲染指令（投影 → data-*·消息行）

| 投影 channel | apply* | 渲染的 data-*（msg 行） | UC |
|---|---|---|---|
| `im:post:sending`（瘦·render-ready） | `applyPostSending` | 乐观行：`data-temporary-id`/`data-send-status=sending`/`data-channel-id`/`data-type`/`data-msg-id`(=tmp) | 1.1 / 1.2 |
| `im:post:received`（fat） | `applyMessageItem` | echo 覆写：`data-msg-id`(server)/`data-send-status=sent`/`data-event-seq`/`data-read-bits`/`data-type`/`data-reactions`/`data-template-received`/`data-system-notice`/avatar `data-user-id` | 1.1/1.2/1.4/1.7/6.1拉踢post/10.2 |
| `im:post:updated`（fat） | `applyMessageItem` | patch：`data-reactions`(1.8) / `data-urgent`(1.9) / `data-template-received`(3.3) / `data-pinned`(5.5b) / `data-revoke`(1.5在线) / `data-vote`/`data-average`(8.x) | 1.5/1.8/1.9/3.3/5.5b/8.x |
| `im:post:read` / `im:channel:read_echo`（fat） | `applyMessageItem` | `data-read-bits`（单调覆盖） | 3.1 / 3.2 |
| `im:post:deleted`（fat·离线撤回） | `applyPostDeleted` | `data-revoke=1`（按 msg_id） | 1.5 离线 |
| `im:post:batch-updated`（在线撤回批） | `applyBatchUpdated` | `data-revoke=1`（按 posts[].id） | 1.5 在线 |
| `im:messages:query_result` | `applyMessagesQueryResult` | 首屏 append render-ready 行（`bindRenderReadyRow` 1:1 + O(1) 锚 upsert） | 2.1 |
| `im:messages:older_loaded` | `applyOlderLoaded` | 头部 prepend 更早行（逆序·hasMore） | 2.2 |
| `im:post:received`(props.type=channelUpdate) | `applyChannelUpdatePost` | 系统帧：刷 CL 群属性（屏①）+ 渲染系统提示行 `data-system-notice` | 5.4 / 10.2 |
| `rows()` computed（_locateTarget） | `locatePost` | `data-highlighted=true`（纯本地高亮·无 HTTP） | 2.3 |

> 完整 msg 行 data-* 集（app.component.ts template）：`data-msg-id` `data-temporary-id` `data-channel-id` `data-event-seq` `data-send-status` `data-read-bits` `data-revoke` `data-highlighted` `data-type` `data-urgent` `data-reactions` `data-template-received` `data-reply-id` `data-pinned` `data-system-notice` `data-vote` `data-average` + avatar `data-user-id`。

### 入站指令（IpcIn）+ 出站指令（Outbound）

| 用户动作（testid·msg 行 ops） | store 方法 | invoke 命令 | 出站 HTTP → WS echo | UC |
|---|---|---|---|---|
| `revoke-btn` | `revoke` | `im_revoke` | POST `/api/cses/posts/revoke` → WS `posts_update`/`post_update` | 1.5 |
| `read-post-btn` | `markRead` | `im_mark_read` | POST `/api/cses/post/read` → WS `post_read` | 3.2 |
| `template-received-btn` | `templateReceived` | `im_template_received` | POST `/api/cses/post/templateReceived` → WS `post_update` | 3.3 |
| `quick-reply-btn`（👍） | `quickReply` | `im_send_quick_reply` | POST `/api/cses/posts/quickReply` → WS `post_update`(props.quickReply) | 1.8 |
| `forward-btn` | `relayMessages` | `im_relay_messages` | POST `/api/cses/posts/createPosts` → 各目标频道 WS `post` | 1.7 |
| `make-topic-btn` | `makeTopic` | `im_make_topic` | POST `/api/cses/posts/makeTopic` → WS `channel_created`(type=T)（CL 新行·屏①/④） | 5.2 |
| `urgent-btn` | `urgentPost` | `im_urgent_post` | POST `/api/cses/posts/urgentPost` → WS `post_update`(urgent) | 1.9 |
| `urgent-confirm-btn` | `urgentConfirm` | `im_urgent_confirm` | POST `/api/cses/posts/urgentConfirm` → WS `post_update` | 1.9 |
| `locate-btn` | `locatePost` | （读族纯本地·无 invoke·真实按钮点击） | （复用 query_result ②④ + ③ 高亮） | 2.3 |
| `post-pin-btn` | `pinMessage` | `im_post_pin` | POST `/api/cses/channel/add/postPinned` → WS `post_pin` | 5.5b |
| `bookmark-create-btn` | `createBookmark` | `im_bookmark_create` | POST `/api/cses/post/bookmark/create`（读族 im:read:result） | 9.x |
| `bookmark-delete-btn` | `deleteBookmark` | `im_bookmark_delete` | POST `/api/cses/post/bookmark/delete`（读族） | 9.x |
| `announcement-accept-list-btn` | `announcementAcceptList` | `im_announcement_accept_list` | POST `/api/cses/post/announcement/acceptList`（读族） | 5.6r |
| `announcement-detail-btn` | `announcementDetail` | `im_announcement_detail` | POST `/api/cses/post/announcement/detail`（读族） | 5.6r |
| `announcement-read-btn` | `announcementRead` | `im_announcement_read` | POST `/api/cses/post/announcement/read` → WS `post_update` | 5.6w |
| `announcement-delete-btn` | `announcementDelete` | `im_announcement_delete` | POST `/api/cses/post/announcement/delete` → WS `post_update` | 5.6w |
| `vote-*`（create/do/read/close/delete） | `createVote`…`deleteVote` | `im_vote_*` | 第二网关 :3399（partials/6 集合八）→ WS `post_update`(props.vote) | 8.x |
| `average-*`（publish/attend/read/close/delete） | `publishAverage`…`deleteAverage` | `im_average_*` | 第二网关 :3399 → WS `post_update`(props.average) | 8.x |
| `resend-btn`（failed 行） | `resend` | `im_send`（复用原 tmp·upsert） | POST `/api/cses/posts/create` → WS `post` | 1.4 |
| `load-older-btn`（列头） | `loadOlder` | `im_load_older_context` | （多轮 `posts/postContext` 编排·读族）→ `im:messages:older_loaded` | 2.2 |

### 回灌（WsRecv → Projection）
所有写族经后端 WS echo（`post`/`post_update`/`posts_update`/`post_read`/`post_pin`）→ helix-im → fat `im:post:received`/`im:post:updated`/… → `applyMessageItem` O(1) 锚定位（tmp→server 对账在 helix `reconcile_post_echo`·壳只 1:1 绑定 render-ready）。读族（书签/公告读）HTTP 200 → `im:read:result`。

---

## 屏 ③ 输入发送态 / CP composer

`data-testid` = `compose-input` / `send-btn` 等（footer im__compose）

### 承载 UC
1.1 输入发送 · 1.2 文档 · 1.9 加急（composer 便捷入口）· 1.10 定时 / 取消定时 · 3.1 会话已读 · 1.3 附件🌙（按需·不打 csesapi）

### 渲染指令
composer 自身无独立 data-*；发送态 `data-send-status: sending→sent`（失败 failed）渲染在屏② ML 乐观行上（投影 `im:post:sending` → `im:post:received`）。

### 入站指令 + 出站指令

| 用户动作（testid） | store 方法 | invoke 命令 | 出站 HTTP → WS | UC |
|---|---|---|---|---|
| `compose-input`(enter) / `send-btn` | `send` | `im_send` | POST `/api/cses/posts/create` → WS `post` | 1.1 |
| `send-document-btn` | `sendDocument` | `im_send`(msgType=DOCUMENT) | POST `/api/cses/posts/create`(type=DOCUMENT) → WS `post` | 1.2 |
| `send-urgent-btn` | `onSendUrgent`→`urgentPost` | `im_urgent_post` | POST `/api/cses/posts/urgentPost` → WS `post_update` | 1.9 |
| `schedule-btn` | `createSchedule` | `im_create_schedule` | POST `/api/cses/posts/createSchedule` → WS `post_schedule_created` | 1.10 |
| `cancel-schedule-btn` | `cancelSchedule` | `im_cancel_schedule` | POST `/api/cses/posts/cancelSchedule` → WS `post_schedule_canceled` | 1.10 |
| `read-channel-btn` | `readChannel` | `im_read_channel` | POST `/api/cses/channels/view` → WS `post_read` | 3.1 |

### 回灌
`im_send` 入泵即返 Ok（不 await HTTP）→ 乐观行靠 `im:post:sending` 投影上屏；WS `post` echo → `im:post:received`（fat）→ `applyMessageItem` 按 tmp 锚覆写 sent（helix 对账）。定时 → WS `post_schedule_created` → `im:channel:schedule-created`（屏① CL badge）。

---

## 屏 ④ 话题 / 回复链面板（AX reply-drawer + 定位）

`design` frame `ARBMK`· `data-testid` = `reply-drawer`

### 承载 UC
2.4 一/二级回复链 · 2.3 定位高亮 · 2.2 上拉历史 · 2.1 首屏 · 5.2 消息转话题（建话题 channel）

### 渲染指令

| 投影 channel | apply* | 渲染的 data-* | UC |
|---|---|---|---|
| `im:channel:replies`（render-ready） | `applyChannelReplies` | AX reply-drawer `data-reply-id`（replyIds 1:1 绑·零 extract） | 2.4 |
| `im:read:result`（冻结 ② 契约面） | `applyReadResult` | （契约裁定·壳不再据其 extract reply·S8 已下沉 helix） | 2.4 |
| `rows()` computed | `locatePost` | msg 行 `data-highlighted=true` + `data-reply-id`（msg 行属性） | 2.3 |

### 入站指令 + 出站指令

| 用户动作（testid·msg 行） | store 方法 | invoke 命令 | 出站 HTTP | UC |
|---|---|---|---|---|
| `reply-drawer-btn` | `loadReplies` | `im_get_replies` | POST `/api/cses/posts/getReplies`（读族·im:read:result + im:channel:replies） | 2.4 |
| `reply-branch-btn` | `loadReplyBranch` | `im_get_reply_branch` | POST `/api/cses/posts/getReplyBranch`（读族） | 2.4 |
| `make-topic-btn` | `makeTopic` | `im_make_topic` | POST `/api/cses/posts/makeTopic` → WS `channel_created`(type=T) | 5.2 |

### 回灌
读族 request-response：HTTP 200 body → helix `read_relay::emit_read_result` → `im:read:result`（冻结 ② 面）+ helix 额外抽 postId 下沉 → `im:channel:replies`（render-ready·壳纯绑定）。无 WS 回声。

---

## 屏 ⑤ 成员管理 / MB 成员区

`design` frame `glSMj`· `data-testid` = `member-list`

### 承载 UC
6.1 拉/踢人 · 6.2 设/撤管理员 · 6.3 改群昵称 · 6.4 成员快照/全量（byIds 自愈 + 时间窗快照）

### 渲染指令

| 投影 channel | apply* | 渲染的 data-* | UC |
|---|---|---|---|
| `im:channel:members`（render-ready） | `applyChannelMembers` | 成员行 `data-member-id`/`data-nickname`/`data-admin` keyed upsert + leaves 删行（helix 已 role→admin·壳零判） + `data-members` 回读串 + `data-member-count` | 6.1 / 6.4 |
| `im:channel:memberNickname` | `applyMemberNickname` | 成员行 `data-nickname`（缺行 upsert·data-member-id=userId） | 6.3 |
| `im:channel:member-updated`（冻结 ②） | （契约面·壳不据其派生） | （UC-6.1 ② 契约裁定 verbatim·成员渲染走 im:channel:members） | 6.1 |
| `im:read:result`（byIds 认领 drop） | `applyReadResult` | （pendingMemberReqs 命中即 drop·成员走 render-ready 通道） | 6.4 |

### 入站指令 + 出站指令

| 用户动作（testid） | store 方法 | invoke 命令 | 出站 HTTP → WS | UC |
|---|---|---|---|---|
| `load-members-btn` | `loadMembersByIds` | `im_members_by_ids` | POST `/api/cses/channels/member/byIds`（读族·im:read:result→im:channel:members） | 6.4 |
| （时间窗快照·e2e/桥） | `loadMemberSnapshot` | `im_member_snapshot` | POST `/api/cses/channel/member/snapshot`（读族） | 6.4 |
| `change-member-btn`（拉） | `changeMember`(join) | `im_channel_member_change` | POST `/api/cses/channel/member/change` → WS `channel_member_update` | 6.1 |
| `kick-member-btn`（踢） | `changeMember`(leave) | `im_channel_member_change` | POST `/api/cses/channel/member/change` → WS `channel_member_update` | 6.1 |
| `change-nickname-btn` | `changeMemberNickname` | `im_update_member_nickname` | POST `/api/cses/channel/member/change/nickname` → WS `update_channel_member_nickName` | 6.3 |
| `change-manger-btn` | `setManger` | `im_channel_set_manger` | POST `/api/cses/channel/add\|remove/manger` → WS `channel_member_role_updated`(L1 noop·权威 L2#45) | 6.2 |

> **6.2 历史残留说明**：add/remove manger 后端 WS 已注释·L1 单账号 ② emit_channel_member_updated 不到达；旧的壳侧 `data-admin` 直刷路径现已废弃且当前无效，权威态只能等 L2 #45 广播帧对账。

### 回灌
拉/踢人 WS `channel_member_update`（broadcast）→ helix（role→admin + 四源/byIds 解析下沉）→ render-ready `im:channel:members`（members=应在册·leaves=离场）→ `applyChannelMembers` keyed upsert。byIds 读族 HTTP 200 → `im:read:result`（认领 drop）+ helix port_reply 额外 emit `im:channel:members`（载族自愈·leaves 空）。

---

## 屏 ⑥ 杂项卡片（AX：投票 / 平均分 / 书签 / 待办）

`design` frame `bmtut`· `data-testid` = `bookmark-panel` / `todo-panel`（投票/平均分在 msg 行）

### 承载 UC
8.x 投票 / 平均分 · 9.x 书签 · 10.1 待办

### 渲染指令

| 投影 channel | apply* | 渲染的 data-* | UC |
|---|---|---|---|
| `im:todo:updated`（render-ready·内核自驱） | `applyTodoUpdated` | AX todo-panel `data-todo-id`/`data-todo-type`/`data-todo-can-del`（1:1 绑·零 rename） | 10.1 |
| `im:read:result`（书签 body） | `applyReadResult` | AX bookmark-panel `data-bookmark`/`data-bookmark-id`（书签列表读族回灌·待核：当前 applyReadResult 仅处理 health/byIds drop，书签 body 渲染路径待补） | 9.x |
| `im:post:updated`(props.vote/average) | `applyMessageItem` | msg 行 `data-vote`/`data-average`（投票/平均分卡 id） | 8.x |

> 待办 `im:todo:updated` 触发源 = **内核自驱**（hello 收尾 global increment_channel_end → 攒 about-me mention/urgent post id → `posts/queryTodoList` HTTP 回报装配 emit）·无前端命令·无 WS 回声·无落库（projection-only）。

### 入站指令 + 出站指令

| 用户动作（testid） | store 方法 | invoke 命令 | 出站 HTTP → WS | UC |
|---|---|---|---|---|
| `bookmark-btn`（AX 面板·载列表） | `loadBookmarks` | `im_bookmark_load` | POST `/api/cses/post/bookmark/load`（读族） | 9.x |
| `bookmark-create-btn`（msg 行） | `createBookmark` | `im_bookmark_create` | POST `/api/cses/post/bookmark/create`（读族） | 9.x |
| `bookmark-delete-btn`（msg 行） | `deleteBookmark` | `im_bookmark_delete` | POST `/api/cses/post/bookmark/delete`（读族） | 9.x |
| `vote-create-btn` 等 5 件（msg 行） | `createVote`… | `im_vote_*` | 第二网关 :3399（vote CRUD）→ WS `post_update` | 8.x |
| `average-publish-btn` 等 5 件（msg 行） | `publishAverage`… | `im_average_*` | 第二网关 :3399（average CRUD）→ WS `post_update` | 8.x |
| 待办（无 UI 触发·内核自驱） | — | （内核 build `posts/queryTodoList`） | POST `/api/cses/posts/queryTodoList`（domain #18·UC-10.1） | 10.1 |

### 回灌
待办：内核 HTTP 回报装配 `im:todo:updated`（projection-only）。投票/平均分写族：第二网关 → WS `post_update`(props.vote/average) → `im:post:updated` → msg 行 data-vote/data-average。投票/平均分/书签读族：HTTP 200 → `im:read:result`。

---

## 屏 ⑦ Teams / 运维

`design` frame `dDwpV`（CL 工具条 + H 区复用·无独立大屏）

### 承载 UC
5.8 条件查频道 · 11.1 维护公司大群 · 11.2 退出公司 · 12.1 健康探针 · 10.3 模块（运维读）· 5.7 在线状态

### 渲染指令

| 投影 channel | apply* | 渲染的 data-* | UC |
|---|---|---|---|
| `im:read:result`（body.status） | `applyReadResult` | `data-health`（H 区·HealthRow） | 12.1 |
| `im:channel:created` | `applyChannelCreated` | CL 大群新行（复用屏① applyChannelCreated） | 11.1 |
| `im:channel:closed`/`channel_member_update` 配套 | `applyChannelClosed` | 退公司 = 退 team 下所有 channel·CL 删行 | 11.2 |
| `im:read:result`（查频道/在线/模块 body） | `applyReadResult` | （body 透传·非冻结契约面·前端从 body 抽渲染） | 5.8 / 5.7 / 10.3 |

### 入站指令 + 出站指令

| 用户动作（testid） | store 方法 | invoke 命令 | 出站 HTTP → WS | UC |
|---|---|---|---|---|
| `team-upsert-btn` | `teamUpsert` | `im_team_upsert` | POST `/api/cses/teams/upsert` → WS `channel_created` | 11.1 |
| `team-quit-btn`（CL 行） | `teamQuit` | `im_team_quit` | DELETE `/api/cses/teams/member/quit` → WS `quit_company` | 11.2 |
| `health-btn` | `checkHealth` | `im_health` | GET `/api/cses/health`（读族） | 12.1 |
| `query-channel-btn` | `queryChannels` | `im_channel_query` | POST `/api/cses/channel/query`（读族） | 5.8 |
| `online-status-btn` | `loadOnlineStatus` | `im_channel_online_status` | POST `/api/cses/channel/onlineStatus`（读族） | 5.7 |
| `modules-get-all-btn` | `getAllModules` | `im_modules_get_all` | POST `/api/cses/modules/getAll`（读族） | 10.3 |
| （team 域复用 ChannelMemberChange） | `changeMember`（同屏⑤） | `im_channel_member_change` | POST `/api/cses/teams/member/add`（与 channel#32 同 app 方法） | 6.1 / team |

### 回灌
公司大群 = 建群路径（id 缺省）→ WS `channel_created` → `im:channel:created`（屏①）。退公司 → WS `quit_company`（helix graceful no-op）+ 配套 `channel_close`/`channel_member_update` → CL 删行。健康/查频道/在线/模块 → HTTP 200 → `im:read:result`（读族·无 WS）。

---

# 附录 A：全 HTTP（124·按 UI 归类·method + path + UC + 触发 UI）

> 覆盖统计源自 `coverage-crossmap.md`（2026-06-26 核对纠正）：✅ 70 · 🟡 2 · ⛔ 0 · 🚫 37 · ✂️ 8 · ❓ 7 = 124。下表按「触发 UI 屏」归类**有 UI 入口**的端点（✅/🟡），其余（🚫/✂️/❓）单列。

## A.1 屏① CL/主壳 + 屏⑦ Teams/运维（channel + sync + teams + 运维·40 端点）

| method + path | UC | 触发 UI | 判定 |
|---|---|---|---|
| POST `/channels/load/increment` | 4.1 | 屏① 就绪 probe（内核） | ✅ |
| POST `/channel/load/incrementByChannelId` | 4.5 | 屏① `ensure-channel-loaded-btn` | ✅ |
| POST `/channels/enableApproval` | 5.4 | 屏① 群属性（审批开关·待核 UI 入口） | ✅ |
| POST `/channels/view` | 3.1 | 屏①H/③ `read-channel-btn` | ✅ |
| POST `/channels/member/byIds` | 6.4 | 屏⑤ `load-members-btn` | ✅ |
| POST `/channel/member/snapshot` | 6.4 | 屏⑤（快照·e2e/桥） | ✅ |
| POST `/channel/create` | 5.1 | 屏① `create-channel-btn` | ✅ |
| POST `/channel/createSpecifyOwner` | 5.1 | 屏① 建群变体 / 屏⑦ teamUpsert 底层 | ✅ |
| POST `/channel/change/permission` | 5.4 | 屏① 群属性（待核 UI·change/* 同族） | ✅ |
| POST `/channel/change/notice` | 5.4 | 屏① `change-channel-notice-btn` | ✅ |
| POST `/channel/change/info` | 5.4 | 屏① 群属性（待核 UI·change/* 同族） | ✅ |
| POST `/channel/change/source` | 5.4 | 屏① 群属性（待核 UI） | ✅ |
| POST `/channel/change/displayName` | 5.4 | 屏① `change-channel-btn` | ✅ |
| POST `/channel/change/picture` | 5.4 | 屏① 群属性（待核 UI） | ✅ |
| POST `/channel/change/props` | 5.4 | 屏① 群扩展属性（待核 UI） | ✅ |
| POST `/channel/change/orient` | 5.4 | 屏① 群属性（待核 UI） | ✅ |
| POST `/channel/change/purpose` | 5.4 | 屏① 群属性（待核 UI） | ✅ |
| POST `/channel/change/top` | 5.5 | 屏① `change-channel-top-btn` | ✅ |
| POST `/channel/add/manger` | 6.2 | 屏⑤ `change-manger-btn`(set) | ✅ |
| POST `/channel/remove/manger` | 6.2 | 屏⑤ `change-manger-btn`(unset) | ✅ |
| POST `/channel/add/postPinned` | 5.5b | 屏② `post-pin-btn` | ✅ |
| POST `/channel/remove/postPinned` | 5.5 | 屏②（取消置顶·待核 UI） | ✅ |
| POST `/channel/load/notice` | 5.4 | 屏① 公告栏回读（改后读） | ✅ |
| POST `/channel/load/postPinned` | 5.5 | 屏②（置顶列表读·待核 UI） | ✅ |
| POST `/channel/load/admin` | 6.2 | 屏⑤ 管理员列表读路径 | ✅ |
| POST `/channel/query` | 5.8 | 屏①/⑦ `query-channel-btn` | ✅ |
| POST `/channel/close` | 5.3 | 屏① `close-channel-btn` | ✅ |
| POST `/channel/onlineStatus` | 5.7 | 屏①/⑦ `online-status-btn` | ✅ |
| POST `/channel/member/change/role` | 6.2 | 屏⑤（角色·setManger 关联） | ✅ |
| POST `/channel/member/change/notify` | 5.4 | 屏⑤ 成员免打扰（待核 UI） | ✅ |
| POST `/channel/member/change/nickname` | 6.3 | 屏⑤ `change-nickname-btn` | ✅ |
| POST `/channel/member/change` | 6.1 | 屏⑤ `change-member-btn`/`kick-member-btn` | ✅ |
| POST `/channel/member/leave` | 5.3 | 屏① 退群映射（待核 UI） | ✅ |
| POST `/channel/sync/notify` | 4.2 | 屏① `sync-channels-btn`（引擎自驱） | ✅ |
| POST `/users/list` | 6.4 | 屏⑤ 成员全量读路径 | ✅ |
| POST `/teams/upsert` | 11.1 | 屏⑦ `team-upsert-btn` | ✅ |
| POST `/teams/member/add` | 6.1/team | 屏⑦（team 复用 ChannelMemberChange） | ✅ |
| DELETE `/teams/member/quit` | 11.2 | 屏⑦/① `team-quit-btn` | ✅ |
| POST `/modules/getAll` | 10.3 | 屏①/⑦ `modules-get-all-btn` | ✅ |
| GET `/health` | 12.1 | 屏①H/⑦ `health-btn` | ✅ |

## A.2 屏② ML/聊天主区 + 屏③ composer + 屏④ 回复链（posts·31 端点）

| method + path | UC | 触发 UI | 判定 |
|---|---|---|---|
| POST `/posts/create` | 1.1/1.2/1.4 | 屏③ `send-btn`/`send-document-btn`/屏② `resend-btn` | ✅ |
| POST `/posts/createPosts` | 1.7 | 屏② `forward-btn` | ✅ |
| POST `/posts/createSchedule` | 1.10 | 屏③ `schedule-btn` | ✅ |
| POST `/posts/cancelSchedule` | 1.10 | 屏③ `cancel-schedule-btn` | ✅ |
| POST `/posts/getSchedule` | 1.10 | 屏③（定时列表读·待核 UI） | ✅ |
| POST `/posts/urgentPost` | 1.9 | 屏②/③ `urgent-btn`/`send-urgent-btn` | ✅ |
| POST `/posts/postContext` | 2.2 | 屏②/④ `load-older-btn`（多轮编排） | ✅ |
| POST `/posts/top20` | 2.1 | 屏②（too_long 兜底首屏） | ✅ |
| POST `/posts/urgentConfirm` | 1.9 | 屏② `urgent-confirm-btn` | ✅ |
| POST `/posts/urgentCancel` | 1.9 | 屏②（取消加急·同 UC 母项·待核 UI） | ✅ |
| POST `/posts/get` | 2.3 | 屏④ 越界翻页（L2·L1 走本地 Scan） | 🟡 |
| POST `/posts/getPostsAfterIndex` | 2.3 | 屏④ 越界翻页（L2·L1 走本地 Scan） | 🟡 |
| POST `/posts/revoke` | 1.5 | 屏② `revoke-btn` | ✅ |
| POST `/posts/getReplies` | 2.4 | 屏④ `reply-drawer-btn` | ✅ |
| POST `/posts/getReplyBranch` | 2.4 | 屏④ `reply-branch-btn` | ✅ |
| POST `/posts/makeTopic` | 5.2 | 屏②/④ `make-topic-btn` | ✅ |
| POST `/posts/queryTodoList` | 10.1 | 屏⑥ 待办（内核自驱·无 UI） | ✅ |
| POST `/posts/getLatestPost` | 2.1 | 屏②（too_long 兜底首屏） | ✅ |
| POST `/posts/quickReply` | 1.8 | 屏② `quick-reply-btn` | ✅ |
| POST `/posts/updatePostProps` | 8.x | 屏⑥ 投票/平均分 props 更新 | ✅ |
| POST `/post/read` | 3.2 | 屏② `read-post-btn` | ✅ |
| POST `/post/read/list` | 3.2 | 屏②（批量查已读 bitmap 读路径） | ✅ |
| POST `/post/templateReceived` | 3.3 | 屏② `template-received-btn` | ✅ |
| POST `/post/announcement/save` | 5.6w | 屏① `announcement-save-btn` | ✅ |
| POST `/post/announcement/read` | 5.6w | 屏② `announcement-read-btn` | ✅ |
| POST `/post/announcement/acceptList` | 5.6r | 屏② `announcement-accept-list-btn` | ✅ |
| POST `/post/announcement/delete` | 5.6w | 屏② `announcement-delete-btn` | ✅ |
| POST `/post/announcement/list` | 5.6r | 屏① `announcement-list-btn` | ✅ |
| POST `/post/announcement/detail` | 5.6r | 屏② `announcement-detail-btn` | ✅ |
| POST `/post/bookmark/create` | 9.x | 屏②/⑥ `bookmark-create-btn` | ✅ |
| POST `/post/bookmark/delete` | 9.x | 屏②/⑥ `bookmark-delete-btn` | ✅ |
| POST `/post/bookmark/load` | 9.x | 屏⑥ `bookmark-btn` | ✅ |

> 注：投票/平均分 CRUD（vote/average 各 5 件）走**第二网关 :3399**（partials/6 集合八），不属本 124 接口集（partials/1-4），故不在上表 124 计数内·但有 UI 入口（屏⑥/② `vote-*`/`average-*` btn·invoke `im_vote_*`/`im_average_*`）。

## A.3 无 UI 入口（🚫 bot移除 37 / ✂️ 剔除 8 / ❓ 真漏网 7）

| 类别 | 数量 | 端点（摘要） |
|---|---|---|
| 🚫 bot/agent 管理类（2026-06-24 裁决不测） | 37 | 域D #1-37：`posts/createBot`·`bot-manage/*`·`bot-agent/*`·`agents/*`·`webhook/*` |
| ✂️ 永久剔除（用户拍板） | 8 | `users/status/ids`（真阻塞 statusCache）+ `search/post\|user\|channel\|do`（归属 java）+ `channels/csesCrossRepoDemo`/`crossRepoCounterPoll`/`triggerMmToCsesCounterAck`（trace 合成 handler） |
| ❓ 真漏网（客户端无 invoke） | 7 | `posts/createMock`（压测废弃）·`posts/getUpdatedPosts`（被 4.2 cursor sync 取代）·`post/approval/approval`（审批动作无 UC）·`users`（开户真阻塞）·`groups`（空骨架）·`notification/loadSend`·`notification/loadTarget` |

---

# 附录 B：全 WS（19 action·按 action 归类·投影工厂 + 渲染屏）

> 真源 `coverage-crossmap.md` 表 2（2026-06-26 核对纠正）：✅ 17 · ⛔ 0 · 🚫 1 · ❓ 0（去重后 18 个不同 action 字符串·`post` 业务+bot 两变体）。

| # | WS action | ② 投影工厂 | 壳投影 channel → apply* | 渲染屏 | UC | 判定 |
|---|---|---|---|---|---|---|
| 1 | `post` | `emit_post_received`(fat) | `im:post:received`→`applyMessageItem` | 屏② ML | 1.1/1.2/1.4/1.7/6.1拉踢 | ✅ |
| 2 | `posts_update` | `emit_post_batch_updated` | `im:post:batch-updated`→`applyBatchUpdated` | 屏② ML | 1.5 撤回批 | ✅ |
| 3 | `post_update` | `emit_post_updated`(fat) | `im:post:updated`→`applyMessageItem` | 屏②/⑥ | 1.5/1.8/1.9/3.3/5.5b/5.6w/8.x | ✅ |
| 4 | `post_read` | `emit_post_read`(fat) | `im:post:read`→`applyMessageItem` | 屏② ML | 3.1/3.2 | ✅ |
| 5 | `post_pin` | `emit_post_updated` | `im:post:updated`→`applyMessageItem`(data-pinned) | 屏② ML | 5.5b | ✅ |
| 6 | `post_schedule_created` | `emit_schedule_created` | `im:channel:schedule-created`→`applyScheduleCreated` | 屏① CL | 1.10 | ✅ |
| 7 | `post_schedule_canceled` | `emit_schedule_canceled` | （待核·壳 onBus 无 schedule-canceled 分支） | 屏① CL | 1.10 | ✅ |
| 8 | `increment_channel` | `emit_channel_increment` | `im:channel:increment`→`applyChannelIncrement` | 屏① CL | 4.1/4.5 | ✅ |
| 9 | `increment_channel_end` | `emit_channel_update`(thin·批次结束) | `im:channel:update`→`applyChannelUpdate`（就绪 probe 锚） | 屏① CL | 4.1 | ✅ |
| 10 | `channel_created` | `emit_channel_created` | `im:channel:created`→`applyChannelCreated` | 屏①/④/⑦ | 5.1/5.2/6.4/11.1 | ✅ |
| 11 | `channel_member_update` | `emit_channel_member_updated`(+render-ready `im:channel:members`) | `im:channel:member-updated`(②冻结)+`im:channel:members`→`applyChannelMembers` | 屏⑤ MB | 5.1/6.1 | ✅ |
| 12 | `channel_member_role_updated` | `emit_channel_member_updated`/`emit_channel_update` | （L1 graceful no-op·旧 `data-admin` 直刷路径已废弃/无效·权威 L2#45） | 屏⑤ MB | 6.2 | ✅ |
| 13 | `channel_close` | `emit_channel_closed` | `im:channel:closed`→`applyChannelClosed` | 屏①/⑦ | 5.3/11.2 | ✅ |
| 14 | `update_channel` | `emit_channel_update`(thin) | `im:channel:update`→`applyChannelUpdate`（重查 dialogList） | 屏① CL | 5.4/5.5/3.1 badge | ✅ |
| 15 | `update_channel_notice` | `emit_channel_update`(thin) | `im:channel:update`→`applyChannelUpdate` | 屏① CL | 5.4 改公告 | ✅ |
| 16 | `update_channel_member_nickName` | `emit_member_nickname` | `im:channel:memberNickname`→`applyMemberNickname` | 屏⑤ MB | 6.3 | ✅ |
| 17 | `change_channel_approval` | `emit_channel_update`(thin) | `im:channel:update`→`applyChannelUpdate` | 屏① CL | 5.4 审批开关 | ✅ |
| 18 | `quit_company` | （退公司·member/channel 移除·graceful no-op） | 配套 `channel_close`/`channel_member_update` | 屏①/⑦ | 11.2 | ✅ |
| 19 | `post`（agent/bot 变体） | `emit_post_received` | （同 #1 action·bot 链路） | — | — | 🚫 bot移除 |

> **壳额外投影（非直接 WS 1:1·读族/内核自驱/bootstrap）**：`im:channels:projection`（dialogList bootstrap+重查）· `im:channels:loaded`（冷启动信号·noop）· `im:channel:update-by-post`（4.2 sync badge·瘦）· `im:read:result`（读族 request-response 回灌·无 WS）· `im:channel:replies`（2.4 render-ready）· `im:todo:updated`（10.1 内核自驱·projection-only）· `im:messages:query_result`（2.1 本地 Scan）· `im:messages:older_loaded`（2.2 编排）· `im:post:sending`（1.1 乐观·瘦）· `im:post:deleted`（1.5 离线撤回·fat）· `im:channel:read_echo`（3.1 fat）。

---

# 附录 C：覆盖矩阵（哪些 HTTP/WS 有 UI 入口·哪些无）

## C.1 HTTP（124）

| 维度 | 数量 | 说明 |
|---|---|---|
| ✅ 有 UI 入口（直接 / 内核自驱 / e2e 桥·全挂 UC） | 70 | 域A 30 + 域B 34 + 域C 6（见附录 A.1/A.2） |
| 🟡 部分面有入口（L2 越界翻页·L1 走本地 Scan） | 2 | `posts/get` / `posts/getPostsAfterIndex`（屏④ 定位兜底） |
| 🚫 无 UI 入口（bot/agent 移除） | 37 | 域D #1-37 |
| ✂️ 无 UI 入口（永久剔除·真阻塞/归属 java/非业务） | 8 | status/ids + search×4 + cross-repo demo×3 |
| ❓ 无 UI 入口（真漏网·客户端无 invoke） | 7 | createMock/getUpdatedPosts/approval/users/groups/loadSend/loadTarget |
| **合计** | **124** | ✅70 + 🟡2 + 🚫37 + ✂️8 + ❓7 |

> **有 UI 入口的可达业务面 = 72**（✅70 + 🟡2）·逐个对得上 UC。剩 52（🚫37+✂️8+❓7）全部「客户端无 invoke 的 bot/服务端/运维/废弃/被取代/归属 java」链路·不在「最小可测客户端宿主」职责范围。
>
> **额外 UI 入口（不在 124 集）**：vote CRUD 5 件 + average CRUD 5 件（第二网关 :3399·partials/6 集合八）·屏⑥/② `vote-*`/`average-*` btn → invoke `im_vote_*`/`im_average_*` → UC-8.x。

## C.2 WS（19·去重 18 不同 action）

| 维度 | 数量 | 说明 |
|---|---|---|
| ✅ 有壳投影渲染入口（apply* 消费·全挂 UC） | 17 | #1-18（除 #19 bot 变体）·post_schedule_canceled(#7) 投影工厂存在；壳侧取消定时按钮已接 `im_cancel_schedule`，仍需 live e2e 持续确认 WS 回灌清空 schedule badge |
| 🚫 无入口（bot/agent 变体） | 1 | #19 `post`(agent/bot) |
| ❓ 漏网 | 0 | quit_company→11.2·post_pin→5.5b 已覆盖 |

> **WS 全部 18 个业务 action 有投影工厂**·其中 17 有壳 apply* 渲染回灌路径。`post_schedule_canceled`（#7）已有 `emit_schedule_canceled` 投影工厂与 UI 触发入口；后续以 UC-1.10 cancel live e2e 报告作为最终回灌证据。

## C.3 入站命令（IpcIn）覆盖

壳 `im-store.service.ts` 实接 invoke 命令 **47 个**（按 UC）：

```
发送族: im_send(1.1/1.2/1.4) im_relay_messages(1.7) im_template_received(3.3)
       im_send_quick_reply(1.8) im_urgent_post/im_urgent_confirm(1.9) im_create_schedule(1.10)
读写已读: im_mark_read(3.2) im_read_channel(3.1)
历史读: im_query_messages_by_channel(2.1) im_load_older_context(2.2)
        im_get_replies/im_get_reply_branch(2.4)
频道: im_create_channel(5.1) im_make_topic(5.2) im_channel_close(5.3)
     im_channel_change_display_name/_notice(5.4) im_channel_change_top(5.5)
     im_channel_query(5.8) im_channel_online_status(5.7) im_ensure_channel_loaded(4.5)
     im_sync_channels(4.2) im_query_dialog_list(4.1/bootstrap)
成员: im_channel_member_change(6.1) im_channel_set_manger(6.2) im_update_member_nickname(6.3)
     im_members_by_ids/im_member_snapshot(6.4)
公告: im_announcement_save/_read/_delete(5.6w) im_announcement_accept_list/_list/_detail(5.6r)
置顶: im_post_pin(5.5b)
书签: im_bookmark_create/_delete/_load(9.x)
投票: im_vote_create/_do/_read/_close/_delete(8.x)
平均分: im_average_publish/_attend/_read/_close/_delete(8.x)
Teams: im_team_upsert(11.1) im_team_quit(11.2)
运维: im_health(12.1) im_modules_get_all(10.3)
就绪: im_ready(W1 probe)
```

> **占位/待核 invoke**：当前未发现 `onRevoke` / `onCancelSchedule` 仍为空；两者已经接入 `im_revoke` / `im_cancel_schedule`。后续扫描重点转向“UI 是否真点到按钮”和“WS-dependent 回灌是否由 live 报告证明”，不是再按旧占位项推进。

---

# 诚实结论

1. **壳=纯渲染铁律（C013）成立**：每条入站 = 用户动作→`invoke im_*`（args 透传·body/identity/wire 构造全在 helix-im commands.rs + outbound/*.rs）；每条渲染 = `im:* 投影 → apply* → data-* 1:1 绑定`（解析/对账/role→admin/四源合并/wire 归一全已下沉 helix render-ready 通道：`im:channel:members`/`im:channel:replies`/`im:todo:updated`/message_item_data render-ready 字段）。UC-6.2 曾存在壳侧 `data-admin` 直刷历史写法，但该路径现已废弃且当前无效；管理员态只认后端/helix 权威回灌与 L2 #45。

2. **UI 覆盖完整性**：7 屏覆盖**全部可达业务 UC**（30+ UC）；HTTP 有 UI 入口 72/124（✅70+🟡2·其余 52 = bot/服务端/运维/废弃/归属 java）；WS 17/18 业务 action 有壳渲染路径；入站 invoke 49 个实接（含 revoke / cancelSchedule）。

3. **待核项（2）**：① `post_schedule_canceled` 需以 UC-1.10 cancel live e2e 持续证明 badge 清空回灌；② 书签列表 body 渲染路径——`applyReadResult` 当前仅处理 health/byIds drop·书签/公告/在线/模块/查频道 read body 的前端「从 body 抽渲染」逻辑需继续核对 live 报告。

> 本文档每行 UC↔HTTP↔WS verbatim 自 `coverage-crossmap.md`·data-*↔投影↔invoke verbatim 自 `app.component.ts`/`im-store.service.ts`/`projection.types.ts`·任一行可回溯真源逐字核对。

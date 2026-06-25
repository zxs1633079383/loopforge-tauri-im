# Spec — Angular 展示页方案（覆盖所有 UC · 语义 DOM + data-* 直映投影）

> **一句话**：提前设计一个**简单单页**的语义 DOM 壳，覆盖 rollout 全 UC（阶段 0–7 + L2）的渲染/交互需求，供后续**逐 UC 按需开发**。
> UI 不追组件/像素保真（CLAUDE §1）——重点是 **③ DOM 面的 data-* 直映投影字段**，给 WebdriverIO 当四面契约断言的锚点。
>
> **真源**：本文件 = 前端 ③ DOM 面的**设计蓝图**；锚 `docs/uc-rollout/rollout-checklist.md`（阶段 + ③ DOM 锚点）+ `docs/uc-coverage-ledger.md`（各 UC 四面细节）+ `docs/spec/send-message-vertical-slice.md §4`（已绿竖切 DOM 契约）。
> **现状基线**：`src/app/app.component.ts`（消息列表 + composer + send/document 按钮 + data-ready/data-active-channel）已绿（UC-1.1/1.2/1.5）。本方案是**加法式扩展**，不回退已绿。
>
> ✅ **骨架就位**（issue #46）：6 语义区（H/CL/ML/MB/CP/AX）容器 + 消息行 data-* 全集（冻结 8 + 待加 8）+ 全交互件挂载位 + 配套组件方法（C007）+ store 区域信号占位**一次搭到位**。各 UC issue（#7-#45）只往现成区绑数据/接真实 invoke，不再重搭结构。`pnpm exec ng build --configuration development` 无 TS 错·`bash scripts/gate.sh` 绿·冻结集形态未动。

---

## 0. 设计哲学与铁律（开发前必读）

1. **壳纯渲染（铁律）**：`im-store.service.ts` 只 listen `im:__bus__` → 按投影分发 → 渲染。**data-\* 直映投影字段，不在 JS 合成**（`readBits` 禁前端算 · projection-schema §3；`data-members` 回读投影帧透传的 channel 对象，不前端拼）。
2. **加法式扩展**：每个 UC 只**新增** data-* 字段 / 新增语义区，**不改已绿 UC-1.1/1.2/1.5 的 DOM 形态**（`data-msg-id`/`data-temporary-id`/`data-send-status`/`data-read-bits`/`data-revoke`/`data-type` 冻结）。
3. **事件绑定必配组件方法（harness C007）**：模板每加一个 `(click)="fn()"` / `[attr.x]="m.y"` → **同 commit** 在组件类加 `fn()` 方法、在 `MessageRow`/model 加 `y` 字段。否则 ng serve 编译挂 → run.sh live 假死。**这是逐 UC 开发的头号坑。**
4. **未设字段不渲染该属性**：`[attr.data-x]="m.x ?? null"`（null → Angular 不渲染该属性），避免空属性污染未涉及 UC 的断言（沿用现状 `data-revoke`/`data-type` 写法）。
5. **沿用现状框架约束**：`ChangeDetectionStrategy.OnPush` + 默认 `ViewEncapsulation`（现状内联 styles，单组件，类名隔离够用）；signals 驱动；`@for` track `temporaryId`（消息行选择器锚贯穿乐观→覆写不变）。
6. **命名锚 snake/camel 混用陷阱**：投影 data 字段名按 projection-schema 逐字（`channel_id` 信号锚 snake / `channelId` 渲染核 camel）——store 的 `capture*`/`apply*` 要兼容两形态（沿用 `captureActiveChannel` 写法）。
7. **不做的 UI**：⛔ 群公告（5.6 回声不可观测）/ ⛔ 在线状态（5.7 后端阻塞）/ ⛔ 搜索（7.x 后端空桩）/ 🚫 bot-agent（已移除）——**不在本壳建 data-\* 区**（建了也无投影喂数据，徒增噪音）。文件上传（1.3 🌙）只留 `data-send-status:uploading` 占位语义，不建真上传件。

---

## 1. 页面区域划分（简单单页 · 语义区）

单页布局，五大语义区 + 状态指示。简单 flex 三栏（左频道列表 · 中消息列表 · 右成员/辅助），底部 composer。**所有区都是语义 DOM，data-\* 直映投影，无业务逻辑。**

```
┌──────────────────────────────────────────────────────────────┐
│ header  [data-ready] [data-active-channel] [data-health?]      │ ← 状态指示
├──────────────┬───────────────────────────────┬───────────────┤
│ 频道列表区    │ 消息列表区                     │ 成员区        │
│ data-testid= │ data-testid=msg-list           │ data-testid=  │
│  channel-list│                                │  member-list  │
│              │  <div.msg data-msg-id ...>      │ [data-member- │
│ <div         │  消息行 data-* 全集（§2）       │  count]       │
│  data-channel│                                │ <div data-    │
│  -id ...>×N  │                                │  member-id>×N │
│ [data-active-│                                │ [data-admin]  │
│  channel]    │                                │ [data-nick-   │
│ [data-unread]│                                │  name]        │
├──────────────┴───────────────────────────────┴───────────────┤
│ 辅助区（折叠面板/抽屉，按 UC 显隐）                            │
│  书签 data-bookmark · 待办 data-todo · 投票 data-vote ·       │
│  平均分 data-average · 系统通知 data-system-notice ·          │
│  定时 data-has-schedule-post · 回复链 data-reply-id                │
├──────────────────────────────────────────────────────────────┤
│ composer: input + 交互件                                       │
│  [send][document][urgent][quick-reply][schedule][forward]     │
│  [revoke][read][template-received][make-topic][create-channel]│
└──────────────────────────────────────────────────────────────┘
```

### 1.1 状态指示区（header）

| data-* | 来源投影 | UC | 现状 |
|---|---|---|---|
| `data-ready` | `im_ready` probe（非 bus·increment_end+inflight0+cursor稳） | 0/4.1 就绪根 | ✅ 已有 |
| `data-active-channel` | stream 第一个真实频道 / dialogList 首行 | send 族锚定 | ✅ 已有 |
| `data-health` | `im_health` → GET /health 200（可选·一面①连通性） | 12.1 | ⬜ 新增（可选属性） |

### 1.2 频道列表区（`data-testid="channel-list"`）

每个频道一行 `<div data-channel-id>`。覆盖建群/切群/关群/置顶/属性。

| data-* | 来源投影 | UC |
|---|---|---|
| `data-channel-id` | `emit_channels_loaded`/`emit_channel_created`/`emit_channel_increment` | 4.1/5.1/5.2/5.8/11.1 |
| `data-active-channel`（行级 class/attr 二选一） | activeChannel signal 比对 | 切群 |
| `data-channel-type` | channel 对象 type（P/T/team 大群） | 5.1/5.2/11.1 |
| `data-channel-display-name` | `emit_channel_update` 回读 channel.displayName | 5.4 |
| `data-channel-notice` | channel.notice 回读 | 5.4 |
| `data-channel-top` / `data-pinned`（频道级） | `emit_channel_update` channelIsTop | 5.5 |
| `data-unread` / badge | cursor/unread_count（4.2 sync 增量后 badge） | 4.2 |
| `data-has-schedule-post` | channel.has_schedule_post | 1.10 |
| 行移除（无 data-*，节点消失） | `emit_channel_closed` / teams/member/quit | 5.3/11.2 |

### 1.3 消息列表区（`data-testid="msg-list"`）

消息行 `<div.msg data-msg-id ...>` —— **data-\* 全集见 §2**。覆盖 posts 全族（发/收/撤回/已读/加急/快捷回复/模板/转发/历史/系统通知）。

### 1.4 成员区（`data-testid="member-list"`）

每个成员一行 `<div data-member-id>`；区容器带 `data-member-count`。覆盖成员管理 6.x。

| data-* | 来源投影 | UC |
|---|---|---|
| `data-member-count`（区容器） | 成员快照/全量 channel.members 长度 | 6.4 |
| `data-member-id` | channel 对象 members[].id | 6.1/6.4 |
| `data-admin`（行级·ADMIN 标） | `emit_channel_member_updated` role | 6.2 |
| `data-nickname` | `emit_member_nickname` nickName | 6.3 |
| `data-members`（区级·成员 id 集合回读串） | `emit_channel_member_updated` channel 对象 | 6.1 |
| 行增/移除（join/leave） | member 变更投影 | 6.1/11.2 |

### 1.5 composer + 交互件

input（现状 `data-testid="compose-input"`）+ 一排触发按钮。**每个按钮 = 一个 UC 触发件，必配组件方法（C007）**。按钮 disabled 绑 `!store.activeChannel()`（无锚定频道不可发）/ 行级操作绑选中消息。

| 交互件（data-testid） | 触发 invoke | UC | 现状 |
|---|---|---|---|
| `send-btn` | `im_send` | 1.1 | ✅ |
| `send-document-btn` | `im_send`(msgType=DOCUMENT) | 1.2 | ✅ |
| `send-urgent-btn` | `posts/urgentPost`(+urgentConfirm) | 1.9 | ⬜ |
| `quick-reply-btn`（行级 emoji） | `posts/quickReply` | 1.8 | ⬜ |
| `schedule-btn` / `cancel-schedule-btn` | `posts/createSchedule`/`cancelSchedule` | 1.10 | ✅ |
| `forward-btn`（行级·选目标 channel） | `im_create_posts`→`posts/createPosts` | 1.7 | ⬜ |
| `revoke-btn`（行级） | `im_revoke` | 1.5 | ✅（命令已通·UI 触发件待补） |
| `read-channel-btn` / `read-post-btn`（行级） | `im_read_channel`/`im_post_read` | 3.1/3.2 | ⬜ |
| `template-received-btn`（行级） | `templateReceived` | 3.3 | ⬜ |
| `resend-btn`（行级·failed 行显） | `im_send`(复用 temp_id) | 1.4 | ⬜ |
| `create-channel-btn` | `im_create_channel` | 5.1 | ⬜ |
| `make-topic-btn`（行级·rootId=postId） | `im_make_topic` | 5.2 | ⬜ |
| `close-channel-btn`（频道级） | `im_channel_close` | 5.3 | ⬜ |
| `change-channel-btn`（属性/置顶/管理员/拉踢/昵称） | `channel/change/*`·`member/change`·`add/remove/manger` | 5.4/5.5/6.1/6.2/6.3 | ⬜ |
| `load-older-btn`（消息列表顶部） | `im_load_older_context` | 2.2 | ⬜ |
| `query-channel-btn` | `im_query_channels` | 5.8 | ⬜ |
| `team-upsert-btn` / `team-quit-btn` | `im_team_upsert`/`im_team_quit` | 11.1/11.2 | ⬜ |

### 1.6 辅助区（折叠面板/抽屉 · 按 UC 显隐）

低频/读族 UC 的渲染落点，避免污染主消息列表。容器各带 `data-testid`，内部 data-* 直映读族投影。

| 子区（data-testid） | data-* | 来源投影 | UC |
|---|---|---|---|
| `bookmark-panel` | `data-bookmark`（每书签一行 data-bookmark-id） | `query::emit_read_result`（书签 load） | 9.x |
| `todo-panel` | `data-todo`（每条 data-todo-id+type+canDel） | `todo::emit_todo_updated` items | 10.1 |
| `vote-card`（消息行内嵌或抽屉） | `data-vote`（options/counts 透传 props） | `emit_post_updated`(fat·投票卡) | 8.x |
| `average-card` | `data-average`（avg 值透传 props） | `emit_post_updated`/读族 | 8.x |
| `reply-drawer` | `data-reply-id`（回复链每行） | `query::emit_read_result`（getReplies） | 2.4 |
| `system-notice`（消息列表内特殊行） | `data-system-notice`（SYSTEM/SYSTEN 类型保真） | `emit_post_received`/`updated` | 10.2 |

> ⛔ **不建**：`data-announcement`(5.6)/`data-search-result`(7.x)/在线状态(5.7)/bot 区——无投影喂数据。

---

## 2. 消息行 data-* 全集（MessageRow 模型扩展清单）

消息行 `<div class="msg" ...>` 是 ③ DOM 面的核心。下表逐字段标**来自哪个 UC**、**MessageRow 字段名**、**投影来源**。
**冻结集（已绿·禁改）** + **待加集（逐 UC 扩 MessageRow）**。

### 2.1 冻结集（现状已绿·禁改形态 · UC-1.1/1.2/1.5）

| data-* | MessageRow 字段 | 投影来源 | UC |
|---|---|---|---|
| `data-msg-id` | `msgId`（tmp→server 覆写） | `emit_post_received` msg_id / 乐观 temporaryId | 1.1 |
| `data-temporary-id` | `temporaryId`（选择器锚·贯穿不变） | `im:post:sending` temporary_id | 1.1 |
| `data-channel-id` | `channelId` | data.channel_id/channelId | 1.1 |
| `data-event-seq` | `eventSeq`（null→空串） | `emit_post_received` event_seq | 1.1 |
| `data-send-status` | `sendStatus`（sending/sent/failed） | sending 投影 / echo 覆写 | 1.1/1.4 |
| `data-read-bits` | `readBits`（**禁前端算**·单调覆盖） | `emit_post_received`/`emit_post_read` readBits | 1.1/3.1/3.2 |
| `data-revoke` | `revoked`（1/不渲染） | `im:post:batch-updated`/`im:post:deleted` | 1.5 |
| `data-type` | `type`（TEXT/DOCUMENT…） | data.type 透传 | 1.2/10.2 |

### 2.2 待加集（逐 UC 扩 MessageRow · 加法式）

| data-* | 新增 MessageRow 字段 | 投影来源 | UC | 渲染规则 |
|---|---|---|---|---|
| `data-urgent` | `urgent?: boolean` | `emit_post_updated`(fat·expedite 归一) props.expedite | 1.9 | 命中→`"1"`，否则不渲染 |
| `data-reactions` | `reactions?: string` | `emit_post_updated` props.quickReply（emoji+userIds 序列化串·读族透传非合成） | 1.8 | 有→透传 props 串 |
| `data-template-received` | `templateReceived?: boolean` | `emit_post_updated`/读族 props.template.userIds 含 self | 3.3 | 含 self→`"1"` |
| `data-has-schedule-post` | （频道级·非消息行·见 §1.2） | `emit_schedule_created`/`canceled` hasSchedulePost | 1.10 | 频道行属性 |
| `data-reply-id` | `replyId?: string`（或辅助区 reply-drawer 行级） | 读族 getReplies/getReplyBranch | 2.4 | 回复链行标 root postId |
| `data-pinned` | `pinned?: boolean`（消息置顶·🟡 data-dep） | `query::emit_read_result`(postPinned) | 5.5 | 命中→`"1"`（注：消息置顶子项物理够不到·留字段不强求绿） |
| `data-system-notice` | `systemNotice?: boolean` | type=SYSTEM/SYSTEN 透传 | 10.2 | 系统消息行→`"1"` |
| `data-vote` | `vote?: string`（投票卡·或辅助区 vote-card） | `emit_post_updated` props.vote 透传 | 8.x | 有投票卡→透传 props |
| `data-average` | `average?: string` | `emit_post_updated` props.average 透传 | 8.x | 有平均分卡→透传 props |
| `data-bookmark` | （辅助区 bookmark-panel·非消息行主属性） | 读族书签 load | 9.x | 辅助区渲染 |

> **读族透传字段（reactions/vote/average）规则**：壳**透传投影里的 props 串**，不在 JS 解析/重组（projection-schema 读族透传三态）。data-* 值 = 投影给的字符串原样，断言只比对「投影 props == DOM data-*」。

---

## 3. 每 UC → UI 区域 + data-*/交互件 映射表（一行一 UC）

> 标该 UC 前端要加什么。`✅`=已绿/已有；`⬜`=待开发；`🟡`=主路径可做+子项物理够不到；`⛔/🚫`=不建 UI。
> 区域缩写：**H**=header状态 · **CL**=频道列表 · **ML**=消息列表 · **MB**=成员区 · **CP**=composer交互件 · **AX**=辅助区。

| UC | 区域 | 前端要加的 data-* / 交互件 / 组件方法 | 状态 |
|---|---|---|---|
| 4.1 hello 全量增量 | H+CL | `data-ready` 置位 + CL 渲染 channel 行（data-channel-id） | ⬜ |
| 5.1 创建群聊 | CP+CL | `create-channel-btn`+`onCreateChannel()` → CL 新增 data-channel-id 行 | ⬜ |
| 5.2 创建话题 | CP+CL | `make-topic-btn`(行级·rootId=postId)+`onMakeTopic(row)` → CL data-channel-type=T 行 | ⬜ |
| 1.1 发文本 | CP+ML | ✅ `send-btn`+`onSend()`；消息行冻结集 | ✅ |
| 1.2 发文档 | CP+ML | ✅ `send-document-btn`+`onSendDocument()`；`data-type=DOCUMENT` | ✅ |
| 1.9 加急+加急已读 | CP+ML | `send-urgent-btn`+`onSendUrgent()` / 行级 confirm；`data-urgent` + MessageRow.urgent | ⬜ |
| 1.8 快捷回复 emoji | CP+ML | 行级 `quick-reply-btn`+`onQuickReply(row,emoji)`；`data-reactions`+MessageRow.reactions | ⬜ |
| 1.10 定时消息 | CP+CL | `schedule-btn`/`cancel-schedule-btn`+`onSchedule()`/`onCancelSchedule()`；频道行 `data-has-schedule-post` | ✅ |
| 1.3 发图片/文件 🌙 | CP+ML | `data-send-status:uploading→sent` 占位语义（不建真上传件） | 🌙 |
| 1.5 撤回 | CP+ML | 行级 `revoke-btn`+`onRevoke(row)`；`data-revoke=1`（命令已通·补 UI 触发件） | ✅(命令)/⬜(件) |
| 3.2 单条已读 | CP+ML | 行级 `read-post-btn`+`onPostRead(row)`；`data-read-bits` 更新 | ⬜ |
| 3.1 会话已读 | CP+ML | `read-channel-btn`+`onReadChannel()`；ML 各行 `data-read-bits`(self 位 1) | ⬜ |
| 3.3 模板已收到 | CP+ML | 行级 `template-received-btn`+`onTemplateReceived(row)`；`data-template-received` | ⬜ |
| 1.4 重发失败 | CP+ML | failed 行显 `resend-btn`+`onResend(row)`；`data-send-status:failed→sending→sent` | ⬜ |
| 1.7 转发/合并 | CP+ML | 行级 `forward-btn`+`onForward(row,targetChannels)`；多 channel ML 消息行 | ⬜ |
| 2.4 一级/二级回复 | AX+ML | `reply-drawer`+`onLoadReplies(row)`；`data-reply-id` 回复链 | ⬜ |
| 2.1 切群首屏 | CL+ML | CL 行 click→`onSelectChannel(id)` → ML 渲染 N 个 data-msg-id 行 | ⬜ |
| 2.3 按 postId 定位 | ML | `onLocatePost(postId)`；命中行高亮 data-msg-id | ⬜ |
| 2.2 上拉更早历史 | ML | 列表顶 `load-older-btn`+`onLoadOlder()`；prepend 更早 data-msg-id 行 | ⬜🔴(helix wire-bug) |
| 5.4 群属性修改 | CP+CL | `change-channel-btn`+`onChangeChannel(field,val)`；CL `data-channel-display-name`/`-notice` 回读 | ⬜ |
| 5.5 置顶 | CP+CL+ML | 频道置顶 `data-channel-top`(可做) / 消息置顶 `data-pinned`(🟡 data-dep) | 🟡 |
| 5.3 关闭/退出群 | CP+CL | `close-channel-btn`+`onCloseChannel()`；CL 行移除（member-leave 广播子项 ⛔） | 🟡 |
| 6.3 改群昵称 | CP+MB | `change-nickname-btn`+`onChangeNickname(memberId,nick)`；`data-nickname` | ⬜ |
| 6.4 成员快照/全量 | MB | `onLoadMembers()`；区 `data-member-count` + data-member-id 行 | ⬜ |
| 6.1 拉/踢人 | CP+MB | `change-member-btn`+`onChangeMember(join/leave)`；`data-members` 回读（留存收 RX 需双连接 ⛔） | 🟡 |
| 6.2 设/撤管理员 | CP+MB | `change-manger-btn`+`onChangeManger(memberId,role)`；`data-admin`（add_manger 次路径 ⛔） | 🟡 |
| 9.x 书签 | AX | `bookmark-panel`+`onBookmark()`/`onLoadBookmarks()`；`data-bookmark` | ⬜ |
| 10.1 待办列表 | AX | hello 收尾自驱 → `todo-panel` 渲染 `data-todo` 列表 | ⬜ |
| 4.2 按需 sync notify | CL+ML | `onSyncChannels()` → 增量 ML 行 + CL `data-unread` badge | ⬜ |
| 4.5 陌生 channel 兜底 | CL | WS 自动注册 → CL 单 channel 增量渲染 data-channel-id | 🟡 |
| 4.4 心跳 gap 补偿 | — | **③ DOM N/A（已移除该面）**；纯 Rust 自驱无 UI | 🟡(三面) |
| 8.x 投票/平均分 | AX+ML | `vote-card`/`average-card`；`data-vote`/`data-average`（vote 真 id 子项 ⛔） | 🟡 |
| 10.2 系统通知 | ML | WS 帧触发 → ML 特殊行 `data-system-notice`（SYSTEN 拼写保真） | ⬜ |
| 5.8 条件查频道 | CP+CL | `query-channel-btn`+`onQueryChannels()`；CL data-channel-id 列表 | ⬜ |
| 11.1 维护公司大群 | CP+CL | `team-upsert-btn`+`onTeamUpsert()`；CL team 大群 data-channel-id | ⬜ |
| 11.2 退出公司 | CP+CL+MB | `team-quit-btn`+`onTeamQuit()`；channel/member 行移除 | ⬜ |
| 12.1 健康探针 | H | `onHealth()`；`data-health`（可选·一面①连通性） | ⬜ |
| 5.6 群公告 | — | ⛔ 不建 data-announcement（回声不可观测） | ⛔ |
| 5.7 在线状态 | — | ⛔ 不建（后端阻塞） | ⛔ |
| 7.x 搜索 | — | ⛔ 不建 data-search-result（后端空桩） | ⛔ |
| bot/agent | — | 🚫 不建（已移除） | 🚫 |
| **L2 US-17** 他人收推送 | ML | 复用 ML data-msg-id（新行追加·已有 applyMessageItem 追加分支） | 🔗双连接 |
| **L2 6.1b/5.3b/6.2b** 广播 | MB/CL | 复用 data-members/data-admin/行移除（第二连接观测） | 🔗双连接 |

> **L2 复用现状**：双账号广播 UC 的 ③ DOM 全部**复用 L1 已建的 data-\***（他人消息走 `applyMessageItem` 追加分支已存在；成员/admin 广播走 6.1/6.2 同 data-*）——L2 不需新建 DOM 区，只需第二真实连接喂帧。

---

## 4. 按需开发顺序（对齐 rollout 阶段 0–7）

每阶段标**要动哪个区 / 加哪些 data-* 字段 / 加哪些 MessageRow 字段 / 加哪些组件方法**。逐 UC 验绿才动下一个（C006 rollout 纪律）。

| 阶段 | UC | UI 增量（区 + data-* + MessageRow 字段 + 组件方法） |
|---|---|---|
| **0 就绪根** | 4.1 | H：`data-ready` 已有；CL：新建频道列表区 + `data-channel-id`/`data-channel-type` 行渲染（store 加 `applyChannelsLoaded`/`applyChannelIncrement`）。**首个新增区。** |
| **1 建频道** | 5.1/5.2 | CP：`create-channel-btn`+`onCreateChannel()`、`make-topic-btn`+`onMakeTopic()`；CL：新行渲染（store `applyChannelCreated`）。 |
| **2 发消息** | 1.1✅/1.2✅/1.9/1.8/1.10/1.3🌙 | ML 已有；**MessageRow 扩** `urgent`/`reactions`；CP 加 `send-urgent-btn`/行级 `quick-reply-btn`/`schedule-btn`；CL 频道行加 `data-has-schedule-post`。组件方法 `onSendUrgent`/`onQuickReply`/`onSchedule`。 |
| **3 对已发操作** | 1.5✅/3.2/3.1/3.3/1.4/1.7/2.4 | **MessageRow 扩** `templateReceived`/`replyId`；行级件 `revoke-btn`/`read-post-btn`/`template-received-btn`/`resend-btn`/`forward-btn`；AX 新建 `reply-drawer`；`data-read-bits` 走已有字段（投影更新）。组件方法 `onRevoke`/`onPostRead`/`onReadChannel`/`onTemplateReceived`/`onResend`/`onForward`/`onLoadReplies`。 |
| **4 历史** | 2.1/2.3/2.2🔴 | CL 行 click `onSelectChannel`；ML 顶 `load-older-btn`+`onLoadOlder`（prepend）；`onLocatePost` 高亮。store `applyMessageQueryResult`/`applyOlderLoaded`。（2.2 ① 面等 helix wire-bug 修。） |
| **5 频道/成员管理** | 5.4/5.5🟡/5.3🟡/6.3/6.4/6.1🟡/6.2🟡 | **新建成员区 MB**（`data-member-count`+data-member-id 行+`data-admin`/`data-nickname`/`data-members`）；CL 扩 `data-channel-display-name`/`-notice`/`data-channel-top`；CP 加 `close-channel-btn`/`change-channel-btn`/`change-member-btn`/`change-manger-btn`/`change-nickname-btn`。store `applyChannelUpdate`/`applyChannelMemberUpdated`/`applyMemberNickname`/`applyChannelClosed`。 |
| **6 杂项** | 9.x/10.1/4.2/4.5🟡/4.4🟡/8.x🟡/10.2 | AX 新建 `bookmark-panel`/`todo-panel`/`vote-card`/`average-card`；ML 加 `data-system-notice`（MessageRow `systemNotice`）+ `data-vote`/`data-average`（MessageRow `vote`/`average`）；CL `data-unread` badge。store `applyTodoUpdated`/`applyReadResult`(书签/投票)。 |
| **7 teams/运维** | 5.8/11.1/11.2/12.1 | CP 加 `query-channel-btn`/`team-upsert-btn`/`team-quit-btn`/health；H 加 `data-health`（可选）；CL team 大群行 + 退出移除。组件方法 `onQueryChannels`/`onTeamUpsert`/`onTeamQuit`/`onHealth`。 |
| **L2 双连接** | US-17/6.1b/5.3b/6.2b | **零新 DOM**：全复用 L1 已建 data-*（ML 追加分支 / MB data-members/data-admin / CL 行移除）。仅需第二真实连接。 |

> **开发节奏（每 UC）**：模板加件/属性 → **同 commit** 加组件方法 + MessageRow 字段（C007）→ store 加 apply 分支 → `pnpm exec ng build --configuration development` 验无 TSxxxx → `run.sh -- --spec test/specs/uc-X.e2e.mjs` 四面 → reducer 断面 → 验绿 → 翻台账 + 打钩。

---

## 5. 设计约束（落地护栏 · 逐 UC 开发必守）

1. **OnPush + ViewEncapsulation 沿用现状**：单组件内联 styles + signals 驱动；新区/字段加 signal computed，不引入外部状态库。
2. **data-\* 直映投影字段，不在 JS 合成（铁律）**：
   - `data-read-bits` 禁前端算（projection-schema §3）——只透传 `emit_post_read`/`emit_post_received` 的 readBits。
   - `data-members`/`data-member-count` 回读 `emit_channel_member_updated` 透传的 channel 对象，不前端拼成员集。
   - 读族 `data-reactions`/`data-vote`/`data-average` 透传投影 props 串，不解析重组。
3. **加法式扩展，不回退已绿**：UC-1.1/1.2/1.5 冻结集（§2.1）形态禁改；新 data-* 用 `?? null` 未设不渲染，不污染已绿断言。
4. **事件绑定必配组件方法（harness C007 · 头号坑）**：模板每加 `(click)="fn()"`/`[attr.data-x]="m.y"` → 同 commit 加 `fn()`+`MessageRow.y`。live 卡住先 `grep -iE "error|TS[0-9]" /tmp/loopforge/run-ng.log`，别干等满超时。
5. **命名 snake/camel 兼容**：store apply 分支抽字段兼容 `channel_id`(snake) 与 `channelId`(camel)（沿用 `captureActiveChannel`）；`createAt` 非 `createdAt`（命名陷阱）。
6. **选择器锚稳定**：消息行 `@for` track `temporaryId`；行级操作（撤回/已读/转发/回复）用 `[data-temporary-id]` 或 `[data-msg-id]` 选中，不依赖 DOM 顺序。
7. **不建无投影喂数据的区**：⛔ 5.6/5.7/7.x、🚫 bot——建了徒增断言噪音 + 误导覆盖率。
8. **简单风格（CLAUDE §1）**：不追组件/像素保真；折叠面板/抽屉可用最简 `@if` 显隐 + 朴素 flex；交互件就是 `<button data-testid>`，不做样式精修。

---

## 6. 一页速查：现状 → 全 UC 的 DOM 增量边界

| 区 | 现状（已绿） | 全 UC 终态新增 |
|---|---|---|
| **H 状态** | data-ready / data-active-channel | + data-health(可选) |
| **CL 频道列表** | （无·activeChannel 仅 signal） | **新建区** + data-channel-id/-type/-display-name/-notice/-top/-unread/-has-schedule + 行移除 |
| **ML 消息列表** | data-msg-id/-temporary-id/-channel-id/-event-seq/-send-status/-read-bits/-revoke/-type | + data-urgent/-reactions/-template-received/-reply-id/-pinned/-system-notice/-vote/-average |
| **MB 成员区** | （无） | **新建区** + data-member-count/-member-id/-admin/-nickname/-members + 行增减 |
| **CP composer** | input + send-btn + send-document-btn | + 18 个交互件（urgent/quick-reply/schedule/forward/revoke/read×2/template/resend/create-channel/make-topic/close/change×N/load-older/query/team×2/health） |
| **AX 辅助区** | （无） | **新建区** + bookmark-panel/todo-panel/vote-card/average-card/reply-drawer + system-notice 特殊行 |
| **MessageRow 模型** | msgId/temporaryId/channelId/eventSeq/sendStatus/readBits/text/type/revoked | + urgent/reactions/templateReceived/replyId/pinned/systemNotice/vote/average |

---

## 7. 维护铁律

- 本方案 = ③ DOM 面**蓝图**，不是冻结契约（冻结契约是 projection-schema/真机curl真源/四面期望文件·只读）。逐 UC 开发时本文件是**设计参考**，可随 rollout 实跑校正（如 props 串形态、读族字段名以投影实跑为准）。
- 每铺一个 UC → 按本表加件/字段 → 验绿 → 若发现 data-* 形态与本蓝图偏差，**就地校正本文件对应行**（保持蓝图与实跑一致）。
- 新增 UC（rollout 扩） → §3 加一行 + §4 排进对应阶段 + §2 若涉消息行加字段。
- **与 C007 配套**：本文件每标 `(click)="fn()"` 都隐含「同 commit 加 fn()」——开发时把 §3 的「组件方法」列当 checklist。

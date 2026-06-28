# 端点级穷举覆盖交叉映射（HTTP 124 × WS 19 × UC）

> **用途**：把「124 HTTP 接口 + 19 WS action 是否被 UC 覆盖」逐个对到「哪个 UC 触发它」，标出真漏网的，让覆盖可验证。
>
> **真源（只读）**：
> - HTTP 全集：helix `csesapi-migration/full-map/partials/{1-posts,2-channel-sync,3-user-misc,4-bot-agent}.md`（接口名/path verbatim）
> - WS 全集：`partials/5--backend-ws-events.md`（19 action）
> - gap 状态：`30-capability-gap-matrix.md`（covered 86 / partial 30 / missing 7）
> - UC 集：`docs/uc-rollout/rollout-checklist.md`（依赖序 UC 触发 invoke→outbound）+ `docs/uc-coverage-ledger.md`（每 UC ① 出站 HTTP+WS 细节）
>
> 更新 2026-06-26（核对纠正：公告/onlineStatus/modules ⛔→✅·post_pin→UC-5.5b·status/ids/search/demo→✂️ 剔除·重算计数）。
> **增补 2026-06-28**（cses-im-server `feat/im-ws-echo-fills` 实勘+补齐后）：① `users/status/ids` 实测已接线可用（api/user.go→app UserStatusByIds→presenceQuery().OnlineUserIds·WS presence ZSET 真源·非 statusCache 阻塞）→ **✂️→✅（UC-5.7 子项）**，✅ 70→71·✂️ 8→7；② `post_pin`/`add·remove manger` 后端补 WS 广播（post_pin 帧 + channel_member_role_updated）→ echo 面不再 ⛔backend-down。helix spec 真源：`helix/crates/helix-im/docs/uc-automation/{uc-command-set-spec,uc-test-contracts,backend-gap-fills}.md`。

## 图例（覆盖判定）

| 标记 | 含义 |
|---|---|
| ✅ | 被某 managed UC 的 ① 出站触发（在 rollout-checklist / ledger 中有对应 UC）。**含「可达面已 e2e 真跑全绿、echo/广播面 ⛔backend-down（cses-java 宕）」者——覆盖判定看「是否挂到 UC」不看 echo 面 backend-down，backend-down 在备注标明** |
| 🌙 | 按需（真 go 夜间）—— 仅 UC-1.3 文件上传 |
| ⛔ | 阻塞（testbed 物理够不到 / 后端真阻塞）。**2026-06-26 核对纠正后 HTTP 侧 ⛔=0**（公告/onlineStatus/modules 已转 ✅·status/ids/search/demo 已转 ✂️剔除）|
| 🚫 | bot/agent 管理类，2026-06-24 用户裁决不测 |
| ✂️ | **剔除规划（2026-06-26 用户拍板·永久剔除）**：真阻塞且客户端未注册 / 归属 java / 非业务 trace 合成 handler —— 不再当漏网或阻塞挂账，不计入 ⛔ 也不计入 ❓ |
| ❓ | 真漏网：没有任何 UC 触发它，且不属上述任何一类 |

> **触发 UC 列**：填打这个 endpoint 的 UC 编号；对不上填「—」。
> **gap 状态列**：verbatim 自 30-capability-gap-matrix（covered/partial/missing）。

---

## 表 1：HTTP 接口 × UC（逐个 124 接口，按域分组）

### 域 A — posts（35 接口，文件 partials/1）

| # | 接口 path | gap 状态 | 触发 UC | 覆盖判定 |
|---|---|---|---|---|
| 1 | POST `/api/cses/posts/create` | covered | UC-1.1 / 1.2 / 1.4 | ✅ |
| 2 | POST `/api/cses/posts/createPosts` | partial | UC-1.7 | ✅ |
| 3 | POST `/api/cses/posts/createSchedule` | covered | UC-1.10 | ✅ |
| 4 | POST `/api/cses/posts/cancelSchedule` | covered | UC-1.10 | ✅ |
| 5 | POST `/api/cses/posts/getSchedule` | covered | UC-1.10 | ✅ |
| 6 | POST `/api/cses/posts/createMock` | missing（有意不迁·压测旁路） | — | ❓ 真漏网（压测 mock·无 UC，也非 ⛔/🚫/🌙）|
| 7 | POST `/api/cses/posts/urgentPost` | covered | UC-1.9 | ✅ |
| 8 | POST `/api/cses/posts/postContext` | covered | UC-2.2 | ✅ |
| 9 | POST `/api/cses/posts/top20` | covered | UC-2.1（too_long 兜底首屏）| ✅ |
| 10 | POST `/api/cses/posts/urgentConfirm` | covered | UC-1.9 | ✅ |
| 11 | POST `/api/cses/posts/urgentCancel` | covered | UC-1.9（取消加急同 UC 母项）| ✅ |
| 12 | POST `/api/cses/posts/get` | covered | UC-2.3（越界翻页·helix `im_get_posts`·L2/真翻页·L1 走本地Scan未实跑此HTTP）| 🟡 |
| 13 | POST `/api/cses/posts/getPostsAfterIndex` | covered | UC-2.3（越界翻页·helix `im_get_posts_after_index`{postIds:postId 单string}·L2兜底·L1 定位走本地Scan未实跑此HTTP）| 🟡 |
| 14 | POST `/api/cses/posts/revoke` | covered | UC-1.5 | ✅ |
| 15 | POST `/api/cses/posts/getReplies` | covered | UC-2.4 | ✅ |
| 16 | POST `/api/cses/posts/getReplyBranch` | covered | UC-2.4 | ✅ |
| 17 | POST `/api/cses/posts/makeTopic` | covered | UC-5.2 | ✅ |
| 18 | POST `/api/cses/posts/queryTodoList` | covered | UC-10.1 | ✅ |
| 19 | POST `/api/cses/posts/getUpdatedPosts` | covered | — | ❓ 真漏网（增量按时间游标拉更新·无 UC 列它·非 ⛔/🚫/🌙）|
| 20 | POST `/api/cses/posts/getLatestPost` | covered | UC-2.1（too_long 兜底首屏）| ✅ |
| 21 | POST `/api/cses/posts/quickReply` | covered | UC-1.8 | ✅ |
| 22 | POST `/api/cses/posts/updatePostProps` | covered | UC-8.x（投票/平均分 props 更新）| ✅ |
| 23 | POST `/api/cses/post/read` | covered | UC-3.2 | ✅ |
| 24 | POST `/api/cses/post/read/list` | partial | UC-3.2（批量查已读 bitmap·已读读路径）| ✅ |
| 25 | POST `/api/cses/post/templateReceived` | covered | UC-3.3 | ✅ |
| 26 | POST `/api/cses/post/announcement/save` | covered | UC-5.6w | ✅（写族·① 出站经 go :8065 真绿·②④ post_update echo ⛔backend-down 待 cses-java 恢复·**回声实有**·见 9--gap-posts §26）|
| 27 | POST `/api/cses/post/announcement/read` | covered | UC-5.6w | ✅（写族·① 真绿·②④ ⛔backend-down·**回声实有 post_update**·见 9--gap-posts §27）|
| 28 | POST `/api/cses/post/announcement/acceptList` | covered | UC-5.6r | ✅（读族·①② 双面 e2e 真跑全绿·go-served·③④ N/A）|
| 29 | POST `/api/cses/post/announcement/delete` | covered | UC-5.6w | ✅（写族·① 真绿·②④ ⛔backend-down）|
| 30 | POST `/api/cses/post/announcement/list` | covered | UC-5.6r | ✅（读族·①② 双面真跑全绿·go-served·③④ N/A）|
| 31 | POST `/api/cses/post/announcement/detail` | covered | UC-5.6r | ✅（读族·①② 双面真跑全绿·go-served·③④ N/A）|
| 32 | POST `/api/cses/post/approval/approval` | partial | — | ❓ 真漏网（消息审批·无 UC·非 ⛔/🚫/🌙；审批开关入口在 channels/enableApproval 走 5.4，但本审批动作 approval 无 UC）|
| 33 | POST `/api/cses/post/bookmark/create` | covered | UC-9.x | ✅ |
| 34 | POST `/api/cses/post/bookmark/delete` | covered | UC-9.x | ✅ |
| 35 | POST `/api/cses/post/bookmark/load` | covered | UC-9.x | ✅ |

> 域 A 小计（2026-06-26 核对纠正）：✅ 30（公告 6 转 ✅·挂 UC-5.6r 读 3 + UC-5.6w 写 3）· 🟡 2（#12 get / #13 getPostsAfterIndex·L2 越界翻页）· ⛔ 0（原 6 已转 ✅）· ❓ 3（createMock / getUpdatedPosts / approval）。〔修正前：✅ 28（含 🟡 2 误并入）/ ⛔ 6〕

### 域 B — channel + sync（34 接口，文件 partials/2）

| # | 接口 path | gap 状态 | 触发 UC | 覆盖判定 |
|---|---|---|---|---|
| 1 | POST `/api/cses/channels/load/increment` | covered | UC-4.1 | ✅ |
| 2 | POST `/api/cses/channel/load/incrementByChannelId` | covered | UC-4.5 | ✅ |
| 3 | POST `/api/cses/channels/enableApproval` | partial | UC-5.4（群属性·审批开关）| ✅ |
| 4 | POST `/api/cses/channels/view` | covered | UC-3.1 | ✅ |
| 5 | POST `/api/cses/channels/member/byIds` | covered | UC-6.4 | ✅ |
| 6 | POST `/api/cses/channel/member/snapshot` | covered | UC-6.4 | ✅ |
| 7 | POST `/api/cses/channel/create` | partial | UC-5.1 | ✅ |
| 8 | POST `/api/cses/channel/createSpecifyOwner` | partial | UC-5.1（指定 owner 变体·同建群母 UC）| ✅ |
| 9 | POST `/api/cses/channel/change/permission` | partial | UC-5.4 | ✅ |
| 10 | POST `/api/cses/channel/change/notice` | partial | UC-5.4 | ✅ |
| 11 | POST `/api/cses/channel/change/info` | partial | UC-5.4 | ✅ |
| 12 | POST `/api/cses/channel/change/source` | partial | UC-5.4 | ✅ |
| 13 | POST `/api/cses/channel/change/displayName` | partial | UC-5.4 | ✅ |
| 14 | POST `/api/cses/channel/change/picture` | partial | UC-5.4 | ✅ |
| 15 | POST `/api/cses/channel/change/props` | partial | UC-5.4（群扩展属性·change/* 同族）| ✅ |
| 16 | POST `/api/cses/channel/change/orient` | partial | UC-5.4 | ✅ |
| 17 | POST `/api/cses/channel/change/purpose` | partial | UC-5.4 | ✅ |
| 18 | POST `/api/cses/channel/change/top` | partial | UC-5.5 | ✅ |
| 19 | POST `/api/cses/channel/add/manger` | partial | UC-6.2 | ✅（2026-06-28 `feat/im-ws-echo-fills` 补 `channel_member_role_updated` 广播·role=ADMIN）|
| 20 | POST `/api/cses/channel/remove/manger` | partial | UC-6.2 | ✅（同·补 role 广播·role=普通）|
| 21 | POST `/api/cses/channel/add/postPinned` | partial | UC-5.5 | ✅ |
| 22 | POST `/api/cses/channel/remove/postPinned` | partial | UC-5.5 | ✅ |
| 23 | POST `/api/cses/channel/load/notice` | covered | UC-5.4（公告栏回读·改 notice 后读）| ✅ |
| 24 | POST `/api/cses/channel/load/postPinned` | covered | UC-5.5 | ✅ |
| 25 | POST `/api/cses/channel/load/admin` | covered | UC-6.2（管理员列表读路径）| ✅ |
| 26 | POST `/api/cses/channel/query` | covered | UC-5.8 | ✅（2026-06-24 新增 UC）|
| 27 | POST `/api/cses/channel/close` | covered | UC-5.3 | ✅ |
| 28 | POST `/api/cses/channel/onlineStatus` | partial | UC-5.7 | ✅（读族·①② 双面 e2e 真跑全绿·已迁移返 data·go-served·③④ N/A；users/status/ids 2026-06-28 实测已接线可用→见域C#2 转 ✅）|
| 29 | POST `/api/cses/channel/member/change/role` | partial | UC-6.2 | ✅ |
| 30 | POST `/api/cses/channel/member/change/notify` | partial | UC-5.4（成员免打扰·5.4 列 member/change/notify）| ✅ |
| 31 | POST `/api/cses/channel/member/change/nickname` | partial | UC-6.3 | ✅ |
| 32 | POST `/api/cses/channel/member/change` | partial | UC-6.1 | ✅ |
| 33 | POST `/api/cses/channel/member/leave` | partial | UC-5.3（退群·5.3 退出群映射）| ✅ |
| 34 | POST `/api/cses/channel/sync/notify` | covered | UC-4.2 | ✅ |

> 域 B 小计（2026-06-26 核对纠正）：✅ 34（含 UC-5.8 channel/query + onlineStatus 转 ✅）· ⛔ 0（原 onlineStatus 1 已转 ✅）· ❓ 0。〔修正前：✅ 33 / ⛔ 1〕

### 域 C — user-misc（15 接口，文件 partials/3）

| # | 接口 path | gap 状态 | 触发 UC | 覆盖判定 |
|---|---|---|---|---|
| 1 | POST `/api/cses/users/list` | covered | UC-6.4（拉成员用户·成员全量读路径）| ✅ |
| 2 | POST `/api/cses/users/status/ids` | covered | UC-5.7 | ✅（2026-06-28 实勘纠正·非 statusCache 阻塞·已接线：api/user.go:27 userStatusByIds→app/cses_user.go:32 UserStatusByIds→presenceQuery().OnlineUserIds·WS presence ZSET `ws:presence:{userID}` 真源·`feat/im-ws-echo-fills` 补 API 层测试）|
| 3 | POST `/api/cses/users` | missing（真阻塞·createUser）| — | ❓ 真漏网（开户深耦合原生·客户端无 invoke·非 ⛔/🚫/🌙 任一类·gap=真阻塞）|
| 4 | POST `/api/cses/teams/upsert` | covered | UC-11.1 | ✅（2026-06-24 新增 UC）|
| 5 | POST `/api/cses/teams/member/add` | covered | UC-6.1（team 域复用 channel ChannelMemberChange·与 channel#32 同 app 方法）| ✅ |
| 6 | DELETE `/api/cses/teams/member/quit` | covered | UC-11.2 | ✅（2026-06-24 新增 UC·配 WS quit_company）|
| 7 | POST `/api/cses/groups` | missing（uncertain·空骨架）| — | ❓ 真漏网（空骨架从未实现·无 UC）|
| 8 | POST `/api/cses/modules/getAll` | covered | UC-10.3 | ✅（读族·①② 双面 e2e 真跑全绿·查库直返 data=[]*Modules·空 body·go-served·③④ N/A）|
| 9 | POST `/api/cses/notification/loadSend` | partial | — | ❓ 真漏网（加载通知发送侧·无 UC·非 ⛔/🚫/🌙）|
| 10 | POST `/api/cses/notification/loadTarget` | missing（uncertain·store 全注释）| — | ❓ 真漏网（接收侧通知·store 未实现·无 UC）|
| 11 | POST `/api/cses/search/post` | partial | — | ✂️ 剔除（2026-06-26 用户拍板·空桩 ES/store 未迁·归属 java·不列入本仓规划）|
| 12 | POST `/api/cses/search/user` | partial | — | ✂️ 剔除（同·归属 java）|
| 13 | POST `/api/cses/search/channel` | partial | — | ✂️ 剔除（同·归属 java）|
| 14 | POST `/api/cses/search/do` | covered | — | ✂️ 剔除（同·聚合搜索·归属 java）|
| 15 | GET `/api/cses/health` | covered | UC-12.1 | ✅（2026-06-24 新增 UC·连通性 1 面）|

> 域 C 小计（2026-06-28 增补纠正）：✅ **7**（users/list·teams/upsert→11.1·teams/member/add→6.1·teams/quit→11.2·health→12.1·modules→10.3·**status/ids→5.7 实测接线**）· ⛔ 0 · ✂️ 剔除 **4**（search 4 件·status/ids 已转 ✅）· ❓ 4（users / groups / loadSend / loadTarget）。〔2026-06-26：✅ 6 / ✂️ 5；本次 status/ids ✂️→✅〕

### 域 D — bot-agent / webhook / cross-repo demo（40 接口，文件 partials/4）

> bot/agent **管理 + 调用类整体 🚫bot移除**（2026-06-24 用户裁决不测）；只有 vote/average 互动卡片归 UC-8.x —— **但 vote/average 端点不在 partials/4，走第二网关 :3399（partials/6 集合八），不属本 40 接口**。cross-repo demo（#38-40）是 GitNexus trace 合成 handler，有意排除（非业务）。

| # | 接口 path | gap 状态 | 触发 UC | 覆盖判定 |
|---|---|---|---|---|
| 1 | POST `/api/cses/posts/createBot` | covered | — | 🚫 bot移除 |
| 2 | POST `/api/cses/posts/botCallback` | covered | — | 🚫 bot移除 |
| 3 | GET `/api/cses/bot-manage/list` | covered | — | 🚫 bot移除 |
| 4 | POST `/api/cses/bot-manage/create` | covered | — | 🚫 bot移除 |
| 5 | POST `/api/cses/bot-manage/token/generate` | covered | — | 🚫 bot移除 |
| 6 | GET `/api/cses/bot-manage/token/list` | covered | — | 🚫 bot移除 |
| 7 | POST `/api/cses/bot-manage/token/revoke` | covered | — | 🚫 bot移除 |
| 8 | POST `/api/cses/bot-manage/scope/set` | covered | — | 🚫 bot移除 |
| 9 | POST `/api/cses/bot-manage/scope/visible-user/add` | covered | — | 🚫 bot移除 |
| 10 | POST `/api/cses/bot-manage/scope/visible-user/remove` | covered | — | 🚫 bot移除 |
| 11 | GET `/api/cses/bot-manage/scope/visible-user/list` | covered | — | 🚫 bot移除 |
| 12 | POST `/api/cses/bot-agent/config` | covered | — | 🚫 bot移除 |
| 13 | GET `/api/cses/bot-agent/config/{botUserId}` | covered | — | 🚫 bot移除 |
| 14 | GET `/api/cses/bot-agent/configs/enabled` | covered | — | 🚫 bot移除 |
| 15 | DELETE `/api/cses/bot-agent/config/{botUserId}` | covered | — | 🚫 bot移除 |
| 16 | POST `/api/cses/bot-agent/config/{botUserId}/regenerate-token` | covered | — | 🚫 bot移除 |
| 17 | POST `/api/cses/bot-agent/config/{botUserId}/test-webhook` | covered | — | 🚫 bot移除 |
| 18 | GET `/api/cses/bot-agent/channel/{channelId}/bots` | covered | — | 🚫 bot移除 |
| 19 | GET `/api/cses/bot-agent/channel/{channelId}/available-bots` | covered | — | 🚫 bot移除 |
| 20 | POST `/api/cses/bot-agent/channel/{channelId}/bot/{botUserId}` | covered | — | 🚫 bot移除 |
| 21 | DELETE `/api/cses/bot-agent/channel/{channelId}/bot/{botUserId}` | covered | — | 🚫 bot移除 |
| 22 | GET `/api/cses/bot-agent/info` | covered | — | 🚫 bot移除 |
| 23 | POST `/api/cses/bot-agent/messages/direct` | partial | — | 🚫 bot移除 |
| 24 | POST `/api/cses/bot-agent/messages/channel` | partial | — | 🚫 bot移除 |
| 25 | GET `/api/cses/bot-agent/teams/{team_id}/members` | partial | — | 🚫 bot移除 |
| 26 | GET `/api/cses/bot-agent/teams/{team_id}/users/{user_id}` | partial | — | 🚫 bot移除 |
| 27 | GET `/api/cses/bot-agent/teams/{team_id}/channel` | covered | — | 🚫 bot移除 |
| 28 | POST `/api/cses/agents/create` | covered | — | 🚫 bot移除 |
| 29 | POST `/api/cses/agents/join-channel` | covered | — | 🚫 bot移除 |
| 30 | POST `/api/cses/agents/start-session` | covered | — | 🚫 bot移除 |
| 31 | POST `/api/cses/agents/send` | covered | — | 🚫 bot移除 |
| 32 | POST `/api/cses/agents/callback` | covered | — | 🚫 bot移除 |
| 33 | GET `/api/cses/agents/session/{sessionId}/timeline` | missing（uncertain）| — | 🚫 bot移除 |
| 34 | GET `/api/cses/agents/session/{sessionId}/cost` | missing（uncertain）| — | 🚫 bot移除 |
| 35 | POST `/api/cses/webhook/config` | covered | — | 🚫 bot移除（webhook 分发配置·bot/agent 链路）|
| 36 | GET `/api/cses/webhook/config` | covered | — | 🚫 bot移除 |
| 37 | POST `/api/cses/webhook/test` | covered | — | 🚫 bot移除 |
| 38 | POST `/api/cses/channels/csesCrossRepoDemo` | covered | — | ✂️ 剔除（2026-06-26 用户拍板·cross-repo trace 合成 handler·非业务·永久剔除）|
| 39 | POST `/api/cses/channels/crossRepoCounterPoll` | covered | — | ✂️ 剔除（同·trace 合成 handler·非业务）|
| 40 | POST `/api/cses/channels/triggerMmToCsesCounterAck` | covered | — | ✂️ 剔除（同·trace 合成 handler·非业务）|

> 域 D 小计（2026-06-26 核对纠正）：🚫 bot移除 37 · ✂️ 剔除 3（cross-repo demo #38-40·trace 合成 handler·非业务·用户拍板永久剔除）。〔修正前：❓ 3〕

---

## 表 2：WS action × UC（逐个 19）

> WS 全集真源 = partials/5（19 action）。② 投影工厂 = projection-schema 对应 emit_*。

| # | WS action | 触发它的 UC | ② 投影工厂 | 覆盖判定 |
|---|---|---|---|---|
| 1 | `post` | UC-1.1 / 1.2 / 1.4（首发）· UC-6.1（拉踢 type=leave post）· US-17（他人发·L2）| `emit_post_received`（fat）| ✅ |
| 2 | `posts_update` | UC-1.5（撤回批帧）| `emit_post_batch_updated` | ✅ |
| 3 | `post_update` | UC-1.5（在线撤回）· UC-1.8（quickReply）· UC-1.9（加急）· UC-3.3（模板已收到）| `emit_post_updated`（fat）| ✅ |
| 4 | `post_read` | UC-3.1（会话已读）· UC-3.2（单条已读）| `emit_post_read`（fat）| ✅ |
| 5 | `post_pin` | UC-5.5b（消息置顶）| `emit_post_updated` | ✅（UC-5.5b·① 出站 `channel/add/postPinned` 真绿·②③④ **2026-06-28 cses-im-server `feat/im-ws-echo-fills` 补 post_pin 广播帧**(sendPinSystemPost 写库后 publish·operation add/remove)→ echo 面解除 backend-down）|
| 6 | `post_schedule_created` | UC-1.10 | `emit_schedule_created` | ✅ |
| 7 | `post_schedule_canceled` | UC-1.10 | `emit_schedule_canceled` | ✅ |
| 8 | `increment_channel` | UC-4.1（hello）· UC-4.5（陌生 channel 自动注册）| `emit_channel_increment` | ✅ |
| 9 | `increment_channel_end` | UC-4.1（就绪 probe 锚）| `emit_channel_update`（thin·批次结束）| ✅ |
| 10 | `channel_created` | UC-5.1（建群 type=P）· UC-5.2（话题 type=T）· UC-6.4（携全员快照）| `emit_channel_created` | ✅ |
| 11 | `channel_member_update` | UC-5.1（入群成员）· UC-6.1（加入已有群）| `emit_channel_member_updated` | ✅ |
| 12 | `channel_member_role_updated` | UC-6.2 | `emit_channel_member_updated` / `emit_channel_update` | ✅ |
| 13 | `channel_close` | UC-5.3 | `emit_channel_closed` | ✅ |
| 14 | `update_channel` | UC-5.4（改名/简介/通知）· UC-5.5（频道置顶 per-member）· UC-3.1（已读刷会话 badge）| `emit_channel_update`（thin）| ✅ |
| 15 | `update_channel_notice` | UC-5.4（改公告 content.text）| `emit_channel_update`（thin）| ✅ |
| 16 | `update_channel_member_nickName` | UC-6.3 | `emit_member_nickname` | ✅ |
| 17 | `change_channel_approval` | UC-5.4（开/关审批·channels/enableApproval）| `emit_channel_update`（thin）| ✅ |
| 18 | `quit_company` | UC-11.2 | （退公司·member/channel 移除）| ✅（2026-06-24 新增 UC）|
| 19 | `post`（agent/bot 变体）| — | `emit_post_received` | 🚫 bot移除（bot/agent 回复·与 #1 同 action·触发源是 bot 链路）|

> WS 小计（2026-06-26 核对纠正）：✅ 17（含 quit_company→UC-11.2 + post_pin→UC-5.5b 转 ✅）· ⛔ 0（原 post_pin 1 已转 ✅）· 🚫 1（post agent/bot 变体）· ❓ 0。〔修正前：✅ 16 / ⛔ 1〕
> 注：#1 与 #19 是同一 action 字符串 `post`，按触发源拆两行（业务发消息 ✅ / bot 变体 🚫），去重后不同 action 字符串 18 个。

---

## 汇总

### HTTP（124 接口）

| 判定 | 数量 | 分布 |
|---|---|---|
| ✅ 被 managed UC 触发 | **71** | 域 A 30 + 域 B 34 + 域 C 7（2026-06-28 +status/ids→5.7）|
| 🟡 部分面（L2/越界翻页）| **2** | 域 A #12 get / #13 getPostsAfterIndex（L2 真翻页·L1 走本地 Scan）|
| 🌙 按需（文件上传）| **0** | UC-1.3 文件上传**不打 csesapi 端点**（上传接口在 java·posts/create 底层走域A#1 已 ✅）→ 本 124 内无独立 🌙 接口 |
| ⛔ 阻塞 | **0** | 2026-06-26 核对纠正：公告 6/onlineStatus 1/modules 1 转 ✅·status/ids 1+search 4 转 ✂️ → ⛔ 清零 |
| 🚫 bot移除 | **37** | 域 D #1-37 |
| ✂️ 剔除规划 | **7** | search 4（域C#11-14）+ cross-repo demo 3（域D#38-40）〔2026-06-28 status/ids 移出转 ✅〕|
| ❓ 真漏网 | **7** | 见下逐个列出 |

> **2026-06-26 核对纠正来源**：用户拍板 ① 公告 save/read 实有 WS post_update 广播（9--gap-posts §26-27·原「回声不可观测」描述错误，已更正）→ 公告 6 转 ✅（读 3·UC-5.6r / 写 3·UC-5.6w）；② onlineStatus 已迁移返 data → 转 ✅（UC-5.7 读族·与真阻塞的 users/status/ids 解耦）；③ modules/getAll 查库直返 → 转 ✅（UC-10.3 读族）；④ post_pin 用户拍板挂 UC-5.5b → WS 转 ✅；⑤ users/status/ids + search×4 + cross-repo demo×3 → ✂️ 永久剔除（不计 ⛔ 不计 ❓）。
> **✅ 精确计数**：域A 30 + 域B 34 + 域C 7 = **71**（2026-06-28 +status/ids）。
> **🚫**：域D #1-37 = **37**。
> **✂️ 剔除**：域C 4（search 4）+ 域D 3（demo）= **7**（status/ids 已转 ✅）。
> **❓ 真漏网**：124 − 71 − 2（🟡）− 37（🚫）− 7（✂️）= **7**。

#### ❓ 真漏网逐个清单（7 个）

| 接口 path | 域 | gap 状态 | 为什么漏网 |
|---|---|---|---|
| POST `/api/cses/posts/createMock` | A | missing | 压测旁路直发 Pulsar MockTopic·已拍板废弃·无 UC |
| POST `/api/cses/posts/getUpdatedPosts` | A | covered | 按时间游标增量拉更新消息·rollout 用 channel_event v2 cursor sync（4.2）取代·无 UC 列它 |
| POST `/api/cses/post/approval/approval` | A | partial | 消息审批动作·客户端无对应 invoke·审批开关入口（enableApproval）走 5.4 但本审批动作无 UC |
| POST `/api/cses/users` | C | missing（真阻塞）| 开户深耦合原生 mattermost·客户端无 invoke·gap=createUser 真阻塞·非测试范围 |
| POST `/api/cses/groups` | C | missing（uncertain）| 空骨架从未实现·无 UC |
| POST `/api/cses/notification/loadSend` | C | partial | 加载发送侧通知·客户端无对应 invoke·无 UC |
| POST `/api/cses/notification/loadTarget` | C | missing（uncertain）| 接收侧通知·store 全注释返 nil·无 UC |

> **修正前 → 修正后对照（HTTP）**：
> | 判定 | 修正前（2026-06-24 严口径）| 修正后（2026-06-26 核对纠正）|
> |---|---|---|
> | ✅ | 66 | **70**（+公告6 +onlineStatus1 +modules1·−原误并入的 🟡 2）|
> | 🟡 | （并入 ✅）| **2**（拆出 get/getPostsAfterIndex）|
> | ⛔ | 13 | **0**（全部转 ✅ 或 ✂️）|
> | 🚫 | 37 | 37（不变）|
> | ✂️ | （无此类）| **8**（status/ids + search4 + demo3）|
> | ❓ | 8（含 demo 3）| **7**（demo 3 移出归 ✂️·原「真业务漏网 5」实为 7·此处一并校正）|
> | 合计 | 124 | 124 ✓ |

**HTTP 最终计数（2026-06-28 增补纠正）**：✅ **71** · 🟡 2 · 🌙 0 · ⛔ 0 · 🚫 37 · ✂️ **7** · ❓ 7 = 124 ✓〔2026-06-26 为 ✅70/✂️8；status/ids ✂️→✅〕

### WS（19 action）

| 判定 | 数量 | action |
|---|---|---|
| ✅ 被 UC 触发 | 17 | post / posts_update / post_update / post_read / **post_pin（UC-5.5b·2026-06-26 转 ✅）** / post_schedule_created / post_schedule_canceled / increment_channel / increment_channel_end / channel_created / channel_member_update / channel_member_role_updated / channel_close / update_channel / update_channel_notice / update_channel_member_nickName / change_channel_approval / quit_company（共 18 条目，含同 action 复用）|
| ⛔ 阻塞 | 0 | 2026-06-26 核对纠正：post_pin 转 UC-5.5b ✅（echo 面 ⛔backend-down 不改覆盖判定）|
| 🚫 bot移除 | 1 | post（agent/bot 变体）|
| ❓ 漏网 | 0 | （quit_company 2026-06-24 已转 UC-11.2）|

> 去重后 18 个不同 action 字符串（`post` 业务+bot 两变体共用）。
> **修正前 → 修正后对照（WS）**：✅ 16→**17**（post_pin 转入）· ⛔ 1→**0**（post_pin 转出）· 🚫 1（不变）· ❓ 0（不变）。
> **WS 漏网逐个**：无（`quit_company` 已转 UC-11.2·`post_pin` 2026-06-26 已转 UC-5.5b）。

---

## 诚实结论

**不是「所有可达 HTTP+WS 都对得上某 UC」。** 但 2026-06-26 核对纠正后，可达业务面已**逐个对得上 UC**，剩余 ❓ 全部是「客户端无 invoke 的服务端/运维/废弃/被取代」链路：

1. **HTTP ✂️ 剔除规划 7 个**（2026-06-28：原 8·status/ids 已转 ✅）：
   - ~~`users/status/ids`~~ **2026-06-28 转 ✅（UC-5.7 子项）**：实勘非 statusCache 阻塞·已接线复用 WS presence ZSET 真源（`feat/im-ws-echo-fills` 补 API 层测试）。
   - **归属 java·不列入本仓规划**：`search/post|user|channel|do`（空桩·ES/store 未迁）。
   - **非业务 trace 合成 handler**：`channels/csesCrossRepoDemo` / `crossRepoCounterPoll` / `triggerMmToCsesCounterAck`（GitNexus cross-repo trace·非业务）。

2. **HTTP ❓ 真业务漏网 7 个**（全部客户端无 invoke·非 UC 漏铺）：
   - **客户端无对应 invoke 的后台链路**：`users`（开户·真阻塞）/ `groups`（空骨架）/ `notification/loadSend` / `notification/loadTarget`。
   - **被新架构取代**：`posts/getUpdatedPosts`（旧时间游标增量·已被 channel_event v2 cursor sync = UC-4.2 取代）/ `posts/createMock`（压测旁路·已废弃）。
   - **客户端无 invoke 的服务端动作**：`post/approval/approval`（消息审批动作·审批开关入口 enableApproval 走 5.4·本审批动作无 UC）。

3. **2026-06-26 转 ✅（原 ⛔）**：公告 6（`announcement/{save,read,acceptList,delete,list,detail}`→UC-5.6r 读 + UC-5.6w 写）/ `channel/onlineStatus`→UC-5.7 / `modules/getAll`→UC-10.3。WS `post_pin`→UC-5.5b。
   **2026-06-28 echo/广播面解除 backend-down**（cses-im-server `feat/im-ws-echo-fills` 实补）：`post_pin` 广播帧 + `add/remove manger` 的 `channel_member_role_updated` 广播；公告 save/read/delete 实勘早已链 `publishPostUpdate`（旧 ⛔backend-down 系 cses-java 宕的环境噪音·非契约缺口）。

4. **WS 漏网**：无（`quit_company`→UC-11.2·`post_pin`→UC-5.5b）。

**一句话**：loopforge 客户端 UC 集对**客户端可触发的业务面**逐个对得上（HTTP ✅ **71**·域A 30/B 34/C 7；WS ✅ 17）；HTTP ⛔ 清零；2026-06-28 后端补齐后 echo/广播面亦解除 backend-down；✂️ 剔除 **7** + ❓ 真漏网 7 **全部是「客户端无 invoke 的服务端/运维/废弃/被取代/归属 java/非业务」链路**，不在「最小可测客户端宿主」职责范围内。

> **可验证性**：本表每行 gap 状态 verbatim 自 30-capability-gap-matrix，触发 UC verbatim 自 rollout-checklist / uc-coverage-ledger，端点 path verbatim 自 partials/1-5。任一行可回溯真源逐字核对。

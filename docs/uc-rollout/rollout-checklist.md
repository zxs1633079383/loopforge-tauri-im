# UC Rollout 最终计划 + 勾选清单（依赖序 · 细粒度四面锚点）

> 契约细节 = `docs/uc-coverage-ledger.md`；四面真源 = helix `真机curl真源.md`(①) / `projection-schema.md`(②) / `partials/8`(④)。
> 本文件 = 执行计划 + 进度（e2e 四面全绿 → 自动打钩）。更新 2026-06-24。
> **范围**：只列可铺 UC（含 🌙 按需）。⛔ 阻塞/gap（1.6 无编辑端点 / 5.6 公告无 echo / 5.7 在线状态后端阻塞 / 7.x 搜索空桩 / 4.3 too_long harness-gap / bot-agent 已移除）**不在本清单管理**。

## 图例
`[x]`✅四面全绿 · `[ ]`⬜L1待铺(单账号自发回流) · `[~]`🟡主路径绿+子项需双连接 · `[2]`🔗需第二真实连接 · `[n]`🌙按需(真go夜间) · 难度 S/M/D
> **依赖序铁律**：没有群聊无法发消息；没有已发消息无法撤回/已读/转发。后序复用前序真实数据。

---

## 阶段 0 · 就绪根
| 勾 | UC | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 难度 |
|---|---|---|---|---|---|---|---|
| [x] | 4.1 hello 全量增量 | (WS hello 自动)/`channels/load/increment` | `partials/8 http.rs:25`{timestamp,cursors:[{channelId,fromSeq}]} | `emit_channels_loaded`+`emit_channel_increment`+`emit_channel_update` | data-ready + channel 行 | `channel`+`channel_event_cursor` | M |

## 阶段 1 · 建频道（产出可发消息容器）
| 勾 | UC | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 难度 |
|---|---|---|---|---|---|---|---|
| [x] | 5.1 创建群聊 | `im_create_channel`→`channel/create` | `真机curl真源 §4`(type:P/users role/picture/forceCreate) | `emit_channel_created`{channel_id,channel} | data-channel-id 新行 | `channel` 新行 | M |
| [x] | 5.2 创建话题 | `im_make_topic`→`posts/makeTopic` | `真机curl真源 §2`(rootId/users CREATOR/picture) | `emit_channel_created`(type=T) | data-channel-id(topic) | `channel`(type=T) | M |

## 阶段 2 · 发消息（依赖频道）
| 勾 | UC | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 难度 |
|---|---|---|---|---|---|---|---|
| [x] | 1.1 发文本 | `im_send`→`posts/create` | `真机curl真源 §1`(camel 全字段) | `emit_post_received`(fat)+`emit_post_sending` | data-msg-id(tmp→server) data-send-status data-event-seq | `message`+cursor+1 | S |
| [x] | 1.2 发文档 | `im_send`(type=DOCUMENT)→`posts/create` | `真机curl真源 §1`+type 透传 | `emit_post_received`(fat) | 同 1.1 + data-type=DOCUMENT | `message` | S |
| [x] | 1.9 加急+加急已读 | `posts/urgentPost`/`urgentConfirm` | `partials/6 UC-1.9` | `emit_post_updated`(fat·expediteMap **不吐**·line186) | post-row 重渲(data-urgent **不可投影驱动**·DB 回读 expedite_map) | `message` batch_update(expedite_map 列) | M |
| [x] | 1.8 快捷回复 emoji | `im_send_quick_reply`→`posts/quickReply`{emoji,postId,userId} | `partials/6 UC-1.8` | `emit_post_updated`(fat·顶层 quickReply 合并进 props.quickReply·parser bbbf809) | data-reactions(👍) | `message` batch_update(quick_reply 列) | S |
| [x] | 1.10 定时消息 | `posts/createSchedule`/`cancelSchedule`/`getSchedule` | `partials/6 UC-1.10` | `emit_schedule_created`/`canceled`{channelId,hasSchedulePost} | data-has-schedule-post | `channel.has_schedule_post` | M |
| [n] | 1.3 发图片/文件 🌙 | (上传·java 接口·todo)+`im_send`→`posts/create` | `真机curl真源 §1`+props.file | `emit_post_received`(fat) | data-send-status:uploading→sent | `message` | D(真go夜间) |

## 阶段 3 · 对已发消息操作（依赖阶段 2 server_id）
| 勾 | UC | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 难度 |
|---|---|---|---|---|---|---|---|
| [x] | 1.5 撤回 | `im_revoke`→`posts/revoke` | `真机curl真源 §3`{postId}✅ | `emit_post_batch_updated`(在线)/`emit_post_deleted`(离线) | data-revoke=1/行移除 | `message` mark_revoked | S |
| [~] | 3.2 单条已读 | `im_mark_read`→`post/read`{channelId,posts:[postId]}✅ | `partials/6 UC-3.2` | `emit_post_read`(fat)🟡L2 | data-read-bits✅ | `message.read_bits`🟡L2 | S |
| [~] | 3.1 会话已读 | `im_read_channel`→`im_channels_view`→`channels/view`{channels:[{id}]}✅ | `partials/6 UC-3.1` | `emit_post_read`(fat)🟡L2 | data-read-bits✅ | `message.read_bits`🟡L2 | S/M |
| [x] | 3.3 模板已收到 | `templateReceived`→`post/templateReceived` | `partials/6 UC-3.3`{postId}(单数 path) | `emit_post_updated`/read:result | data-template-received | `message` | S |
| [ ] | 1.4 重发失败 | `im_send`(temp_id 复用)→`posts/create` | `真机curl真源 §1` | `emit_post_sending`→`emit_post_received` | data-send-status:failed→sending→sent | `message` upsert 覆盖 | S |
| [ ] | 1.7 转发/合并 | `im_create_posts`→`posts/createPosts` | `真机curl真源 附录A`{posts,channelIds}✅ | 各目标 channel `emit_post_received` | 多 channel 消息行 | `message`×N | M |
| [ ] | 2.4 一级/二级回复 | `posts/getReplies`/`getReplyBranch` | `partials/6 UC-2.4` | `query::emit_read_result`(读族透传) | data-reply-id | `Scan message`(回复链) | M |

## 阶段 4 · 历史（依赖累积消息）
| 勾 | UC | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 难度 |
|---|---|---|---|---|---|---|---|
| [ ] | 2.1 切群首屏(3 面) | `im_query_messages_by_channel`(本地) | (本地 Scan·无 HTTP 出站) | `query::emit_message_query_result`(透传) | N 个消息行 data-msg-id | `Scan message` | S |
| [ ] | 2.3 按 postId 定位 | `posts/getPostsAfterIndex`{postIds:postId} | `partials/6 UC-2.3` | `query::emit_message_query_result`(透传) | data-msg-id 命中高亮 | `Scan message` | S |
| [ ] | 2.2 上拉更早历史(3 面) | `im_load_older_context`→`posts/postContext`×N | `partials/8 http.rs:89`{postId,before} | `older_context::emit_older_loaded`(透传) | prepend 更早行 | `message` upsert prepend | M |

> ⚠️ 2.2 ①预期红：acl query 放行 fix 在 helix round3，不在 pin 的 round6@248fc84 → 出 bug 报告(不改 helix)。

## 阶段 5 · 频道 / 成员管理（依赖频道）
| 勾 | UC | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 难度 |
|---|---|---|---|---|---|---|---|
| [ ] | 5.4 群属性修改 | `channel/change/{displayName,notice,…}` | `partials/6 UC-5.4` | `emit_channel_update`(thin{channel_id}) | data-channel-* 回读 | `channel` patch | M |
| [~] | 5.5 置顶 | `channel/change/top`/`add(remove)/postPinned` | `partials/6 UC-5.5` | `emit_channel_update`/`emit_read_result` | data-pinned | `channel`/`message.props` | M |
| [~] | 5.3 关闭/退出群 | `im_channel_close`→`channel/close` | `真机curl真源 §6`{channelId}✅ | `emit_channel_closed`{channelId,deleteAt} | channel 行移除 | `channel` 软删 | M |
| [ ] | 6.3 改群昵称 | `channel/member/change/nickname` | `partials/6 UC-6.3` | `emit_member_nickname`{channelId,userId,nickName} | data-nickname | `channel_member` | M |
| [ ] | 6.4 成员快照/全量 | `channel/member/snapshot`/`channels/member/byIds` | `partials/6 UC-6.4` | `query::emit_read_result`(读族) | data-member-count | `channel_member` 自愈 | M |
| [~] | 6.1 拉/踢人 | `channel/member/change`(join/leave) | `真机curl真源 §5`{channelId,joinUsers/leaveUsers} | `emit_channel_member_updated`{channel_id,channel} | data-members 回读 | `channel_member` | M |
| [~] | 6.2 设/撤管理员 | `channel/add/manger`/`remove/manger` | `partials/6 UC-6.2` | `emit_channel_member_updated`/`emit_channel_update` | data-admin | `channel_member` | M |

## 阶段 6 · 杂项（书签/待办/同步/互动卡片/系统）
| 勾 | UC | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 难度 |
|---|---|---|---|---|---|---|---|
| [ ] | 9.x 书签 | `post/bookmark/{create,delete,load}` | `partials/6 集合九` | `query::emit_read_result`(读族透传) | data-bookmark | `message`(书签) | M |
| [ ] | 10.1 待办列表 | (hello 收尾自驱)`posts/queryTodoList` | `partials/8 http.rs:67` | `todo::emit_todo_updated`{items} | data-todo 列表 | `todo` 表 | M |
| [ ] | 4.2 按需 sync notify | `im_sync_channels`→`channel/sync/notify` | `partials/8 §2.1`{cursors:[{channelId,fromSeq}]} | `emit_post_*`+`emit_channel_update_by_post`(thin) | 增量行+badge | `message`+cursor 跳空洞 | M |
| [~] | 4.5 陌生 channel 兜底 | `ensure_channel_loaded`→`channel/load/incrementByChannelId` | `partials/8 http.rs:47`{channelId} | `emit_channel_increment` | 单 channel 增量渲染 | `channel`+cursor | M |
| [~] | 4.4 心跳 gap 补偿(3 面) | (Rust ping/pong piggyback 自驱) | `partials/8 §5.7`{cursors,allHash} | (补偿走 4.2 sync 投影) | **③ N/A（已移除该面）** | `channel_event_cursor` | M(①②④+cursor) |
| [~] | 8.x 投票 CRUD | `vote/{createVote,vote,readVote,closeVote,deleteVote}`(:3399) | `partials/6 集合八` | `emit_post_updated`(fat) | data-vote | `message.props` | M |
| [~] | 8.x 平均分 CRUD | `average/{publish,attend,read,close,delete}`(:3399) | `partials/6 集合八` | `emit_post_updated`(fat) | data-average | `message.props` | M |
| [ ] | 10.2 系统通知 | (WS 帧触发·无独立 HTTP) | — | `emit_post_received`/`updated`(系统消息) | data-system-notice | `message`(SYSTEM/SYSTEN 类型) | M |

## 阶段 7 · teams / 运维（2026-06-24 新增·原端点漏网→用户确认要测）
| 勾 | UC | 触发 invoke → outbound | ① 出站真源 | ② 投影工厂 | ③ DOM data-* | ④ DB 表 | 难度 |
|---|---|---|---|---|---|---|---|
| [ ] | 5.8 条件查频道 | `im_query_channels`→`channel/query` | `partials/2 channel/query`(条件分页) | `query::emit_read_result`/`channels:projection`(透传) | data-channel-id 列表 | `Scan channel` | S |
| [ ] | 11.1 维护公司大群 | `im_team_upsert`→`teams/upsert` | `partials/3 teams/upsert` | `emit_channel_created`/`emit_channel_update`(公司大群) | data-channel-id(team 大群) | `channel` | M |
| [ ] | 11.2 退出公司 | `im_team_quit`→`teams/member/quit`(DELETE) + WS `quit_company` | `partials/3 teams/member/quit` | (member/channel 移除投影) | channel/member 行移除 | `channel_member` 删 | M |
| [ ] | 12.1 健康探针(1 面①) | `im_health`→`GET /health` | `partials/3 health` | (无投影) | data-health(可选) | (无落库) | S·连通性(①+200) |

## 阶段 L2 · 双账号广播（需第二真实连接·feasible·L1 稳后专批）
| 勾 | UC | 触发 → 观测 | ② 投影工厂 | ③ DOM data-* | 说明 |
|---|---|---|---|---|---|
| [2] | US-17 他人发消息收推送 | 连接 B 发 → 连接 A 收 | `emit_post_received`(fat) | 新消息行 | 跨账号 post 推送 |
| [2] | 6.1b 拉人后对端实时更新 | B 被拉 → 留存成员 A 收 | `emit_channel_member_updated` | data-members | type=join/leave post |
| [2] | 5.3b member-leave 广播 | 被增减目标第二连接收 | (member 广播) | channel/member 变更 | 退群/关群广播 |
| [2] | 6.2b admin 广播到他人 | 第二连接收 role 变更 | `emit_channel_member_updated` | data-admin | member_role_updated 广播 |

---

## Tag 与测试用例策略
> **绑定规则见项目根 `CLAUDE.md` §8 UC Rollout 纪律**（开局必读·会遵守）。本文件只做依赖序细粒度 + 勾选。

## 进度统计
- **真绿 6**：1.1、1.2、1.5、1.9、1.8、5.1/5.2（建群/话题）。〔4.1 ①③绿·②④ yellow=server-data-gap〕
- 本清单管理：阶段 0–7 共 **31 UC**（含 🟡6、🌙1、阶段7 新增 4：5.8/11.1/11.2/12.1）+ L2 **4 UC**。⛔ 阻塞/gap 不管理。
- **闭环模式**：接最简 UI → `run.sh -- --spec test/specs/uc-X.e2e.mjs`(seeded db) → reducer 断面 → 修(多为校正草拟契约/复用 corr-key posts[]、storage rows‖keys) → 复跑全绿 → 翻台账 + commit + tag + **本清单打钩**。

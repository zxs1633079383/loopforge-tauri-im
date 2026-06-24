# UC Rollout 逐项勾选清单（全 4 域 · 39 UC）

> 配套：契约细节真源 = `docs/uc-coverage-ledger.md`；优先序 = `docs/uc-rollout/00-rollout-plan.md`。
> 本文件是**进度勾选视图**：每个 UC 四面全绿 → 勾 `[x]`。`⛔` 不计入分母（物理/后端够不到）。
> 更新于 2026-06-24（分支 `feat/uc-rollout-domain-a`）。

## 图例
- `[x]` ✅ four-facet-verified（真 Tauri+WKWebView+真 Go 四面全绿，已 tag）
- `[ ]` ⬜ 待铺（契约已 authoring / 草拟；接最简 UI + run.sh + 校正草拟 → 转绿）
- `[~]` 🟡 partial（主路径可证，子项物理够不到——多为广播/双连接/data-dep）
- `[-]` ⛔ unreachable（物理/后端真阻塞，诚实出账，不计分母）

## 总账
| 域 | 总 | ✅ | ⬜/🟡 待铺 | ⛔ |
|---|---|---|---|---|
| A posts | 17 | 2 | 13（13⬜） | 2 |
| B channel/sync | 12 | 0 | 9（5⬜+4🟡） | 3 |
| C user-misc | 7 | 0 | 6（4⬜+2🟡） | 1 |
| D bot-agent | 3(+bot域) | 0 | 2（1⬜+1🟡） | 1+整域 |
| **合计** | **39** | **2** | **30** | **7+bot域** |

真绿 2 / 可达 32 = 6.25%。

---

## 域 A — posts（消息收发 / 历史 / 已读）· 17

| 勾 | UC | 标题 | 接线要点（命令 → 事件 / data-*） | 备注 / 风险 |
|---|---|---|---|---|
| [x] | 1.1 | 发文本/富文本 | `posts/create` → im:post:received / data-msg-id… | 竖切根 ✅ |
| [x] | 1.5 | 撤回 | `im_revoke{postId}` → im:post:batch-updated / data-revoke | 首个新 UC 闭环 ✅（tag uc-1.5）|
| [ ] | 3.1 | 会话已读 | `im_read_channel`/channels/view → im:post:read / data-read-bits | channels/view endpoint 待核（不在冻结 curl 真源）medium |
| [ ] | 3.2 | 单条已读 | `post/read` → im:post:read / data-read-bits | 较简单 |
| [ ] | 3.3 | 模板已收到 | `post/templateReceived`(单数!){postId} → im:post:updated / data-template-received | casing 陷阱；body 仅 {postId}（已纠 ledger）high |
| [ ] | 1.2 | 发 DOCUMENT | `posts/create` type=DOCUMENT 透传 → im:post:received / data-type | 复用发送链 |
| [ ] | 1.4 | 重发失败 | `posts/create` 同 tmp → sending→received / data-send-status upsert | 较简单 |
| [ ] | 1.7 | 转发/合并转发 | `posts/createPosts` 多频道 ×N → 多频道投影 / 多行 | 批量信封（corr-key posts[] 已就绪）|
| [ ] | 1.8 | 快捷回复 emoji | `quick_reply` → emit_post_updated / props | |
| [ ] | 1.9 | 加急 + 加急已读 | `expedite` → 投影 / data-* | |
| [ ] | 1.10 | 定时消息 | `schedule` 建/撤/查 → schedule-created/canceled | |
| [ ] | 2.1 | 切群首屏（3 面）| `im_query_messages_by_channel` 本地 Scan → im:messages:query_result | **无 HTTP 出站** → 三面(②③④) |
| [ ] | 2.2 | 上拉更早历史（3 面）| query 更老 → im:messages:older_loaded | **①预期红**：acl fix 在 round3、不在 pin 的 round6 → bug 报告 |
| [ ] | 2.3 | 按 postId 定位 | query 定位 → 读族 | 读族 |
| [ ] | 2.4 | 一级/二级回复 | 读族 → | |
| [-] | 1.6 | 编辑消息 | — | ⛔ 产品无编辑端点（verified-not-a-capability）|
| [-] | 1.3 | 发图片/文件 | — | ⛔ 需真上传管线，golden-tape 不录文件 IO |

---

## 域 B — channel/sync（离线同步 / 频道管理）· 12

| 勾 | UC | 标题 | 接线要点（命令 → 事件 / data-*） | 备注 / 风险 |
|---|---|---|---|---|
| [ ] | 4.1 | hello 根群全量增量 | WS hello / `channels/load/increment` → emit_channels_loaded + channel_increment + channel_update / data-ready | **就绪 probe 锚点**（多 UC 前置）|
| [ ] | 4.2 | 按需 sync notify | `channel/sync/notify` → emit_post_* + channel_update_by_post | cursor 跳空洞 |
| [~] | 4.5 | 陌生 channel 兜底 | `ensure_channel_loaded`/incrementByChannelId → emit_channel_increment | 主路径 helix 已独立证；子项 data-dep |
| [ ] | 5.1 | 创建群聊 | `channel/create` → emit_channel_created / data-channel-id | |
| [ ] | 5.2 | 创建话题 | `posts/makeTopic` → emit_channel_created(type=T) | |
| [~] | 5.3 | 关闭/退出群 | `channel/close{channelId}` → emit_channel_closed | member-leave 广播子项 ⛔（需双连接）|
| [ ] | 5.4 | 群属性修改 | `channel/change/{displayName,notice,…}` → emit_channel_update(thin) | batch 结束低频回读 |
| [~] | 5.5 | 置顶 | `channel/change/top` → emit_channel_update / data-pinned | 消息置顶 ⛔ data-dep（pin 回声够不到）|
| [-] | 5.6 | 群公告 | `post/announcement/*` | ⛔ WS 无 echo，回声不可观测 |
| [-] | 5.7 | 在线状态/分组 | `users/status/ids` | ⛔ 后端 statusCache 阻塞（P1-2，改契约才能过）|
| [-] | 4.3 | too_long 重拉 | — | ⛔ harness-gap：无注入落后 cursor 入口（helix 单测已覆盖）|
| [~] | 4.4 | 心跳 gap 补偿 | ping piggyback{cursors,allHash} → 无独立投影 | ③DOM 纯 Rust 自驱不可达；①②④+cursor 不变量可证 |

---

## 域 C — user-misc（成员 / 搜索 / 待办 / 书签）· 7

| 勾 | UC | 标题 | 接线要点（命令 → 事件 / data-*） | 备注 / 风险 |
|---|---|---|---|---|
| [~] | 6.1 | 拉/踢人 | `channel/member/change{joinUsers/leaveUsers}` → emit_channel_member_updated / data-members | 留存成员 RX 需第二连接（子项 ⛔）|
| [~] | 6.2 | 设/撤管理员 | `channel/add(remove)/manger` → emit_channel_member_updated / data-admin | add_manger 次路径 ⛔ data-dep |
| [ ] | 6.3 | 改群昵称 | `channel/member/change/nickname` → emit_member_nickname / data-nickname | |
| [ ] | 6.4 | 成员快照/全量 | `channel/member/snapshot` → emit_read_result / data-member-count | 读族自愈覆盖 |
| [ ] | 9.x | 书签 | `post/bookmark/{create,delete,load}` → emit_read_result / data-bookmark | 读族三命令 |
| [ ] | 10.1 | 待办列表 | `posts/queryTodoList`（hello 收尾自驱）→ emit_todo_updated / data-todo | 非前端命令；禁裸数组 |
| [-] | 7.x | 搜索（全局/会话/分类）| `Im/search/*` | ⛔ 后端空桩恒返空（P2-1，改契约才能过）|

---

## 域 D — bot-agent / 互动卡片 · 3（+整 bot 域）

| 勾 | UC | 标题 | 接线要点（命令 → 事件 / data-*） | 备注 / 风险 |
|---|---|---|---|---|
| [~] | 8.x | 投票/平均分 CRUD | `vote/*` + `average/*`（:3399）→ emit_post_updated / emit_read_result / data-vote,data-average | average/read 可证；vote/readVote ⛔ data-dep（需真 vote id）|
| [ ] | 10.2 | 系统通知 | WS SYSTEM 帧（无独立 HTTP）→ emit_post_received/updated / data-system-notice | SYSTEN 拼写陷阱保真透传 |
| [-] | bot | bot/agent 召唤 | — | ⛔ 整域：客户端无 service 方法 + Pulsar fanout 未接（P1-3）|

---

## ⛔ 不可达汇总（7 + bot 域，不计分母）
A：1.6 编辑无端点 · 1.3 文件上传需真管线
B：5.6 群公告 WS 无 echo · 5.7 在线状态后端阻塞 · 4.3 too_long 无注入入口
C：7.x 搜索后端空桩
D：bot/agent 整域无客户端入口

## 复用闭环（每个 `[ ]` → `[x]`）
接最简 UI 接线 → `run.sh -- --spec test/specs/uc-X.e2e.mjs`（seeded db）→ reducer「断在哪一跳」→ 修（多为校正 Phase1 草拟契约 / 复用 corr-key posts[]、storage rows‖keys）→ 复跑全绿 → 翻台账 + commit + tag。

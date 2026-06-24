# UC Rollout 最终计划 + 逐项勾选清单（依赖序）

> 配套：契约细节 = `docs/uc-coverage-ledger.md`。本文件 = **最终执行计划 + 进度勾选**（e2e 四面全绿 → 自动打钩）。
> 更新于 2026-06-24（分支 `feat/uc-rollout-domain-a`）。取代旧 `00-rollout-plan.md` 的优先序。

## 状态图例
- `[x]` ✅ 四面全绿（真 Tauri+WKWebView+真 Go，已 tag）
- `[ ]` ⬜ L1 待铺（**单账号自发回流**窗口可闭环跑——本批次主线）
- `[2]` 🔗 需**第二真实连接**（跨账号广播·**可行**·L1 稳后做，单列一批）
- `[~]` 🟡 主路径 L1 可绿 + 子项需 `[2]`
- `[n]` 🌙 untested·按需（物理限制 / 真 go 夜间·如文件上传）
- `[-]` ⛔ 后端真阻塞（改契约才能过 = 违护栏·暂不做）

## 关键原则：**按依赖序调用**
有些 UC 依赖前序数据（没有群聊就无法发消息；没有已发消息就无法撤回/已读/转发）。执行链：
**就绪 → 建频道 → 发消息 → 对消息操作 → 历史 → 频道/成员管理 → 杂项**。每个 UC 复用前序产出的真实数据。

---

## 阶段 0 · 就绪根（所有 UC 前置）
| 勾 | UC | 标题 | 依赖 | 说明 |
|---|---|---|---|---|
| [ ] | 4.1 | hello 根群全量增量 | — | **就绪 probe 锚点**；seeded db 已可起，本 UC 验 increment 四面 |

## 阶段 1 · 建频道（产出可发消息的容器）
| 勾 | UC | 标题 | 依赖 | 说明 |
|---|---|---|---|---|
| [ ] | 5.1 | 创建群聊 | 4.1 | `channel/create` → channel_created；**产出新频道供后续发消息** |
| [ ] | 5.2 | 创建话题 | 5.1 | `posts/makeTopic`(type=T) |

## 阶段 2 · 发消息（依赖频道存在）
| 勾 | UC | 标题 | 依赖 | 说明 |
|---|---|---|---|---|
| [x] | 1.1 | 发文本 | 频道 | ✅ 竖切根 |
| [x] | 1.2 | 发 DOCUMENT | 1.1 | ✅ type 透传链 |
| [ ] | 1.9 | 加急 + 加急已读 | 1.1 | `expedite`（复用 type/props 透传链）|
| [ ] | 1.8 | 快捷回复 emoji | 1.1 | `quick_reply` + props |
| [ ] | 1.10 | 定时消息 | 频道 | `schedule` 建/撤/查 |

## 阶段 3 · 对已发消息操作（依赖阶段 2 产出 server_id）
| 勾 | UC | 标题 | 依赖 | 说明 |
|---|---|---|---|---|
| [x] | 1.5 | 撤回 | 1.1 | ✅（spec 内先发后撤）|
| [ ] | 3.2 | 单条已读 | 1.1 | `post/read` → im:post:read / data-read-bits |
| [ ] | 3.1 | 会话已读 | 1.1 | `channels/view`(endpoint 待核) → im:post:read |
| [ ] | 3.3 | 模板已收到 | 1.1 | `post/templateReceived`(单数) → im:post:updated |
| [ ] | 1.4 | 重发失败 | 1.1 | 同 tmp 重走 send / status upsert |
| [ ] | 1.7 | 转发/合并 | 1.1 | `posts/createPosts` ×N（批量 corr-key 已就绪）|
| [ ] | 2.4 | 一级/二级回复 | 1.1 | replied 字段 |

## 阶段 4 · 历史（依赖累积消息）
| 勾 | UC | 标题 | 依赖 | 说明 |
|---|---|---|---|---|
| [ ] | 2.1 | 切群首屏（3 面）| 阶段2累积 | 本地 Scan·无 HTTP 出站 |
| [ ] | 2.3 | 按 postId 定位 | 2.1 | query 定位 |
| [ ] | 2.2 | 上拉更早历史（3 面）| 2.1 | **①预期红**：acl fix 在 round3 不在 pin 的 round6 → bug 报告(不改 helix) |

## 阶段 5 · 频道 / 成员管理（依赖频道·部分依赖第二连接）
| 勾 | UC | 标题 | 依赖 | 说明 |
|---|---|---|---|---|
| [ ] | 5.4 | 群属性修改 | 5.1 | `channel/change/*` → channel_update(thin) |
| [~] | 5.5 | 置顶 | 5.1/1.1 | 频道置顶 L1 绿；消息置顶 pin 回声 data-dep |
| [~] | 5.3 | 关闭/退出群 | 5.1 | self close L1 绿；member-leave 广播 → `[2]` |
| [ ] | 6.3 | 改群昵称 | 5.1 | `member/change/nickname` → member_nickname |
| [ ] | 6.4 | 成员快照/全量 | 5.1 | `member/snapshot` → read_result |
| [~] | 6.1 | 拉/踢人 | 5.1 | 操作 self L1 绿；留存成员 RX → `[2]` |
| [~] | 6.2 | 设/撤管理员 | 5.1 | member_role self L1 绿；广播到他人 → `[2]` |

## 阶段 6 · 杂项（书签 / 待办 / 同步 / 互动卡片 / 系统）
| 勾 | UC | 标题 | 依赖 | 说明 |
|---|---|---|---|---|
| [ ] | 9.x | 书签 | 1.1 | `post/bookmark/{create,delete,load}` 读族三命令 |
| [ ] | 10.1 | 待办列表 | 4.1 | `posts/queryTodoList`(hello 收尾自驱) → todo_updated |
| [ ] | 4.2 | 按需 sync notify | 4.1 | `channel/sync/notify` → 增量投影 |
| [~] | 4.5 | 陌生 channel 兜底 | 4.1 | WS 自动注册 L1 主路径可证 |
| [~] | 4.4 | 心跳 gap 补偿（**3 面**）| 4.1 | ①②④ + cursor 不变量；**③ DOM N/A（纯 Rust 自驱，已移除该面要求）** |
| [~] | 8.x | 投票/平均分（互动卡片）| 频道 | `vote/*`+`average/*`(:3399)；average/read 可证；vote/readVote data-dep |
| [ ] | 10.2 | 系统通知 | — | WS SYSTEM 帧 → post_received（SYSTEN 拼写陷阱）|

---

## 阶段 L2 · 双账号广播集合（需第二真实连接·**可行**·L1 稳后专批）
> 单 testbed 单账号收不到跨账号广播；起第二个真实连接即可验。这批是 feasible（非 ⛔）。
| 勾 | UC | 标题 | 说明 |
|---|---|---|---|
| [2] | 17 | 他人发消息收推送（PRD US-17）| 第二连接发 → 本连接收 post 推送四面 |
| [2] | 6.1b | 拉人后对端实时更新 | 留存成员第二连接收 type=leave/join post |
| [2] | 5.3b | 退群/关群 member-leave 广播 | 被增减目标第二连接收广播 |
| [2] | 6.2b | 设/撤管理员广播到他人 | 第二连接收 member_role_updated |

---

## 🌙 untested · 按需（物理限制 / 真 go 夜间·不计 L1 分母）
| 勾 | UC | 标题 | 说明 |
|---|---|---|---|
| [n] | 1.3 | 发图片/文件 | **上传接口在 java（先列 todo）**；物理文件 + 上传进度链需真文件系统/上传服务；golden-tape 不录文件 IO；④ DB message 可测但 ① 上传 hop 不可确定性回放。文本链已由 1.1 覆盖；文件上传真 go 夜间按需。 |

## ⛔ 后端真阻塞 / harness-gap（改契约才能过·暂不做·不计分母）
| UC | 标题 | 阻塞 |
|---|---|---|
| 1.6 | 编辑消息 | 产品无编辑端点（verified-not-a-capability）|
| 5.6 | 群公告 | WS 无 echo，回声不可观测（data-dep）|
| 5.7 | 在线状态/分组 | `users/status/ids` 依赖 mattermost statusCache（P1-2）|
| 7.x | 搜索 | `Im/search/*` app 层空桩恒返空（P2-1）|
| 4.3 | too_long 重拉 | testbed 无注入落后 cursor 入口（helix 单测已覆盖）|

## 已移除（不在测试范围）
- **bot / agent 召唤**（原 Domain D）：bot-agent 不在我们测试范围。Domain D 重命名为「互动卡片 / 系统通知」（仅留 UC-8.x 投票/平均分 + UC-10.2 系统通知）。

---

## 进度
- **真绿 3 / 32**：UC-1.1、UC-1.2、UC-1.5。
- **闭环模式**：接最简 UI → `run.sh -- --spec test/specs/uc-X.e2e.mjs`(seeded db) → reducer 断面 → 修 → 复跑全绿 → 翻台账 + commit + tag + **本清单打钩**。

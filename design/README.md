# loopforge-im 设计稿 ↔ UC ↔ data-* 映射

> 设计源文件：`design/loopforge-im.pen`（Pencil · 加密 · 只能用 pencil MCP 工具读写，禁 `cat`/`grep`）。
> 由 Pencil MCP 生成，Discord 深色质感。**铁约束**：导出代码必须保留 `data-*` 语义锚点，四面契约 e2e 不掉绿（当前状态看 `docs/uc-rollout/README.md`）。
> 决策来源：2026-06-26 用户拍板「升级本仓薄壳·保留 data-*」。

## 为什么 data-* 必须保留

本仓是「契约一致性自动化夹具」。四面 oracle 的**第三面 = DOM `data-*` 直映投影字段**。Pencil 出的像素级 UI / `export_html` 默认**不带** `data-*`，因此每个承载锚点的节点把 `data-*` **编进了 Pencil 图层名**（`[data-...]`），`export_html --includeLayerNames` 会把图层名落成 data 属性 → 翻译 Angular 时据此补回真实 `data-*`。

## 7 屏 → 顶层 frame

| 屏 | 视图 | frame id |
|---|---|---|
| ①②③ | 主应用 3 栏壳（频道列表 / 聊天主区 / 输入发送态 + 成员栏） | `vqg8x` |
| ④ | 话题 / 回复链面板 | `ARBMK` |
| ⑤ | 成员管理 | `glSMj` |
| ⑥ | 杂项卡片（投票/平均分/书签/待办） | `bmtut` |
| ⑦ | Teams / 运维 | `dDwpV` |

## 复用组件（编辑组件即全实例同步）

| 组件 | id | 承载 data-* |
|---|---|---|
| Avatar | `TIMt5` | — |
| ChannelRow | `pVsBh` | `data-channel-id` `data-channel-top`(PinIcon) |
| MessageRow | `n91XAa` | `data-msg-id` `data-send-status`(SendStatusIcon) `data-event-seq` `data-type` `data-revoke` `data-urgent`(UrgentBadge) `data-reactions`(Reactions) `data-read-bits`(ReadReceipt) `data-template-received` |
| MemberRow | `i54eCC` | `data-member-id` `data-nickname`(Nickname) `data-admin`(AdminBadge) |

## 视图 → UC → data-* 全映射

| 视图 | 承载 UC | 必埋 data-* 锚点 |
|---|---|---|
| ① 频道列表 | 4.1 就绪、5.1/5.2 建群/话题、5.3 退群、5.4 改群名、5.5 置顶、1.10/4.2 badge | `data-ready`(Sidebar Header) `data-channel-id` `data-channel-top` `data-channel-display-name`(Chat Header) `data-has-schedule-post` |
| ② 聊天主区 | 1.1/1.2 发送、1.4 重发、1.5 撤回、1.9 加急、1.8 emoji、3.1/3.2 已读、3.3 模板已收到、10.2 系统通知 | `data-msg-id` `data-send-status` `data-event-seq` `data-type` `data-revoke` `data-urgent` `data-reactions` `data-read-bits` `data-template-received` `data-system-notice`(SystemNotice) |
| ③ 输入发送态 | 1.1 输入、1.7 转发/合并、1.10 定时、1.3 附件🌙 | `data-send-status:uploading→sent` |
| ④ 话题/回复链 | 2.4 一二级回复、2.3 定位高亮、2.2 上拉历史、2.1 首屏 | `data-reply-id` `data-msg-id` `data-highlighted` |
| ⑤ 成员管理 | 6.1 拉踢、6.2 设/撤管理员、6.3 改群昵称、6.4 成员快照 | `data-members`(MemberList) `data-admin` `data-nickname` `data-member-count`(Sub) `data-member-id` |
| ⑥ 杂项卡片 | 8.x 投票/平均分、9.x 书签、10.1 待办 | `data-vote` `data-average` `data-bookmark` `data-todo-id` |
| ⑦ Teams/运维 | 5.8 条件查频道、11.1 维护公司大群、11.2 退出公司、12.1 健康探针 | `data-channel-id` `data-health`(HealthRow) |

> ⛔ 未覆盖（后端阻塞/已移除，不在本仓清单管理）：1.6 编辑、5.6 公告、5.7 在线状态、7.x 搜索、4.3 too_long、bot/agent。

## 设计稿 → Angular 代码（保留 data-*）

1. `export_html({filePath:"design/loopforge-im.pen", nodeIds:["vqg8x"], format:"html-tailwind", includeLayerNames:true, includeLayerIds:true, outputPath:"..."})` —— 图层名里的 `[data-...]` 落成 data 属性。
2. 按上表把 HTML/Tailwind 翻成 `src/app/im/` 下 Angular 20 组件；**逐节点核对**图层名标注的 `data-*` 真实写进模板（`[attr.data-msg-id]="msg.id"` 等绑定到投影字段）。
3. 跑四面 e2e（`bash scripts/run.sh -- --spec test/specs/uc-X.e2e.mjs`，seeded DB）确认第三面 DOM `data-*` 仍命中、不掉绿。
4. 模板加任何 `(event)` 必同步加组件方法（否则 ng serve 挂，见 harness C007）。

> 单次只导一屏、一屏一屏验，别整文档一次导出。

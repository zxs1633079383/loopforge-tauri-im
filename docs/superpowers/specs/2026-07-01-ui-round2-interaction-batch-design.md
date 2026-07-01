# loopforge-tauri-im UI 升级 Round 2 —— 消息/频道级交互补全设计

> 状态：ready-for-plan（brainstorming 完成，待 writing-plans）
> 来源：2026-07-01 grilling 会话
> 关联：`docs/orchestration/README.md`（round 1 编排真源）· `design/README.md`（7 屏 UC→data-* 映射）· `docs/migration/{NEED_HELIX,HELIX_READY,BOUND_GREEN}.log`（round 1 三单写者 log，本轮继续复用）

---

## 0. 背景

Round 1（2026-06-26～27）已把 7 屏主壳跑通 A1(pencil 设计)→A2(绑定)→Conductor 闭环，第二北极星（纯绑定覆盖率）100%。本轮是在此基础上**新增一批消息级/频道级/侧边栏交互**（用户 2026-07-01 拍板的 11 项功能），复用同一套机器（design/loopforge-im.pen 新增 frame、A2 绑定模式、NEED_HELIX 反向通信），不重新发明流程。

**铁律不变**（继承自项目 CLAUDE.md §6.13/C013）：本仓只做 Angular 组件绑定 + 真实 invoke/listen；任何"字段没有""需要业务逻辑拼装"的地方，一律写进 `docs/migration/NEED_HELIX.log`（或本 spec 的 NEED_HELIX 表）交给 helix 侧，不在本仓写 JS 拼装/兜底逻辑。

## 1. 范围拆分（A/B/C 三组）

- **Group C** — 左侧群列表增强（最小，先行）
- **Group A** — 消息级交互（已读进度/模板/加急/回复/书签/置顶，量最大）
- **Group B** — 频道级弹窗（建群/转发/建话题/公告/群设置）

## 2. 导航与交互壳（贯穿三组）

| 交互形态 | 用途 | 组件 |
|---|---|---|
| Modal 弹窗 | 建群、转发、公告、群设置、模板消息、加急选人 | 复用同一 `ModalHost` 容器组件（居中，遮罩，Esc/点遮罩关闭）|
| 右侧抽屉 | 已读进度（读/未读两列）、回复树、书签列表 | 复用同一 `DrawerHost` 组件（同 04-threads 话题面板已用模式）|
| 统一消息右键菜单 | 回复 / 加急 / 创建话题 / 收藏 / 置顶 / 转发 | 单一 `MessageContextMenu` 组件，所有消息行共享，替代 6 个分散入口 |
| 转发多选 | hover 消息行浮出 checkbox → 进入选择态 → 工具栏「转发选中(N)」 | 点击态，非真鼠标拖拽（wdio 用点击驱动，行为可预测）|

四面 e2e 断言方式不变：DOM 面锚点用 `data-*`，对话框/抽屉本身加 `data-testid` 供 wdio `waitForExist` 定位，内部字段仍 1:1 绑投影字段。

## 3. Group C — 左侧群列表

| 锚点 | 语义 | 数据源 | 状态 |
|---|---|---|---|
| `data-last-message` | 最后一条消息文本 | 已有 `applyChannelIncrement` render-ready | 已绑（round1）|
| `data-last-sender-id` | 最后一条消息发送者 userId（占位显示，非头像/昵称）| **NEED_HELIX**：channel 行投影需新增 `lastMessageSenderId` 字段 | 本轮暂留空/不渲染该属性，helix 补上后再绑定（同 A2 既有"未绑定行"模式）|
| `data-mention` | 是否有人 @ 我（数字角标）| 已有 `channel.mentionCount` 列，`>0` 显示 | 直绑，无需新字段 |
| `data-urgent` | 是否有未确认的加急消息 | 已有 `channel.hasUrgentPost` 列 | 直绑，无需新字段 |

## 4. Group A — 消息级交互

### 4.1 已读进度圆环 + 已读/未读两列抽屉

- 消息行右下角圆形进度：`已读人数 / 需读总人数`。
- **需读总人数计算规则**（业务规则，必须由 helix 算好吐出，壳不算）：`viewers=['all']` → 频道内除发送者外全体成员；`viewers` 为具体名单 → 该名单人数。
- 点击圆环 → 右抽屉，两列「已读」「未读」，本轮先展示 userId（同用户要求）。
- **NEED_HELIX**：`im:post:received`/`im:post:read` 系投影新增 render-ready 字段：`readCount`、`totalCount`、`readUserIds: string[]`、`unreadUserIds: string[]`。壳只做 `readCount/totalCount` 除法出百分比，不做位图↔成员表错位计算。

### 4.2 模板消息（发送 + 已收到）

- 「已收到」确认（3.3 `templateReceived`）：round 1 已具备，本轮补齐 DOM 展示（`data-template-received`已在设计表中）。
- 「发送模板消息」新增：输入框旁「模板消息」按钮 → modal（选需确认用户 + 正文）→ `invoke('im_send', {type:'TEMPLATE', props:{template:{userIds}}, ...})`。
- **验证项**（非新需求，执行阶段先查）：现有 `im_send` invoke 层是否已透传任意 `type`/`props`（UC-1.2 DOCUMENT 已验证同机制，大概率可直接复用）；如受限，走 NEED_HELIX。

### 4.3 加急发送 + 收件人确认

- 发送：右击消息 →「加急」→ 选人 modal → 复用 1.9 `urgentPost`（已真绿）。
- 确认：收件人在加急消息行内联「确认已收到」按钮（仅加急对象可见）→ 调 `urgentConfirm`。按钮点击后消失/置灰。

### 4.4 回复（悬浮预览 + 回复树侧栏）

- 右击消息 →「回复」→ 输入框上方悬浮预览条（显示被回复消息摘要，可取消）。
- 发送时携带回复关系。**验证/NEED_HELIX**：确认当前 `im_send` invoke 是否已支持可选 `replyToPostId` 参数（helix `send_build.rs` 内部已具备 reply chain 推导逻辑 `RepliedRef`/`find_reply_root_id`，但需要核实该参数是否已在 Tauri command 签名层对前端开放，或仍需 helix 侧新增桥接）。
- 消息下方内联展示前 3 条回复摘要（发送人+文本）+「查看全部 N 条回复」→ 展开右抽屉回复树。复用已具备的 `im:channel:replies`（render-ready `replyIds`）。

### 4.5 收藏书签

- 右击「收藏」+ header 书签图标 → 右抽屉书签列表（可取消收藏）。
- 复用 9.x `post/bookmark/{create,delete,load}`（已具备，读族透传）。

### 4.6 置顶消息

- 右击「置顶」/「取消置顶」。
- 聊天区顶部固定「置顶消息栏」，展示最新一条置顶消息，可展开看全部，点击跳转定位到原消息（复用 2.3 定位高亮 `data-highlighted` 机制）。
- 复用 5.5b `channel/add(remove)/postPinned` + `channel/load/postPinned`（命令已存在；历史记录曾标记 backend-down，执行阶段需重新验证，非本设计假设有误）。

## 5. Group B — 频道级弹窗

### 5.1 创建群聊

- 群列表「+」→ modal：群名称输入框（displayName）+ 硬编码测试用户 checkbox 列表（678/555 等，本轮不接真实通讯录/公司花名册）。
- 复用 5.1 `channel/create`（已具备）。

### 5.2 转发（合并 / 逐行）

- 触发：单条右击「转发」，或多选（hover checkbox 进入选择态）后工具栏「转发选中(N)」。
- Modal：目标群多选 + 「合并转发 / 逐行转发」单选。
- 复用 1.7 `posts/createPosts`（`{posts, channelIds}`，已具备）；合并 vs 逐行的 `posts` 数组构造方式由 helix 侧命令决定，壳只传"选中的消息 id 列表 + 模式 + 目标频道列表"。

### 5.3 创建话题（右击）

- 加入统一右键菜单「创建话题」→ modal（话题名）→ 复用 5.2 `posts/makeTopic`。
- **核查项**：`projection-schema.md` 历史标注该端点曾为部分实现（🔴仅校验 postId），而 `rollout-checklist.md` 标记 5.2 已真绿——执行阶段需核实当前状态，若仍有缺口走 NEED_HELIX。

### 5.4 群公告

- header 新增公告图标 → modal：详情 / 发布（管理员）/ 删除（管理员），打开详情时自动触发已读（`announcement/read`）。
- 复用 5.6r（`list`/`detail`/`acceptList`）+ 5.6w（`save`/`read`/`delete`）全套命令（已具备）。
- **核查项**：历史记录曾标注 5.6w 部分 backend-down，执行阶段需重新验证现状（`2026-06-26 翻案` 已将 5.6 从 ⛔ 移除，理论上已可做）。

### 5.5 群聊设置面板

- header「设置」图标 → modal，包含：
  - 群名称编辑（复用 5.4 `channel/change/displayName`，已绑定 `applyChannelUpdatePost`）
  - 消息免打扰开关（复用 `channel/member/change/notify`，新绑 UI）
  - 置顶会话开关（复用 5.5 `channel/change/top`，与侧边栏 pin 图标共享同一后端命令）
  - 成员管理入口（跳转已有 05-members 面板，不重建）
  - 退出/解散群按钮（复用 5.3 `channel/close`，危险操作放面板底部，需二次确认）

## 6. NEED_HELIX 汇总（本轮新增，交 B track）

| 字段/能力 | 用途 | 优先级 |
|---|---|---|
| `channel.lastMessageSenderId`（render-ready）| 左侧列表发送人展示 | 高（Group C 依赖）|
| `readCount`/`totalCount`/`readUserIds`/`unreadUserIds`（render-ready，post 级）| 已读进度圆环+抽屉 | 高（Group A 核心功能）|
| `im_send` 可选 `replyToPostId` 参数（如尚未在 invoke 层暴露）| 右击回复 | 中（需先核实是否已具备）|
| `posts/makeTopic` 完整字段透传（如仍有缺口）| 右击创建话题 | 中（需先核实现状）|

未在上表但设计中提到"核查项"的（模板发送 type/props 透传、5.5b 消息置顶 echo、5.6w 公告 echo）不是新字段需求，是**现状验证**——执行阶段先跑一次真链路，绿则直接绑，红则按其结果决定是否升级为 NEED_HELIX。

## 7. 测试方式（沿用四面契约）

每个新交互按现有 UC 编号体系延伸（如 已读进度→3.2 延伸子用例、模板发送→3.3 延伸、加急确认→1.9 延伸、回复→2.4 延伸、书签→9.x 延伸、置顶→5.5b、建群→5.1 延伸校验字段、转发→1.7 延伸合并/逐行两分支、建话题→5.2、公告→5.6、群设置各子项→对应既有 UC），四面锚点表按第 3-5 节的 `data-*` 补进 `design/README.md`「视图→UC→data-*」表。四面 reducer 裁绿标准与 round 1 一致，不新增 oracle 形态。

## 8. 执行方式（复用 round 1 机器，非本 spec 范围，供 writing-plans 参考）

1. **A1 延伸**：在 `design/loopforge-im.pen` 新增/编辑 frame（unified context menu、read-progress drawer、reply-tree 内联摘要、bookmark drawer、pinned-bar、create-group modal、forward modal、announcement modal、group-settings modal、template-message modal、urgent-picker modal），沿用 `[data-...]` 图层名编码约定 → `export_html` 逐屏校对。
2. **A2 延伸**：按第 6 节 NEED_HELIX 清单先判断哪些行可立即绑定（已具备命令的）、哪些需等 B track 补字段（写 `HELIX_READY.log` 解锁）。
3. **Conductor**：沿用 round 1 双闸自动 merge（前置冲突分析 + 四面 reducer 裁绿）。

## 9. Out of Scope

- 真实用户/通讯录查询（建群仍用硬编码 678/555 测试名单）。
- 头像上传/文件上传（沿用 UC-1.3 🌙按需状态，不在本轮解锁）。
- 群设置里更细粒度的通知规则（如按消息类型/按人免打扰）。
- 转发的"合并卡片"具体渲染样式细节（合并卡片内部展示形态留给 A1 设计阶段决定，只锚定"合并 vs 逐行"两个模式的行为差异）。
- 像素级视觉保真（沿用项目一贯的 data-* 语义锚点优先原则）。

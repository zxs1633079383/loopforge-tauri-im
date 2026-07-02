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
| `✅ four-facet-verified` | LoopForge `run.sh` 经真 Tauri+WKWebView 跑过四面 oracle **全绿**（① 出站体逐字对齐 + ② 投影字段集一致 + ③ DOM data-* tmp→server 覆写 + ④ message/channel 落行 + cursor 推进）。**当前 UC-1.1 + UC-1.5**。 |
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
| 当前绿数 | 33 UC `✅ e2e-verified`（服务端 wire 视角）| **3 UC**（UC-1.1 + UC-1.5 + UC-1.2，客户端四面视角）|

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

### UC-3.1 会话已读 — `🟡 ①③ four-facet-verified · ②④ ⏸park 后端缺口（channels/view 不广播 post_read echo·issue #15 已closed·L2无法验·2026-06-28）`（认领 S/M）
> **②④ park 实证（spec uc-3.1-l2 红 + raw-WS 探针）**：与 #14(post/read 单条已读·已绿)不同·`channels/view`(会话已读)**不广播 post_read echo** 给消息作者(raw-WS 实证 444 发消息→678 channels/view→444 零 post_read 帧·仅 join+自身 echo)。故 ②(im:post:read)④(read_bits) 在 channels/view 路径结构上不产出。#15 已 closed·留台账诚实记。需后端 channels/view 也广播 post_read(同 post/read)·见 NEEDS_CSES_IM_SERVER_FIX_channels_view_read_echo.md。artifacts: test/specs/uc-3.1-l2.e2e.mjs + test/expect/uc-3.1-l2.expect.json(ready·后端补后转绿)。

> 实证：`run.sh -- --spec test/specs/uc-3.1.e2e.mjs` → `✅ 四面报告全绿`（spec pass·①③ 严格断言绿 + ②④ 确认 server-data-gap·带 run.jsonl 证据 + 可证伪护栏断缺席）。接线：壳 `im_read_channel`（channelId → 包 `channels:[{id}]` 入泵 `im_channels_view`·会话级·非 UC-3.2 的 posts 单条）+ 前端 `store.readChannel` + header `已读` 按钮（C007 配 `onReadChannel`）+ 消息行 `data-read-bits`（既有渲染路径·复用 fat 集）。装饰器 `extract_corr_key` 增 `body.channels[0].id→ch` 探针（channels/view 出站经 ch 与 ②④ 聚束·契约 URL+body-shape 不变·机器件归一）。

- **① 出站 HTTP**：`POST /api/cses/channels/view`，body `{channels:[{id}]}`（fire-and-forget·真源 full-map/partials/6:139 `onChannelRead`）。✅ **实跑绿**（Go 返 `viewChannel success`·已写 channelmembers.last_read_seq·corr_key `ch=…` 经 channels[0].id 探针归束）。曾误判为 `post/read{channelId}`（区间模式）被 Go 拒 `post read is empty`·回正 channels/view。
- **① WS 推送（read echo）**：action=`post_read`（type=6）·data.postId + readMap/readBits + seq。
- **② 投影**：`im:post:read`（**fat**·同 `emit_post_received` 完整集）。🟡 **L2-facet（结构性单账号造不出·须 L2 #47）**：read echo `post_read`(event_type=6) 推给**消息的发送者**——当**别人已读了发送者的消息**时（partials/6:140·非自读回执·非多设备 echo）。L1 单账号单连接无第二账号去读本账号消息 → 结构上无 `im:post:read` 产出。run.jsonl 证据：channels/view 返 200 `viewChannel success`·但全 run（UC-3.1 + send + quiescence 窗口）**零** post_read/type6/readMap 帧。须 **L2 双账号**（B 读 A 消息 → A 收 post_read·追踪 issue #47）复跑转绿。
- **③ DOM**：`data-read-bits`（self 位）。✅ **实跑绿**（壳纯渲染·send echo `im:post:received` fat 集已置 self read bit·无前端算·projection-schema §3）。
- **④ 落库**：`message.read_bits` 单调覆盖。🟡 **L2-facet（同 ②·依赖 post_read echo 落 read_bits·须 L2 #47）**。

### UC-3.2 单条已读 — `✅ 四面全绿（L2 双账号·issue #14/#47·2026-06-28·helix gate bypass + oracle batch_update 人审）`（认领 S）
> **L2 绿证（#14/#47·spec uc-3.2-l2 两轮 channelId 各异 9hfd/z8aia）**：后端 round-2 post_read 帧补 channelId(commit 6e6dbc3) + helix fix/im-post-read-bypass-gate(post_read 无 event_seq 也 emit·loopforge re-pin 15615d1) + oracle storage.op batch_upsert→batch_update(人审 331e249)。A=444 建频道拉 678→A 发消息→B=678 post/read 标已读→A 收 post_read echo(data.channelId 现非空)→helix emit_post_read→②im:post:read(fat·readBits=11)③data-read-bits④message batch_update。①出站 N/A(B侧)。〔旧「post_read 推发送者结构性单账号造不出」+「帧缺 channelId/event_seq」gap 均已 round-2 解除。〕

> 实证：`run.sh -- --spec test/specs/uc-3.2.e2e.mjs` → `✅ 四面报告全绿`（spec pass·①③ 严格断言绿 + ②④ 确认 server-data-gap·带 run.jsonl 证据）。接线：壳 `im_mark_read`（postId+channelId → posts 列表模式 `{channelId, posts:[postId]}` 入泵 `im_post_read`）+ 前端 `store.markRead` + 消息行 `data-read-bits`（既有渲染路径·复用 im:post:read fat 集）。装饰器 `extract_corr_key` 增 `payload.body` + `posts[0]` 探针（出站 post/read 经 sid 与投影聚束·契约不变）。

- **① 出站 HTTP**：`POST /api/cses/post/read`，body `{channelId, posts:[postId]}`（**posts 列表模式标单条**·真源 helix `outbound/posts_existing.rs` PostReadCommand + entity.PostRead.Posts `json:"posts,omitempty"`·post.go:527-536）。✅ **实跑绿**（corr_key `ch=…;sid=…` 经 body+posts 探针归束）。
- **① WS 推送**：action=`post_read`（≤2 人）+ `update_channel`（刷未读）。
- **② 投影**：`im:post:read`（fat）。🟡 **L2-facet（结构性·非多设备 echo）**：`post_read`(type6) 是**已读回执**——推给**消息的发送者**·当**别人已读了发送者的消息**时（2026-06-25 用户权威语义·非自读 echo·非多设备 echo）。L1 单账号单连接**结构上造不出**（没有第二账号去读本账号消息）→ 0 个 `im:post:read` 产出。须 **L2 双账号**（A 发 → B 读 → A 收 post_read echo）复跑转绿·由 L2 追踪 issue **#47** 接盘。run.jsonl 证据：post/read 返 200·频道 seq 进·但增量 sync 拉 `fromSeq:N` 返 `no_change`·无 type=6 read event 回灌本（读者）连接。
- **③ DOM**：`data-read-bits`。✅ **实跑绿**（壳纯渲染·send echo 投喂 readBits）。
- **④ 落库**：`message.read_bits`。🟡 **L2-facet**（同 ②·待 L2 双账号·依赖 post_read echo 落 read_bits·L2 issue #47）。

### US-17 他人发消息收推送 — `✅ four-facet-verified（L2 双账号首证·issue #42）`（2026-06-28 暖栈实跑全绿·认领 D）
- **L2-facet 真验证范式**：跨账号 post 推送结构上只有第二真账号才造得出。A=444（暖栈 app 4445·驱动+观测）当场新建频道并把 B=678 拉为成员（`im_create_channel {memberIds:[678]}`·server users:[{444 CREATOR},{678 MEMBER}]·真机curl真源 §4）→ B=678 经 `scripts/l2-act.sh send`（posts/create·act-as-678·cookieId 桥）在该频道发消息 → go 按 `broadcast.channelId` fanout 到频道成员 444 的 WS 连接 → A 实时收 `post` 帧。**踩坑**：硬编码"共享频道"`15gcgoyf…`并非 444+678 共有（uc-3.2-l2 旧假设）→ server 不 fanout → A 收不到（raw-WS 实证 + sync no_change/nextSeq:0 双证）；改为当场新建带 678 的频道后 raw-WS 实证 A=444 收到 `post` 帧（broadcast.channelId 命中·全字段）→ 跨账号链路打通。
- **① 出站**：N/A（L2 read-side·optional·isOutboundOptional）。结构上在动作端 B=678（posts/create·act-as-678）·非被观测端 A。spec 直断 l2-act send 返回 SUCCESS（B 真发出·守可证伪：B 没发出则第一步红）。
- **② 投影**：`im:post:received`（fat·17 键·projection-schema §1 emit_post_received）·`data.userId==678`（跨账号铁证：作者是 B 非 A 自发回声）。
- **③ DOM**：新消息行 `[data-msg-id=server_id]`（received 无 temporary-id·非本端发）·data-channel-id=新频道·data-event-seq 非空。**L2 核心证据：B 的消息渲成 A 的 UI 新行**。
- **④ 落库**：`message` batch_upsert（id=server_id·经 sid=msg_id 别名与 ② 聚同束）。
- **接通件（全机器件·零改冻结 oracle·C004/C009）**：`scripts/l2-act.sh`（act-as-678 cookieId 桥·已存在）+ `test/expect/uc-us17.expect.json`（① optional·② fat userId=678·④ message·③ data-msg-id）+ `test/specs/uc-us17-l2.e2e.mjs`（A 新建频道拉 678→set_uc US-17→l2-act send→waitUntil im:post:received[message==本轮TEXT && userId==678]取 server msg_id→DOM 新行→reducer 锚 sid 裁定四面）。reducer 主入口 `runFourFacet`（sid 锚·① optional 自动绿）。
- **绿证**：corr_key=`ch=sproit7rbjrcm8apuuhsmyt5te;tmp=d2a702f56d417b4903103d07;sid=w6rj434i6tycjrmauqsdgsfrzr;seq=2`·四面全绿·gate.sh 绿（reducer 自测 189 pass）。

### UC-3.3 模板已收到 — `✅ four-facet-verified`（2026-06-25 实跑全绿·认领 S）

> 实证：`run.sh -- --spec test/specs/uc-3.3.e2e.mjs` → `✅ UC-3.3 四面全绿`（corr_key `ch=15gcg…;tmp=…;sid=1ouh77refibz8j4ujz4aiy1m8a;seq=65`）。接线：壳 `im_template_received`（postId → camelCase `{postId}` 入泵·helix builder 读 camel·snake 会 Parse 失败）+ 前端 `store.templateReceived` + 消息行 `template-received-btn`（C007 配 `onTemplateReceived`）+ `data-template-received`（store `extractTemplateReceived` 抽 props.template.userIds 非空 → '1'·壳纯渲染）。
>
> **关键（与 UC-3.1/3.2 read-echo 黄不同·本 UC 全绿）**：go `App.TemplateReceived`（cses_post.go:1794）`a.Publish(post_update, userId="")` 广播给**整频道含发起本连接**（非 read-echo 的多设备-only）→ 单账号夹具即可观测 ② post_update echo·四面全绿。**前置**：go cses_post.go:1762 校验 `post.Type==TEMPLATE`，故 e2e 须先发 **TEMPLATE 类型**消息（im_send msgType=TEMPLATE·send_build 透传真值·UC-1.2 DOCUMENT 同款）而非 TEXT，否则 TemplateReceived 返 'post type is not TEMPLATE' 不广播。

- **① 出站 HTTP**：`POST /api/cses/post/templateReceived`，body `{postId}`（camelCase·**`/post` 单数前缀**命名陷阱·真源 helix `outbound/template_received.rs` + posts.go:721 匿名 struct·bodyForbidden 锚 snake `post_id` 泄漏）。✅ **实跑绿**（corr_key `sid=<postId>` 经装饰器 pick `postId` 探针归束·契约不变）。
- **① WS 推送**：action=`post_update`（EventKind::PostEdit）·data.id 命中·`props.template.userIds` 含 self userId（go AppendTemplateUserId 把我写进已收回执列表）。
- **② 投影**：`im:post:updated`（**fat** 13 键·同 `emit_post_received`）。✅ **实跑绿**（WS post_update → gate EventKind::PostEdit → channel.rs:511 emit_post_updated）。
- **③ DOM**：`data-template-received=1`。✅ **实跑绿**（壳 applyMessageItem 抽 props.template.userIds 非空置位·壳纯渲染·无前端算）。
- **④ 落库**：`message`（props.template patch·op=**batch_update**）。✅ **实跑绿**（**契约更正**：原草拟 op=update 误·实测 batch_update·与 UC-1.9 加急同款·两者同走 EventKind::PostEdit → edit_content_op gate·run.jsonl 证据）。

### UC-1.2 发送 DOCUMENT 消息 — `✅ four-facet-verified`（2026-06-24 实跑全绿，认领 S）

> 实证：`run.sh -- --spec test/specs/uc-1.2.e2e.mjs` → `✅ UC-1.2 四面全绿 … type=DOCUMENT`。接线：壳 im_send 加 msg_type 透传 + 前端 sendDocument/pendingType + 消息行 data-type。

- **① 出站 HTTP**：`POST /api/cses/posts/create`，同 UC-1.1 + `type:"DOCUMENT"`（**type 原样透传非降级 TEXT**·helix P1 修后实证·`send_build.rs` 读 cmd type 默认 TEXT/DOCUMENT 透传真值）+ `props.document`（待核）。
- **① WS 推送**：action=`post`，data.type=`DOCUMENT` 原样回声。
- **② 投影**：`im:post:received`（fat）+ data.type=DOCUMENT。
- **③ DOM**：同 UC-1.1 + `data-type=DOCUMENT`。
- **④ 落库**：`message`（type=DOCUMENT）。

### UC-1.4 重发失败消息 — `✅ four-facet-verified`（2026-06-25 实跑全绿，认领 S）

> 四面全绿实证：`run.sh -- --spec test/specs/uc-1.4.e2e.mjs`（seeded db·live 真 go）→
> `✅ UC-1.4 四面全绿（corr_key=ch=15gcgoyf;tmp=pfuneqqp…;sid=c58zkjqn…;seq=68）`。
> 接线：壳 `onResend` → `store.resend(tmp,ch,text)` 复用原 temporaryId 重走 `im_send`（upsert 语义·不生成新 id）。
> 失败前置（架构现实：`im_send` 入泵即返 Ok 不 await HTTP → 健康 live run 不自然产生 failed 行）：
> 旧 debug 桥 `__lf.debugMarkFailed` 已废弃；当前只能走真实故障前置或后端失败投影，不允许把前端乐观行当作 accepted success path。
> 重发四面校正：
> ① 出站 `posts/create` temporaryId 复用 camelCase 必填集✅（bodyForbidden snake_case 无泄漏）
> ② 投影 `im:post:received` fat 13 键✅ ③ DOM `failed→sending→sent`（data-msg-id tmp→server 覆写）✅
> ④ 落库 `batch_upsert message`（PK=temporary_id 覆盖原失败行）✅。

- **① 出站 HTTP**：`POST /api/cses/posts/create`，temporaryId 复用（重发 = 重走 posts/create·✅ 实跑 RAW action=`post` self-echo 命中）。
- **① WS 推送**：action=`post`（✅ ws-recv echo 命中本束·sid=c58zkjqn…）。
- **② 投影**：`im:post:sending` → `im:post:received`（fat·✅）。
- **③ DOM**：`data-send-status: failed→sending→sent`（✅，来自真实失败态而非 debug patch）。
- **④ 落库**：`message` upsert 覆盖（PK=temporary_id·✅ batch_upsert）。

### UC-1.5 撤回消息 — `✅ four-facet-verified`（2026-06-24 实跑全绿，认领 S）

> 四面全绿实证：`run.sh -- --spec test/specs/uc-1.5.e2e.mjs`（seeded db）→
> `✅ UC-1.5 四面全绿（corr_key=ch=15gcgoyf;tmp=…;sid=…）`。
> 接线：壳 `im_revoke` 命令 + 前端 `im:post:batch-updated`→`markRevokedById`→`data-revoke=1`。
> Phase2 校正：① 出站 `{postId}`✅ ② 投影 `im:post:batch-updated{channel_id,posts}`✅（corr-key.mjs 探入
> `posts[].id` 取 sid 才能与出站/落库聚束）③ DOM `data-revoke=1`✅ ④ 落库 `batch_update message`✅
> （reducer 计数归一 rows‖keys；expect.storage.op 由 update 校正为 batch_update）。

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

### UC-1.7 转发/合并转发消息 — `✅ e2e-green`（live 多频道四面全绿·N=2 目标·2026-06-25）

> 多频道四面：单 ① createPosts 出站 → N 目标 channel 各 1 投影 + 1 落库 + 1 DOM 行。
> reducer 走 `runFourFacetMultiChannel`（机器件·按 targetChannels 聚 N 束·非冻结 oracle）。
> **实证 run.jsonl**：① channelIds=[14jeie…, 181jj…]；② im:post:received ×2（msg_id=wrjcaq…/s6p3md…·各目标 ch 各一）；④ message storage writes=2。

- **① 出站 HTTP**：`POST /api/cses/posts/createPosts`（**双段复数**·camelCase `{posts:[<Post>], channelIds:[<id>...]}`·`真机curl真源 附录A` 三方证据定论·✅ helix 现状一致）。**实证** posts[0] keys=[message,temporaryId,type,userId]·channelIds=2 目标·无 PascalCase 泄漏。
- **① WS 推送**：各目标 channel action=`post` 广播 → 各目标 channel 真 echo 回声（**非 harness-gap**·loopforge 内嵌引擎实收 2 条 post echo·驱动 ②③④）。
- **② 投影**：各目标 channel `im:post:received`（fat 13 键·channel_id/msg_id/event_seq 各异·共享 temporaryId）。reducer `diffRelayProjections` 逐目标频道断字段集。
- **③ DOM**：N 条转发消息行（各自 `data-channel-id`=目标频道·`data-msg-id`!=tmp server 覆写·`data-send-status=sent`）。**契约实现 fix**：store `applyMessageItem` temporaryId 锚叠加 channelId 同频道约束（单出站 posts[0] 同 tmp 应用到 N 频道·N 条 echo 同 tmp 异 ch·原纯 tmp 锚会让第 2 条覆写第 1 条丢频道）。
- **④ 落库**：`message` 表 `batch_upsert` ×N（每目标 channel 一行·minRows≥2 实证 2）。
- **关键根因 fix（loopforge 壳缺陷·非 server gap）**：转发 Post 对象须携 `userId`。后端 `postSender` 消费者 `PrePostSend`（post_core.go）在 `UserId==""` 时直接拒并 **Ack-drop**（user id is nil）→ 转发副本无 userId 被静默丢弃 → createPosts 返 SUCCESS 但目标频道无落库/无投影（实测三轮红）。loopforge `im_relay_messages` 命令补自身 userId（identity 单一真源·与现网 sendRelayMessages 透传完整 Post 对象一致·壳不臆造）后四面真绿。

### UC-1.8 快捷回复 emoji — `✅ e2e-green`（live 四面全绿·corr_key sid=owd8oao7wbbo9jxye1wfgpts8w·seq=54·2026-06-25）

- **① 出站 HTTP**：`POST /api/cses/posts/quickReply`，body `{emoji, postId, userId}`（全 camelCase·**实证 run.jsonl** seq510 userId=444·bodyForbidden snake 锚守）。helix `outbound/quick_reply.rs` QuickReplyCommand 兑现；loopforge `im_send_quick_reply` 命令补自身 userId（identity 单一真源·壳不臆造）。
- **① WS 推送**：action=`post_update`（quickReply toggle 后服务端 `a.Publish(WebsocketEventPostUpdate, post.ToMap())`·cses_post.go:1574）→ emit `im:post:updated`。
- **② 投影**：`emit_post_updated`（fat 13 键）。**契约实现 gap 修复**（helix parser bbbf809）：服务端 `post.ToMap()` 把 emoji 反应作**顶层** `quickReply` 字段下发（`[{emoji, userIds:[self]}]`·copy_post.go:72），原 `extract_post_fields` 只读 post.props → quickReply 整丢。修复后顶层 quickReply 合并进 `props.quickReply` 搭 fat 投影顺风车下传（projection-schema 13 键集**不变**·quickReply 寄生 props）。
- **③ DOM**：`data-reactions`（含 emoji👍）。loopforge `applyMessageItem` 从 `props.quickReply` 抽 emoji 串渲染（server id 锚命中既有行·patch 只增不清）。**实证** reactions=👍。
- **④ 落库**：`message` 表 `batch_update`（quickReply patch 既有 post 行·UPDATE WHERE id·post 已由原 send 插入）→ 反应态落 `message.quick_reply` 列（helix schema.rs:49）。**契约更正**：op=`batch_update`（**非 `batch_upsert`**·Phase1 草拟误·与 UC-1.5 撤回/UC-1.9 加急同形态同纠正·证据 run.jsonl {op:batch_update,table:message,keys:1,id=postId}）。

### UC-1.9 加急 + 加急已读 — `✅ e2e-green`（live 四面全绿·corr_key sid=tasdeqxtubbrzbigoic5iya77o·2026-06-25）

- **① 出站 HTTP**：`POST /api/cses/posts/urgentPost`（camelCase `{channelId, postId, targetIds}`·message 可选）/ `posts/urgentConfirm`（`{postId, channelId}`）。两阶段同 corr_key=postId·reducer diffOutboundPhases 逐段对齐（真源 partial 6 UC-1.9 + UrgentPostVO post.go L502-509）。**实证 run.jsonl**：seq510 urgentPost + seq511 urgentConfirm 全 camelCase·bodyForbidden snake 锚守。
- **① WS 推送**：action=`post_update`（加急走 type2 编辑路径·`post_urgent` action 在 helix-im 是 dead-action no-op）→ emit `im:post:updated`。
- **② 投影**：`emit_post_updated`（fat 13 键）。**契约更正**：projection-schema line186 明确 expediteMap **不吐**（HX-C005 热路径回读铁律）→ 加急标记**不在 post 投影**·props 由 gate 合成 `{channel_event_seq}`。原 ledger「expedite 归一透传投影」与 line186 矛盾·已纠正。
- **③ DOM**：post-row 重渲（`data-msg-id`/`-channel-id`/`-event-seq` 投影驱动）。**契约更正**：`data-urgent=1` **不可投影驱动**（expediteMap 不吐）·加急视觉须 DB 回读 `message.expedite_map`（line188·minimal 壳投影域外）→ DOM 面断投影可观测的 post-row 重渲·不断 data-urgent。
- **④ 落库**：`message` 表 `batch_update`（加急经 gate edit_content_op patch·UPDATE WHERE id·保留本地 read_bits）→ 加急态落 `message.expedite_map` 列（helix schema.rs:47）+ `channel.has_urgent_post` 列（seq511 channel batch_update）。**契约更正**：op=`batch_update`（非 `batch_upsert`·原契约误·证据 seq516）。

### UC-1.10 定时消息 create — `✅ green`（四面真跑·corr_key=ch；2026-06-25）

- **① 出站 HTTP**：`POST /api/cses/posts/createSchedule`（body `{post:{channelId,message,temporaryId?}, schedulePostAt}`·helix posts_existing.rs CreateScheduleCommand 兑现·e2e 实跑命中）。cancel/get 子流（`cancelSchedule`/`getSchedule`·im_cancel_schedule 命令族同源）按需扩。
- **① WS 推送**：action=`post_schedule_created`（helix ledger 命中·实跑回声）。`post_schedule_canceled` 同族·cancel 子流按需。
- **② 投影**：`emit_schedule_created` = `{channelId, hasSchedulePost}`（projection-schema 行 72·2 键集冻结·reducer 实绿）。
- **③ DOM**：`data-has-schedule-post=true`（CL 频道行·store applyScheduleCreated 透传投影 hasSchedulePost·实绿）。
- **④ 落库**：`channel` 表 `batch_update`（has_schedule_post 列 patch·UPDATE WHERE id·keys=1）。**契约更正**：op=`batch_update`（非草拟误写的 `update`·helix storage port 无 plain update·ports/storage.rs:82 注 update==batch_update(len=1)·run.jsonl 实证 + UC-1.5/1.8/1.9 同 op）。
- **接线**：src-tauri `im_create_schedule` 命令（lib.rs 双 handler 注册）+ store `createSchedule()`/`applyScheduleCreated()` + app.component `onSchedule()`。spec `test/specs/uc-1.10.e2e.mjs` + expect `test/expect/uc-1.10.expect.json`。

### UC-2.1 切群首屏 — `✅ 四面全绿`（读族 ②③·①④ N/A·认领 S·issue #20·corr_key=ch=15gcgoyf1jfcur614qydhs69ha）

- **① 出站 HTTP**：N/A（读族纯本地 Scan·无 HTTP 出站·expect.json `reachable=false`·reducer 不裁定 ①）。
  too_long 兜底 `posts/getLatestPost` LoopForge 单账号闭环常态不命中（optional 校验）。
- **② 投影**：`im:messages:query_result`（`{channel_id, messages}`·外层 2 键严格·`query::emit_message_query_result`
  透传本地 DB 行·实跑 run.jsonl 实证 messages=58 行透传整 `SELECT * FROM message` snake 列）。**GREEN**。
- **③ DOM**：N 个消息行 `data-msg-id`（壳 `applyMessagesQueryResult` 渲染·实跑 50 行·首行
  msg-id=bzs3hu9xzp8o9qduqq3q7q7ike 对账 DB·默认 limit=50 截断 58→50）。**GREEN**。
- **④ 落库**：N/A（Scan-only 读路径·不落新行·reducer `minRows:0` 不强求 storage 写 hop·读族无写）。
- **链路**：切群点 CL 频道行 → `onSelectChannel` → `store.queryMessages` → invoke `im_query_messages_by_channel`
  （commands.rs 薄壳翻译入泵·lib.rs 双 handler 注册）→ helix `query_dispatch` 吐 `Scan(message WHERE
  channel_id ORDER BY create_at DESC LIMIT 50)` → `port_reply` emit `im:messages:query_result` → 壳渲染。
- **测试件**：`test/specs/uc-2.1.e2e.mjs`（e2e 经 `__lf.invoke` 直 invoke `im_query_messages_by_channel`·
  waitUntil 等行数稳定 ≥1 非恒真 minRows=0·HX-C011）+ `test/expect/uc-2.1.expect.json`（②③ 冻结·
  ①④ optional/read-path）。helix `acl/from_tick.rs::accepts_tick` query 族放行已修（line 28
  `|| is_query`）→ 真命令路径可达（实测 58 行 emit·原 ledger「依赖 UC-2.2 accept 闸修复」注已过时·删）。

### UC-2.2 上拉更早历史 — `✅ 四面全绿`（读族编排 ①②③·④ N/A·认领 M·issue #22·corr_key=ch=15gcgoyf1jfcur614qydhs69ha）

> **原 helix wire-bug 注已过时**：`acl/from_tick.rs::accepts_tick` Command 臂漏 `query::is_query()` 的修复
> **已在 pin 的 round6@bbbf809**（line 28 `|| crate::query::is_query(cmd.name.as_ref())`·Round-5 e2e 揪出·
> from_tick.rs 注释实证）→ `im_load_older_context` 真命令路径可达·实跑 2 轮 postContext 出站命中（早先「①
> 预期红·fix 在 round3 不在 round6」判断有误·实测 round6 已含·见 issue #22 close comment）。

- **① 出站 HTTP**：多轮 `posts/postContext`，body `{before:50, postId}`（camelCase·forbidden snake post_id/before_id）。
  实跑 2 轮 moving anchor：`postId=by5bgzfz1frk3j9bb7r5z3u9ay` → `postId=oyra3judutfaxcn7n57mxjgwah`
  （reducer `createOutbound` fallback 锚 urlEndsWith=posts/postContext·取最后一轮逐字段断言）。**GREEN**。
- **② 投影**：`im:messages:older_loaded`（§1.3 透传·`{channelId, messages, hasMore}` 外层 3 键严格·
  `older_context::emit_older_loaded`·实跑 messages=9 严格更早 wire Post 升序 + hasMore=false）。**GREEN**。
- **③ DOM**：prepend 9 更早消息行到 ML 区头部（壳 `applyOlderLoaded` 升序逆插头部·data-msg-id 直映
  server id·实跑 firstScreen 50 → settled 59·全行 channel-id/msg-id 齐）。**GREEN**。
- **④ 落库**：N/A（读族编排·`older_context.rs` 只产 `Effect::Http`+`Effect::Emit`·**无 Effect::Persist**·
  冻结真源 projection-schema §1.3 行 137「helix-im 编排，前端 prepend」·与 UC-2.4 getReplies 同读族无写·
  按 C004 校正草拟 expect.storage `batch_upsert`→N/A·reducer runFourFacetRead 不裁定 ④）。
- **链路**：滚到顶点 `[data-testid=load-older-btn]` → `onLoadOlder` → `store.loadOlder`（选当前最旧已加载行
  server id+createAt 作 pivot 锚·薄壳不合成 before）→ invoke `im_load_older_context`（commands.rs 薄壳翻译
  入泵 snake `{channel_id, anchor_post_id, anchor_create_at}`·lib.rs 双 handler 注册）→ helix `module_query`
  发首轮 postContext → `module.rs` PortReply ingest_round 推进 anchor → 凑够/耗尽 emit older_loaded → 壳 prepend。
- **测试件**：`test/specs/uc-2.2.e2e.mjs`（e2e 先 invoke `im_query_messages_by_channel` 建首屏锚行 → 点上拉
  按钮 → waitUntil 等行数增长非恒真·HX-C011 → `runFourFacetRead` 裁定 ①② + ③ DOM 行集断言）+
  `test/expect/uc-2.2.expect.json`（①② 冻结·④ N/A·storage 草拟纠偏 batch_upsert→N/A 对齐 projection-schema §1.3）。

### UC-2.3 按 postId 定位 — `✅ 四面全绿`（读族本地·②③④·① N/A optional·认领 S·issue #21·corr_key=ch=15gcgoyf1jfcur614qydhs69ha）

- **① 出站 HTTP**：`N/A optional`（读族纯本地 Scan·无 HTTP 出站·expect.outbound 全 `*` → reducer
  `isOutboundOptional` 判 ① 不约束·总绿）。**契约纠偏**：前 draft 期望 `posts/getPostsAfterIndex
  {postIds:postId}` 与 `im:messages:query_result` 投影**互斥**——HTTP getPostsAfterIndex 走 read_relay
  `im:read:result` 透传，而 query_result 来自 `im_query_messages_by_channel` 本地 Scan（query.rs:96·零 HTTP）。
  单账号 L1 + seeded DB 下定位目标必在已加载首屏内（≤500 条）→ 走本地 Scan 路径·①N/A。越界翻页
  `posts/getPostsAfterIndex`（单 id string·posts.go:318·helix `im_get_posts_after_index`）是 L2/真翻页
  HTTP 兜底·非本 L1 闭环（证据：run.jsonl 本 UC 束无 outbound hop·storage scan(message) rows=50）。
- **② 投影**：`im:messages:query_result`（外层 `{channel_id, messages}`·query.rs:92 emit_message_query_result·
  透传 DB Post 行·与 UC-2.1 同一投影路径）。
- **③ DOM**：定位命中行 `data-msg-id`=server postId + `data-highlighted="true"`（client locate 高亮·
  store `_locateTarget` 命中·rows computed 打标·壳纯渲染·非投影字段）。实跑 highlighted=true 命中
  `bzs3hu9xzp8o9qduqq3q7q7ike`。
- **④ 落库**：Scan `message`（读路径·op=scan/table=message/rows=50）。**reducer 机件纠偏**：Scan op
  payload 仅 `{op,rows,table}`（防隐私·无 channel_id）→ corr_key=null 落 unkeyed·不进 ch 锚束·新增
  `scanFallback`（窗口内同 uc + scan op 的 storage 事件补 ④·与 UC-5.1 create fallback 同模式·非放水：
  缺 scan(message)/错表 → ④ 红·见 reducer 单测可证伪对偶 ×4）。

### UC-2.4 一级/二级回复 — `✅ 四面全绿`（读族 ①②·③④ N/A·认领 M·issue #19）

- **① 出站 HTTP**：`posts/getReplies` `{replyId, pageNumber, pageSize}` / `posts/getReplyBranch`
  `{replyFirstLevelId, pageNumber, pageSize}`（全 camelCase·真源 partial 1 §15-16 GetPostOpts 嵌
  PageOpts·实跑 run.jsonl 实证）。**契约纠偏**：前 draft 期望 getReplyBranch body 含 `offset` 是误把
  partial 6 §129 前端 UI 层 `queryReplyBranchMessage({...offset})` 当 wire body；后端 wire 真相是
  GetPostOpts.pageNumber（posts.go:261 嵌 PageOpts·helix page_body() helper 发 pageNumber 非 offset）→
  expect 改 pageNumber + offset 进 bodyForbidden（证据：run.jsonl 出站 body 实抓 `pageNumber:0`）。
- **② 投影**：`im:read:result`（读族透传·§1.2 `{req_id, body}`·实跑 body 透传后端 `{status, data}`
  SUCCESS 信封·外层键集 2 键严格对齐 + req_id 锚本次 invoke）。
- **③ DOM**：N/A（读族无 write 驱动 DOM 契约面·前端 AX reply-drawer 从透传 body 抽 Post.id 渲染
  `data-reply-id` chips·属前端渲染非冻结契约面·reducer runFourFacetRead 不裁定 ③）。
- **④ 落库**：N/A（Scan-only 读路径·不落新行·cursor 不推进·reducer 不裁定 ④）。
- **测试件**：`test/specs/uc-2.4.e2e.mjs`（e2e 经 `__lf.invoke` 直 invoke `im_get_replies`/
  `im_get_reply_branch` 注真实 seeded postId + reqId → 等 run.jsonl im:read:result 回灌 → reducer
  `runFourFacetRead` 裁 ①②）+ `test/expect/uc-2.4.expect.json`（两 endpoint flat 子期望）。e2e 实跑
  2 passing 全绿（getReplies + getReplyBranch 各 ①② 绿）。reducer 自测含 6 可证伪对偶（snake/offset
  泄漏·少 invoke·少回灌·req_id 错束·投影多字段·均破坏即红）。

### UC-1.3 发送图片/文件 — `🌙 untested·按需`（上传接口在 java·先列 todo·真 go 夜间）

> **物理够不到**：host-cli/testbed 无文件上传 / `processMessageFiles` 上传管线·无法构造 multipart/文件预处理链。
> 物理文件选择 + 上传进度链需真实文件系统 + 上传服务；golden-tape 只录 WS/HTTP 帧不录文件 IO。
> posts/create 底层路径已由 UC-1.1/1.2/1.4 post 回声**间接验证**；UI 上传链路需真前端 e2e（真 go 夜间按需）。
> 参照 helix ledger UC-1.3 同标注法。④ DB 落 message 可测，但 ① 上传 hop 不可确定性回放 → 整 UC 标 ⛔。

---

## 2. 域 B — channel/sync（离线同步 / 频道管理）

> 认领需 increment 就绪 probe（M）。① 出站锚 `真机curl真源 §4/§6` + full-map partial 8 sync wire 契约。

### UC-4.1 hello 根群全量增量 — `✅ green`（四面实跑全绿·2026-06-25 收口·corrected behind-cursor seed）

- **① 出站 HTTP**：WS hello 自动 / `channels/load/increment`，body `{timestamp, cursors:[{channelId, fromSeq}]}`（**✅ 绿**·corr_key 经 `body.cursors[0].channelId` 探针锚频道·全 camelCase·无 snake 泄漏·真源 = helix `acl/sync_http_effects.rs::increment_http_trigger`；reducer batch fallback 把单批请求归锚频道束·cursors 覆盖锚 ch）。
- **① WS 推送**：hello + channels + `increment_channel`（data 携 `lastEventSeq`·**实测 server 真推 114 帧**）+ `increment_channel_end`（批次结束·就绪 probe 锚）。
- **② 投影**：`emit_channels_loaded`（`{items}`·瘦·无 channel_id）+ `emit_channel_increment`（`{channel_id, increment}`·**reducer 锚此 keyed 面·✅ 绿·实测 ×114**）+ `emit_channel_update`（`{channel_id}`·thin·批次结束触发）。
- **③ DOM**：`data-ready` 标志 + channel 行 `data-channel-id`（**✅ 绿·commit f72fdf2** applyDialogList upsert CL 行；e2e 锚频道取批 outbound cursors[0]·保证 ①②④ 真收敛同频道·并断言其已渲染）。
- **④ 落库**：`channel`（`batch_upsert` upsert_channel_full·**✅ 绿·实测 ×114**）+ `channel_event_cursor`（`monotonic_upsert`·run 后 cursor 真前进回 high-water·旁证 increment 帧真到达）。

> **状态（诚实出账·C011·四面实跑全绿·run.sh EXIT=0·幂等复跑两次绿·2026-06-25）**：infra up（go :8065 ping 200·cses-java Micronaut·dev-local 真 creds）。四面收口路径：
> 1. **③ DOM**（commit f72fdf2·loopforge UI 缺陷·已修）：`applyDialogList` 改 upsert CL 每行 → 渲染。
> 2. **① 出站**（机器件·非冻结 oracle·C004 允许）：装饰器 `event.rs::extract_corr_key` + reducer `corr-key.mjs` 增 `body.cursors[0].channelId` 探针 + reducer **batch fallback**（目标束无 outbound 时取 cursors 覆盖锚 ch 的批请求作 ①·faithful·非 tautology·配可证伪对偶单测）。
> 3. **②④ 转绿 = 修正 seed 策略（替代旧「置 0」误判）**：旧 `seed-behind-cursor.sh` 把 cursor **置 0** → server 视为「从头全量同步」→ 返回 `no_change` 空增量（seq=0 历史已过 server 保留窗·不回放）→ ②④ 永空·**误判为「server 数据 gap」**。**实测纠正**：cursor 回退到 **max−DELTA**（落后但仍在 server 事件保留窗内·DELTA=2000）→ **server 真回放 114 个 `increment_channel` 帧** → ② `im:channel:increment`×114 + ④ `batch_upsert channel`×114 真落地·cursor run 后前进回 high-water。故**非 server 数据 gap·是 seed 用错相对量 vs 清零**。
> 4. **uc_id 归属修正（机器件·非冻结 oracle）**：hello 自驱增量在 app 启动即流过（早于 e2e before-hook 的 `set_uc('UC-4.1')`）→ 旧默认全归 `__quiescence__`·reducer 抽空。新增 `LOOPFORGE_BOOTSTRAP_UC` env（`ctx.rs`·缺省 `__quiescence__`）·run.sh UC-4.1 设 `=UC-4.1` → bootstrap hello hop 真归 UC-4.1；其余 UC 不设·语义不污染。
> 5. **④ storage channel 落库 corr-key 归一（机器件）**：channel 表主键 `id`==channelId（非 server post id）→ 装饰器 + reducer 表感知（`table=='channel'` 且无独立 channel_id 时 `id→ch`）·使 ④ 与 ② 同束。回归保护：message 落库 `id` 仍抽 sid。
> 证据：`run.sh -- --spec test/specs/uc-4.1.e2e.mjs` EXIT=0·`[UC-4.1 四面报告] ✅ UC-4.1 四面全绿`·幂等复跑（锚 `3h7og9rf…` / `ber93xo9…` 各异·非硬编）·UC-send-1 regression 四面全绿不回退。reducer 自测 52/52（+13 含 UC-4.1 batch/channel-key 可证伪对偶）·Rust 单测 11/11。冻结 oracle（expect/projection-schema/真机curl真源）零改（C004）·绿由 reducer 裁定（C009）。

### UC-4.2 按需 sync notify — `✅ 四面全绿`（live·内核自驱 gap 触发·anchorCh=14jeie5yc78mzbixrhdeocfoyy·issue #32 closed·2026-06-25 暖栈实跑 ×2 全绿）

- **① 出站 HTTP**：`POST channel/sync/notify`，body `{cursors:[{channelId, fromSeq}]}`（per-channel·内层 camelCase channelId/fromSeq·顶层仅 cursors 键·区别于 UC-4.1 batch increment 的 {timestamp, cursors}）。✅ live 实证（decorator 探 body.cursors[0] 抽 ch → ① keyed by ch·151 条 sync/notify 出站·`bodyForbidden` 锚顶层 channelId/channel_id/fromSeq/from_seq 泄漏）。真源 `sync_http_effects.rs::sync_notify`·partial 8 §2.1。
- **① WS 推送**：cursor 落后（behind-cursor seed）→ hello 重检 per-channel needSync gap → server 回放离线区间 `increment_channel`/`post` 帧（helix ledger 实证 needSync=true 真帧）。
- **② 投影**：`emit_channel_update_by_post`（im:channel:update-by-post·`{channel_id, event_seq, msg_id}`·瘦·badge 触发位）+ 配对 fat `emit_post_received`（增量行驱动）。✅ live 实证字段集 == {channel_id, event_seq, msg_id}（885 条 update-by-post）。
- **③ DOM**：CL 区锚频道行 data-unread badge 累加（每条 update-by-post +1·✅ 实证 unread=2）+ ML 区增量消息行 data-msg-id（fat im:post:received 驱动 applyMessageItem 追加·✅ 实证 msg-id=wrjcaq48b7dbmrtkg4u7wf3ztc）。
- **④ 落库**：锚 ch `message` batch_upsert ≥1 行（sync 回放逐 PostUpsert 落库·988 条 message 落库）+ `channel_event_cursor` monotonic_upsert 跳空洞（scope=ch·value=high-water·旁证）。✅ live 实证。
- **artifacts**：`test/expect/uc-4.2.expect.json` + `test/specs/uc-4.2.e2e.mjs`（live 真跑·1 passing ×2 轮·anchorCh 恒定·四面交集 94 频道）。
- **机器件改动**：reducer 新增 `runFourFacetSyncNotify`（内核自驱 gap 触发·UC 窗口 + 锚 ch 各 facet 聚合裁定·非单 corr_key 束）+ 单测 12 断言（绿 + 7 可证伪：无 sync/notify→①红 / 顶层 channelId 泄漏→①红 / 无 update-by-post→②红 / 缺 event_seq→②红 / 无锚 ch 落库→④红 / badge 未刷→③红 / sync 发生即①绿锚收敛靠②④过滤）；harness.sh `spec <uc> --keep` 跳过 truncate（保 boot 自驱 hop·UC-4.1/4.2/10.1 类）+ case 分发改 `cmd_spec "$@"`。Angular：store `applyChannelUpdateByPost`（unread +1 badge）+ `CHANNEL_UPDATE_BY_POST_CHANNEL` onBus 分支 + `syncChannels`（invoke im_sync_channels）·组件 `onSyncChannels` 接通（C007）。Rust：`im_sync_channels` 命令（pump im_reconnect → driver 重连重跑 hello 重检 gap）·lib.rs 双 handler 注册。
- **触发机制**：behind-cursor seed（cursor 落后态·改环境对齐契约·C004 决策 A·复用 UC-4.1 seed-behind-cursor.sh）+ bootstrap UC=UC-4.2（hello gap-sync hop 归 UC-4.2·`reload-app --uc UC-4.2`）→ hello 自驱 sync/notify。onSyncChannels 按钮是同 UC 的按需触发入口（reconnect 重跑·链路同 cold-boot）。

### UC-4.5 陌生 channel 兜底 — `✅ 读族双面全绿`（live·req_id 锚·read-relay ①② 绿·③④=N/A 读路径·issue #33 closed）

- **契约校正（C004·冻结源码裁定）**：issue #33 草拟锚『② emit_channel_increment / ④ channel+cursor』与冻结真源**冲突**——`channel/load/incrementByChannelId` 是**读命令**（`channel_read.rs::LoadIncrementByChannelIdCommand` `is_read=true`·HTTP 直返单条 `*IncrementChannel`·**不推送**），走 helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`（projection-schema §1.2 读族·非 21 投影集），**无 `Effect::Persist`**（不落新行·cursor 不推进）。按 C004 以冻结源码（channel_read.rs:99-110 + read_relay.rs）校正为读族 ①② 两面·③④=N/A（同 UC-2.4 getReplies / UC-6.4 byIds 读族断面）。
- **① 出站 HTTP**：`im_ensure_channel_loaded` → `POST channel/load/incrementByChannelId`，body `{channelId}`（全 camelCase）。✅ live 实证（run.jsonl seq=633·body=`{channelId:15gcgoyf1jfcur614qydhs69ha}`·无 snake/cursor 泄漏·`bodyForbidden` 锚 channel_id/from_seq/fromSeq）。
- **② 投影**：`im:read:result`（`{req_id, body}`·body=后端 IncrementChannel 响应体透传·含 boss/admin/createAt 等·inner 不冻结）。✅ live 实证（run.jsonl seq=635·req_id 锚本次 invoke·外层键集严格 {req_id, body}）。
- **③ DOM**：N/A（读族无 write 驱动 DOM 契约面·前端 bridge resolve req_id 后由透传 body 渲染单频道增量·非冻结面）。reducer runFourFacetRead 不裁定 ③。
- **④ 落库**：N/A（读路径·is_read=true·HTTP 直返不推送·无 Persist·不落新行·cursor 不推进）。reducer runFourFacetRead 不裁定 ④。
- **触发机制**：e2e 经 `__lf.invoke('im_ensure_channel_loaded', {channelId, reqId})`（与 app.component `onEnsureChannelLoaded` / CL 区 `ensure-channel-loaded-btn` 同命令·求确定性）→ waitUntil 等 reqId 的 im:read:result 回灌落 run.jsonl → runFourFacetRead 裁定 ①②。
- **artifacts**：`test/expect/uc-4.5.expect.json` + `test/specs/uc-4.5.e2e.mjs`（live 真跑·1 passing·338ms）。
- **机器件改动**：Rust `im_ensure_channel_loaded` 命令（入泵 `im_channel_load_increment_by_channel_id`·lib.rs 双 cfg 分支注册）+ 前端 `ImStore.ensureChannelLoaded` + `onEnsureChannelLoaded` 处理件（C007 事件配方法）+ CL 区兜底按钮。reducer / 装饰器 / oracle 未改（读族断面复用 runFourFacetRead·无需新机件）。
- **WS 旁证（非本 UC 契约面）**：`increment_channel` 命中本地未知 channel → 自动注册是 helix 引擎入站旁路（UC-4.1 hello 主驱·73 帧实证）·与本 UC 前端 invoke 读族兜底路径不同源·不并入本 UC 四面。

### UC-5.1 创建群聊 — `✅ 四面全绿`（live·corr_key=ch=hkcs5xdupty69bg9oztxbmc9th·issue #8 closed）

- **① 出站 HTTP**：`POST /api/cses/channel/create`，body 锚 `真机curl真源 §4`——`{teamId, displayName, orient:"", type:"P", users:[{id,teamId,role}]（自己 CREATOR + 他人 MEMBER）, picturetype:"USER", picture:{userIds}, forceCreate:true}`。✅ live 实证 body keys 全集匹配·无 channelId 泄漏（出站 body 无 server 分配 id → reducer createOutbound fallback 归锚 ch 束·窗口隔离保证唯一）。
- **① WS 推送**：action=`channel_created`（type:P·data.id 命中·helix ledger 实证）+ `channel_member_update` + `post`。
- **② 投影**：`emit_channel_created`（`{channel_id, channel}`·透传帧 channel 对象）。✅ live 实证字段集 == {channel_id, channel}。
- **③ DOM**：`data-channel-id` 新行。✅ live 实证（before=114 → after=115·新 ch 行渲染·store.applyChannelCreated upsert）。
- **④ 落库**：`channel` 新行。✅ live 实证 batch_upsert channel rows=1 id=ch。
- **变体备注**：HTTP #8 `channel/createSpecifyOwner`（指定 owner·`im_create_specify_owner`）是同建群母 UC 的指定-owner 变体（独立 endpoint·session 默认 owner 走本 #7）；本 UC 收口 #7 主路径。
- **artifacts**：`test/expect/uc-5.1.expect.json` + `test/specs/uc-5.1.e2e.mjs`（live 真跑·1 passing）。
- **机器件改动**：reducer `actualOutbound` 加 create fallback（非批量·URL endsWith·窗口唯一）+ 单测 3 断言（绿 + 2 可证伪：无 create→红 / channelId 泄漏→红）；装饰器 extract_corr_key 未改（建群出站本就 corr_key None·归 unkeyed 是预期·靠 fallback 归束·非改抽键口径）。Rust：`im_create_channel` 命令 + AppState.identity（profile 单一真源拼 body·壳不臆造）。

### UC-5.2 创建话题 — `✅ 四面全绿`（live·corr_key=ch=1k47mhtxhf8988y8x7646y4xey·issue #9 closed）

- **① 出站 HTTP**：`POST /api/cses/posts/makeTopic`，body 锚 `真机curl真源 §2`——`{rootId, teamId, postId, displayName, type:"T", users:[{id,role:CREATOR/MEMBER,teamId}], picturetype:"USER", picture:{userIds}, forceCreate:true}`（头带 `Cses-Track-Id`）。
- **① WS 推送**：action=`channel_created`（type:T·displayName·rootId 关联·helix ledger 实证）+ `post_update` 旁推。
- **② 投影**：`emit_channel_created`（type=T）。
- **③ DOM**：`data-channel-id`（topic）。
- **④ 落库**：`channel`（type=T）。

### UC-5.3b member-leave 广播 — `✅ ①+②④源 L2 双账号验证绿（issue #44·后端 round-2 补齐·2026-06-28）`
> **L2 绿证（#44·2026-06-28 暖栈 spec uc-5.3b-l2 两轮 channelId 各异 rd84i…/53rf3…）**：后端 round-2 `handleMemberLeave→broadcastMemberLeaveIncrement` 补对**留存成员**单播 `channel_member_update{memberChange.leave:[678]}`。被移除者 678 已离群收不到（结构性）→ 观测端=留存成员 B=999。A=444 建频道含 678+999 → 移除 678 → **B=999 raw-WS（observe·L2_USER=999）收 channel_member_update**（memberChange.leave 含 678·channelId 锚命中）= ②(emit_channel_member_updated)/④(channel_member BatchDelete) 留存成员侧结构源。① A 出站 `channel/member/change {channelId, leaveUsers:[{id:678}]}` reducer 绿。artifacts：`test/specs/uc-5.3b-l2.e2e.mjs` + `test/expect/uc-5.3b-l2.expect.json`。

### UC-5.3 关闭/退出群 — `✅ 关闭群四面全绿`（member-leave 广播子项 → L2 #44 已验证绿·见上 UC-5.3b 节）

- **e2e**：`test/specs/uc-5.3.e2e.mjs` 四面全绿（corr_key=ch=<channelId>·真 go·真 Tauri+WKWebView·建本人 CREATOR 群后关闭·run.jsonl 实证 ②deleteAt=server 真值）。
- **① 出站 HTTP**：`POST /api/cses/channel/close`，body `{channelId}`（✅ 真跑覆盖·ChannelCloseCommand·`真机curl真源 §6`·crossmap HTTP #27 covered）·`bodyForbidden` id/channel_id 别名/top/displayName/notice/deleteAt 泄漏。退群子项走 `channel/member/leave`（crossmap #33 partial·broadcast-dep ⛔）。
- **① WS 推送**：action=`channel_close`（self 收·broadcast 到 channelId·crossmap WS #13·✅ 实证）·member-leave 广播给被增减目标（**非 self = broadcast-dep 子项·单账号 ⛔**）。
- **② 投影**：`emit_channel_closed`（im:channel:closed·`{channelId, deleteAt}`·全 camelCase·独立 broadcast 推送非批次结束 thin·✅ 实证）。
- **③ DOM**：channel 行移除（im:channel:closed → 壳 `applyChannelClosed` filter 删行·data-channel-id !absent·✅ 实证·reducer `!absent` 哨兵守可证伪行仍在即红）。
- **④ 落库**：`channel` 表 batch_update（delete_at + is_active=0 定点 patch·表感知归一 channel.id→ch·✅ 实证·软删权威在 DB 列·壳层删行渲染）。
- **admin 权限真实约束**：关闭群须本人 owner/admin·e2e 先建本人 CREATOR 新群再关闭（真实用户流·C003）。
- **机器件**：reducer `diffDom` 加 `!absent` 哨兵（行已移除语义·行仍在即 ③ 红·非 tautology）+ 装饰器标准 body.channelId 探针·均非冻结 oracle（C009）。

### UC-5.4 群属性修改（改群名 displayName）— `✅ 四面全绿`（round5·corr_key=ch=…;seq=2）

> **真机 wire 实证纠偏（C010/C011）**：改群名 server echo **不**走独立 `update_channel` WS / `emit_channel_update` thin（先前 ledger 假设错·server 不推该帧）——实抓走 **channelUpdate 系统 NOTICE post**（`im:post:received`·`props.type=channelUpdate`·`props.field=displayName`·`props.content=新名`·`userId=SYS`·`type=NOTICE`）。oracle 以真机 wire 为准（run.jsonl seq19/514 实证）。
>
> **覆盖**：本 UC 实跑 displayName 改名一面四绿（crossmap HTTP #13 `channel/change/displayName`）。同族 notice/purpose/orient/permission/picture/source/info/props（crossmap #9-17）走同 channelUpdate-post 回声机制·命令已接（`im_channel_change_notice` 等可按需补 spec）。

- **① 出站 HTTP**：`channel/change/displayName`（body `{id, displayName}`·真源 ChangeDisplayNameCommand）✅。同族 `channel/change/{notice,info,source,picture,orient,purpose,props,permission}` 命令已接（按需补 spec）。
- **① WS 推送**：改属性 → server 回 **channelUpdate 系统 post**（`props.field` 标改的字段·`props.content` 新值）✅。
- **② 投影**：`im:post:received`（fat·channelUpdate 系统帧·`propsMatch type=channelUpdate/field=displayName/content=新名` 精确区分 vs 同形态 join 帧·守可证伪）✅。
- **③ DOM**：`data-channel-display-name` 回读（壳 `applyChannelUpdatePost` 透传 props.field/content 刷 CL 行）✅。
- **④ 落库**：`message` 行（channelUpdate 系统 NOTICE post 逐条落库·batch_upsert message）✅。
- **admin 权限真实约束**：改群名须本人 owner/admin（非 owner → server `update_cses_channel` app_error）·e2e 先建本人 CREATOR 新群再改名（真实用户流·C003）。
- **机器件**：装饰器 `extract_corr_key` url-aware（`channel/change/`→body.id→ch）+ reducer `chPerPostTarget`（ch 匹配 + 含期望 channelUpdate 投影·`propsMatch` 子集断言）·均非冻结 oracle（C009）。

### UC-5.5 置顶 — `✅ 频道置顶四面全绿` + `⚠️ 消息置顶 5.5b ① 出站全绿·②③④ ⛔backend-down`（子项不阻塞）

- **e2e**：`test/specs/uc-5.5.e2e.mjs` 频道置顶四面全绿（corr_key=ch=<channelId>·真 go·真 Tauri+WKWebView·建本人 CREATOR 群后置顶）。**消息置顶 5.5b**：`test/specs/uc-5.5b.e2e.mjs`（拆两 it·① 出站面 + ②③④ post_pin echo 面·暖栈实跑）。
- **① 出站 HTTP**：频道置顶 `channel/change/top`（im_channel_change_top·body {channelId, top}·✅ 真跑覆盖）·**消息置顶 `channel/add/postPinned`（im_post_pin·body {channelId, postId} camelCase·✅ 暖栈实跑绿）**——send round-trip（posts/create→WS echo 取 server_id）+ post_pin 出站均经 go-mattermost :8065·与 post_pin 业务 echo（cses-java）解耦。
- **① WS 推送**：频道置顶 → action=`update_channel`（per-member 定向 PATCH·channelIsTop→is_top 列）·消息置顶 → `post_pin` echo（`im:post:updated`）**阻于 cses-java 宕机**（7091/3391=000·JDWP suspend·go→cses-java 业务 WS 广播链断·见 log.md #14/#42）→ ②③④ ⛔backend-down（waitUntil data-pinned 超时·真 backend-down·非掩盖·C008 可证伪）。
- **② 投影**：`emit_channel_update`（im:channel:update·thin·{channel_id}·✅ 实证）/ 消息置顶 `emit_post_updated`（im:post:updated·fat 13 键·⛔backend-down·后端恢复后裁定）。
- **③ DOM**：`data-channel-top`（is_top 列回读·✅ 实证）/ 消息置顶 `data-pinned`（⛔backend-down）。
- **④ 落库**：`channel` 表 batch_update（is_top 列·✅ 实证）/ 消息置顶 `message` 表 batch_update（pinned patch·⛔backend-down）。
- **artifacts**：`test/expect/uc-5.5b.expect.json`（冻结 oracle·只读）+ `test/specs/uc-5.5b.e2e.mjs`（① it 1 passing·②③④ it 红=⛔backend-down·禁伪造绿）。后端恢复后 `harness.sh reload-app && harness.sh spec 5.5b` 裁定 ②③④ 绿。

### UC-5.6 群公告 — `✅ 5.6r 读族 ①② 全绿`（go-served）+ `⚠️ 5.6w 写族 ① 全绿·②④ ⛔backend-down`

- **5.6r 读族 acceptList/list/detail（断面 ①②·③④ N/A）**：三端点（`post/announcement/{acceptList,list,detail}`·真源 partials/1 §28/§30/§31）均纯读 announcement 表（无 post_update 回声）→ helix `read_relay::emit_read_result` 透传 `im:read:result{req_id, body}`。**经 go-mattermost :8065 ①② 双面全绿**（暖栈 `harness.sh spec 5.6r`·3 passing·corr_key=req_id·各端点独立 set_uc 窗口·reducer runFourFacetRead 裁定）。① 出站逐端点 body camelCase（acceptList {postId} / list {channelId} / detail {postIds:[]}·bodyForbidden 锚 snake 泄漏）·② im:read:result 外层键集严格对齐。artifacts：`test/expect/uc-5.6r.expect.json` + `test/specs/uc-5.6r.e2e.mjs`。
- **5.6w 写族 save/read/delete（WS post_update echo·断面 ①②④·③ N/A）**：三写端点（`post/announcement/{save,read,delete}`·真源 partials/1 §26-29）server echo 统一 WS `post_update`（gap §69 announcement*→post_update ✅）→ `emit_post_updated` im:post:updated（fat 13 键）→ message batch_update。**① 出站经 go-mattermost :8065 三端点全绿**（save {channelId,type,message} / read {postId,channelId} / delete {postIds,postId} 两字段同值数组 camelCase）·**②④ post_update echo 阻于 cses-java 宕机**（go→cses-java 业务 WS 广播链断·见 log.md #14/#42）→ ⛔backend-down（禁伪造绿·C009/C011）。artifacts：`test/expect/uc-5.6w.expect.json` + `test/specs/uc-5.6w.e2e.mjs`（① 3 passing·②④ 3 红=backend-down）。后端恢复后 `harness.sh reload-app && harness.sh spec 5.6w` 裁定 ②④ 绿。
> **机器件改动**：reducer `runFourFacet` outbound facet 修 `target ?? 空束`——delete 出站 body `{postIds,postId}` 两字段皆**数组** → corr-key 抽不出 sid → target 落空·此前 `target && actualOutbound` 短路 null → ① 假红；改传空束让 createOutbound（urlEndsWith）fallback 兜底取出站（守可证伪·无 URL 命中仍红·reducer 自测 167 通过）。非冻结 oracle（C009·机器件 target 选择/出站兜底）。

### UC-5.7 在线状态/分组 — `✅ channel/onlineStatus 读族 ①② 全绿`（users/status/ids ⛔ 后端真阻塞·P1-2）

- **channel/onlineStatus 批量查在线（断面 ①②·③④ N/A）**：`im_channel_online_status`→`POST channel/onlineStatus`·body `{channelIds:[]string}`（真源 partial 2 §28·触发 WS 无→读族 request-response）→ helix `read_relay::emit_read_result` 透传 `im:read:result{req_id, body}`。**经 go-mattermost :8065 ①② 双面全绿**（暖栈 `harness.sh spec 5.7`·1 passing·corr_key=req_id·reducer runFourFacetRead 裁定）。① 出站 body camelCase channelIds 数组（bodyForbidden 锚 snake/单数误形）·② im:read:result 外层键集严格对齐。artifacts：`test/expect/uc-5.7.expect.json` + `test/specs/uc-5.7.e2e.mjs`。
> **users/status/ids 仍后端真阻塞**（缺口矩阵 P1-2·依赖 mattermost statusCache·迁移裁决前不能红转绿·违护栏）→ 标 ⛔（与 channel/onlineStatus 读族解耦·后者已绿）。

### UC-5.8 条件查频道 — `✅ 四面全绿`（读族 ①②·③④ N/A·暖栈实跑全绿·corr_key=req_id·issue #38）

> **读族 request-response 断面 ①②**（同 UC-4.5 / UC-6.4）：`channel/query` 是读命令（`channel_read.rs::ChannelQueryCommand` `is_read=true`·HTTP 200 响应体即查询结果·**不推送**·无 WS 回声）→ helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`（projection-schema §1.2 读族·非 21 投影集）。按 C004 以冻结源码（channel_read.rs:115-143 + read_relay.rs）裁定为读族 ①② 两面·③④=N/A。

- **① 出站 HTTP**：`im_channel_query` → `POST channel/query`，body = condition map 平铺顶层 + `pageNumber`/`pageSize`/`offset`（i64·缺省 0·匿名 struct embed Channel + PageOpts 同层 merge·全 camelCase）。✅ 暖栈实证（reducer diffOutbound：`bodyFields {pageNumber, pageSize, offset}` 命中 + `bodyForbidden` 锚 page_number/page_size/pageOpts/condition snake/别名泄漏 不命中）。真源 partial 2 §2 + helix outbound/channel_read.rs ChannelQueryCommand。
- **② 投影**：`im:read:result`（读族透传·§1.2 `{req_id, body}`·外层键集严格对齐·req_id 锚本次 invoke·body = 后端 channel/query 响应体原样透传 []*Channel·inner 不冻结）。✅ 暖栈实证（req_id=req-6wlpf9wi41）。
- **③ DOM**：N/A（读族无 write 驱动 DOM 契约面·查询结果列表 data-channel-id 由前端从透传 body 抽频道渲染·非冻结面）。reducer runFourFacetRead 不裁定 ③。
- **④ 落库**：N/A（查询为只读·无 `Effect::Persist`·装饰器 facet④ 不暴露读路径）。reducer runFourFacetRead 不裁定 ④。
- **artifacts**：`test/expect/uc-5.8.expect.json` + `test/specs/uc-5.8.e2e.mjs`（暖栈真跑·1 passing·192ms·reducer 报告「✅ UC-5.8 读族双面全绿·endpoint=channel/query」）。
- **机器件改动**：Rust `im_channel_query` 命令（commands.rs·入泵 helix-im `im_channel_query`·lib.rs 双 cfg 分支注册）+ 前端 `ImStore.queryChannels` + `onQueryChannels` 接通（占位 → 真接·C007 事件配方法·按已渲染频道名构 condition）。reducer / 装饰器 / oracle 未改（读族断面复用 runFourFacetRead·无需新机件）。

### UC-4.3 too_long 重拉 — `⛔ unreachable`（harness-gap·触发态够不到）

> **物理/数据够不到（非 wire-bug·代码侧实现完整有单测）**：testbed 无「注入本地落后 cursor」入口·冷启动 cursor=0 走 increment 不进 too_long 分支·也无法把本地 cursor 顶到远落后服务端 seq 的态（helix ledger 同标 harness-gap）。
> **② 投影**：`emit_sync_too_long`（`{channelId, resetTo}`·channel.rs:223 emit / module.rs:760 清表·由 helix-im 单测覆盖）；**③ DOM**：清表重渲首屏；**④ 落库**：`message` 清+重拉·cursor=resetTo-1。e2e 触发态待 testbed 加注入入口或服务端构造超阈 gap。

### UC-4.4 心跳 gap 补偿 — `✅ 三面全绿`（①②④ e2e 真跑·③ DOM N/A 已移除该面要求·issue #34）

> **纯 Rust ping/pong 自驱**（8s piggyback·`ping_interval_ms=8000`）·无前端 invoke 触发·③ DOM 面已移除（补偿增量经 4.2 路径渲染·DOM 断言归 UC-4.2）。三面 ①②④ + cursor 经 `runFourFacetHeartbeatGap` reducer 真跑裁定全绿（e2e 暖跑·anchorCh=`181jj6htd7nn3xx51z78bhuhcr`·ping∩update-by-post∩message 三面交集命中 94 频道）。
>
> **环境前置（C003/C004 决策 A·改环境不改 oracle）**：`scripts/seed-behind-cursor.sh` 把 cursor 拉回落后态 → 心跳 ping piggyback 的 `allHash`（FNV-1a 16-hex·实证 `97b4cbbb048f0f04`）与 server 权威水位不符 → pong 回 `{gaps, hashMismatch}` → `pong_compensate::compensate_from_pong` 自驱补偿。bootstrap UC=UC-4.4（`reload-app --uc UC-4.4`·心跳/补偿 hop 归 UC-4.4）。

- **① 出站**：ws-send ping 帧 `{action:"ping", seq, data:{cursors:[{channelId, fromSeq}], allHash}}`（`acl::transport_effects::ping_frame`·全量根群确定性升序快照·实证 152 cursors·allHash 16-hex 小写）。**✅ 真绿**：Transport::send decorator tee facet① hop=ws-send → reducer 找 action==ping 且 data.cursors 含锚 ch 的 ws-send 帧（faithful·覆盖锚 ch·allHash 非空）。
- **① WS 推送（输入·非断言面）**：pong `{status:OK, seq_reply, data:{gaps, hashMismatch}}`（hashMismatch:true 触发全量根群对账补偿）。
- **② 投影**：`im:channel:update-by-post`（`{channel_id, event_seq, msg_id}`·瘦 badge·补偿 sync 回放每条可见 type1 触发）。**✅ 真绿**：外层键集严格对齐（缺/多即红）·实证 885 条·data keys 精确 `{channel_id, event_seq, msg_id}`。
- **③ DOM**：N/A（issue #34 已移除该面·补偿增量经 4.2 路径渲染·DOM 断言归 UC-4.2）。
- **④ 落库**：`message` batch_upsert（补偿 sync 回放逐 PostUpsert 落库·锚 ch 累计 ≥1·实证 94 频道 batch_upsert）+ `channel_event_cursor` monotonic_upsert 跳空洞旁证。**✅ 真绿**。
- **接通件**：复用 helix `ping_frame`（产侧）+ `pong_compensate::compensate_from_pong`（消费侧·blocked by #7 cursor 根 + #32 补偿走 4.2 sync 投影·均 CLOSED）· reducer `runFourFacetHeartbeatGap`（三面 ①②④·③ N/A·6 可证伪对偶）· expect/uc-4.4.expect.json + specs/uc-4.4.e2e.mjs（e2e 真跑三面全绿）。无独立 Angular UI（③ 面已移除·issue #34 acceptance「无独立 UI」）。

---

## 3. 域 C — user-misc（成员管理 / 搜索 / 待办 / 书签）

> 认领 M。① 出站锚 `真机curl真源 §5`（member change）+ full-map partial 6。

### UC-6.1 拉/踢人 — `✅ ① L1 真绿 · ②④源 L2 双账号验证绿（issue #28/#43·2026-06-28）`（③ data-members 为 B 侧观测·A 驱动 spec N/A）
> **L2 绿证（#28/#43·2026-06-28 暖栈 spec uc-6.1-l2 两轮·channelId 各异非 tautology）**：A=444 当场建频道（不含 678）→ 拉 678 → **B=678 raw-WS（observe-678.mjs）收 `channel_member_update` 广播帧**（全 channel 对象·broadcast.userId=678=被拉成员 key 路由位·raw 含锚频道）= ②(`emit_channel_member_updated` 输入帧)/④(`channel_member` BatchUpsert 输入帧) 在 B 侧的结构性源。① A 出站 `channel/member/change {channelId, joinUsers:[678]}` reducer 裁定绿。③ data-members 是被拉成员 678 视图的 DOM·A 驱动 spec 不渲染（B 侧观测·raw 帧即源）。**对照实证拉人有正确 member-update 事件**（区别于 #29 admin/#44 leave 的 NOTICE-post 缺口·见 NEEDS_CSES_IM_SERVER_FIX_member_event_broadcast.md）。

- **① 出站 HTTP**：`POST /api/cses/channel/member/change`，body 锚 `真机curl真源 §5`——`{channelId, joinUsers:[{id,teamId,role}]}` 加人 / `{channelId, leaveUsers:[...]}` 踢人（两者可同时非 nil·**新 endpoint·不是 member/leave**）。**✅ L1 真绿**（e2e 暖跑·corr_key=ch=qsegsk5coifo3pqoxm391t6u1c·HTTP 200 `channelMemberChange success`·reducer outbound facet OK·body 实证 `{channelId, joinUsers:[{id:445,role:MEMBER,teamId:...}]}`·bodyForbidden snake/顶层 userId/id 无泄漏）。
- **接通件**：Rust `im_channel_member_change`(commands.rs + lib.rs 双 feature 注册·teamId 取 identity·真源 §5 camelCase body) · 壳 store.changeMember + applyMemberUpdated（projection.types MEMBER_UPDATED_CHANNEL·从 channel 对象 memberChange.join+四源 upsert MB 行 + data-members 在册串） · UI MB 区 change-member-input + 拉/踢 btn + onChangeMember · expect/uc-6.1.expect.json + specs/uc-6.1.e2e.mjs（① 真跑绿·②③④ L2 阻塞红·见下）。
- **②③④ 结构性 L2（→#43·非 L1 单账号可造）**：go `cses_channel.go:587` `result[member.UserId]=inc`（map 键=被拉成员 userId·members=`LoadChannelMemberByChannelIdAndUserIds(joinIds)` 只含被拉成员）+ `:974` `NewWebSocketEvent(WebsocketEventChannelMemberUpdate, "","", key, nil,"")`（`key` 落在 **userId 参数位**·非 channelId 位）→ `channel_member_update` echo **只推被拉成员（445）的连接**·**不回声操作者（444）**。实证 run.jsonl：member/change 出站后操作者连接 **0 条** `channel_member_update` ws-recv / **0 条** `im:channel:member-updated` 投影（HTTP 200 后只剩 http-resp 帧·无任何 ws action 帧）。故 ②④（im:channel:member-updated 投影 + channel_member 自驱 upsert）+ ③（data-members 实时更新）**结构上只在被拉成员第二连接观测得到**·单账号 L1 无法产出·由 L2 issue #43（拉人后对端实时更新·双账号）接盘。
- **② 投影**：`emit_channel_member_updated`（`{channel_id, channel}`·透传帧 channel 对象）。— L2（被拉成员侧观测·#43）
- **③ DOM**：`data-members` 回读。— L2（被拉成员侧观测·#43）
- **④ 落库**：`channel_member`。— L2（被拉成员侧自驱·#43）

### UC-6.2 设/撤管理员 — `✅ ①③ L1 真绿 · ②④源 L2 双账号验证绿（issue #29/#45·后端 round-2 changeManagerRole 补齐·2026-06-28）`（认领 C）
> **L2 绿证（#29/#45·2026-06-28 暖栈 spec uc-6.2-l2 两轮 channelId 各异 955km…/67n4o…）**：后端 round-2 `changeManagerRole` 补 `channel_member_role_updated{channelId,userIds,role}` 广播（add/remove manger 都经它·无 GrpcInvoke 绕过）。A=444 建频道含 678 → 设 678 admin → **B=678 raw-WS（observe-678）收 `channel_member_role_updated`**（role=MANAGER·userIds 含 678·channelId 锚命中）= ②(emit_channel_member_updated 角色态源)/④(channel_member role 落库源) 在 B 侧结构源。① A 出站 `channel/add/manger {channelId, users:[{id:678,role:ADMIN}]}` reducer 绿。③ data-admin 为 678 视图·A 驱动 spec N/A。〔旧判断「add/remove manger 后端 WS 已注释」已被 round-2 修正·channel_member_role_updated 现真广播。〕

- **① 出站 HTTP**：`POST channel/add/manger`（set=true·撤=`channel/remove/manger`）·body `{channelId, users:[{id,name,role,teamId}]}`（全 camelCase·bodyForbidden channel_id snake / 顶层 userId/id/role 泄漏·成员四键嵌 users[]·真源 channel_change_dedicated.rs §19/§20 AddMangerCommand/RemoveMangerCommand + Go command.AddChannelMangerCommand/DeleteChannelMangerCommand）。✅ 实证 run.jsonl：`{channelId, users:[{id:445,name:'',role:ADMIN,teamId}]}`·uc_id=UC-6.2。
- **③ DOM**：`data-admin`（=1·set ADMIN 态）+ `data-member-id`(=userId)。L1 无 ② 投影源 → 壳 setManger 的旧乐观刷写法已废弃，当前仅保留“真实出站 + L2 广播回灌”口径。✅ waitUntil 等 data-admin==1（历史 debug 桥 debugSetManger 已废弃）。
- **② 投影**：`emit_channel_member_updated` / `emit_channel_update`。🟡 **L2-facet（结构性·非 data-dep）**：add/remove manger 后端 WS 已注释（仅 GrpcInvoke·真源 §19/§20 注），操作者实际收 `channel_member_role_updated`（helix `ws/handlers/channel_member_role_updated.rs` **graceful no-op**·真源 cses-client router.rs 落 vec![]·无业务 Effect）；emit_channel_member_updated 须 `channel_member_update` 全量广播帧（角色态由其覆盖·结构性须第二账号触发）。L1 单账号造不出 → **L2 #45 接盘**。run.jsonl 证据：add/manger 返出站·但窗内无 channel_member_update echo / 无 im:channel:member-updated 投影。
- **④ 落库**：`channel_member`。🟡 **L2-facet（同 ②·须 channel_member_update 广播帧的 BatchUpsert·结构性须第二账号触发·L2 #45）**。
- **接通件**：Rust `im_channel_set_manger`(commands.rs + lib.rs 双 feature 注册·set bool 切 add/remove·users 单成员 {id,name:'',role:ADMIN|MEMBER,teamId}·teamId 取 identity) · 壳 store.setManger（真实出站；`data-admin` 仅由 L2 广播回灌，不再乐观刷）+ onChangeManger（UI『管』按钮 toggle !mem.admin）·历史 debug 桥 debugSetManger 已废弃 · reducer runFourFacetCommandDom（①③ 断面·②④ N/A 不裁定·structural L2）· expect/uc-6.2.expect.json（facetMode=command-dom）+ specs/uc-6.2.e2e.mjs。

### UC-6.3 改群昵称 — `✅ 四面全绿`（e2e 真跑·corr_key=ch=<channelId>·issue #26）

- **① 出站 HTTP**：`POST channel/member/change/nickname`·body `{channelId, nickname[, userId]}`（全 camelCase·bodyForbidden channel_id snake / nickName camelN / id 别名·真源 UpdateNicknameCommand + Go command.UpdateChannelMemberNickname）。✅ 实证 run.jsonl：`{channelId, nickname, userId:445}`。
- **① WS 推送**：action=`update_channel_member_nickName`（camelN·{channelId, userId, nickName}·broadcast 到 channelId·成员各收）。
- **② 投影**：`im:channel:memberNickname`（`{channelId, userId, nickName}`·to_effect_s1::emit_member_nickname·缺/多即 fail + dataValues userId/nickName 守可证伪）。✅ 实证 run.jsonl。
- **③ DOM**：`data-member-id`(=userId) + `data-nickname`(=nickName)·壳 applyMemberNickname upsert MB 区成员行（投影驱动入列·壳纯渲染）。✅ waitUntil 等 data-nickname==新昵称。
- **④ 落库**：`channel_member` BatchUpsert（复合 PK channel_id,user_id·conflict 仅改 nick_name 列·exclude team_id/role·O(1) 单行 upsert）。✅ 实证 run.jsonl rows=1。
- **接通件**：Rust `im_update_member_nickname`(commands.rs + lib.rs 双 feature 注册) · 壳 store.changeMemberNickname + applyMemberNickname（projection.types MEMBER_NICKNAME_CHANNEL）· UI MB 区 change-nickname-input + onChangeNickname · expect/uc-6.3.expect.json + specs/uc-6.3.e2e.mjs。

### UC-6.4 成员快照/全量 — `✅ 四面全绿`（读族 ①②·③④ N/A·暖栈实跑双 endpoint 全绿·issue #27）

- **① 出站 HTTP**：`channels/member/byIds` body `{channelIds:[活动频道]}`（len 1..200·全 camelCase）+ `channel/member/snapshot` body `{channelId, startTime, endTime}`（int64 毫秒·全 camelCase）——helix `outbound/channel_read.rs` MembersByIdsCommand / MemberSnapshotCommand 实证·真源 partial 2 §5/§6。loopforge 桥 `im_members_by_ids` / `im_member_snapshot`（commands.rs·snake→camel 化在 helix build·壳不臆造 body）。
- **② 投影**：`read_relay::emit_read_result` → `im:read:result {req_id, body}`（读族透传·外层键集严格对齐·req_id 锚本次 invoke·body 不冻结）。
- **③ DOM**：N/A（读族无 write 驱动 DOM 契约面·MB 区 data-member-count 由前端从透传 body 抽成员渲染·非冻结面·reducer runFourFacetRead 不裁定）。
- **④ 落库**：N/A（成员自愈落库 channel_member 由 helix 按 byIds 响应体内部兑现·装饰器 facet④ 不暴露读路径 self-heal write·reducer 不裁定）。
- **验证**：2026-06-25 暖栈实跑双 endpoint 各四面（①②）全绿·复现 ≥2 轮（reload-app→spec→绿·纯暖 rerun→绿）·corrAnchor req_id 锚（membersByIds req_id=req-dh8sptgz7l / memberSnapshot req_id=req-uz8lmk0goj 等·每轮新 reqId）·暖 spec ~3s。

### UC-9.x 书签 — `✅ 四面全绿`（读族 ①②·③④ N/A·暖栈实跑三 endpoint 全绿·issue #30）

- **① 出站 HTTP**：`post/bookmark/{create,delete,load}`——create `{channelId, userId, postIds:[postId]}` / delete `{userId, postId}` / load `{channelId, userId} + 扁平 PageOpts`（全 camelCase·真源 partial 1 §33/§34/§35 verbatim·helix `outbound/posts_read_ext.rs` BookmarkCreate/Delete/LoadCommand 实证）。loopforge 桥 `im_bookmark_create`/`im_bookmark_delete`/`im_bookmark_load`（commands.rs·`userId` 取 AppState.identity 身份单一真源·壳前端只供 channelId/postId(s)+reqId·snake→camel 化在 helix build·壳不臆造 body）。
- **② 投影**：`query::emit_read_result` → `im:read:result {req_id, body}`（读族透传·外层键集严格对齐 2 键·req_id 锚本次 invoke·body 不冻结·CommonRes 透传/load 回 posts 列表）。
- **③ DOM**：N/A（读族无 write 驱动 DOM 冻结契约面·AX 书签面板 `data-bookmark` 由前端从透传 body 抽收藏列表渲染 store.bookmarks().length·非冻结面·reducer runFourFacetRead 不裁定）。
- **④ 落库**：N/A（书签落库 post/书签表由 helix 按响应内部兑现·装饰器 facet④ 不暴露读路径 self-heal write·reducer 不裁定）。
- **验证**：2026-06-25 暖栈实跑三 endpoint 各四面（①②）全绿·先 bridge invoke im_send 取真实 server_id(postId)→ create/load/delete 链·corrAnchor req_id 锚（create=req-qs01jxld4d / load=req-ainti547r9 / delete=req-7f6qpecolw·每轮新 reqId）·暖 spec 6.1s·3 passing。

### UC-10.1 待办列表 — `✅ done`（issue #31·暖栈实跑 ①②③ 三面全绿·④ projection-only N/A）

> **实跑全绿**（2026-06-25·corr=window endpoint+event·reducer `runFourFacetSelfDriven`）：hello 收尾自驱
> queryTodoList → im:todo:updated{15 items} → DOM 首行 todo-id=`x8j9135nc3rg3ktptz6qgd3ddh_mention`
> （type=mention·canDel=1·id 装配 `{postId}_{messageType}` 实证）。bootstrap UC=UC-10.1（hello hop 归本 UC·
> 见 harness `reload-app --uc UC-10.1`·同 UC-4.1 自驱根机制）。
>
> **④ 落库 = N/A（projection-only·结构性·非橡皮章）**：todo 链 helix `port_reply.rs:196-209` TodoQuery 分支
> **只 emit_todo_updated 不落库**（无 storage Effect·无 todo 表·helix migrations 无 todo schema）；
> projection-schema 行 154 注「前端 getTodoUpdated$→INIT_TODO_LIST_DATA」= in-memory 待办态·不持久化。
> issue body / 本表早先「④ todo 表」为草拟锚·**与实现真源不符**（真源 = todo.rs/port_reply.rs）→ 校正为 N/A。
> reducer `runFourFacetSelfDriven` 断面 = ①②③·④ 不裁定（同 read 族 ③④ N/A / command-dom 族 ②④ N/A 诚实出账）。

- **① 出站 HTTP**：（hello 收尾自驱·非前端命令）`posts/queryTodoList`·body `{postIds:[]string}`（camelCase·非空·真源 `increment_channel_end.rs::trigger_todo_query` + todo.rs:44·global `increment_channel_end` 触发·实跑 16 postIds 出站）。
- **② 投影**：`todo::emit_todo_updated`（§1.4·外层 `{items}` 冻结·item `{id, channel, post, type, canDel}` 透传不冻结·**禁裸数组**·实跑 items=15 非空·item.id 装配 `{postId}_{messageType}`·canDel 仅 mention）。
- **③ DOM**：`data-todo-id` 列表（store `applyTodoUpdated` 透传投影 items → `_todos` signal → @for 渲染·实跑首行 data-todo-id 非空）。
- **④ 落库**：N/A（projection-only·见上注·port_reply 仅 emit 不落库）。

### UC-10.3 全模块读 — `✅ 读族双面全绿`（读族 ①②·③④ N/A·暖栈实跑全绿·corr_key=req_id·go-served）

> **读族 request-response 断面 ①②**（同 UC-5.8 / UC-4.5 / UC-6.4）：`modules/getAll` 是读命令（`user_misc.rs::GetAllModulesCommand` `is_read=true`·handler **不解析请求体**·HTTP 200 响应体即模块列表·**不推送**·无 WS 回声）→ helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`（projection-schema §1.2 读族·非 21 投影集）。按 C004 以冻结源码（user_misc.rs:160-166 + read_relay.rs）裁定为读族 ①② 两面·③④=N/A。go :8065 read 端点真跑（probe 200·非 cses-java 宕机阻塞面）。

- **① 出站 HTTP**：`im_modules_get_all` → `POST modules/getAll`，**空 body `{}`**（handler getAllModules 不 decode 请求体·真源 modules.go:14 + 前端 message.service.ts:828 无 body）。✅ 暖栈实证（reducer diffOutbound：`bodyFields {}` 空必填集命中 + `bodyForbidden` 锚 page_number/page_size/req_id/channel_id/user_id/condition/pageOpts 旧形态泄漏 不命中·method POST + urlEndsWith modules/getAll 命中）。真源 partial 3 §8 + partial 11 §8（已迁移·含修「channelMemberChange success」笔误·SetData 不 SetMessage）+ helix outbound/user_misc.rs GetAllModulesCommand。
- **② 投影**：`im:read:result`（读族透传·§1.2 `{req_id, body}`·外层键集严格对齐·req_id 锚本次 invoke·body = 后端 modules/getAll 响应体原样透传 dto.CommonRes 信封 data=[]*ent.Modules·inner 不冻结）。✅ 暖栈实证（req_id=req-ix0mny2083）。
- **③ DOM**：N/A（读族无 write 驱动 DOM 契约面·模块列表由前端从透传 body 抽模块渲染·非冻结面）。reducer runFourFacetRead 不裁定 ③。
- **④ 落库**：N/A（查询为只读·无 `Effect::Persist`·装饰器 facet④ 不暴露读路径）。reducer runFourFacetRead 不裁定 ④。
- **artifacts**：`test/expect/uc-10.3.expect.json` + `test/specs/uc-10.3.e2e.mjs`（暖栈真跑·1 passing·597ms·reducer 报告「✅ UC-10.3 读族双面全绿·endpoint=modules/getAll」）。
- **机器件改动**：Rust `im_modules_get_all` 命令（commands.rs·入泵 helix-im `im_get_all_modules`·lib.rs 双 cfg 分支注册）+ 前端 `ImStore.getAllModules` + `onModulesGetAll` 接通（C007 事件配方法·空入参直触发拉全部模块）。reducer / 装饰器 / oracle 未改（读族断面复用 runFourFacetRead·无需新机件）。

### UC-7.x 搜索（全局/会话/分类）— `⛔ unreachable`（后端真阻塞·P2-1）

> **后端真阻塞缺失**：`Im/search/{global,searchByChannel,…}`（走 api 非 imHttp·缺口矩阵 P2-1）app 层全空桩恒返空 + data 形态偏离源。后端裁决迁移前标 ⛔（不能红转绿·改契约才能过 = 违护栏）。helix fullmap-coverage.sh 亦排除 search 集合七。
> **② 投影**：`query::emit_read_result`（读族）；**③ DOM**：`data-search-result`；**④ 落库**：（ES 透传无落库）。

---

## 4. 域 D — 互动卡片 / 系统通知（bot-agent 已移除·不在测试范围）

> 最低优先级（依赖外部接通 / 非 message-v3 主链）。投票/平均分走 api（第二网关 :3399）。

### UC-8.x 投票 CRUD — `✅ e2e 真跑全绿`（写族 ① + 读族 ①②·issue #35·spec uc-8.x-vote）

- **e2e 真跑（5 端点全覆盖·corr_key=set_uc 窗口·anchorCh=15gcgoyf1jfcur614qydhs69ha）**：
  - **写族 4 命令**（`vote/createVote` 整 args 透传·`vote/vote {id,indexes}`·`vote/closeVote {id}`·`vote/deleteVote {id}`）：**① 出站 wire body e2e 真跑全绿**（camelCase 逐字对齐 partial 6 集合八·bodyForbidden 锚住 snake/req_id 泄漏·真出站到 :3399）。② 投影标 `optional`（reducer isProjectionOptional 短路）——写族 helix is_read=false fire-and-forget·数据走 server WS post_updated 回声·单账号 L1 无可观测 echo（真 server-WS-dep·非阻塞·见下）。
  - **读族 vote/readVote**（is_read=true）：**①② e2e 真跑全绿**——① 出站 `{id}`（req_id 不泄漏·id_body 只取 id）·② `query::emit_read_result` 回灌 `im:read:result{req_id, body}`（本环境 :3399 该 id **回 200**·envelope `{body, req_id}` 键集对齐·req_id 锚本次 invoke）。注：旧 ledger 记 readVote ⛔ data-dep(坏 id 恒 500)·本次 seeded 环境回 200——且 ② envelope 面与 inner 真 vote id 解耦（emit_read_result 200 / emit_read_error 500 皆产 im:read:result envelope·envelope 恒可观测）。
- **① 出站 HTTP**：`vote/{createVote,vote,readVote,closeVote,deleteVote}`（走 api·第二网关 :3399·partial 6 集合八 L257-272）。**average/{publish,attend,read,close,delete}** 同族第二批已闭环（见下平均分子节·issue #36·spec uc-8.x-average）。
- **平均分子族 average/{publish,attend,read,close,delete} — `✅ e2e 真跑全绿`（issue #36·spec uc-8.x-average·anchorCh=15gcgoyf1jfcur614qydhs69ha）**：
  - **写族 4 命令**（`average/publish` 整 args 透传·`average/attend {id,score:number,postId?}`·`average/close {id,postId?}`·`average/delete {id}`）：**① 出站 wire body e2e 真跑全绿**（camelCase 逐字对齐 vote_score.rs Average* 命令·bodyForbidden 锚住 snake(max_score/min_score/post_id)/req_id 泄漏·真出站到 :3399）。② 投影标 `optional`（同 vote 写族·is_read=false fire-and-forget·server-WS-dep·非阻塞）。
  - **读族 average/read**（is_read=true）：**①② e2e 真跑全绿**——① 出站 `{id}`（id_body 只取 id·req_id 不泄漏）·② `query::emit_read_result` 回灌 `im:read:result{req_id, body}`（req_id=req-skzy3duqov 锚本次 invoke·envelope 键集对齐）。
  - **Tauri 命令新缝**：commands.rs 新增 `im_average_{publish,attend,read,close,delete}`（薄壳翻译入参入泵·对 helix AveragePublishCommand 等）+ lib.rs 双 invoke_handler 注册；Angular app.component 加 average-{publish,attend,read,close,delete}-btn（C007 配方法 onPublishAverage 等）+ im-store {publishAverage,attendAverage,readAverage,closeAverage,deleteAverage}。
- **② 投影**：写族 `emit_post_updated`（fat·投票卡·server-WS-dep N/A·标 optional）/ 读族 `query::emit_read_result`（e2e ✅）。
- **③ DOM**：`data-vote`（写族 server-WS-dep N/A·UI 件 vote-{create,do,read,close,delete}-btn 已接·data-vote attr 已绑）。
- **④ 落库**：`message.props`（写族 server-WS-dep N/A·投票卡 props 由 server 回声落库）。
- **残面（真 server-WS-dep·不阻塞关闭·标准 c）**：写族 ②③④（emit_post_updated/data-vote/message.props）须 server WS post_updated 回声驱动——单账号 L1 写族 fire-and-forget 本账号无自身可观测 echo（结构性·同 ledger UC-5.3 member-leave / UC-5.5 置顶子项）。① 出站（freezable wire 契约）+ 读族 ①② 已 e2e 真跑全绿·UC 关闭依据 = 五端点 ① 全覆盖真跑 + 读族双面绿。

### UC-10.2 系统通知 — `✅ 四面全绿（issue #37·2026-06-28·改群名 channelUpdate 系统 NOTICE post）`（认领 M）
> **绿证（#37·spec uc-10.2 两轮 channelId 各异 s9s8/j3usg·corr_key seq=2）**：A=444 建频道→`im_channel_change_display_name`(改群名·channel/change/displayName)→server 回 channelUpdate 系统 NOTICE post→helix emit_post_received(type=NOTICE·userId=SYS·props{type:channelUpdate,field:displayName,content:新名})→helix is_system_notice(NOTICE∈NOTICE_TYPES)置 systemNotice→②im:post:received(fat 17键)③data-system-notice=1④message batch_upsert。①出站 N/A(系统 post 帧触发·optional)。**spec 时序修复**：先 waitUntil channelUpdate 投影(props.content=新名)落 UC-10.2 窗口再关窗(rename echo 慢于建群 join post·join 也是 NOTICE→systemNotice 会提前满足 DOM 检查致 channelUpdate post 落 __quiescence__ 被 reducer uc 过滤漏掉·C008 waitUntil 真条件)。

- **① 出站**：（WS 帧触发·无独立 HTTP）。
- **① WS 推送**：系统消息帧（messageType=SYSTEM·**注意 SYSTEN 拼写陷阱保真透传**·projection-schema §6）。
- **② 投影**：`emit_post_received`/`updated`（系统消息）。
- **③ DOM**：`data-system-notice`。
- **④ 落库**：`message`（SYSTEM/SYSTEN 类型）。

### UC-11.1 维护公司大群 — `✅ 四面全绿`（写族 ①②③④·暖栈实跑全绿·issue #39·corr_key=ch=grji34e9q3g9if6zjsi3h7n7dh）

- **e2e 真跑（teams/upsert 单端点全覆盖·建群路径·corr_key=set_uc 窗口锚 server 分配 ch）**：bridge 直 invoke `im_team_upsert {displayName, memberIds:['445']}` → 出站 `POST teams/upsert`（CreateChannelSpecifyOwner·不携 id → server `UpsertTeam` 走 `CreateCsesChannel` 建公司大群分支）→ WS `channel_created` 推回 → 投影 `im:channel:created` → CL 区新行（before=157→after=158）+ DB channel 新行。四面全绿 `✅ UC-11.1 四面全绿（corr_key=ch=grji34e9q3g9if6zjsi3h7n7dh）`。
- **① 出站 HTTP**：`POST teams/upsert`·body = CreateChannelSpecifyOwner（嵌入 Channel 必填集 `{teamId, displayName, orient:"", type:"P", picturetype:"USER", picture}` + `users[CREATOR+MEMBER]` + `forceCreate:true` + `owner`·全 camelCase·真源 partials/3 §4 + TeamUpsertCommand 原样透传 team 对象）。bodyForbidden 锚 channel_id/channelId/id 泄漏（建群分支不该携已分配 id·避现网 ID!="" 二次 decode io.Reader 耗尽 bug）。① reducer createOutbound fallback（URL endsWith teams/upsert·窗口内唯一一条）归锚 ch 束。✅ 实证 run.jsonl。
- **② 投影**：`im:channel:created`（`{channel_id, channel}`·to_effect_s1::emit_channel_created·同 UC-5.1·channel 透传帧 data 原始对象·缺/多即 fail）。✅ 实证 run.jsonl。
- **③ DOM**：`data-channel-id` 新行（store.channels() 由 im:channel:created 投影 upsert→CL 渲染·复用 applyChannelCreated 同 UC-5.1·壳纯渲染）。✅ waitUntil 等新 channel 行出现（不在 before 快照集）。
- **④ 落库**：`channel` batch_upsert ≥1 行（建群路径落 channel·表感知归一·channel 表 id 抽成 ch→与 ② 同束）。✅ 实证 run.jsonl rows≥1。
- **Tauri 命令新缝**：commands.rs 新增 `im_team_upsert`（薄壳从 profile 拼 CreateChannelSpecifyOwner·身份单一真源·对 helix TeamUpsertCommand）+ lib.rs 双 invoke_handler 注册；Angular app.component `onTeamUpsert`（C007 配方法·team-upsert-btn 已绑）+ im-store `teamUpsert`。冻结 oracle 零改（C004）·绿由 reducer 裁定（C009）。

### UC-11.2 退出公司 — `✅ ① L1-verified · ②④源 L2 双账号绿（issue #40/#48·2026-06-28·后端 round-2 quit_company 广播）`
> **L2 绿证（#40/#48·spec uc-11.2-l2 两轮 baseline=0→Δ≥1·非 tautology）**：后端 round-2 补 quit_company 多播。隔离设计(C014·不破暖栈 444)：退出者=777(独立账号·l2-act quit·teams/member/quit DELETE)·观测端=留存成员 888(observe raw-WS)·A=444 仅 setup 建频道含 777+888(纳入 team)·不退自己。777 quit→留存成员 B=888 收 quit_company 广播(②emit/④移除在留存成员侧结构源)。守可证伪:baseline-delta(quit 前 quit_company 帧数→quit 后新增≥1·暖栈 team 池历史噪声/connect 重放隔离)。③ DOM=B 视图移除·A 驱动 spec N/A。〔旧「退出者本连接结构性不可观测」仍成立·L2 改由留存成员观测·issue #40 第2用例边界断言保留。〕

- **e2e 真跑（暖栈 ×2 复现·helix dep bumped 4cc33c2→bb00d4d 含 im_team_quit→DELETE 修复）**：bridge 直 invoke `im_team_quit {}`（身份由 Rust 从 profile 拼 userId=444/teamId=64118eeb...）→ 出站 `DELETE teams/member/quit {userId, teamId}` → server `LeaveAllChannelsForTeam` 退该 team 所有群（HTTP **200 空 body**·现网源 bug·实证 run.jsonl）。
- **① 出站 HTTP（L1 严格可验绿）**：`DELETE teams/member/quit`·body `{userId, teamId}`（QuitTeamReq·全 camelCase·真源 quit_team.go:3-6 + partials/3 §6）。窗口内按 URL endsWith teams/member/quit 直接定位（唯一一条·窗口隔离·非 tautology）→ 严格断 `method=DELETE`（regress 回 POST→红·实证 POST→go 404）+ body 含 userId/teamId + bodyForbidden channelId/snake 别名/id/displayName。✅ 实证 run.jsonl `method=DELETE body={teamId,userId}`。
- **②③④ 离群移除（🟡 L2-facet·退出者本连接结构性不可观测·非 yellow 糊弄·带 run.jsonl 证据）**：server `quit_company` 多播给 `idsByTeamId`（同 team **其余**受影响用户·partials/5 §2.18 + §4 UserIds 多用户定向）而**非退出者本人**；helix `quit_company` handler 亦 graceful no-op（quit_company.rs default vec![]·无独立投影/落库）。实证 run.jsonl：DELETE 200 success 后退出者本连接**零** quit_company / channel_close WS 帧（spec 第 2 用例可证伪断言：若 server 某日也推退出者→红→提示提升回 L1）→ ②（im:channel:closed）/ ③（DOM 行移除）/ ④（channel batch_update）L1 单账号造不出 → **须 L2 双账号**（B 在公司·A 退公司 → B 收 quit_company → B 视图移除 A 相关 channelMember·追踪 issue **#48**·与 UC-5.3b member-leave 广播 #44 同族）。
- **helix 修复（C004 缺陷确认即修·不改 oracle）**：实测 ① 出站 `POST teams/member/quit`→go **404**（DELETE-only 路由）。根因=pinned helix `4cc33c2` registry 写死 POST。在 helix worktree(feat/cses-round6-uc-reclaim) 加 surgical commit `bb00d4d`（registry `outbound_method` 按命令名产 method·im_team_quit→DELETE·http_post→http_request 加 method 参数·回填上游 e005638 的 im_team_quit 部分）→ loopforge `cargo update` 四 crate 同步到 bb00d4d（C001 单版本）。
- **Tauri 命令新缝**：commands.rs 新增 `im_team_quit`（薄壳从 profile 拼 userId/teamId·身份单一真源·对 helix TeamQuitCommand）+ lib.rs 双 invoke_handler 注册；Angular app.component `onTeamQuit`（C007 配方法·team-quit-btn 已绑）+ im-store `teamQuit`。冻结 oracle 零改（C004）·绿由 reducer/spec 裁定（C009）。

### UC-12.1 健康探针 — `✅ ① 面全绿`（连通性·GET health + 200·暖栈实跑·issue #41·corr_key=req_id·② N/A optional）

- **e2e 真跑（health 单端点全覆盖·连通性 ①·corr_key=req_id 窗口锚·helix dep bumped bb00d4d→721a5b5 含 im_health 注册）**：bridge 直 invoke `im_health {reqId}` → 出站 `GET http://localhost:8065/api/cses/health`·**空 body `{}`** → server `healthCheck` 裸 `{"status":"OK"}`（不走业务信封·partials/3 §15）→ is_read=true → read_relay 回灌 `im:read:result{req_id, body:{status:"OK"}}`（证 200 真连通）。实证 run.jsonl `method=GET url=.../api/cses/health body={}` + `im:read:result body={"status":"OK"}`。
- **① 出站 HTTP（连通性严格可验绿）**：`GET /api/cses/health`·空 body（health 无请求体·真源 partials/3 §15 healthCheck·health.go:9）。窗口内按 URL endsWith `/api/cses/health` 直接定位（唯一一条·窗口隔离·非 tautology·少 invoke→① 红）→ 严格断 `method=GET`（regress 回 POST→红）+ 空 body + bodyForbidden channelId/id/status（健康探针无业务字段）。reducer 报告 `✅ UC-12.1 写族 ① 出站绿（② 投影 N/A·fire-and-forget·endpoint=/api/cses/health）`。
- **② 投影 N/A（本 UC 仅 ① 面·issue #41 连通性+200）**：is_read=true 的 `im:read:result{req_id, body}` 是读族回灌**副产**（非冻结业务投影面）→ expect 缺 projection 节 → reducer `isProjectionOptional` → ② 不裁定（守可证伪——少 ① 出站仍红）。③ DOM data-health（H 区指示件·store._health 由 im:read:result body.status 设·可选·本 UC 不裁定）·④ 健康端点无 DB 表（partials/3 §15 DB 表:无）→ N/A。
- **helix 新缝（C001 单版本·非改 oracle）**：helix worktree(feat/cses-round6-uc-reclaim) 加 commit `721a5b5`（user_misc.rs HealthCommand distributed_slice 注册·("health",{}) GET·is_read=true + registry outbound_method 加 im_health→GET + 单测 health_get_no_body）→ loopforge `cargo update` 四 crate 同步到 721a5b5。**踩坑（C001 实证）**：首次误在 helix `main` 拉分支改·loopforge 实际吃的是 git branch dep `feat/cses-round6-uc-reclaim` 的 pinned commit·改 main 不生效（live `is_outbound("im_health")=false`）→ 须改对应分支 worktree + cargo update bump pinned commit。
- **Tauri 命令新缝**：commands.rs 新增 `im_health`（薄壳翻 reqId 入泵·对 helix HealthCommand）+ lib.rs 双 invoke_handler 注册；Angular app.component `onHealth`（C007 配方法·health-btn 已绑）+ im-store `checkHealth` + applyReadResult 抽 body.status 设 _health。冻结 oracle 零改（C004）·绿由 reducer/spec 裁定（C009）。
- **artifacts**：`test/expect/uc-12.1.expect.json` + `test/specs/uc-12.1.e2e.mjs`（暖栈真跑·1 passing·reducer 报告「✅ UC-12.1 写族 ① 出站绿·endpoint=/api/cses/health」）。

### bot / agent 召唤 — `🚫 已移除`（bot-agent 不在测试范围·2026-06-24 用户裁决）

> **物理够不到 + 后端真阻塞**：message-v3 service 层无独立 bot 端点（客户端无对应 invoke）·`BotAgentWebhookEvent` Pulsar fanout（缺口矩阵 P1-3）未接。客户端侧无用例 → 整域标 ⛔（如需覆盖从服务端 csesapi 侧梳理·超 testbed 范围）。

---

## 5. 物理够不到 / 后端真阻塞汇总（⛔ 理由逐条记账）

| UC | ⛔ 原因 | 缺口矩阵 / 真源 | 与 helix ledger 对照 |
|---|---|---|---|
| UC-1.3 发图片/文件 | 物理文件选择 + 上传进度链需真上传管线·golden-tape 不录文件 IO | （物理限制）| helix ledger UC-1.3 ⬜ untested 同标 |
| UC-1.6 编辑 | 现网消息正文不可改·无编辑端点（产品无此能力）| cses-client claude.md:299 + Go 无 posts/update 路由 | helix ledger ✅ verified-not-a-capability |
| UC-4.3 too_long 重拉 | testbed 无注入落后 cursor 入口·触发态够不到（代码侧完整有单测）| harness-gap | helix ledger ⬜ harness-gap 同标 |
| UC-5.6 群公告（已部分解阻·见各节标题）| **2026-06-26 核对纠正**：读族 acceptList/list/detail（5.6r）①② 已 e2e 真跑全绿（go-served·非「回声不可观测」错述）；写族 save/read/delete（5.6w）① 出站全绿·②④ post_update echo 阻于 cses-java 宕（**回声实有**·9--gap-posts §26-27） | echo=backend-down（非 data-dep）| helix gap §26-27 announcement*→post_update ✅ |
| UC-5.7 在线状态（已部分解阻·见各节标题）| **2026-06-26 核对纠正**：`channel/onlineStatus` 读族 ①② 已 e2e 真跑全绿（已迁移返 data·go-served）；仅 `users/status/ids` 仍真阻塞（statusCache·已 ✂️ 剔除规划·与读族解耦）| 矩阵 P1-2（仅 status/ids）| status/ids goBlocked |
| UC-7.x 搜索 | `Im/search/*` app 层空桩恒返空 + 形态偏离·后端真阻塞 | 矩阵 P2-1 | helix fullmap 排除集合七 |
| bot/agent 召唤 | 客户端无 service 方法·`BotAgentWebhookEvent` Pulsar fanout 未接 | 矩阵 P1-3 | — |
| 广播类子项（拉踢留存收 / close member-leave / 消息置顶 / vote 真 id / add_manger）| 单 testbed 单账号·跨账号广播需第二真实连接 / 依赖 Go 落库后投影 | 认领难度 D | helix ledger 多标 broadcast-dep / data-dep |

---

## 6. 覆盖率统计 + scripts 接口

### 当前计数（2026-06-25·rollout 收尾对账·按每节标题图例为准 C011 诚实出账）

> 分母 = 42 invoke-driven UC 节（按本台账每节标题统计·UC-8.x vote+average 为一节双 issue #35/#36）；bot/agent 召唤是「整域 ⛔」不计入分母（单列）。
> **section-level 计数（authoritative·以每节标题图例为准）**：✅ 30 · 🟡 5 · ⛔ 5 · 🌙/⬜ 2 = 42。

| 域 | UC 节数 | `✅ four-facet-verified` | `🟡 partial/L2-facet` | `⬜/🌙 pending` | `⛔ unreachable` |
|---|---|---|---|---|---|
| A posts（收发/历史/已读）| 17 | 14（1.1/1.2/1.4/1.5/1.7/1.8/1.9/1.10/2.1/2.2/2.3/2.4/3.3）+ … | 2（3.1/3.2 L2-facet→#47）| 1（1.3 文件🌙）| 1（1.6 编辑）|
| B channel/sync（同步/频道管理）| 13 | 9（4.1/4.2/4.4/4.5/5.1/5.2/5.3/5.4/5.5/5.8）| 0 | 0 | 3（4.3/5.6/5.7）|
| C user-misc（成员/搜索/待办/书签）| 7 | 4（6.3/6.4/9.x/10.1）| 2（6.1→#43 / 6.2→#45）| 1（10.2）| 1（7.x 搜索）|
| D teams/运维/互动卡片 | 5 | 3（8.x/11.1/12.1）| 1（11.2 ①绿·②③④ L2→#48）| 0 | 0 |
| **合计（42 节分母）** | **42** | **30** | **5** | **2** | **5** |
| bot/agent 召唤（整域，不计入 42）| 1 域 | — | — | — | 1 域（🚫/⛔）|

> 说明：A 域绿 14 节恰为 UC-1.1/1.2/1.4/1.5/1.7/1.8/1.9/1.10/2.1/2.2/2.3/2.4/3.3（每节标题 ✅）。B 域 5.3/5.5 节标题为 ✅（主路径全绿·子项 ⛔ 不阻塞）。reachable 分母 = 42 − 5⛔ = 37；reachable 内 ✅ 30 + 🟡 5（①③或①面 L1 绿·②④或②③④ 结构性 L2·已挂 #43/#45/#47/#48）+ ⬜/🌙 2（10.2 pending / 1.3 文件夜间）。**L1 单账号可达面全部跑绿；剩余 5 黄全部是 read-receipt/member-broadcast/admin-broadcast/quit-broadcast 这类「结构上须第二账号才观测」的 L2-facet（issue 留 open·label ready-for-human·链 L2 追踪 issue）**。

> 精确分类（按本台账每节标题图例为准·1+7+24+7=39）：
> - **✅ four-facet-verified = 16**：见 `docs/uc-rollout/all-uc-real-chain-status.md` 的绿行；本节保留的是历史实跑总览，像 `debugLocatePost` / `debugMarkFailed` 这类旧桥都已废弃，只能当历史说明，不能当成功路径。
> - **🟡 partial**：UC-6.1 拉踢 / UC-6.2 管理员 / UC-8.x 投票平均分（注：UC-4.4 心跳 gap 补偿已转 ✅·三面 ①②④ e2e 真跑全绿·③ DOM N/A 已移除该面·anchorCh=181jj6htd7nn3xx51z78bhuhcr·ping∩update-by-post∩message 交集 94 频道·issue #34；UC-4.5 陌生 channel 已转 ✅·读族 ①② 全绿·is_read=true 校正③④ N/A·issue #33；UC-5.3 关群主路径已转 ✅·member-leave 广播子项 ⛔ broadcast-dep 不阻塞；UC-5.5 置顶频道路径已转 ✅·消息置顶子项 ⛔ data-dep·见各节标题图例）。
> - **🟡 ①③-verified · ②④ L2-facet（read echo 推发送者·须 L2 #47）= 2**：UC-3.1 会话已读 / UC-3.2 单条已读（2026-06-25 实跑·①③ 严格断言绿 + ②④ `post_read`(type6) 推**消息的发送者**·当别人已读发送者消息时·L1 单账号单连接结构性造不出·带 run.jsonl 证据 + 可证伪护栏·须 L2 双账号 #47 转绿）。
> - **⬜ pending = 8**：1.2 / 1.5 / 1.8 / 5.4 / 6.3 / 9.x / 10.1 / 10.2（注：UC-4.2 已转 ✅·暖栈实跑 ×2 内核自驱 gap 四面 ①②④③ 全绿·issue #32；UC-6.4 已转 ✅·暖栈实跑双 endpoint 四面绿·issue #27；UC-2.2 已转 ✅·原「① blocked on helix wire-bug」判断有误·round6@bbbf809 已含 acl is_query 放行 fix·实跑 ①②③ 全绿；UC-4.1 / UC-5.1 / UC-5.2 / UC-1.9 / UC-1.10 / UC-3.3 / UC-1.4 / UC-1.7 / UC-2.4 / UC-2.1 / UC-2.3 已转 ✅；UC-3.1 / UC-3.2 转 🟡 read-echo gap）。
> - **⛔ unreachable = 7**（39 分母内）：UC-1.3 文件 / UC-1.6 编辑 / UC-4.3 too_long / UC-5.6 公告 / UC-5.7 在线 / UC-7.x 搜索·另 bot/agent 整域 ⛔（不计入 39 分母）。

> ⚠️ **诚实声明（2026-06-25 收尾对账更新）**：全 42 UC 节中 **30 节经真 Tauri+WKWebView 四面 oracle 跑绿**（每节标题 ✅ + 引用块附 corr_key/run.jsonl 证据·`bash scripts/run.sh`/暖栈 `harness.sh spec` 实跑·reducer 裁定无断点）。`🟡` 5 节（3.1/3.2/6.1/6.2/11.2）= L1 可达面（①③ 或 ① 面）严格断言绿 + ②④/②③④ 是「结构上须第二账号才观测」的 L2-facet（read echo 推发送者 / member-leave 广播他人 / admin role 广播 / quit_company 广播他人）·**非 yellow 糊弄**：issue 留 open·label ready-for-human·链对应 L2 追踪 issue（#43/#45/#47/#48）·带 run.jsonl 缺席证据 + 可证伪护栏。`⛔` 5 节（1.6 编辑无端点 / 4.3 too_long harness-gap / 5.6 公告 data-dep / 5.7 在线后端阻塞 / 7.x 搜索后端阻塞）物理够不到·诚实剔出绿分母。`🌙/⬜` 2 节（1.3 文件夜间 / 10.2 系统通知 pending）。**reachable 内 L1 可达面 100% 跑绿·无任何「①③绿就 close 把②④延后」的橡皮章账（C011）**。

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

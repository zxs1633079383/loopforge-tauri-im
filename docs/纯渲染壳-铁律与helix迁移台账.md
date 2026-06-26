# loopforge 纯渲染壳——架构铁律 · 北极星 · helix 迁移台账

> 2026-06-26 用户 grilling 拍板。本文件 = loopforge 的**第二北极星**与**架构铁律真源**。
> 配套：根 `CLAUDE.md`/`AGENTS.md` §10 索引 · harness 卡 `docs/harness/C013-*.md`（机器闸门）。
> 本仓所有 md **一律中文**。

---

## 0. Goal（这个 demo 是干嘛的）

> loopforge = **helix 投影的纯渲染验证场**。用一个五脏俱全的 IM UI，证明「**helix 吐的投影/指令已 render-ready，本仓零业务逻辑也能跑通全部 UC**」。
> **每个跑不通的地方，都是 helix 投影缺口的探针，不是本仓补逻辑的理由。**
> 反例铁律：渲染消息 = 发个 IPC，helix 吐 render-ready 事件，**直接渲染**——不在本仓对账、不在本仓整形、不在本仓判业务。

---

## 1. 边界铁律（Q1·严格版·违反即拒）

loopforge 的 TS **只能做四件事**：

| 允许 | 说明 |
|---|---|
| **(a) 1:1 绑定** | 把投影字段直接绑到 `data-*`/DOM 节点 |
| **(b) 纯展示格式化** | 不含业务含义：头像色取 hash、时间戳→`HH:MM`、取首字母 |
| **(c) 持有快照** | 用 signal 持有最新投影快照（只存不算） |
| **(d) 发 IPC** | 用户动作时 `invoke` 一个指令 |

**一律禁止（必须是 helix 投影/指令吐 render-ready）**：

| 禁区 | 现有违例 |
|---|---|
| 解析/重组 payload | ~~`extractReplyIds`~~（S8 消灭#57） `extractReactions` `extractTemplateReceived` ~~`applyMembersSnapshot`~~（S7 消灭）— **本仓禁区 grep == 0** |
| 合并/对账状态（tmp→server·upsert·dedup） | `applyMessageItem` ~~`applyMemberUpdated`~~（S7 消灭·extractMemberIds/memberChangeField 删） `applyMessagesQueryResult` `applyOlderLoaded` |
| 归一 wire 格式 | `normalizeNotice` `normalizeIsTop` `toReadBits` |
| 编码业务规则 | ~~`role→admin`（CREATOR/MANGER→admin）~~（S7 消灭·下沉 helix role_is_admin）· `isSystemNotice`(NOTICE 分类)· `unread++` |

**试金石（逐行 TS 自问）**：「**如果 helix 已经把它整形好吐出来，这行还需要存在吗？**」答「不需要」→ 就是该搬进 helix 的债。

---

## 2. 北极星（Q2·覆盖率版）

> **北极星 = `render-ready 纯绑定渲染路径 / 总渲染路径` → 100%**

- **一条渲染路径** = store 里一个 `apply*` 投影处理函数（投影 channel → 渲染某区行/卡）。
- **判「纯绑定」当且仅当**：函数体只做「**按 key upsert + 把投影字段直接赋值**」，零 extract/normalize/合并对账/业务规则。
- **背靠背机器判据**：`src/app/im/*.ts` 禁区 grep 命中数 → 单调降到 0。**覆盖率 100% ⟺ 禁区命中 0**。
- **基线（2026-06-26·实测校正）**：分母 = 全 src `apply*` 渲染路径**实测 19**（非早先误填的 24）。
- **进度（S4 后·2026-06-26）**：精确闸门 grep（C013 §4 模式）**31 → 22 命中**（applyMessageItem 迁移·降 9·props-extract.ts 删除）；BOUND_GREEN 🟩 **1/19**（applyMessageItem）；纯绑定（含〜近纯）≈ 5/19 ≈ **26%**。剩余 2 个 `_rows().findIndex` 在 applyMessagesQueryResult/applyOlderLoaded（S6 行）。
- **进度（S5 后·2026-06-26·issue #54）**：精确闸门 grep **22 → 17 命中**（applyDialogList 迁移·删 normalizeNotice/normalizeIsTop def+call 共 4 + 清 1 处陈旧注释）；helix dialogList 升 render-ready（8 终态键·helix 834af2a）；applyDialogList 退纯绑定（直绑 displayName/notice/isTop/createAt/unread/mention/lastMessage/urgent）+ applyChannelUpdateByPost 删 unread++（改触发 dialogList 重查·未读累加下沉 helix）+ CL 模板加 data-last-message/data-urgent/data-mention。BOUND_GREEN 🟩 **2/19**（+applyDialogList·UC-5.1/5.2/5.3/5.4/1.10 四面绿 + UC-4.1 CL render-ready DOM 实测 last-message/unread 直绑·真 HTTP+WS 零 mock）。UC-5.5 isTop 绑定经探针实证正确（top→'1'）但 auto im:channel:update 这会话未到达（后端 WS echo·非 S5 回归·见 NEED_HELIX.log）；UC-4.1/4.2 增量/gap 面需冷启 run.sh 种子（set_uc/hello 时序·orthogonal）。
- **进度（S6 后·2026-06-26·issue #55）**：精确闸门 grep **17 → 15 命中**（消灭 applyMessagesQueryResult/applyOlderLoaded 的 2 个 `_rows().findIndex` 全表扫）；helix 升 render-ready（新 `render_ready::shape_message_rows`·读族 DB snake / wire camel 统一整形 + 批内去重保序·下沉 helix；`emit_post_sending` +text/type render-ready 乐观终态行·helix 255aeb1）；applyMessagesQueryResult/applyOlderLoaded/applyPostSending 三条退纯绑定（`bindRenderReadyRow` 1:1 + `upsertHistoryRow` **O(1) 锚 upsert** 替代 findIndex）。BOUND_GREEN 🟩 **3→6/19**（+applyMessagesQueryResult UC-2.1 四面 green×2·+applyOlderLoaded UC-2.2 ①② 读族 green×2·+applyPostSending UC-1.4 四面 green×2 + UC-send-1 六面 green×2）。UC-1.5 撤回连跑 2 次 1 绿 1 红（红在 ②投影/④落库「无投影 emit」= 后端 cses-im-server WS posts_update echo 非确定性到达·**非 S6 回归**·DOM `data-revoke=1` 两次都对·applyBatchUpdated wire 未动·见 `docs/migration/NEED_CSES_IM_SERVER_FIX.md`）。
- **进度（S7 后·2026-06-26·issue #56）**：成员族禁区**全清零**——消灭 `applyMembersSnapshot`（byIds extract loop）+ `applyMemberUpdated`（四源 extractMemberIds/memberChangeField 合并）+ `role===CREATOR/MANGER/ADMIN`（admin 判定），三段 shaping 下沉 helix `render_ready_members`（helix 964d90d·新投影 `im:channel:members{memberId,nickname,admin,leaves}`·`role_is_admin` 统一判 raw+归一 role·byIds body 解析 + 双源 emit）。壳 `applyChannelMembers` 退**纯绑定**（keyed upsert + leaves 删行·同 S6 upsertHistoryRow）。分母 19→**18**（−applyMembersSnapshot −applyMemberUpdated +applyChannelMembers）。残留禁区 code-ref **5 条全为他 UC**（extractReplyIds=UC-2.4 replies ×3 / toReadBits=read bits ×2·成员族 0 命中）。BOUND_GREEN 🟩 **6→7/18**（+applyChannelMembers·UC-6.1/6.4 ②④ 契约面照旧绿 + ③ data-members/data-admin render-ready 直绑）。冻结契约零改：im:channel:member-updated{channel_id,channel} / im:read:result{req_id,body} / im:channel:memberNickname 三投影键集原样（额外 emit 新通道·C004 只读护栏不破）。
- **进度（S8 后·2026-06-26·issue #57·终局切）**：**第二北极星 100% 达成**——精确闸门 grep **5 → 0 命中**（消灭最后禁区 `extractReplyIds`×5·删 `read-result-extract.ts` 整文件）。回复链 postId 抽取（rootPost/replies/data/list 探针 + 去重保序）下沉 helix `render_ready_replies`（helix 5198b28·新投影 `im:channel:replies{reqId, replyIds}`·`OutboundReplies` 双 emit 臂：`im:read:result` verbatim 照旧 + `im:channel:replies` render-ready）；待办族 helix `todo.rs` 额外吐 `todoId/todoType` 终态键。壳 `applyChannelReplies`（新增·纯绑定 replyIds→data-reply-id）+ `applyTodoUpdated`（退纯绑定·1:1 取 todoId/todoType/canDel·不 filter/抽）+ `applyReadResult`（仅留 member-drop + health 透传·零 extract）。分母 18→**19**（+applyChannelReplies）。**`HITS == 0 ⟺ 第二北极星 100%`**（C013 §4 BASELINE 5→0·gate.sh 8b 机器强制）。BOUND_GREEN 🟩 **7→10/19**（+applyChannelReplies UC-2.4 ①② green×2 + im:channel:replies render-ready 双 emit 实证·+applyTodoUpdated UC-10.1 ①②③ green×2·14 items render-ready todoId/todoType·+applyReadResult UC-6.4 ①② green·该行禁区归零·UC-12.1 健康探针 ② backend read-relay 未回灌 echo-gated 非回归）。回归核验零破：UC-6.4/8.x-vote/8.x-average/9.x 读族全绿。冻结契约零改：im:read:result{req_id,body} / im:todo:updated{items} 外层键集原样（额外 render-ready 通道 + inner 额外键·C004 只读护栏不破）。
- **辅助仪表（缺口版）**：本仓挂起的「helix 投影缺口」条目数 → 0（驱动去 helix 补，不是本仓补）。

---

## 3. 工程铁律（本轮新增·一并遵守）

1. **DDD 分包分层严格遵循**：本仓只剩两层——**展示层**（Angular 组件/模板·data-* 绑定）+ **投影适配层**（store signal 持快照 + IPC 发射）。**无领域层**（领域逻辑全在 helix）。目录按「区/职责」分包（CL/ML/MB/AX/composer），高内聚低耦合，单文件 < 800 行。
2. **合理利用设计模式**：投影分发用策略/注册表（channel→handler 表，禁 if-else 长链）；IPC 封装用门面（bridge service）；快照持有用观察者（signal/computed）。模式服务于「薄」，不为模式而模式。
3. **算法复杂度低→高**：热路径（每事件命中）必 **O(1)**——按 key 的 Map/signal upsert，禁线性扫 `_rows().findIndex` 全表（现有 `applyMessageItem` 的 findIndex 是债，迁移时一并消灭）；排序/去重等 O(N log N) 只在低频出口（如 `channels` computed）。

---

## 4. 渲染路径台账（分母 + 债标注）

> ✅=纯绑定 · ❌=债（欠 helix render-ready）· 〜=近纯（仅 upsert id）

| apply* 函数 | 投影源 | 渲染目标 | 纯? | 欠 helix 啥 |
|---|---|---|---|---|
| `applyChannelIncrement` | im:channel:increment | CL 行 | 〜 | — |
| `applyChannelCreated` | im:channel:created | CL 行 | 〜 | — |
| `applyChannelClosed` | im:channel:closed | CL 删行 | 〜 | — |
| `applyPostDeleted` | im:post:deleted | ML 删行 | 〜 | — |
| ~~**`applyMessageItem`**~~ ✅ | im:post:received(fat) | ML 行 | ✅ | **S4 已迁(6abe5df)**：helix 吐 render-ready 终态行(sendStatus/reactions/templateReceived/systemNotice + type 默认下沉)·壳退纯绑定 + O(1) upsert·六面绿·禁区归零 |
| `applyPostSending` ✅ | im:post:sending | ML 乐观行 | ✅ | **S6 已迁(helix 255aeb1)**：emit_post_sending 吐 render-ready 乐观终态行(text/type/sendStatus/readBits)·壳退纯绑定(不再取 pendingText/pendingType)·UC-1.4 四面 green×2 + UC-send-1 六面 green×2 |
| `applyMessagesQueryResult` ✅ | im:messages:query_result | ML 行 | ✅ | **S6 已迁(helix 255aeb1)**：shape_message_rows 吐 render-ready 终态行(非 DB snake)·壳 bindRenderReadyRow 1:1 + upsertHistoryRow O(1)·消灭 `_rows().findIndex`·UC-2.1 四面 green×2 |
| `applyOlderLoaded` ✅ | im:messages:older_loaded | ML prepend | ✅ | **S6 已迁(helix 255aeb1)**：render-ready 终态行 + 顺序/批内去重下沉 helix·壳 O(1) prepend upsert·消灭 `_rows().findIndex`·UC-2.2 ①② 读族 green×2 |
| `applyBatchUpdated` | im:post:batch-updated | ML revoke 态 | ❌ | render-ready revoke 终态（wire `{channel_id,posts}` 冻结·绑定已对·UC-1.5 红卡后端 WS echo·见 NEED_CSES_IM_SERVER_FIX.md） |
| ~~`applyDialogList`~~ ✅ | im:channels:projection | CL 行字段 | ✅ | **S5 已迁(helix 834af2a)**：helix dialogList 吐 8 render-ready 终态键(displayName/notice 归一/isTop bool/createAt/unread 终值/mention bool/lastMessage 预览/urgent bool)·壳退纯绑定(str/bool/num 纯展示取值)·删 normalizeNotice/normalizeIsTop·UC-5.1/5.2/5.3/5.4/1.10 四面绿 |
| `applyChannelUpdateByPost` ✅ | im:channel:update-by-post | CL unread | ✅ | **S5 已迁**：删 unread `++`·改触发 dialogList 重查(发 IPC·C013(d))·未读累加下沉 helix unread_count·壳零 ++ |
| `applyChannelUpdate` 〜 | im:channel:update(thin) | CL 重查触发 | 〜 | upsert + 触发重查(发 IPC)·纯·依赖 backend WS echo |
| `applyChannelUpdatePost` | im:post:received(channelUpdate) | CL displayName/notice | ❌ | UC-5.4 契约绑(props.field/content)·render-ready 路径已由 dialogList 重查覆盖·本路径留契约兼容 |
| `applyScheduleCreated` | im:schedule:* | CL hasSchedule | ❌ | hasSchedule 终值 |
| ~~`applyMembersSnapshot`~~ ✅ | (删·并入 applyChannelMembers) | MB 行 | ✅ | **S7 已迁(#56)**：byIds body 解析 + role→admin 下沉 helix(render_ready_members)·壳删该函数 |
| ~~`applyMemberUpdated`~~ ✅ | (删·并入 applyChannelMembers) | MB 行 | ✅ | **S7 已迁(#56)**：四源合并下沉 helix·壳删 extractMemberIds/memberChangeField |
| **`applyChannelMembers`** 🟩 | im:channel:members(render-ready) | MB 行 | ✅ | **S7 新增(#56)**：helix 双源(WS member_update + byIds)吐 render-ready{memberId,nickname,admin,leaves}·壳纯绑定(keyed upsert + leaves 删行) |
| `applyMemberNickname` | im:channel:memberNickname | MB 行 | 〜 | 已 keyed 单行 upsert·纯绑定（helix 该 WS 帧无全量名册·保留绑 memberNickname） |
| `applyReadResult` 🟩 | im:read:result(member-drop+health) | — / data-health | ✅ | **S8 已迁(#57)**：回复抽取下沉 helix·仅留 member byIds 认领 drop + health body.status 1:1 透传·零 extract（UC-6.4 green·UC-12.1 health echo-gated） |
| **`applyChannelReplies`** 🟩 | im:channel:replies(render-ready) | AX reply chip | ✅ | **S8 新增(#57)**：helix `render_ready_replies` 抽好 postId 双 emit·壳纯绑定 replyIds→data-reply-id（UC-2.4 ①② green×2） |
| `applyTodoUpdated` 🟩 | im:todo:updated(render-ready) | AX todo chip | ✅ | **S8 已迁(#57)**：helix todo.rs 额外吐 todoId/todoType 终态键·壳退纯绑定 1:1 取（不 filter/抽·UC-10.1 ①②③ green×2） |

---

## 5. 迁移设计（Q4·冻结 + 台账 + 顺手迁移·非 big-bang）

1. **冻结（即刻）**：harness C013 闸门禁新增禁区命中。碰任一 UI 功能，本仓新增处理逻辑 = 0——要么 helix 已 render-ready，要么**先去 helix-im 补投影/指令**再回本仓绑。
2. **台账（本文件 §4）**：每条 ❌ = 一个「helix 投影缺口」，登记 + 对应 helix issue。
3. **顺手迁移**：每次因别的事碰某 UC，把那段 shaping 搬进 helix（helix 吐 render-ready → **删本仓 apply\* 那段** → 覆盖率 +1 → 禁区 grep −N）。北极星单调爬。

**迁移范式（照抄模板·以 `applyMessageItem` 打头阵）**：

> **现状**：helix 吐瘦 `im:post:received` → 本仓 `applyMessageItem` 做 tmp→server findIndex 对账 + echo 覆写 + props 合并（O(N) 全表扫·最大一块债）。
> **目标**：helix-im **入库成功即吐 render-ready 终态消息行**（已对账 server_id、status=sent、reactions/template/system 成品、按 key 直发）→ 本仓退化成「按 `data-msg-id` 一行 upsert + 绑字段」O(1)，**删掉整个对账块**。「helix 入库成功 = 消息收到」→ 本仓收到即**取消转圈**，不在本仓判「echo 来没来」。
> **验收**：该 UC 四面仍全绿（reducer 裁定）+ 本仓该函数禁区 grep 归零 + 覆盖率 +1。

> 后续批次按 §4 ❌ 行的「影响面 × 债大小」排序顺手迁，每批一个 helix issue + 一次本仓「删逻辑」commit。

---

## 6. 与第一北极星的关系

- **第一北极星**（`docs/NORTH-STAR.md`）：L1 四面契约全绿 UC 数 / 31（量「覆盖多少 UC」）。
- **第二北极星**（本文件）：纯绑定覆盖率 → 100%（量「本仓有多纯」）。
- 两者正交且互补：UC 铺得越多**且**本仓越纯 → helix 投影越被证明 render-ready。掉任一即红灯。

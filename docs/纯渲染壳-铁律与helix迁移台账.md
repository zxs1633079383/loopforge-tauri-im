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
| 解析/重组 payload | `extractReplyIds` `extractReactions` `extractTemplateReceived` `applyMembersSnapshot` |
| 合并/对账状态（tmp→server·upsert·dedup） | `applyMessageItem` `applyMemberUpdated` `applyMessagesQueryResult` `applyOlderLoaded` |
| 归一 wire 格式 | `normalizeNotice` `normalizeIsTop` `toReadBits` |
| 编码业务规则 | `role→admin`（CREATOR/MANGER→admin）· `isSystemNotice`(NOTICE 分类)· `unread++` |

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
| `applyPostSending` | im:post:sending | ML 乐观行 | ❌ | helix 吐 sending 终态（本仓不造乐观） |
| `applyMessagesQueryResult` | im:messages:query_result | ML 行 | ❌ | render-ready 消息行（非 DB snake 整形） |
| `applyOlderLoaded` | im:messages:older_loaded | ML prepend | ❌ | render-ready 行 + 顺序（本仓不 dedup） |
| `applyBatchUpdated` | im:post:batch-updated | ML revoke 态 | ❌ | render-ready revoke 终态 |
| ~~`applyDialogList`~~ ✅ | im:channels:projection | CL 行字段 | ✅ | **S5 已迁(helix 834af2a)**：helix dialogList 吐 8 render-ready 终态键(displayName/notice 归一/isTop bool/createAt/unread 终值/mention bool/lastMessage 预览/urgent bool)·壳退纯绑定(str/bool/num 纯展示取值)·删 normalizeNotice/normalizeIsTop·UC-5.1/5.2/5.3/5.4/1.10 四面绿 |
| `applyChannelUpdateByPost` ✅ | im:channel:update-by-post | CL unread | ✅ | **S5 已迁**：删 unread `++`·改触发 dialogList 重查(发 IPC·C013(d))·未读累加下沉 helix unread_count·壳零 ++ |
| `applyChannelUpdate` 〜 | im:channel:update(thin) | CL 重查触发 | 〜 | upsert + 触发重查(发 IPC)·纯·依赖 backend WS echo |
| `applyChannelUpdatePost` | im:post:received(channelUpdate) | CL displayName/notice | ❌ | UC-5.4 契约绑(props.field/content)·render-ready 路径已由 dialogList 重查覆盖·本路径留契约兼容 |
| `applyScheduleCreated` | im:schedule:* | CL hasSchedule | ❌ | hasSchedule 终值 |
| `applyMembersSnapshot` | im:read:result(byIds) | MB 行 | ❌ | **`im:channel:members` render-ready**（memberId/nickname/admin 成品·role→admin 在 helix 判） |
| `applyMemberUpdated` | im:channel:member-updated | MB 行 | ❌ | render-ready 成员集（非 4 源抽 id 合并） |
| `applyMemberNickname` | im:channel:memberNickname | MB 行 | ❌ | render-ready（本仓不 upsert 合并） |
| `applyReadResult`(reply) | im:read:result(getReplies) | AX reply chip | ❌ | `im:channel:replies` render-ready id[] |
| `applyTodoUpdated` | im:todo:updated | AX todo chip | ❌ | render-ready todo[]（本仓不 filter/抽） |

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

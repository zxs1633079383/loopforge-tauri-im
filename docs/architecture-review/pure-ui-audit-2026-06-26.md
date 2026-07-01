# 纯 UI 渲染层 + 只读 架构审计裁定 — 2026-06-26

> 审计对象：loopforge-tauri-im（feat/uc-rollout · app 运行时代码 `src-tauri/src/**` + `src/app/**`）
> 审计标准：根 CLAUDE.md §1 三层架构 + §2 五不变量 + `src-tauri/CLAUDE.md` 薄壳纪律
> 审计性质：只读审计（未改任何仓内代码）· 四维独立审计 + 本文合成裁定

---

## 0. 整改进度（2026-06-26 im-body-build-down workflow 收口）

**A 类（M1-M5）已整改 — 5 命令出站 wire body + role 业务赋值 + endpoint 路由全部下沉 helix-im，壳回归纯 args 透传。**

- helix 侧：worktree `helix/worktrees/im-body-build` branch `fix/im-wire-body-build` commit `3be1840`——`CreateChannelCommand`/`MakeTopicCommand`/`MemberChangeCommand`/`TeamUpsertCommand`/新增 `SetMangerCommand` 内部 build 出站 wire body（含 self=CREATOR/他人=MEMBER 拼装收口 `build_creator_member_users`、ADMIN/MEMBER role 判定、add/remove manger endpoint 路由）；出站注册表 121→122。
- loopforge 壳侧：`commands.rs` 5 命令删 body 构造，改填结构化 snake_case args 入泵（`im_create_channel {display_name,team_id,self_id,member_ids}` / `im_make_topic {root_id,post_id,...}` / `im_team_upsert {display_name,team_id,self_id,member_ids}` / `im_channel_member_change {channel_id,team_id,self_id,join_user_ids,leave_user_ids}` / `im_channel_set_manger {channel_id,user_id,team_id,set}`）；`Cargo.toml` repoint 到 `fix/im-wire-body-build`。
- **机械搬运·零契约漂移**：wire body 字节一致（暖栈实证 UC-6.1 出站 `{channelId, joinUsers:[{id:"445",role:"MEMBER",teamId:...}]}` 与真源 §5 + 整改前 ledger 记录逐字一致）；冻结 oracle（expect ①面 / projection-schema / 真机curl真源）零改。
- **回归验证**：暖栈实跑 5 改 UC——5.1 ✅ 四面全绿 / 5.2 ✅ 四面全绿 / 6.1 ① 出站绿（②③④ 为整改前即有的 L2/backend-down partial·非本次引入）/ 6.2 ✅（①③ 绿·②④ L2 N/A）/ 11.1 ✅ 四面全绿。回归面 cses-java（JDWP suspend·7091/3391=000）业务广播链断 → post-echo 依赖型 spec（send-1/1.9/3.3/4.2）环境性红（同 #14/#42 根因·非代码回归）；go-mattermost 直发 echo 与读族 spec（1.10/2.1/2.3/5.4/5.8/6.4/10.3）全绿。

**剩余项（不阻塞·低优）**：M6 前端 setManger 乐观 data-admin（随 L2 #45 转权威态）· L1/L2 unread badge +1 与 failed 本地迁移（文档化乐观例外·无持久化）。**A 类裁定从 false → 合规（薄壳纪律守住）**；下方 §2/§5 原始裁定保留作整改前快照。

---

## 1. 综合裁定：**PARTIAL**

本项目**大体**是「纯 UI 渲染层 + 只读」：helix 引擎零改、壳内无落库 / 无 echo 对账 / 无 cursor / 无序号分配 / 无 readBits 业务计算 / 无业务状态机、engine.rs 纯装配（ports + 身份头 + bus→emit 桥 + 就绪 probe）、前端 apply* 方法是「投影→signal store→DOM data-*」纯搬运、无 fetch / localStorage / indexedDB / SQL。核心冻结集（消息行 data-* 直映投影字段）作为纯渲染成立。

**但不完全合规**，存在两类有界越线（均 medium/low，**无 critical/high 真业务渗入**）：

- **A 类（壳·出站 HTTP body 成形外溢）**：create/member 一族 5 个 rollout 命令在壳内构造完整 camelCase 出站 HTTP wire body，并做 role=CREATOR/MEMBER/ADMIN 角色业务赋值 + endpoint 路由。根因是 helix-im 对应 command 降级为 args 直透（pass-through），把 body 成形责任推给壳——壳注释自承『body 形态责任在壳』。偏离根 §2『禁壳内构造出站 HTTP body』与 `src-tauri/CLAUDE.md` 薄壳纪律 2。
- **B 类（前端·有界乐观/派生态）**：3 处文档化例外（setManger 乐观写 data-admin、unread badge +1 累加、发送态 failed 本地迁移）+ 2 处轻度派生（成员增量累积、readBits 回退合并）。属投影 L1 不到达时的乐观 UI / 派生计数，非前端自维护权威业务真值。

**一句话总评：PARTIAL — 核心边界守住（helix 零改 + 壳无落库/对账/cursor + 前端纯渲染投影），但 5 个建群/成员类命令把出站 HTTP body 成形 + 角色业务赋值漏到壳内（pass-through command 所致），前端有 3 处有界乐观例外；均无 critical/high 真业务渗入。**

---

## 2. 全部违反清单（四维去重 · 按 severity 排序）

### Medium（6 条）

| # | file:line | 一句话 |
|---|---|---|
| M1 | `src-tauri/src/commands.rs:716-766` (im_create_channel · UC-5.1) | 壳内拼整个 channel/create wire body（teamId/displayName/orient/type:P/picture/forceCreate + users[] 含 CREATOR/MEMBER 角色赋值）。 |
| M2 | `src-tauri/src/commands.rs:768-838` (im_make_topic · UC-5.2) | 壳内拼 posts/makeTopic wire body（rootId/teamId/postId/type:T/picture/forceCreate + users[] role 分配）。 |
| M3 | `src-tauri/src/commands.rs:855-909` (im_team_upsert · UC-11.1) | 壳内拼 CreateChannelSpecifyOwner team 对象（嵌 Channel 全字段 + owner CREATOR + users[] + forceCreate）。 |
| M4 | `src-tauri/src/commands.rs:1099-1148` (im_channel_member_change · UC-6.1) | 壳内拼 member/change wire body（channelId/joinUsers/leaveUsers，每成员 {id,teamId,role:"MEMBER"} + self 过滤），注释自承『body 形态责任在壳』。 |
| M5 | `src-tauri/src/commands.rs:1168-1209` (im_channel_set_manger · UC-6.2) | 壳内做 role=set?ADMIN:MEMBER 角色业务判定 + 按 set 选 add/remove manger endpoint + 拼 users:[{id,name,role,teamId}] body。 |
| M6 | `src/app/im/im-store.service.ts:544-556` (setManger) + `src/app/im/app.component.ts:1012-1016` (onChangeManger) | 前端乐观维护业务真值：设/撤管理员后壳乐观把成员行 data-admin 置目标态（投影 L1 不到达·权威态留 L2 #45）。 |

### Low（5 条）

| # | file:line | 一句话 |
|---|---|---|
| L1 | `src/app/im/im-store.service.ts:1655-1670` (applyChannelUpdateByPost · UC-4.2) | 前端 unread:(c.unread??0)+1 本地累加合成未读 badge（瘦投影不带 count·前端按信号次数自算派生值）。 |
| L2 | `src/app/im/im-store.service.ts:226-229` (markSendFailed) + 211/250/282 (catch) | 前端维护发送态机 'failed' 迁移：invoke reject 时壳标 data-send-status=failed（前端对失败的本地判定·非投影）。 |
| L3 | `src-tauri/src/commands.rs:294-303` (im_relay_messages) | 壳对每个待转发 Post map.entry("userId") 补 identity.user_id（身份注入合规范畴·但对业务对象做了字段加工）。 |
| L4 | `src/app/im/im-store.service.ts:1730-1741` (memberChange) | 前端用 byId Map 累积 join/leave 增量维护成员花名册（非每帧收全量 snapshot 直映）。 |
| L5 | `src/app/im/im-store.service.ts:2029` (upsert) | readBits: readBits \|\| prev.readBits 回退合并（新值空则保留旧值防闪烁·非纯直映·readBits 本身不在前端计算）。 |

---

## 3. 真业务渗入 vs 可接受边界 分类

### 真业务渗入（critical/high）：**零**
壳内无 SQL/落库/upsert、无 echo 对账（tmp_id→server_id 对账在 helix-im）、无 cursor 推进、无序号分配、无 readBits 计算、无业务状态机；前端无持久化、无出站 HTTP、无按 seq 排序消息、无客户端权威业务态。核心业务真源全在 helix-im。

### 可接受边界 / 装配性质
- **身份头注入**（L3 relay userId、各命令 teamId/userId 取自 AppState.identity profile 单一真源）：属 `src-tauri/CLAUDE.md` §5 身份头单一真源允许范畴——装配非业务。
- **engine.rs bus→emit 桥 + 就绪 probe**（事件计数 / 静默窗近似，非 cursor 计算）：W1 仪表化现实边界，诚实记录非冒充精确计数。
- **helix-driver-instrument Recording 端口装饰器**：纯日志/录放，无业务。
- **测试夹具**（test/specs/*, scripts/l2-*.sh, test/reducer/*）：验证机器件，不计入 app 业务。

### 灰区（medium · 需关注但有界）
- **A 类壳 body 成形（M1-M5）**：是真正的薄壳纪律越线，但**根因在 helix-im 把对应 command 降级为 args 直透**（非壳擅自实现业务）。壳注释诚实标注。整改方向 = 把 wire body 成形 + role 赋值收回 helix-im 的 outbound command 内部（壳退回纯『翻译入参入泵』），属 helix 侧债务，非壳违规要重写壳逻辑。
- **B 类前端乐观/派生（M6 + L1/L2/L4/L5）**：投影 L1 单账号不到达（WS 后端注释 / 瘦投影留 badge 触发位）时的乐观 UI / 派生计数；权威态由 L2 广播帧（#45）或回读对账。文档化例外，边界可控（无持久化）。

---

## 4. helix 零改边界证据

- helix 工作树（`/System/Volumes/Data/workspace/rust/helix`）`git status --short`：仅 `??` 未跟踪文件（.md / .workflow），**零 modified 跟踪源文件** → helix-core/helix-im/helix-driver-native 源零改成立。
- loopforge `src-tauri/Cargo.toml`：5 个 helix crate 全部 `git = "file://.../helix", branch = "feat/cses-round6-uc-reclaim"`（git ref 非 path dep·C001 单源同 rev 合规），Cargo.lock pin 具体 commit 冻结快照。
- 无 rollout commit 触碰 helix 源。

---

## 5. 裁定总结

| 维度 | conforms | 关键结论 |
|---|---|---|
| Tauri 薄壳(src-tauri) | false | 5 个 create/member 命令壳内构造出站 HTTP body |
| Angular 前端只读渲染(src/app) | false | 3 处文档化乐观例外（setManger/unread/failed） |
| helix 零改边界 + 业务归属 | true | helix 零改 + 落库/对账/cursor 真源全在 helix-im |
| Rollout commit 审计 | false | 同 A/B 两类·有界·契约驱动·无落库/cursor 渗入 |
| **VERDICT（合成）** | **PARTIAL** | 核心边界守住·5 命令 body 成形外溢 + 前端 3 处有界乐观·无 critical/high |

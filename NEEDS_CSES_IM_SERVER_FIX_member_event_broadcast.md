# NEEDS — 成员态变更广播为 NOTICE post 而非 member-update WS 事件（阻 L2 #29/#45 · #44 · #40/#48）

> 协调件（让 main 协调：cses-im-server 后端 vs helix 契约决议·别在本仓改）。loop-Engine 数据面 drive·2026-06-28。

## 一句话 gap
admin 角色变更 / 成员退群 / 退公司，cses-im-server **不广播** 契约期望的 `channel_member_update` /
`channel_member_role_updated` / `quit_company` **member-update WS 事件**，而是广播一条 **系统 NOTICE post**
（`action=post`·`props.type=addManager|leave|...`）。helix post handler 把它当普通 NOTICE post →
`emit_post_received`，**不更新成员角色 / 不移除成员行** → 契约 ②④③（`emit_channel_member_updated` /
`data-admin` / `data-members` 移除）结构上不产出。

## 实证（raw-WS observe 678·本会话）
对照组 #28 拉人（**已绿**）：678 被拉 → 收 `action=channel_member_update`（全 channel 对象·adminUsers/displayName…·
broadcast.userId=678）→ helix `emit_channel_member_updated` 成立。**拉人有正确 member-update 事件。**

缺口组：
| 操作（A=444 act·curl 实证） | 678 收到的帧 | 期望（契约）| 实得 |
|---|---|---|---|
| #29 `channel/add/manger {users:[{id:678,role:ADMIN}]}` | `post props.type=addManager` | `channel_member_update`/`channel_member_role_updated` → emit_channel_member_updated → data-admin | ❌ 仅 NOTICE post |
| #44 `channel/member/change {leaveUsers:[678]}` | `post props.type=leave`（broadcast.userId=678）| `channel_member_update`（member 移除）→ data-members 移除 | ❌ 仅 NOTICE post |
| #40 `teams/member/quit`（退公司）| （未 live 跑·避免破坏 444 team 归属）| `quit_company` 多播他人 | 待后端确认（同族大概率 NOTICE post）|

> #29 与 ledger UC-6.2 既有判断一致（「add/remove manger 后端 WS 已注释·仅 GrpcInvoke·须 channel_member_update
> 全量广播帧」）——本会话实证确认该 channel_member_update 广播帧**确实不发**·只发 addManager NOTICE post。

## 期望改动（二选一·main/人审决议）
**A. 后端补 member-update 事件广播**（cses-im-server·推荐·与 #28 拉人对齐）：
- admin 变更 → 广播 `channel_member_update`（全 channel 对象·更新后 adminUsers）或 `channel_member_role_updated`。
- 成员退群 → 广播 `channel_member_update`（成员移除·留存成员侧）+ 被踢者侧 member 移除事件。
- 退公司 → 广播 `quit_company`（payload channels[]·多播同 team 其余成员·partials/5 §2.18）。
**B. 契约修订 + helix 派生**（改 projection-schema/契约 + helix post handler 识别 props.type=addManager/leave
派生成员态变更）——属冻结契约变更·须出『契约变更提案 + 证据』交人审（C004·禁自改 oracle）。

## 现状（诚实出账·不 fake-green）
- #29/#45·#44·#40/#48 **留 OPEN·park**。membership setup（当场建带 678 频道）+ observe-678 harness 已就绪
  （`scripts/l2-observe-678.mjs` + uc-6.1-l2 模板）·一旦后端补 member-update 事件即可快速 port spec 验证。
- 对照绿 #28/#43（拉人 channel_member_update）证明 harness + observe 链路正确·缺口纯在后端 member-event 广播。

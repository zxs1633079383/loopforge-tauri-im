# 缺口闭合 PRD —— loopforge PC 首秀「完整实现所有功能」

> **背景**：2026-06-28 三路证据勘察(loopforge 真vs桩 / helix 真vs桩 / e2e台账诚实度)裁定:helix **0 代码桩**(92% 完整)、cses-im-server 后端刚补齐已 merge main、loopforge 壳 **29/31 四面接通**。真缺口集中在 **壳占位件 + L2 双账号 harness + 后端复验 + 新功能 10.2 + 测试卫生**,**不是从零**。
>
> **关键裁定(杜绝幻觉)**:那批"四面全绿"的 e2e 大多走 `invokeBridge` 直调 debug 桥(`uc-1.5.e2e.mjs:152`),**绕过真 UI 按钮**。引擎/invoke/投影/DOM 是真的,但**真实 UI 触发件接没接 e2e 不保证** → 占位 handler 对"PC 端真能用"是真缺口。
>
> **范围(用户拍板 2026-06-28)**:全量 = L1 真绿 + 建 L2 双账号 harness;**验收 = e2e 真跑绿(站全栈 cses-im-server:8066+helix+loopforge seeded db,四面 reducer 裁定)**;完整代码非骨架。
>
> **驱动**:`/loop-engine`(确定性内核 288 测试绿)`single` L3 首证 → `full` 铺全部。**护栏**:契约只读 C004 · 纯壳 C013 · 禁 merge main/禁 push · 预算储备 15% 自停 · 连败 3 park · 同 gap 第3次 quarantine。
>
> 真源:四面契约 = helix `docs/uc-automation/uc-test-contracts.md` · 拓扑/变量 = `uc-command-set-spec.md` · 覆盖 = `coverage-crossmap.md`。

---

## 0. 缺口矩阵(证据 file:line · 分段定位)

| 组 | UC | 缺哪一段 | 段 | issue |
|---|---|---|---|---|
| **G1 壳占位件** | 1.5 撤回 | `app.component.ts:1082 onRevoke(_row){}` 空 + im-store 无 `revoke()`(command/投影已就绪) | loopforge 壳 | 🆕 待建 |
| | 1.10 取消定时 | `app.component.ts:902 onCancelSchedule(){}` 空·全链缺(建定时已绿) | 壳(+查 helix cancel) | 🆕 待建 |
| | (全扫) | 其余 `on*` handler 占位排查 | 壳 | 并入 G1 |
| **G2 新功能** | 10.2 系统通知 | 投影不足·无 e2e·未建 | 壳+helix | #37 |
| **G3 后端复验** | 5.5b/5.6w/6.1/6.2 | 后端补齐已 merge·echo 面未用新后端复跑四面 | 复验(三段) | #28/#29 |
| **G4 L2 双账号** | 3.1/3.2/6.1/6.2/11.2 + US-17/5.3b/6.2b | ②④广播/回执面单账号测不到·需第二连接 harness | L2 harness | #14/#28/#29/#40/#42/#43/#44/#45/#48 |
| **G5 测试卫生** | 1.5-offline-setup/3.2-l2/6.1-l2 | e2e 脚本悬空·无 expect | 测试 | 并入对应 UC |
| **G6 testbed** | 4.3 too_long | host-cli 无 cursor 注入入口 | harness 限制 | 记录·非本批 |
| 排除 | 1.3🌙/1.6/7.x | 上传在 java/无端点 | 出范围 | #13 backlog |

> 底座:helix outbound/ws/emit 100%·0 `todo!()`;cses-im-server post_pin/manger/users-status-ids 已补 merge main(`4c9d48f`)。

---

## 1. 逐缺口功能 SPEC(完整定义·非骨架)

### G1.1 — UC-1.5 撤回 UI 接线
**功能**:消息行右键/hover「撤回」→ 调 helix `im_revoke` → 在线 `posts_update`/`post_update` 回声 → `emit_post_batch_updated`/`emit_post_deleted` → 行标 `data-revoke=1`。
**实现段(仅壳)**:
- `im-store.service.ts` 加 `async revoke(serverId: string): Promise<{ok:boolean}>` → `bridge.invoke('im_revoke', {post_id: serverId})`(snake·铁律)。
- `app.component.ts:1082` `onRevoke(row)` → `if(!row.msgId) return; void this.store.revoke(row.msgId)`。
- 模板消息行加撤回触发件(button·`data-testid`)。
**四面契约**:见 uc-test-contracts UC-1.5。**e2e 改造**:`uc-1.5.e2e.mjs` 增「真点 UI 撤回件」断言路径(保留 invokeBridge 作引擎旁证,新增 UI 路径证壳接线)。
**TDD red**:先写「点撤回件 → data-revoke=1」断言(红:onRevoke 空)→ 接线 → 绿。
**依赖**:1.1 send(产 post_server_id)。helix/后端已就绪。

### G1.2 — UC-1.10 取消定时
**功能**:定时消息管理面「取消」→ helix `im_cancel_schedule` → `post_schedule_canceled` → `emit_schedule_canceled` → `data-has-schedule-post=null`。
**实现段**:
- 查 helix `im_cancel_schedule` outbound 是否就绪(Agent2:1.10 helix 全绿,含 cancelSchedule);壳侧 `im-store.service.ts` 加 `async cancelSchedule(channelId)`→`invoke('im_cancel_schedule',{channel_id})`。
- `app.component.ts:902 onCancelSchedule()` 接线 + 模板触发件。
**四面契约**:uc-test-contracts UC-1.10(取消子路径)。
**TDD red**:「取消 → data-has-schedule-post 清空」断言。
**依赖**:1.10 建定时(产 schedule_post)。

### G2 — UC-10.2 系统通知
**功能**:WS 帧(SYSTEM/SYSTEN type)→ `emit_post_received`(fat·systemNotice 派生)→ 行 `data-system-notice=1`。无独立 HTTP 出站。
**实现段**:
- helix:确认 SYSTEM/SYSTEN type 帧经 post.rs → message_item_data fat 的 `systemNotice` 字段(type∈NOTICE_TYPES bool·projection-schema issue#53)正确派生。若缺 → helix 补(可逆分支)。
- 壳:确认 fat `systemNotice` 渲染到 `data-system-notice`(已有 data-* 定义)。
**四面契约**:uc-test-contracts UC-10.2。**e2e 新建** `uc-10.2.e2e.mjs` + expect:注入 SYSTEM 帧 → 断言 data-system-notice=1。
**TDD red**:先建 e2e(红)→ 补 helix/壳 → 绿。
**依赖**:4.1 连接。

### G3 — 后端补齐复验(5.5b/5.6w/6.1/6.2)
**功能**:用已 merge main 的 cses-im-server(post_pin 广播/manger role 广播/公告 echo)复跑四面,把 echo 面从 backend-down 转真绿。
**实现段**:无新代码(后端已补);站全栈复跑 e2e + reducer。若仍红 → 三段日志定位是壳没消费新帧 / helix handler 缺 / 后端帧字段不符。
**依赖**:cses-im-server main `4c9d48f`(已 merge)。

### G4 — L2 双账号 harness + 广播面
**功能**:双真实连接(444 主·UI / 678 副·HTTP act + WS observe),解锁 ②④ 广播/回执面:
- US-17 他人发→主收 `im:post:received`
- 6.1b 拉人→留存成员收 `channel_member_update`
- 5.3b member-leave 广播 · 6.2b admin role 广播到他人
- 3.1/3.2 已读回执对端 · 11.2b 退公司移除广播
**实现段(harness)**:复用 `.claude/workflows/uc-rollout-l2.js` + `uc-rollout-l2` skill;建第二连接夹具(副账号 HTTP 发起 + WS 观测);四面 reducer 加双连接认领。
**四面契约**:uc-test-contracts L2 块。**e2e**:补 `uc-3.2-l2`/`uc-6.1-l2` expect(G5)+ 新 L2 spec。
**TDD red**:L2 spec 红(单连接观测不到广播)→ 建双连接 harness → 绿。
**依赖**:对应 L1 UC 先绿;后端广播(已补)。

### G5 — 测试卫生(悬空 spec 补 expect)
`uc-1.5-offline-setup` / `uc-3.2-l2` / `uc-6.1-l2` 有 e2e 无 expect → 随对应 UC 闭合时补 expect(或降级注释)。**gate**:`scripts/gate.sh` expect JSON 校验应覆盖。

---

## 2. 依赖序(loop-engine 拓扑前沿)

```
G3 复验(后端已绿·无前置·先验)  ┐
G1.1 撤回 UI(吃 1.1 send)        ├─ L1 单连接波次(并行 worktree)
G1.2 取消定时(吃 1.10 建定时)   │
G2 10.2 系统通知(吃 4.1)        ┘
        ▼ L1 全绿后
G4 L2 双账号 harness(吃各 L1 UC 绿 + 后端广播)
        ▼
G5 测试卫生(随 G1/G4 收口补 expect)
```

---

## 3. 执行计划(loop-engine 驱动)

1. **L3 首证(single)**:挑 **G1.1 UC-1.5 撤回 UI** 作首证(最干净:helix+command+投影全就绪,纯壳接线 + e2e 加 UI 路径)。`/loop-engine single UC-1.5` → 证明引擎能把一个真 red 壳缺口自驱到四面绿。
2. **首证绿 → full**:`/loop-engine full` 依赖序铺 G1.2/G2/G3,再 G4 L2(走 uc-rollout-l2 workflow),G5 随收口。
3. **每 UC 绿**:reducer 四面裁定 → append `issue_green` + `gh issue close` + 翻 checklist/台账。
4. **红**:三段日志(loopforge/helix/cses-im-server)定位 → route() 动作(helix 分支修=可逆自决 / 壳绑定 / 重启后端)→ 重跑。修不动 → park 写 `NEEDS_HUMAN_*.md` 不阻塞。

## 4. 验收(用户拍板)
- **e2e 真跑绿站全栈**:`bash scripts/run.sh -- --spec test/specs/uc-X.e2e.mjs`(seeded db `/tmp/loopforge-im.db`)+ 四面 reducer 全绿。
- 完整代码非骨架;TDD 先行(red→green→refactor)。
- 每 UC 收口:翻台账 ✅ + 勾 checklist + commit + tag(按阶段)。

## 5. 护栏(机器强制·loop-engine 内置)
契约只读 C004 · 纯壳零业务逻辑 C013(处理逻辑下 helix·壳只绑定) · 测试可证伪 C008(破坏即 fail·禁墙钟下界) · 绿由独立 reducer 裁定 C009 · 禁 merge main/禁 push(worktree 隔离收口·人审后合) · 预算储备 15% 自停 + resume · 连败 3 park · 同 gap 第3次 quarantine。

## 6. to-issues 映射
| 缺口 | issue | 动作 |
|---|---|---|
| G1.1 UC-1.5 撤回 UI | 🆕 建 | label uc-rollout, ready-for-agent |
| G1.2 UC-1.10 取消定时 | 🆕 建 | 同上 |
| G2 UC-10.2 | #37 | 复用·补四面锚 |
| G3 复验 5.5b/5.6w | 🆕 建复验 issue 或并入 #28/#29 | |
| G4 L2 | #14/#28/#29/#40/#42/#43/#44/#45/#48 | 复用·ready-for-agent(原 ready-for-human→转) |
| G5 测试卫生 | 并入对应 UC | |

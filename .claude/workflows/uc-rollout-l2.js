export const meta = {
  name: 'uc-rollout-l2',
  description: 'L2 双账号验证：444(主·UI)+678(副·HTTP act + WS observe) 双连接·解锁 read-receipt/广播类 ②④/②③④ 面·真四面绿关 L2-pending issue(#14/15/28/29/40/42 + tracker #43/44/45/47/48)。',
  phases: [
    { title: 'L2-harness' },
    { title: 'observe-from-444' },
    { title: 'observe-from-678' },
    { title: 'Finalize' },
  ],
}

const REPO = '/Users/mac28/workspace/rustWorkspace/loopforge-tauri-im'

const UC_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['issue', 'uc', 'status', 'note'],
  properties: {
    issue: { type: 'number' },
    uc: { type: 'string' },
    status: { type: 'string', enum: ['green', 'yellow', 'blocked'] },
    four_facet: { type: 'string' },
    committed: { type: 'boolean' },
    issue_closed: { type: 'boolean' },
    l2_tracker_closed: { type: 'string', description: '联动关闭的 L2 tracker issue#（如有）' },
    note: { type: 'string' },
  },
}

const DISCIPLINE = `
# 你是 loopforge-tauri-im L2 双账号验证 autonomous agent（cwd ${REPO}·分支 feat/uc-rollout）
# 开局必读：根 CLAUDE.md §8/§9 + docs/uc-rollout/autonomous-runbook.md + docs/harness/C001-C012 + 各 L2-facet issue 的 close/reopen comment（精确机制已写在里面）

## L2 双账号 creds + 架构（用户 2026-06-26 授权·全权自决·不停下问人）
- **账号 A = 444**（密码 444·主账号·**现成 dev-local profile cookieId=444**·跑暖栈 app webdriver 4445·UI 驱动 + run.jsonl 观测）。
- **账号 B = 678**（密码 678·副账号·同 team）。
- **teamId / companyId = \`64118eebd2b665246b7880eb\`**·apiBase=\`http://localhost:8066/api/cses\`·ws=\`ws://localhost:8066/api/v4/websocket\`（后端=cses-im-server·端口 8065→8066·路径不变·切流 spec docs/cutover/）。
- cses-im-server :8066 健康（curl localhost:8066/api/cses/health→200）·自包含 PG/Redis（无 cses-java/gRPC）。

## L2-facet 真验证范式（这是 L2 的全部意义）
某面"结构上只有第二账号才观测得到"——现在有了 678 就能真造出来：
- **read-receipt（#14/#15·tracker #47）**：A=444 发消息 → **B=678 读 A 的消息**（post/read 或 channels/view·act-as-678）→ **A=444 收 post_read(type6)** → ② im:post:read(fat) ③ data-read-bits ④ message.read_bits。A 观测（暖栈 4445 run.jsonl）。
- **他人发消息收推送（#42·US-17）**：**B=678 在共享频道发消息**（posts/create·act-as-678）→ **A=444 收消息推送** → A 的 ②③④。A 观测。
- **拉/踢人广播（#28·tracker #43）**：A=444 拉 678 进频道 → **B=678 收 channel_member_update** → B 观测（observe-678 WS）。
- **admin 广播（#29·tracker #45）**：A=444 设/撤 678 管理员 → **B=678（或他人）收广播** → B 观测。
- **退公司广播（#40·tracker #48）**：A=444 退 team → 他人收 quit 广播 → B 观测。

## 双账号原语（phase0 建·后续复用·提交进仓）
- **act-as-678**：以 678 身份发 HTTP（读/发/拉）。鉴权探明：cookieId 桥（参记忆 cookieid_equals_userid·cookieId=userId·cses-im-server 入站拿 cookieId header 当 userId 建 session·无独立 token）。写成 \`scripts/l2-act.sh <verb> <args>\`（curl 带 678 鉴权）。
- **observe-678**：轻量 WS 客户端连 678（ws://localhost:8066/api/v4/websocket·678 鉴权握手）·捕获推送帧落 JSONL 供 reducer 读。写成 \`scripts/l2-observe-678.mjs\`（node ws·后台跑·帧写 /tmp/loopforge/l2-678.jsonl）。
- 暖栈 A=444：\`bash scripts/harness.sh up\`（幂等·现成 cookieId=444）。

## 铁律
- **不改冻结 oracle**（test/expect/*.expect.json / projection-schema / 真机curl真源）。reducer/harness/l2-原语 是机器件可改。绿由 reducer 裁定(C009)·破坏即 fail 保可证伪(C008)。
- **真四面绿才 close**（标准 c）：L1 面(①③ A 自身)已绿(冻结不回退) + 本次 L2 面(②④/②③④)双账号真跑绿 → close 本 issue + **联动 close 对应 L2 tracker**（read-receipt→#47·拉人→#43·admin→#45·quit→#48）。
- **禁 fake-green**：678 真没连上/真造不出 → status=yellow + 证据 + 留 open（不橡皮章）。
- **绝不 merge main / 不 push**·commit 前验 branch=feat/uc-rollout + \`bash scripts/gate.sh\` 绿·conventional 中文 commit。
- 完成/中断写终态行 docs/harness/log.md。
`

function ucPrompt(uc) {
  return `${DISCIPLINE}

## 本任务：L2 双账号验证 + 闭环 issue #${uc.n}（${uc.uc} ${uc.title}）
场景：${uc.scenario}
1. \`gh issue view ${uc.n} --comments\` 读 L1 已绿面 + ②④ 精确机制（reopen comment 已写"谁推给谁·为何单账号造不出"）。读 test/expect/uc-${uc.id}.expect.json 的 ②④ projection/storage 锚。
2. 确保暖栈 A=444 up（\`bash scripts/harness.sh up\`）+ 双账号原语就绪（phase0 已建 l2-act.sh / l2-observe-678.mjs；缺则先建·见 DISCIPLINE）。
3. 用双账号跑出 L2-facet：${uc.howto}
4. 四面 reducer 裁定（A 观测的 run.jsonl ∪ B 观测的 l2-678.jsonl 按 corr_key 聚四面）。**绿**→ ledger ✅ + 勾 checklist + \`gh issue close ${uc.n}\`${uc.tracker ? ' + `gh issue close ' + uc.tracker + '`（联动 tracker）' : ''} + gate.sh + commit。**红**→ 定位（678 鉴权/握手/echo 缺）修机器件复跑·真造不出才 yellow+证据。
5. 返回 UC_RESULT（含 l2_tracker_closed）。`
}

// ============ 执行 ============
phase('L2-harness')
const harness = await agent(`${DISCIPLINE}

## 本任务：phase0 — 建 L2 双账号原语 + 首验 read-receipt（#15 UC-3.1）
1. 暖栈 A=444 up（\`bash scripts/harness.sh up\`·现成 cookieId=444）。
2. **探明 678 鉴权**：cses-im-server 用 cookieId 桥（cookieId=678 header·入站当 userId 建 session·无独立 token）。curl 验证能以 678 身份 GET 自己信息（确认鉴权通）。
3. 建 **\`scripts/l2-act.sh\`**（act-as-678·curl 带 678 鉴权·支持 read <channelId> / send <channelId> <text> / member-add 等 verb）+ **\`scripts/l2-observe-678.mjs\`**（node ws 连 678·捕获推送帧 → /tmp/loopforge/l2-678.jsonl）。node ws 依赖若缺用 pnpm add -D ws。
4. **首验 #15 read-receipt**：A=444 发消息(harness spec 或 im_send) → \`l2-act.sh read <channelId>\`(678 读 A 消息) → A=444 收 post_read(type6)（run.jsonl 出 im:post:read + read_bits）→ 四面 reducer 绿。
5. 绿 → close #15 + #47（tracker·若 #14 同机制也可一并验+close #14）+ ledger ✅ + commit（含 l2-act.sh / l2-observe-678.mjs 提交进仓）。真造不出 → yellow + 证据（678 鉴权/echo 卡哪）。
返回 UC_RESULT。`,
  { label: 'L2-harness:#15', phase: 'L2-harness', schema: UC_RESULT, effort: 'high' })

// A=444 观测类（678 act·444 收）——读 receipt 余项 + 他人发消息
phase('observe-from-444')
const obs444 = [
  { n: 14, id: '3.2', uc: 'UC-3.2', title: '单条已读 ②④', tracker: 47,
    scenario: 'A=444 发消息 → B=678 post/read 单条 → A 收 post_read(type6)',
    howto: 'A 发消息取 server_id → `l2-act.sh read-post <postId>`(678 标单条已读) → A run.jsonl 出 im:post:read{postId} + message.read_bits → reducer 绿。' },
  { n: 42, id: 'us17', uc: 'US-17', title: '他人发消息收推送', tracker: null,
    scenario: 'B=678 在共享频道发消息 → A=444 收消息推送(② post_received ③ 新消息行 ④ 落库)',
    howto: '`l2-act.sh send <sharedChannelId> "hi from 678"` → A=444 run.jsonl 出 im:post:received{sender=678} + DOM 新行 + message 落库 → reducer 绿。先确保 444/678 在同一频道(必要时 A 先建群拉 678 或用现成共享频道)。' },
]
const r444 = []
for (const uc of obs444) {
  const r = await agent(ucPrompt(uc), { label: `obs444:#${uc.n}`, phase: 'observe-from-444', schema: UC_RESULT, effort: 'high' })
  r444.push(r)
}

// B=678 观测类（444 act·678 收广播）——需 observe-678 WS 捕获
phase('observe-from-678')
const obs678 = [
  { n: 28, id: '6.1', uc: 'UC-6.1', title: '拉/踢人广播', tracker: 43,
    scenario: 'A=444 拉 678 进频道 → B=678 收 channel_member_update 广播',
    howto: 'observe-678 WS 连着 → A=444 拉 678 进某频道(UI im_pull_member 或 channel/member/change) → l2-678.jsonl 出 channel_member_update{被拉=678} → reducer 绿。' },
  { n: 29, id: '6.2', uc: 'UC-6.2', title: '设/撤管理员广播', tracker: 45,
    scenario: 'A=444 设/撤 678 管理员 → B=678(或他人) 收 admin 广播',
    howto: 'observe-678 连着 → A=444 设 678 为 admin(channel/member/role) → l2-678.jsonl 出 admin/role 广播帧 → reducer 绿。' },
  { n: 40, id: '11.2', uc: 'UC-11.2', title: '退公司广播', tracker: 48,
    scenario: 'A=444 退 team → 他人(678) 收 quit 广播',
    howto: 'observe-678 连着(678 须与 444 同 team) → A=444 退 team(teams/member/quit) → l2-678.jsonl 出 quit/member-leave 广播 → reducer 绿。注意此操作改 444 team 归属·验完可能需恢复(记录原状)。' },
]
const r678 = []
for (const uc of obs678) {
  const r = await agent(ucPrompt(uc), { label: `obs678:#${uc.n}`, phase: 'observe-from-678', schema: UC_RESULT, effort: 'high' })
  r678.push(r)
}

phase('Finalize')
const all = [harness, ...r444, ...r678].filter(Boolean)
const green = all.filter(r => r.status === 'green')
const yellow = all.filter(r => r.status === 'yellow')
const summary = await agent(`${DISCIPLINE}

## 本任务：L2 收尾对账
逐项：绿 ${green.length} · 黄 ${yellow.length}。
1. 核对：每个验绿的 L2 issue + 其 tracker 都已 close（gh issue list --state open --label ready-for-human 应只剩真没验的）。ledger ✅ = checklist 勾 = 关闭数（C011 诚实）。
2. \`bash scripts/gate.sh\` 须绿。
3. 写总终态行 docs/harness/log.md：'✅/⚠️ L2 双账号验证 | 绿N/黄M | 关闭 issue 清单 | feat/uc-rollout'。
4. 若全部 L2 绿 → 打 tag \`v0.2-l2-dual-account\`（覆盖 commit + L2 issue 清单 + 验证状态）。
返回 UC_RESULT（uc='FINAL'·note 写最终统计 + 关闭清单 + 剩余 yellow）。`,
  { label: 'finalize', phase: 'Finalize', schema: UC_RESULT, effort: 'high' })

return {
  harness: harness && harness.status,
  green: green.length, yellow: yellow.length,
  final: summary,
  per_uc: all.map(r => ({ issue: r.issue, uc: r.uc, status: r.status, closed: r.issue_closed, tracker: r.l2_tracker_closed, note: r.note })),
}

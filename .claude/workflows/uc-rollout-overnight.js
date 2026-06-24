export const meta = {
  name: 'uc-rollout-overnight',
  description: '通宵自主跑 UC rollout：#46 UI 骨架 → 阶段0-7 逐 issue 串行四面闭环 → 每阶段全绿打 tag。红则四段日志定位+修+验证(gRPC 自重启)，卡死标🟡不阻塞。',
  phases: [
    { title: 'Scaffold UI' },
    { title: 'phase0-ready' }, { title: 'phase1-channel' }, { title: 'phase2-send' },
    { title: 'phase3-msgops' }, { title: 'phase4-history' }, { title: 'phase5-channel-member' },
    { title: 'phase6-misc' }, { title: 'phase7-teams' }, { title: 'Finalize' },
  ],
}

const REPO = '/Users/mac28/workspace/rustWorkspace/loopforge-tauri-im'
const RUNBOOK = 'docs/uc-rollout/autonomous-runbook.md'

const UC_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['issue', 'uc', 'status', 'note'],
  properties: {
    issue: { type: 'number' },
    uc: { type: 'string' },
    status: { type: 'string', enum: ['green', 'yellow', 'blocked'] },
    four_facet: { type: 'string', description: '四面状态摘要(①②③④)' },
    committed: { type: 'boolean' },
    issue_closed: { type: 'boolean' },
    note: { type: 'string', description: '一句话结果/卡点' },
  },
}

// 通用纪律（每个 UC agent 都注入）
const DISCIPLINE = `
# 你是 loopforge-tauri-im 自主工程 agent（cwd ${REPO}·分支 feat/uc-rollout）
# 开局必读：根 CLAUDE.md §8/§9 + ${RUNBOOK}(单一执行真源) + docs/harness/C001-C012 + docs/spec/angular-ui-plan.md

## 铁律
- **契约只读**：禁改冻结 expect/tape/真源(真机curl真源/projection-schema)让红变绿；绿由 reducer 裁定(C009)。
- **确认即修+验证**：红→四段日志(${RUNBOOK} §6.1)定位哪一端→确认 loopforge/helix 缺陷就**改实现+复跑验证**(helix 在 /Users/mac28/workspace/rustWorkspace/helix 改+commit·不 merge helix 主线)。go-server 默认对。
- **gRPC 信号**：/tmp/mm-go.log 出现 'no service available'/'grpcx9.go' → 隧道断 → \`sudo bash /Users/mac28/workspace/java/zlc_ai/GenericAgent/tp-connect.sh\`(密码输四个空格)+ \`pkill -f cses\` + \`cd /Users/mac28/workspace/java/cses && ./gradlew run > /tmp/cses-java.log 2>&1 &\`(Micronaut)→ 等起好重发。
- **不回退已绿** UC-1.1/1.2/1.5(冻结集禁改)；前端事件必配组件方法(C007)。
- **绝不 merge main**；commit 前 \`bash scripts/gate.sh\` 须绿；conventional 中文 commit。
- 卡死/超预算/helix 改不动 → 标 status=blocked/yellow + gh issue comment 贴 bug 报告 + ledger 标 🟡 + **不阻塞·返回继续下一个**。
- 完成/中断写终态行到 docs/harness/log.md。
`

function ucPrompt(uc) {
  return `${DISCIPLINE}

## 本任务：闭环解决 GitHub issue #${uc.n}（${uc.uc} ${uc.title || ''}）${uc.notes ? '·' + uc.notes : ''}
1. \`gh issue view ${uc.n} --comments\` 读四面锚点 + Angular 需求 + Blocked by（blocker 未绿先跳过本 UC 返回 blocked）。
2. **若无** test/expect/uc-${uc.id}.expect.json + test/specs/uc-${uc.id}.e2e.mjs → 照 test/expect/uc-send-1.* 模板从冻结真源(helix 真机curl真源.md ① / projection-schema.md ②④)派生 author（契约只读·找不到 endpoint 标 ambiguity 别臆造）。
3. 接最简 Angular UI：按 angular-ui-plan 往 #46 骨架绑数据/加交互件（加法式·事件配方法 C007）。
4. \`for p in 1420 4445; do pid=$(lsof -ti tcp:$p); [ -n "$pid" ] && kill -9 $pid; done; pkill -f loopforge-tauri-im; sleep 1\`；改了 Rust 才 \`cargo build --manifest-path src-tauri/Cargo.toml\`。
5. \`bash scripts/run.sh -- --spec test/specs/uc-${uc.id}.e2e.mjs\`（默认 seeded db）。
6. 四面 reducer：**绿**→翻 docs/uc-coverage-ledger.md ✅ + 勾 docs/uc-rollout/rollout-checklist.md + \`gh issue close ${uc.n} --comment "四面全绿 corr_key=..."\` + \`bash scripts/gate.sh\` + commit → status=green。**红**→§6.1 四段日志定位→确认即修(loopforge/helix)/gRPC 自重启→复跑；迭代到绿或判定 helix 缺陷改不动→bug 报告 + 🟡 + status=yellow（不阻塞）。
${uc.notes && uc.notes.includes('预期红') ? '   注：本 UC ① 预期红(acl fix 在 helix round3 不在 pin 的 round6)——可在 helix 仓 cherry-pick/移植该 fix 到 round6 后验证；移植不动则标 🟡 出 bug 报告。' : ''}
7. 返回 UC_RESULT 结构。`
}

function tagPrompt(ph, results) {
  const greens = results.filter(r => r && r.status === 'green').map(r => `#${r.issue}(${r.uc})`).join(' ')
  const notGreen = results.filter(r => r && r.status !== 'green').map(r => `#${r.issue}(${r.status})`).join(' ') || '无'
  return `${DISCIPLINE}

## 本任务：阶段 ${ph.tag} 收口
本阶段结果：绿=[${greens || '无'}] · 非绿=[${notGreen}]。
1. 若本阶段**所有 ready-for-agent UC 全绿** → \`git tag -a v0.1-${ph.tag} -m "覆盖 commit 范围 + 该阶段 UC 列表 + 验证状态"\`。非全绿则**不打 tag**，只在 docs/harness/log.md 记一行阶段状态。
2. 确认本阶段每个绿 UC 的 test/specs/uc-X.e2e.mjs + expect 存在（缺则补·真跑过）。
3. 本阶段若踩 ≥3 同根新坑 → 立 docs/harness/C{NNN} 卡 + 同步 CLAUDE §9/README 索引(gate 索引不变量须仍绿)。
4. \`bash scripts/gate.sh\` 绿 + commit。返回 UC_RESULT（issue 填阶段首 issue·uc 填 ph.tag·status=green 若打了 tag 否则 yellow·note 写 tag 名/原因）。`
}

// ============ 执行 ============
phase('Scaffold UI')
const scaffold = await agent(`${DISCIPLINE}

## 本任务：前置 issue #46 — Angular UI 骨架（覆盖所有 UC 渲染容器）
按 docs/spec/angular-ui-plan.md 一次搭好 6 语义区（H 状态/CL 频道列表/ML 消息列表[已绿勿动]/MB 成员/CP composer/AX 辅助区）+ MessageRow 扩全待加 8 字段（urgent/reactions/templateReceived/replyId/pinned/systemNotice/vote/average·模板 [attr.data-*] 占位·空不渲染）。
铁律：不回退已绿 UC-1.1/1.2/1.5（\`bash scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs\` 仍四面全绿）；事件必配组件方法(C007)；\`pnpm exec ng build --configuration development\` 无 TS 错；\`bash scripts/gate.sh\` 绿；commit + \`gh issue close 46\`。返回 UC_RESULT。`,
  { label: 'scaffold:#46', phase: 'Scaffold UI', schema: UC_RESULT, effort: 'high' })

const PHASES = [
  { tag: 'phase0-ready', ucs: [{ n: 7, id: '4.1', uc: 'UC-4.1', title: 'hello 全量增量·就绪根' }] },
  { tag: 'phase1-channel', ucs: [{ n: 8, id: '5.1', uc: 'UC-5.1', title: '创建群聊' }, { n: 9, id: '5.2', uc: 'UC-5.2', title: '创建话题' }] },
  { tag: 'phase2-send', ucs: [{ n: 10, id: '1.9', uc: 'UC-1.9', title: '加急' }, { n: 11, id: '1.8', uc: 'UC-1.8', title: '快捷回复' }, { n: 12, id: '1.10', uc: 'UC-1.10', title: '定时消息' }] },
  { tag: 'phase3-msgops', ucs: [{ n: 14, id: '3.2', uc: 'UC-3.2', title: '单条已读' }, { n: 15, id: '3.1', uc: 'UC-3.1', title: '会话已读' }, { n: 16, id: '3.3', uc: 'UC-3.3', title: '模板已收到' }, { n: 17, id: '1.4', uc: 'UC-1.4', title: '重发失败' }, { n: 18, id: '1.7', uc: 'UC-1.7', title: '转发合并' }, { n: 19, id: '2.4', uc: 'UC-2.4', title: '回复链' }] },
  { tag: 'phase4-history', ucs: [{ n: 20, id: '2.1', uc: 'UC-2.1', title: '切群首屏' }, { n: 21, id: '2.3', uc: 'UC-2.3', title: '按 postId 定位' }, { n: 22, id: '2.2', uc: 'UC-2.2', title: '上拉历史', notes: '①预期红' }] },
  { tag: 'phase5-channel-member', ucs: [{ n: 23, id: '5.4', uc: 'UC-5.4', title: '群属性修改' }, { n: 24, id: '5.5', uc: 'UC-5.5', title: '置顶' }, { n: 25, id: '5.3', uc: 'UC-5.3', title: '关闭/退出群' }, { n: 26, id: '6.3', uc: 'UC-6.3', title: '改群昵称' }, { n: 27, id: '6.4', uc: 'UC-6.4', title: '成员快照' }, { n: 28, id: '6.1', uc: 'UC-6.1', title: '拉/踢人' }, { n: 29, id: '6.2', uc: 'UC-6.2', title: '设/撤管理员' }] },
  { tag: 'phase6-misc', ucs: [{ n: 30, id: '9.x', uc: 'UC-9.x', title: '书签' }, { n: 31, id: '10.1', uc: 'UC-10.1', title: '待办列表' }, { n: 32, id: '4.2', uc: 'UC-4.2', title: 'sync notify' }, { n: 33, id: '4.5', uc: 'UC-4.5', title: '陌生 channel 兜底' }, { n: 34, id: '4.4', uc: 'UC-4.4', title: '心跳 gap', notes: '3面①②④' }, { n: 35, id: '8.x-vote', uc: 'UC-8.x', title: '投票 CRUD' }, { n: 36, id: '8.x-average', uc: 'UC-8.x', title: '平均分 CRUD' }, { n: 37, id: '10.2', uc: 'UC-10.2', title: '系统通知' }] },
  { tag: 'phase7-teams', ucs: [{ n: 38, id: '5.8', uc: 'UC-5.8', title: '条件查频道' }, { n: 39, id: '11.1', uc: 'UC-11.1', title: '维护公司大群' }, { n: 40, id: '11.2', uc: 'UC-11.2', title: '退出公司' }, { n: 41, id: '12.1', uc: 'UC-12.1', title: '健康探针' }] },
]

const all = [scaffold]
for (const ph of PHASES) {
  phase(ph.tag)
  const results = []
  for (const uc of ph.ucs) {            // 串行·禁并行(端口/GUI/seeded db 冲突)
    const r = await agent(ucPrompt(uc), { label: `${ph.tag}:#${uc.n}`, phase: ph.tag, schema: UC_RESULT, effort: 'high' })
    results.push(r)
    all.push(r)
  }
  const tagRes = await agent(tagPrompt(ph, results), { label: `tag:${ph.tag}`, phase: ph.tag, schema: UC_RESULT, effort: 'high' })
  all.push(tagRes)
  log(`${ph.tag}: 绿 ${results.filter(r => r && r.status === 'green').length}/${ph.ucs.length} · ${tagRes && tagRes.note || ''}`)
}

phase('Finalize')
const ok = all.filter(Boolean)
const green = ok.filter(r => r.status === 'green')
const yellow = ok.filter(r => r.status === 'yellow')
const blocked = ok.filter(r => r.status === 'blocked')
const summary = await agent(`${DISCIPLINE}

## 本任务：整任务收尾
逐项结果：绿 ${green.length} · 黄 ${yellow.length} · blocked ${blocked.length}。
1. 核对 docs/uc-coverage-ledger.md 绿数 = checklist 勾数 = gh 关闭的 issue 数（C011 诚实出账·不一致则修正）。
2. \`bash scripts/gate.sh\` 须绿。
3. 写总终态行到 docs/harness/log.md：'✅ DONE/⚠️ PARTIAL UC rollout 阶段0-7 | commit 范围 | 绿N/黄M/blocked K | feat/uc-rollout'。
4. \`git log --oneline -1\` + \`git tag -l 'v0.1-phase*'\` 汇总。
返回 UC_RESULT（uc='FINAL'·status=green 若全绿否则 yellow·note 写最终统计 + tag 列表 + 剩余黄/blocked 清单）。`,
  { label: 'finalize', phase: 'Finalize', schema: UC_RESULT, effort: 'high' })

return {
  scaffold: scaffold && scaffold.status,
  total_uc: all.length,
  green: green.length, yellow: yellow.length, blocked: blocked.length,
  final: summary,
  per_uc: ok.map(r => ({ issue: r.issue, uc: r.uc, status: r.status, note: r.note })),
}

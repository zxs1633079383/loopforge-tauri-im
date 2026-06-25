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

## 全权 autonomous（2026-06-25 用户授权·终态=真闭环）
目标=**每个 issue 真实关闭·真代码+真测试·覆盖该 UC 全部 HTTP/WS(对 coverage-crossmap.md)**。用户已全权授权你**自己拍契约决策·不要停下问人**。**禁止拿 status=blocked/yellow 当退路**——必须自决修到四面真绿。

## 契约 vs 环境失配决策范式（live 四面失配时·自己拍·优先级从高到低）
1. **改环境对齐契约**(首选·oracle 不动)：如 expect 编码冷启动 increment-delta 但本机 DB 是 current-cursor → **重置 channel_event_cursor.last_event_seq=0 落后态**，并把「run 前重置」固化成可复跑 seed/hook(别留一次性手工态)。
2. **改测试机器件**(reducer/装饰器/seed·非冻结 oracle·允许改)：如 ① batch 出站无单 channel corr_key → 装饰器 \`crates/helix-driver-instrument/src/event.rs\` extract_corr_key 加 \`body.cursors[0].channelId\` 探针归束(契约 URL+body-shape 没变=不算改契约)。
3. **改冻结契约**(最后手段·需确凿证据该 expect 本身错)：可改但 commit body 必写「契约变更提案+证据(run.jsonl)」。

## 暖栈常驻（red→green 内循环秒级·别每轮 down/cold-boot）
ng(1420)+app(4445) 一次起常驻·跨多次 wdio 复用：\`bash scripts/harness.sh up\`(幂等·已健康复用)。**暖 spec ~3s**(vs 冷启 run.sh 10-16min)。规矩：仅改 spec/expect/reducer → \`harness.sh spec <uc-id>\`(不 reload·秒级)；改了 Rust/Angular → \`harness.sh reload-app\`(只重起 app·ng 不动·~30-60s)再 \`spec\`；UC-4.1 cursor 重置 → \`reload-app --uc4.1\`。**别 \`harness.sh down\`**(留给级联续跑)；run.sh 仅留作单次冷启 CI 兜底。run.jsonl 末行残缺(常驻并发追加产物)已由 reducer torn-line 容忍放过(不否决绿·守 C008 仅放末行)。

## 铁律
- **冻结 oracle 永不为绿而改**：\`test/expect/*.expect.json\` / projection-schema / 真机curl真源 / golden tape。**可改机器件**：reducer four-facet-reducer.mjs / 装饰器 extract_corr_key / seed·cursor 脚本 / 渲染壳 / helix 引擎实现。绿由 reducer 裁定(C009)。
- **确认即修+验证**：红→四段日志(${RUNBOOK} §6.1)定位哪一端→loopforge/helix/reducer/装饰器/环境缺陷就**改+复跑验证**(helix 在 /Users/mac28/workspace/rustWorkspace/helix 改+commit·不 merge 主线)。go-server 默认对。
- **infra 真相纠偏(别再误判 down)**：go-mattermost 跑在 GoLand 里→**没有 /tmp/mm-go.log 是正常的**·别据此判 go 未起；验 go 用 \`curl -s localhost:8065/api/v4/system/ping\`(200=健康)。app 实际打开的 DB 是**字面名文件** \`/tmp/loopforge-im.db?mode=rwc\`(engine.rs:101 format 串把 ?mode=rwc 拼进文件名)·**plain /tmp/loopforge-im.db 是 0 字节幽灵文件·别据此判 db 空/infra down**。cses-java 是 graalvm Micronaut(端口 7091/3399/3391)。
- **gRPC 隧道断**(确认是连接非逻辑)：/tmp/mm-go.log 或 go 控制台出现 'no service available'/'grpcx9.go' → \`sudo bash /Users/mac28/workspace/java/zlc_ai/GenericAgent/tp-connect.sh\`(密码四空格·若交互 sudo 失败则在 issue 留 NEED_TUNNEL comment 让 main 协调·不死磕)。
- **#7(UC-4.1 cold-increment) 已知 yellow=真 server-data-gap（cursor 重置后 hello 仍回空增量·server 无 channel event 历史可回放·commit 63bfc7e ①③已绿）·不阻塞任何下游 UC**：建群(#8)/发消息(#10)/已读/历史 都是独立流·**不依赖 cold-increment**。遇 issue 上"Blocked by #7"一律视为可推进·别再回头死磕 #7。#7 留到所有数据生成类 UC 后由收尾复跑（那时 server 已有真事件→②④ 多半自愈转绿）。
- **不回退已绿** UC-1.1/1.2/1.5 + UC-4.1 的 ①③(63bfc7e/f72fdf2)；前端事件必配组件方法(C007)。
- **绝不 merge main / 不 push**；commit 前验 pwd 在仓内 + branch=feat/uc-rollout + \`bash scripts/gate.sh\` 须绿；conventional 中文结构化 commit。
- **read-receipt 正确语义(2026-06-25 用户权威·别再写"多设备 echo"错因)**：\`post_read\`(type6) 推给**消息的发送者**·当**别人已读了发送者的消息**时(不是自读回执·不是多设备 echo)。故 UC-3.1(channels/view)/3.2(post/read) 的 ②④(im:post:read 投影 + message.read_bits 落库) **L1 单账号结构上造不出**(无第二账号读本账号消息)=**真 L2 双账号**·已由 L2 追踪 issue **#47** 接盘。
- **L2-facet 处置(标准 c·关闭门槛)**：某面**结构上只有第二账号才观测得到**(read-receipt 推发送者 / member-leave 广播他人 / admin 广播他人 / 他人发消息收推送)→ ①③(本账号自身可达)验 L1 绿·该 L2-facet **不当 yellow 糊弄关闭**：(1) **issue 留 OPEN**·改 label \`ready-for-human\`(removeLabel ready-for-agent·防自动再抓)·(2) 在 comment **写精确机制**(谁推给谁·为何单账号造不出·别写"多设备 echo")·(3) 链到对应 L2 追踪 issue(read-receipt→#47·其余按 #42-45 或新建)。**issue 只有四面真全绿(L1 面绿 + L2 面在 L2 issue 验证绿)才 close**·**禁止 ①③绿+②④延后就 close**(C011 不留"关了没测"的账)。
- **真 server-data-gap(区别于 L2-facet)**：纯环境数据缺失(如 #7 cold-increment 若 server 真无 event 历史)·带 run.jsonl 证据·标 yellow 留 open·**非**结构性 L2。其余非 L2-facet 的红一律修到绿。
- 完成/中断写终态行到 docs/harness/log.md。
`

function ucPrompt(uc) {
  return `${DISCIPLINE}

## 本任务：闭环解决 GitHub issue #${uc.n}（${uc.uc} ${uc.title || ''}）${uc.notes ? '·' + uc.notes : ''}
0. **幂等跳过**：\`gh issue view ${uc.n} --json state -q .state\`。若已 CLOSED 且 test/specs/uc-${uc.id}.e2e.mjs + test/expect/uc-${uc.id}.expect.json 存在 + \`bash scripts/gate.sh\` 绿 → 直接返回 status=green（note="已闭环·跳过"）不重做。否则继续。
1. \`gh issue view ${uc.n} --comments\` 读四面锚点 + Angular 需求 + Blocked by（blocker 未绿先做 blocker 再回本 UC；blocker 已 CLOSED 视为绿可直接推进·别再标 blocked 退路）。
2. **若无** test/expect/uc-${uc.id}.expect.json + test/specs/uc-${uc.id}.e2e.mjs → 照 test/expect/uc-send-1.* 模板从冻结真源(helix 真机curl真源.md ① / projection-schema.md ②④)派生 author（契约只读·找不到 endpoint 标 ambiguity 别臆造）。
3. 接最简 Angular UI：按 angular-ui-plan 往 #46 骨架绑数据/加交互件（加法式·事件配方法 C007）。
4. **暖栈常驻**（别每轮 down/cold-boot·见 DISCIPLINE「暖栈」节）：\`bash scripts/harness.sh up\`（幂等·已健康则复用·不重起 ng+app）确保 1420+4445 常驻。**改了 Rust/Angular** → \`bash scripts/harness.sh reload-app\`（只重起 app·cargo run 增量~秒级 boot~30-60s·ng 不动；UC-4.1 用 \`reload-app --uc4.1\` 重置 cursor）。仅改 spec/expect/reducer → **不 reload·直接下一步**。
5. \`bash scripts/harness.sh spec ${uc.id}\`（暖跑·app 不重起·仅 wdio·~3s·默认 seeded db）。**红→改完机器件/壳后**：仅改 spec/expect/reducer 重跑 \`harness.sh spec ${uc.id}\`（秒级内循环）；改了 Rust/Angular 先 \`harness.sh reload-app\` 再 \`spec\`。
6. 四面 reducer：**绿**→翻 docs/uc-coverage-ledger.md ✅ + 勾 docs/uc-rollout/rollout-checklist.md + \`gh issue close ${uc.n} --comment "四面全绿 corr_key=..."\` + \`bash scripts/gate.sh\` + commit → status=green。**红**→§6.1 四段日志定位 + 套「契约 vs 环境决策范式」**自决修到绿**(改环境/机器件/helix 实现·迭代复跑)。**禁 blocked/yellow 退路**——只有确凿 server-side 数据 gap(带 run.jsonl 证据)才 yellow，其余必修到四面真绿。覆盖核对：本 UC 的 HTTP/WS 都在 spec 里被实跑覆盖(对 coverage-crossmap.md)。
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
0. **复跑 #7(UC-4.1) 自愈尝试**：现在 #8/#10 等数据生成类 UC 已在 server 造出真 channel+消息事件 → \`bash scripts/seed-behind-cursor.sh\`(或 run.sh 已内置)重置 cursor=0 + \`bash scripts/run.sh -- --spec test/specs/uc-4.1.e2e.mjs\` 复跑。若 ②④ 现有 increment 帧(reducer 四面绿) → 翻 ledger ✅ + 勾 checklist + \`gh issue close 7\` + commit。仍回空增量(cursor 跑后仍 0) → 维持 yellow(确凿 server gap·留 issue 开·带证据)。其余 yellow UC 同理各试一次复跑。
1. 核对 docs/uc-coverage-ledger.md 绿数 = checklist 勾数 = gh 关闭的 issue 数（C011 诚实出账·不一致则修正）。
2. **HTTP/WS 覆盖审计**：对 docs/uc-rollout/coverage-crossmap.md 逐条核——每个非排除的 HTTP/WS 是否都有一个**实跑过的绿 UC spec** 覆盖。列出任何未覆盖的 HTTP/WS（排除项 bot/5.6/5.7/7.x/4.3/🌙1.3/L2 不算）。有缺口则在 note 标明"覆盖缺口:[...]"供下一轮补。
3. \`bash scripts/gate.sh\` 须绿。
4. 写总终态行到 docs/harness/log.md：'✅ DONE/⚠️ PARTIAL UC rollout 阶段0-7 | commit 范围 | 绿N/黄M/blocked K | HTTP/WS 覆盖 X/Y | feat/uc-rollout'。
5. \`git log --oneline -1\` + \`git tag -l 'v0.1-phase*'\` 汇总。
返回 UC_RESULT（uc='FINAL'·status=green 若全绿且 HTTP/WS 全覆盖否则 yellow·note 写最终统计 + tag 列表 + 剩余黄清单 + 覆盖缺口）。`,
  { label: 'finalize', phase: 'Finalize', schema: UC_RESULT, effort: 'high' })

return {
  scaffold: scaffold && scaffold.status,
  total_uc: all.length,
  green: green.length, yellow: yellow.length, blocked: blocked.length,
  final: summary,
  per_uc: ok.map(r => ({ issue: r.issue, uc: r.uc, status: r.status, note: r.note })),
}

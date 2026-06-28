export const meta = {
  name: 'loop-engine',
  description: 'loop-Engine 真 autonomous run：把 scripts/loop-engine 的确定性内核接上真 agent 数据面，自驱 UC 到四面绿。args.mode=single(默认·挑1个UC做L3首证) | full(全 #7-#41)。args.uc 指定单UC。',
  phases: [
    { title: 'Bootstrap' },
    { title: 'Drive' },
    { title: 'Finalize' },
  ],
}

// ── 架构说明（重要）─────────────────────────────────────────────────────────
// Workflow 沙箱无 fs/import → 不能直接 import run.mjs。所以:
//   - 确定性大脑(route/readySet/controller/state-ledger)由 **agent 在 node 子进程里** import
//     scripts/loop-engine/*.mjs 调用(agent 有 fs)——单一真源不复制。
//   - 本脚本只做 async 编排 + budget 守卫(sync runEngine 无法 await agent·见 FLOW.md §0)。
// 即:run.mjs 的 runEngine 是 dry-run/测试参考；本 workflow 是真 async 编排器，复用其纯函数模块。

const REPO = '/Users/mac28/workspace/rustWorkspace/loopforge-tauri-im'
const LE = `${REPO}/scripts/loop-engine`
const EVENTS = `${REPO}/docs/loop-engine/events.jsonl`

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['phases'],
  properties: {
    phases: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['phase', 'waves'],
        properties: {
          phase: { type: 'number' },
          waves: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
        },
      },
    },
    note: { type: 'string' },
  },
}

const DRIVE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['issue', 'outcome', 'note'],
  properties: {
    issue: { type: 'number' },
    outcome: { type: 'string', enum: ['green', 'gap', 'park', 'flaky', 'failcap', 'error'] },
    faultRepo: { type: 'string' },           // loopforge | helix | cses-im-server | none
    fourFacet: { type: 'string' },           // ①②③④ 状态
    fixCommit: { type: 'string' },
    issueClosed: { type: 'boolean' },
    note: { type: 'string' },
  },
}

// 每个 drive agent 注入的纪律（控制面只读·数据面修复·守不变量）
const DISC = `
loop-Engine 数据面执行纪律:
- 仓库 ${REPO}。确定性决策**必须**调既有模块(别自己拍):
    路由:   node -e "import('${LE}/diagnosis-router.mjs').then(m=>console.log(JSON.stringify(m.route({brokenFacet},logFeatures))))"
    记事件: node -e "import('${LE}/state-ledger.mjs').then(m=>{...m.appendEvent})" 追加 ${EVENTS}
- 四面 oracle = run.sh + reducer(C009 绿由 reducer 裁定·禁自评):
    bash scripts/run.sh -- --spec test/specs/uc-<X>.e2e.mjs   (seeded db·C003)
- 红→三段日志(run-app.log/cses-im-server.log/run.jsonl)定位哪一仓(autonomous-runbook §6.1):
    ①出站/②投影/④落库 缺陷→helix 分支修+re-pin(可逆自决) · ③DOM 缺绑定→loopforge 改壳(守 C013)
    缺语义区→pencil MCP 设计→Angular 组件 · health 000→重启 cses-im-server(仅重启不改逻辑)
- 契约只读(C004):四面与冻结契约失配且后端默认对≥2UC→写契约变更提案 park,**不自改 oracle**
- 不可逆(合 helix main/删数据/对外)→park 写 NEEDS_HUMAN_*.md,不阻塞
- 提交在当前仓分支·中文 conventional·禁 merge main·禁 push
- 绿 = reducer 四面全绿才算;绿→append issue_green + gh issue close
`

phase('Bootstrap')
const mode = (args && args.mode) || 'single'
const targetUc = args && args.uc
const plan = await agent(`${DISC}
读引擎 dry-run 计划:在 ${REPO} 跑 \`node scripts/loop-engine/run.mjs --dry-run --from-gh\`。
解析输出,返回 phases[]（每 phase 的 number + 逐波 waves[][] issue 号）。`,
  { label: 'bootstrap:plan', schema: PLAN_SCHEMA })

// 把计划摊平成依赖序 issue 列表
let order = []
for (const p of (plan.phases || [])) for (const w of (p.waves || [])) for (const n of w) order.push({ n, phase: p.phase })

// single 模式:只取第一个(或指定 uc 对应的)issue 做 L3 首证
if (mode === 'single') {
  if (targetUc) {
    log(`single 模式·目标 UC=${targetUc}`)
    order = order.slice(0, 1) // bootstrap agent 已按依赖序;真选 UC 由 drive agent 按 targetUc 找
  } else {
    order = order.slice(0, 1)
  }
  log(`single 模式:只驱动 1 个 issue 做 L3 首证(#${order[0]?.n})`)
} else {
  log(`full 模式:依赖序驱动 ${order.length} 个 issue`)
}

phase('Drive')
const RESERVE = budget.total ? 0.15 : 0           // 预算储备阀(SPEC §8)
const failCount = new Map()
const results = []
let stopped = null

for (const { n, phase: ph } of order) {
  // 预算守卫(控制面·built-in budget)
  if (budget.total && budget.remaining() < budget.total * RESERVE) { stopped = 'budget'; log('⏹ 预算储备 <15% 停'); break }
  // 连败熔断(控制面·SPEC §8 failureCap=3)
  if ((failCount.get(n) || 0) >= 3) { log(`⏹ #${n} 连败 3 → park`); continue }

  const r = await agent(`${DISC}
驱动 issue #${n}(phase ${ph}${targetUc ? `·若本 issue 非 ${targetUc} 则按依赖序它是前置` : ''}):
1. \`gh issue view ${n}\` 读四面锚点 + UC 编号 + Blocked by
2. 接最简 UI / 实现(grill 接地·provenance·缺则查三仓代码+冻结契约,不臆造)
3. 跑 \`bash scripts/run.sh -- --spec test/specs/uc-<X>.e2e.mjs\` → reducer 四面裁决
4. 红→三段日志定位仓→调 route() 拿动作→按动作修(helix 分支/壳绑定/pencil/重启后端)→重跑
5. 四面全绿(reducer 裁定)→ append issue_green 到 ${EVENTS} + \`gh issue close ${n}\`
6. 修不动/不可逆→park 写 NEEDS_HUMAN_*.md(不阻塞)
返回 {issue:${n},outcome,faultRepo,fourFacet,fixCommit,issueClosed,note}。`,
    { label: `drive:#${n}`, phase: 'Drive', schema: DRIVE_SCHEMA })

  results.push(r)
  if (!r || r.outcome === 'error' || r.outcome === 'gap') failCount.set(n, (failCount.get(n) || 0) + 1)
  log(`#${n} → ${r?.outcome ?? 'null'}${r?.faultRepo ? ` @${r.faultRepo}` : ''}`)
}

phase('Finalize')
const fin = await agent(`${DISC}
收口:在 ${REPO}
1. 跑 \`node scripts/loop-engine/run.mjs --dry-run\` 确认调度仍合法
2. 用 state-ledger.renderStatus 刷新 docs/loop-engine/STATUS.md(读 ${EVENTS} 折叠)
3. 追加终态行到 ${EVENTS}(type:run_done) + docs/harness/log.md(✅/⚠️)
4. 汇总:本 run 绿/park/gap 各几个 + 哪些 issue 真关闭
5. 提交(scope loop-engine·中文)·禁 push
返回 {issue:0,outcome:'green',note:逐 issue 终态 + STATUS 摘要}。`,
  { label: 'finalize', schema: DRIVE_SCHEMA })

return {
  mode, planPhases: (plan.phases || []).length, driven: results.length,
  green: results.filter(r => r?.outcome === 'green').length,
  results, stopped, finalize: fin,
}

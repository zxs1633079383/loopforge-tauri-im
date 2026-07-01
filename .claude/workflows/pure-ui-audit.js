export const meta = {
  name: 'pure-ui-audit',
  description: '架构合规审计：本项目是否「纯 UI 渲染层 + 只读」——Tauri 薄壳只翻译入参+入泵转发 helix 指令·Angular 只读渲染投影字段→DOM·业务(落库/出站HTTP/echo对账/计算)全在 helix-im·壳与前端不自干业务。并行多维 review 所有 rollout commit + 代码 → 合成裁定 + 列违反 file:line。',
  phases: [
    { title: 'Audit-dimensions' },
    { title: 'Verdict' },
  ],
}

const REPO = '/Users/mac28/workspace/rustWorkspace/loopforge-tauri-im'

const FINDINGS = {
  type: 'object', additionalProperties: false,
  required: ['dimension', 'conforms', 'violations', 'summary'],
  properties: {
    dimension: { type: 'string' },
    conforms: { type: 'boolean', description: '该维度是否合规(纯 UI 渲染/只读·业务在 helix)' },
    violations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['file_line', 'what', 'severity'],
        properties: {
          file_line: { type: 'string', description: 'file:line 精确定位' },
          what: { type: 'string', description: '违反了什么(壳/前端干了业务)' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
      },
    },
    summary: { type: 'string', description: '一句话该维度结论' },
  },
}

const CRITERIA = `
# 审计标准：本项目是否「纯 UI 渲染层 + 只读」(根 CLAUDE.md §1 三层架构 + §2 五不变量 + src-tauri/CLAUDE.md 薄壳纪律)
cwd=${REPO}·分支 feat/uc-rollout。**只读审计·禁改任何代码**(不 Edit/Write 仓内代码·只 Read/Grep/git)。

## 合规定义(三层架构铁律)
1. **helix 引擎零改**：helix-core/helix-im/helix-driver-native 是 path dep/git 只读消费·本仓零改。业务真源(落库/出站 HTTP/echo 对账/序号/cursor)全在 helix-im·本仓不复制不实现。
2. **Tauri 薄壳(src-tauri)**：#[tauri::command] 只「翻译入参(camel→snake AppCommand) + 入泵」+ tee helix 投影到 app.emit。**禁**：壳内自己落库 / 构造出站 HTTP body / echo 对账 / 算业务态 / 维护业务状态机。engine.rs 只装配 ports + 身份头 + bus→emit 桥 + 就绪 probe。
3. **Angular 前端(src/app)只读渲染**：组件只把 im:__bus__ 投影事件的字段**直映** DOM data-*(message-row 等)·不追组件/像素保真。**禁**：前端算 readBits / 本地落库 / 客户端业务计算 / 改投影语义 / 自维护业务真值(投影来什么渲什么)。允许：纯 UI 态(展开/选中/输入框)、把 invoke 入参拼好发给壳。
4. **唯一新缝 = port 装饰器**(helix-driver-instrument)：Recording 装饰 Transport/EventSink/Storage 只做日志/录放·不改业务。

## 违反判据(找这些)
- 壳/前端出现 SQL/落库/upsert/出站 HTTP fetch 业务请求构造/序号分配/cursor 推进/已读位计算/echo 对账逻辑。
- 前端把投影字段「再加工」成业务真值(而非直映)·或前端维护一份业务状态(而非投影驱动)。
- helix 仓被改(Cargo.toml 出现 path dep 指向 helix 且改了 helix 源·或 helix 仓有未提交改动)。
- 注意区分：**测试夹具**(test/specs/*, scripts/l2-*.sh, scripts/harness.sh, test/reducer/*)**不算 app 业务**——它们是验证机器件·act-as-678 HTTP 是测试驱动非 app 运行时。审计聚焦 **app 运行时代码**(src-tauri/src/** + src/app/**)。
`

phase('Audit-dimensions')
const DIMS = [
  { key: 'tauri-shell', label: 'Tauri 薄壳(src-tauri)',
    scope: 'src-tauri/src/**(尤其 commands.rs / engine.rs / lib.rs / state.rs)。审：每个 #[tauri::command] 是否只翻译入参+入泵(入 AppCommand 给 helix)·有无壳内业务(落库/构造出站 body/对账/算业务态)。engine.rs 是否只装配+bus→emit 桥。rollout 新增的命令(im_create_channel/im_urgent_post/im_make_topic/im_read_channel/im_members_by_ids/...)有没有破薄壳。' },
  { key: 'angular-frontend', label: 'Angular 前端只读渲染(src/app)',
    scope: 'src/app/**(尤其 im-store.service.ts / app.component.ts / message-row 模型 / 各 apply* 方法)。审：是否只把 im:__bus__ 投影字段直映 DOM data-*·有无前端业务计算(算 readBits/本地落库/客户端维护业务真值/再加工投影成业务态)。apply* 方法是否纯「投影→store→DOM」搬运。' },
  { key: 'helix-boundary', label: 'helix 零改边界 + 业务归属',
    scope: 'src-tauri/Cargo.toml(helix 依赖是 git rev 还是 path? 有无改 helix)·helix workspace /System/Volumes/Data/workspace/rust/helix(git status 有无未提交改动·git log 近期有无本仓引发的 helix 改)·crates/helix-driver-instrument(是否只读仪表 Recording 装饰·不掺业务)。确认业务(落库/出站/对账)在 helix-im 不在本仓。' },
  { key: 'rollout-commits', label: 'Rollout commit 审计(防业务渗入)',
    scope: 'git log --stat v0.1-basic..HEAD(29+ UC commit)。逐个 feat(uc-*) commit 看 diff 触碰的 src-tauri/src + src/app 是否守薄壳·有没有哪个 UC 为了过四面把业务塞进壳/前端。重点 5.1建群/1.9加急/3.1已读/6.1拉人 这类有出站+落库的 UC。' },
]

const findings = await parallel(DIMS.map(d => () =>
  agent(`${CRITERIA}

## 本审计维度：${d.label}
范围：${d.scope}

逐项 Read/Grep/git 核查·对照上方「合规定义」+「违反判据」。**只读·禁改代码**。
返回 FINDINGS：conforms(该维度纯 UI 渲染/只读是否成立)·violations[](每条 file:line + what + severity·没有则空数组)·summary。`,
    { label: `audit:${d.key}`, phase: 'Audit-dimensions', schema: FINDINGS, effort: 'high' })
))

phase('Verdict')
const real = findings.filter(Boolean)
const verdict = await agent(`${CRITERIA}

## 本任务：合成最终裁定——本项目是不是「纯 UI 渲染层 + 只读」?
四维审计结果(JSON)：
${JSON.stringify(real, null, 2)}

1. 综合裁定：本项目**是否**纯 UI 渲染层(Tauri 薄壳只转发 helix 指令 + Angular 只读渲染投影 + 业务全在 helix·壳与前端不自干业务)?给明确 YES/NO/PARTIAL。
2. 列出**所有违反**(去重·按 severity 排序·每条 file:line + 一句话)·若无违反明确说"零违反"。
3. 若 PARTIAL/NO：哪些是真业务渗入(critical/high)·哪些是可接受的边界(如壳拼身份头 teamId/userId 取自 profile 单一真源·属装配非业务)。
4. 写一份审计报告到 docs/architecture-review/pure-ui-audit-<标记今天>.md(本工作树·可写此文档)·含裁定 + 违反清单 + 证据。
返回 FINDINGS(dimension='VERDICT'·conforms=最终裁定·violations=合并去重清单·summary=YES/NO/PARTIAL + 一句话总评)。`,
  { label: 'verdict', phase: 'Verdict', schema: FINDINGS, effort: 'high' })

return {
  per_dimension: real.map(f => ({ dim: f.dimension, conforms: f.conforms, violations: f.violations.length, summary: f.summary })),
  verdict: verdict && verdict.summary,
  conforms: verdict && verdict.conforms,
  total_violations: real.reduce((n, f) => n + f.violations.length, 0),
  all_violations: real.flatMap(f => f.violations),
}

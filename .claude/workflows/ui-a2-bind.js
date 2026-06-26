export const meta = {
  name: 'ui-a2-bind',
  description: 'A2 解锁批：对 Conductor 传入的已 HELIX_READY 渲染路径行，把 A1 的 HTML 翻成 Angular 组件 + 真 Router tab + 绑 render-ready 投影 + 删本仓该行壳 shaping + 改旧 spec(url 跳转) + 补新 spec → 四面 reducer 裁绿 → 追加 BOUND_GREEN.log。codegen 并行 / spec 串行（共享暖栈）。',
  phases: [
    { title: 'Bind' },     // 并行：HTML→组件 + 真 Router + 绑 render-ready + 删 shaping
    { title: 'Verify' },   // 串行：harness.sh spec 四面 reducer 裁绿（暖栈不重起 app）
  ],
}

// Conductor 传入：args = { rows: ['applyDialogList', 'applyMessageItem', ...] }（已 HELIX_READY）
const rows = (args && args.rows) || []

const DISCIPLINE = `
A2 纪律（docs/orchestration/README.md §4 文件所有权 + design/README.md）：
- 只能改 src/app/** + test/specs/** + test/expect/**。禁碰 Cargo.toml/Cargo.lock/helix（那是 B 的）。
- 启动先 git merge main（拉 B 的 re-pin·该行 render-ready 字段已在 main）。
- tab=7 屏功能区·真 Angular Router（填 routes=[]）·URL-addressable 利于 wdio url() 定位。
- 绑定 = [attr.data-*]="投影字段"·1:1·禁壳内 shaping（C013 纯渲染壳·第二北极星）。
- 绑该行同时删本仓对应 apply* 的壳 shaping 段（HELIX_READY→BOUND_GREEN）。
- 模板加任何 (event) 必同步加组件方法（否则 ng serve 挂·harness C007）。
- 发现 helix 没吐需要的字段 → 追加 docs/migration/NEED_HELIX.log 反向给 B·不阻塞自己（mock 占位继续）。
`

const VERIFY = `
验证纪律（warm-stack 铁律）：
- 批量铺多行禁 per-row 的 cargo check→reload-app→spec 循环。正确编排：
  ① 一次性实现全部行的组件/路由/绑定（中途禁 cargo check·靠类型自审）
  ② 单次 cargo check + 单次 harness.sh reload-app
  ③ 串行跑各行 spec：bash scripts/harness.sh spec <uc>（~3s·app 不重起）
- 四面绿由独立 reducer 裁定（C009·禁自产自判）。改旧 spec=先 url() 跳到对应 tab/route 再断言 data-*。
`

const ROW_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['row', 'bound', 'shaping_deleted', 'spec_green', 'note'],
  properties: {
    row: { type: 'string', description: 'apply* 渲染路径名' },
    bound: { type: 'boolean' },
    shaping_deleted: { type: 'boolean', description: '本仓该行壳 shaping 是否已删' },
    forbidden_grep_zero: { type: 'boolean', description: '该行禁区 grep 是否归零' },
    spec_green: { type: 'boolean', description: '四面 reducer 是否裁绿' },
    need_helix: { type: 'array', items: { type: 'string' }, description: '反向给 B 的缺口（写 NEED_HELIX.log）' },
    note: { type: 'string' },
  },
}

if (!rows.length) return { rows: [], note: 'no unlocked rows passed' }

// Bind 阶段并行（codegen 各行独立·都在同一 worktree 同一 branch）：
const bound = await parallel(rows.map((row) => () =>
  agent(`${DISCIPLINE}\n绑定渲染路径行 ${row}：把 A1 对应屏 HTML 翻成 Angular 组件 + 接真 Router route + [attr.data-*] 绑 helix 新吐的 render-ready 字段 + 删本仓 ${row} 壳 shaping 段。返回结果。`,
    { label: `bind:${row}`, phase: 'Bind' }).then((r) => ({ row, bind: r }))
))

// Verify 阶段串行（共享暖栈·spec 不能并行）：单次 check+reload 后逐行 spec。
const verifyAgent = await agent(`${VERIFY}\n对刚绑定的行 ${rows.join(', ')}：单次 cargo check + 单次 harness.sh reload-app，然后串行跑各行对应 UC spec（bash scripts/harness.sh spec <uc>），四面 reducer 裁绿。逐行返回 {row, bound, shaping_deleted, forbidden_grep_zero, spec_green, need_helix, note}。绿的追加 docs/migration/BOUND_GREEN.log，缺口追加 docs/migration/NEED_HELIX.log。`,
  { label: `verify:${rows.length}rows`, phase: 'Verify',
    schema: { type: 'object', additionalProperties: false, required: ['rows'],
      properties: { rows: { type: 'array', items: ROW_RESULT } } } })

return { bound: bound.filter(Boolean), verify: verifyAgent }

// events-consistency.mjs — events.jsonl ↔ open gap issue 一致性自检（loop-engine LE-7）
//
// SPEC §5/§8：机器真相 = docs/loop-engine/events.jsonl（append-only 事件日志）。
// 每个 gap_emit 事件代表「发现一个 gap → 开了一个 issue」。该 issue 应仍 open，
// 否则就是「悬挂 sig」：events.jsonl 声称有未闭合的 gap，但 issue 已被关掉/不存在，
// 两侧不再一致（gap-ledger 与 issue tracker 漂移）。
//
// 本模块是**纯函数**（无 IO），便于 node:test 断言；CLI 入口在文件末尾按需读盘 + 调 gh。
// 控制面禁触（SPEC §8）：本模块只读 events.jsonl，绝不就地改它。

/**
 * 解析 JSONL 文本为事件对象数组。
 * 跳过空行/纯空白行；遇到坏 JSON 收集到 errors，不静默吞（C008 可证伪）。
 * @param {string} text
 * @returns {{events: object[], errors: {line: number, raw: string, message: string}[]}}
 */
export function parseEvents(text) {
  const events = [];
  const errors = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    try {
      events.push(JSON.parse(raw));
    } catch (e) {
      errors.push({ line: i + 1, raw, message: e.message });
    }
  }
  return { events, errors };
}

/**
 * 从事件数组挑出 gap_emit 事件，归一为 {sig, issue, kind} 列表。
 * @param {object[]} events
 * @returns {{sig: any, issue: any, kind: any}[]}
 */
export function collectGapEmits(events) {
  return events
    .filter((e) => e && e.type === 'gap_emit')
    .map((e) => ({ sig: e.sig, issue: e.issue, kind: e.kind }));
}

/**
 * 一致性裁定。纯函数。
 *
 * @param {object} input
 * @param {string} input.eventsText      events.jsonl 全文
 * @param {number[]|null} input.openIssues  当前 open issue 号集合；null = 跳过 open 交叉校验（离线/无 gh）
 * @returns {{
 *   ok: boolean,
 *   gapCount: number,
 *   structural: {sig: any, issue: any, reason: string}[],   // gap_emit 缺 sig/issue 等结构错
 *   dangling: {sig: any, issue: number}[],                  // issue 不在 openIssues 中（悬挂）
 *   parseErrors: {line: number, raw: string, message: string}[],
 *   crossChecked: boolean                                   // 是否做了 open 交叉校验
 * }}
 */
export function checkConsistency({ eventsText, openIssues = null }) {
  const { events, errors: parseErrors } = parseEvents(eventsText);
  const gaps = collectGapEmits(events);

  const structural = [];
  for (const g of gaps) {
    if (g.sig === undefined || g.sig === null || g.sig === '') {
      structural.push({ sig: g.sig, issue: g.issue, reason: 'gap_emit 缺 sig' });
      continue;
    }
    if (g.issue === undefined || g.issue === null || !Number.isInteger(g.issue)) {
      structural.push({ sig: g.sig, issue: g.issue, reason: 'gap_emit 缺合法 issue 号' });
    }
  }

  const dangling = [];
  const crossChecked = Array.isArray(openIssues);
  if (crossChecked) {
    const openSet = new Set(openIssues);
    for (const g of gaps) {
      if (!Number.isInteger(g.issue)) continue; // 结构错已单独记
      if (!openSet.has(g.issue)) {
        dangling.push({ sig: g.sig, issue: g.issue });
      }
    }
  }

  const ok = parseErrors.length === 0 && structural.length === 0 && dangling.length === 0;
  return { ok, gapCount: gaps.length, structural, dangling, parseErrors, crossChecked };
}

// ── CLI 入口（被 gate.sh 调用）─────────────────────────────────────────────
// 用法：node events-consistency.mjs <events.jsonl 路径>
// 退出码：0 = 一致；非 0 = 有悬挂 sig / 结构错 / 坏 JSON。
// gh 不可用/无网 → 降级为只做结构 + JSON 校验（不当作失败），打印降级说明。
async function main(argv) {
  const fs = await import('node:fs');
  const path = argv[2];
  if (!path) {
    console.error('用法: node events-consistency.mjs <events.jsonl 路径>');
    return 2;
  }
  if (!fs.existsSync(path)) {
    console.log(`  ⏭ ${path} 不存在 — 跳过（尚无 loop-engine run）`);
    return 0;
  }
  const eventsText = fs.readFileSync(path, 'utf8');

  // 尝试用 gh 拉 open issue 集合；任何失败（无 gh / 无网 / 非仓）→ openIssues=null
  let openIssues = null;
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(
      'gh',
      ['issue', 'list', '--state', 'open', '--limit', '500', '--json', 'number'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const arr = JSON.parse(out);
    openIssues = arr.map((x) => x.number).filter(Number.isInteger);
  } catch {
    openIssues = null;
  }

  const r = checkConsistency({ eventsText, openIssues });

  if (r.parseErrors.length) {
    for (const e of r.parseErrors) console.error(`  ❌ events.jsonl L${e.line} 坏 JSON: ${e.message}`);
  }
  if (r.structural.length) {
    for (const s of r.structural) console.error(`  ❌ 结构错 sig=${s.sig} issue=${s.issue}: ${s.reason}`);
  }
  if (r.crossChecked) {
    if (r.dangling.length) {
      for (const d of r.dangling) console.error(`  ❌ 悬挂 sig=${d.sig} → issue #${d.issue} 非 open`);
    }
  } else {
    console.log('  ⏭ gh 不可用/无网 — 仅做结构 + JSON 校验（跳过 open 交叉校验）');
  }

  if (r.ok) {
    console.log(`  ✅ events.jsonl 一致（${r.gapCount} gap_emit${r.crossChecked ? '·全部 open' : '·结构 OK'}）`);
    return 0;
  }
  return 1;
}

// 仅在被直接执行时跑 CLI（被 import 时不触发）
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv).then((code) => process.exit(code));
}

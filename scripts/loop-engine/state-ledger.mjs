// state-ledger.mjs — loop-engine 状态账本（深模块 LE-1·SPEC §5/§10）
//
// 机器真相 = docs/loop-engine/events.jsonl（append-only 事件日志，不就地改）。
// 任何人读快照都由日志折叠算出（永不失配·同构「事件流单调 cursor」）。
//
// 本模块导出 3 个核心纯函数 + 配套：
//   appendEvent(events, event)  追加一个事件 → 返回**新数组**（append-only·不就地改）
//   foldState(events[])         折叠事件流 → 快照（幂等：同 events 两次 fold 结果相同）
//   renderStatus(state)         快照 → STATUS.md 文本（终态行 + pattern 趋势）
//
// 控制面禁触（SPEC §8）：本模块从不就地改 events.jsonl，写盘只用 'a'（append）flag。
// C008 可证伪：写入侧（appendEvent/serializeEvent）遇未知事件类型即抛；
//             读取侧（foldState）对历史日志容错，把未知/坏事件收集到 state.unknown，不静默吞。

// ── 事件类型全集（SPEC §5）──────────────────────────────────────────────────
export const EVENT_TYPES = Object.freeze([
  'issue_ready', // {issue, phase, blockers[]}      — issue 入就绪前沿
  'issue_green', // {issue, corr_key, facets}        — 四面绿，issue 收口
  'gap_emit', // {sig, issue, kind}               — 发现 gap → 开新 issue
  'assumption', // {issue, decision, provenance, reversible} — 可逆自决记账
  'parked', // {issue, reason, need}            — 需人决策，挂起
  'quarantine', // {sig, regen}                    — 同 sig 反复复燃，隔离
  'fix', // {repo, branch, issue, facet}     — 一次修复落地
  'metrics', // {pass, regen_rate, convergence_min, pattern_count}
  'phase_tag', // {phase, tag}                     — phase 全绿，打 tag（barrier）
]);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

// 控制面硬包络默认值（SPEC §3/§8：N∈[2,5]）。引擎自调有界，越界即夹回。
export const DEFAULT_GAIN_ENVELOPE = Object.freeze({ N: 3, K: 3, Nmin: 2, Nmax: 5 });

/**
 * 该字符串是否合法事件类型。
 * @param {unknown} type
 * @returns {boolean}
 */
export function isKnownEventType(type) {
  return EVENT_TYPE_SET.has(type);
}

/**
 * 把一个事件对象序列化为一行 JSONL（写盘前的规范形态）。
 * 未知事件类型即抛（C008 可证伪：写入侧不放过坏事件）。
 * @param {object} event
 * @returns {string}
 */
export function serializeEvent(event) {
  if (!event || typeof event !== 'object') throw new TypeError('event 必须是对象');
  if (!EVENT_TYPE_SET.has(event.type)) {
    throw new Error(`未知事件类型: ${JSON.stringify(event.type)}（合法集 ${EVENT_TYPES.join('/')}）`);
  }
  return JSON.stringify(event);
}

/**
 * 追加一个事件（append-only）。**返回新数组，绝不就地改** `events` 或 `event`。
 * 缺 ts 时补一个时间戳（可注入 now 以便确定性测试）。
 *
 * @param {object[]} events     现有事件数组
 * @param {object} event        待追加事件
 * @param {{now?: () => string}} [opts]  now() 返回 ts 字符串（默认 ISO 时间）
 * @returns {object[]} 新数组 = [...events, 规范化后的 event]
 */
export function appendEvent(events, event, { now } = {}) {
  if (!Array.isArray(events)) throw new TypeError('events 必须是数组');
  if (!event || typeof event !== 'object') throw new TypeError('event 必须是对象');
  if (!EVENT_TYPE_SET.has(event.type)) {
    throw new Error(`未知事件类型: ${JSON.stringify(event.type)}（合法集 ${EVENT_TYPES.join('/')}）`);
  }
  // 始终造新对象 → 不就地改 caller 的 event
  const normalized = { ...event };
  if (normalized.ts === undefined || normalized.ts === null || normalized.ts === '') {
    normalized.ts = now ? now() : new Date().toISOString();
  }
  // 始终造新数组 → 不就地改 caller 的 events
  return [...events, normalized];
}

/**
 * 折叠事件流为快照（STATE_SCHEMA·SPEC §10）。**纯函数 + 幂等**：
 * 从空白逐事件重建，不读外部状态、不就地改入参 → 同 events 两次 fold 必相同。
 *
 * @param {object[]} events
 * @param {{gainEnvelope?: object}} [opts]  覆盖默认硬包络（控制面注入）
 * @returns {{
 *   phasesRemaining: number[],
 *   issues: {n:number, phase:(number|null), blockers:number[], state:string}[],
 *   gapLedger: {sig:any, issue:any, state:string, regen:number, kind:any}[],
 *   metrics: {pass:number, regen_rate:any, convergence_min:any, pattern_count:any},
 *   gainEnvelope: {N:number, K:number, Nmin:number, Nmax:number},
 *   logCursor: number,
 *   patternTrend: number[],
 *   tags: {phase:any, tag:any}[],
 *   assumptions: object[],
 *   fixes: object[],
 *   unknown: object[]
 * }}
 */
export function foldState(events, { gainEnvelope } = {}) {
  if (!Array.isArray(events)) throw new TypeError('events 必须是数组');

  const issues = new Map(); // n -> {n, phase, blockers, state, ...}
  const gaps = new Map(); // sig -> {sig, issue, state, regen, kind}
  const taggedPhases = new Set();
  const seenPhases = new Set();
  const tags = [];
  const assumptions = [];
  const fixes = [];
  const patternTrend = [];
  const unknown = [];
  let metrics = null;
  let lastRecommendation = null;

  const ensureIssue = (n) => {
    if (!Number.isInteger(n)) return null;
    if (!issues.has(n)) issues.set(n, { n, phase: null, blockers: [], state: 'unknown' });
    return issues.get(n);
  };

  for (const e of events) {
    if (!e || typeof e !== 'object' || !EVENT_TYPE_SET.has(e.type)) {
      unknown.push(e);
      continue;
    }
    switch (e.type) {
      case 'issue_ready': {
        const it = ensureIssue(e.issue);
        if (it) {
          it.state = 'ready';
          if (e.phase !== undefined && e.phase !== null) it.phase = e.phase;
          if (Array.isArray(e.blockers)) it.blockers = [...e.blockers];
        }
        if (e.phase !== undefined && e.phase !== null) seenPhases.add(e.phase);
        break;
      }
      case 'issue_green': {
        const it = ensureIssue(e.issue);
        if (it) it.state = 'green';
        break;
      }
      case 'parked': {
        const it = ensureIssue(e.issue);
        if (it) {
          it.state = 'parked';
          it.parkReason = e.reason;
          it.need = e.need;
        }
        break;
      }
      case 'gap_emit': {
        ensureIssue(e.issue);
        if (e.sig !== undefined && e.sig !== null && e.sig !== '') {
          // 同 sig 复 emit → 覆盖为最新（保留已有 regen，避免被重置）
          const prev = gaps.get(e.sig);
          gaps.set(e.sig, {
            sig: e.sig,
            issue: e.issue,
            state: prev && prev.state === 'quarantine' ? 'quarantine' : 'open',
            regen: prev ? prev.regen : 0,
            kind: e.kind,
          });
        }
        break;
      }
      case 'quarantine': {
        const prev = gaps.get(e.sig);
        const g = prev || { sig: e.sig, issue: null, kind: null, regen: 0 };
        g.state = 'quarantine';
        if (Number.isInteger(e.regen)) g.regen = e.regen;
        gaps.set(e.sig, g);
        break;
      }
      case 'assumption': {
        assumptions.push({
          issue: e.issue,
          decision: e.decision,
          provenance: e.provenance,
          reversible: e.reversible,
        });
        break;
      }
      case 'fix': {
        fixes.push({ repo: e.repo, branch: e.branch, issue: e.issue, facet: e.facet });
        break;
      }
      case 'metrics': {
        metrics = {
          pass: Number.isInteger(e.pass) ? e.pass : 0,
          regen_rate: e.regen_rate ?? null,
          convergence_min: e.convergence_min ?? null,
          pattern_count: e.pattern_count ?? null,
        };
        if (Number.isInteger(e.pattern_count)) patternTrend.push(e.pattern_count);
        if (e.recommendation && typeof e.recommendation === 'object') {
          lastRecommendation = e.recommendation;
        }
        break;
      }
      case 'phase_tag': {
        if (e.phase !== undefined && e.phase !== null) {
          taggedPhases.add(e.phase);
          seenPhases.add(e.phase);
        }
        tags.push({ phase: e.phase, tag: e.tag });
        break;
      }
      default:
        unknown.push(e);
        break;
    }
  }

  // 待办 phases = 见过的 phase 减去已打 tag 的（barrier 收口的）
  const phasesRemaining = [...seenPhases]
    .filter((p) => !taggedPhases.has(p))
    .sort((a, b) => a - b);

  // 硬包络：默认 ∪ 控制面覆盖；再按最后一次 metrics recommendation 在界内夹取
  const env = { ...DEFAULT_GAIN_ENVELOPE, ...(gainEnvelope || {}) };
  const out = { N: env.N, K: env.K, Nmin: env.Nmin, Nmax: env.Nmax };
  if (lastRecommendation) {
    if (Number.isInteger(lastRecommendation.N)) {
      out.N = Math.min(out.Nmax, Math.max(out.Nmin, lastRecommendation.N));
    }
    if (Number.isInteger(lastRecommendation.K)) out.K = lastRecommendation.K;
  }

  return {
    phasesRemaining,
    issues: [...issues.values()],
    gapLedger: [...gaps.values()],
    metrics: metrics || { pass: 0, regen_rate: null, convergence_min: null, pattern_count: null },
    gainEnvelope: out,
    logCursor: events.length,
    patternTrend,
    tags,
    assumptions,
    fixes,
    unknown,
  };
}

/**
 * 渲染重复 pattern 趋势串（meta-DoD §8：pattern 数应单调下降）。
 * @param {number[]} trend
 * @returns {{text: string, rising: boolean}}
 */
export function renderPatternTrend(trend) {
  if (!Array.isArray(trend) || trend.length === 0) return { text: '（无 metrics）', rising: false };
  const seq = trend.join(' → ');
  if (trend.length < 2) return { text: seq, rising: false };
  const first = trend[0];
  const last = trend[trend.length - 1];
  const dir = last < first ? '↓' : last > first ? '↑' : '→';
  return { text: `${seq} (${dir})`, rising: last > first };
}

/**
 * 快照 → STATUS.md 文本（人读视图·每 pass 重生成）。纯函数·可随时由 events.jsonl 重建。
 * 含：终态行（✅ N 绿/M park/K quarantine + pattern 趋势）+ resume manifest + 明细表。
 * @param {object} state  foldState 的返回
 * @returns {string}
 */
export function renderStatus(state) {
  if (!state || typeof state !== 'object') throw new TypeError('state 必须是对象');
  const issues = Array.isArray(state.issues) ? state.issues : [];
  const gapLedger = Array.isArray(state.gapLedger) ? state.gapLedger : [];

  const greens = issues.filter((i) => i.state === 'green');
  const parked = issues.filter((i) => i.state === 'parked');
  const quarantined = gapLedger.filter((g) => g.state === 'quarantine');
  const openGaps = gapLedger.filter((g) => g.state === 'open');

  const trend = renderPatternTrend(state.patternTrend);
  const finalLine = `✅ ${greens.length} 绿 / ${parked.length} park / ${quarantined.length} quarantine · pattern 趋势 ${trend.text}`;

  const lines = [];
  lines.push('# loop-Engine — STATUS（人读快照）');
  lines.push('');
  lines.push(
    '> 由 `state-ledger.renderStatus` 从 `events.jsonl` 折叠重生成（SPEC §5）。'
  );
  lines.push('> 机器真相在 `events.jsonl`（append-only），本文件可随时由日志重建。');
  lines.push('');
  lines.push('## 终态行');
  lines.push('');
  lines.push(finalLine);
  if (trend.rising) {
    lines.push('');
    lines.push('⚠️ pattern 数上升 — 引擎可能失效（meta-DoD §8），需人审工作流。');
  }
  lines.push('');
  lines.push('## Resume manifest');
  lines.push('');
  lines.push(`- logCursor: ${state.logCursor ?? 0}`);
  lines.push(`- phasesRemaining: [${(state.phasesRemaining || []).join(', ')}]`);
  lines.push(
    `- gainEnvelope: N=${state.gainEnvelope?.N} K=${state.gainEnvelope?.K} (N∈[${state.gainEnvelope?.Nmin}, ${state.gainEnvelope?.Nmax}])`
  );
  const m = state.metrics || {};
  lines.push(
    `- metrics: pass=${m.pass ?? 0} regen_rate=${m.regen_rate ?? '—'} convergence_min=${m.convergence_min ?? '—'} pattern_count=${m.pattern_count ?? '—'}`
  );
  lines.push('');

  lines.push('## Issues');
  lines.push('');
  if (issues.length === 0) {
    lines.push('_（无 issue 事件）_');
  } else {
    lines.push('| issue | phase | state | blockers |');
    lines.push('|---|---|---|---|');
    for (const it of issues) {
      lines.push(
        `| #${it.n} | ${it.phase ?? '—'} | ${it.state} | ${(it.blockers || []).map((b) => '#' + b).join(' ') || '—'} |`
      );
    }
  }
  lines.push('');

  lines.push('## Gap ledger');
  lines.push('');
  if (gapLedger.length === 0) {
    lines.push('_（无 gap）_');
  } else {
    lines.push(`- open: ${openGaps.length} · quarantine: ${quarantined.length}`);
    lines.push('');
    lines.push('| sig | issue | state | regen | kind |');
    lines.push('|---|---|---|---|---|');
    for (const g of gapLedger) {
      lines.push(`| ${g.sig} | ${g.issue != null ? '#' + g.issue : '—'} | ${g.state} | ${g.regen} | ${g.kind ?? '—'} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ── IO 辅助（side-effect·真 append-only 写盘）───────────────────────────────
// 纯函数之外的薄壳：用 'a' flag 追加，绝不就地改既有内容（SPEC §8 控制面禁触）。

/**
 * 真追加一行事件到 events.jsonl（'a' flag·append-only）。返回写入的 JSONL 行。
 * @param {string} filePath
 * @param {object} event
 * @param {{now?: () => string}} [opts]
 * @returns {Promise<string>}
 */
export async function appendEventToFile(filePath, event, { now } = {}) {
  const fs = await import('node:fs');
  // 复用 appendEvent 的规范化 + 校验（保证写盘内容与内存账本一致）
  const [normalized] = appendEvent([], event, { now });
  const line = serializeEvent(normalized) + '\n';
  fs.appendFileSync(filePath, line, 'utf8'); // 'a' 语义：只追加，不就地改
  return line;
}

// ── CLI 入口（被 wind-down / gate 调用）────────────────────────────────────
// 用法：node state-ledger.mjs <events.jsonl 路径> [STATUS.md 输出路径]
//   省略输出路径 → 打印 STATUS 到 stdout；给出输出路径 → 写盘。
async function main(argv) {
  const fs = await import('node:fs');
  const eventsPath = argv[2];
  const outPath = argv[3];
  if (!eventsPath) {
    console.error('用法: node state-ledger.mjs <events.jsonl 路径> [STATUS.md 输出路径]');
    return 2;
  }
  let text = '';
  if (fs.existsSync(eventsPath)) text = fs.readFileSync(eventsPath, 'utf8');

  const events = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      events.push(JSON.parse(raw));
    } catch {
      events.push({ __bad__: raw }); // 坏行 → 进 unknown，不静默吞
    }
  }

  const state = foldState(events);
  const status = renderStatus(state);
  if (outPath) {
    fs.writeFileSync(outPath, status + '\n', 'utf8');
    console.log(`  ✅ STATUS 已重生成 → ${outPath}（logCursor=${state.logCursor}）`);
  } else {
    console.log(status);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv).then((code) => process.exit(code));
}

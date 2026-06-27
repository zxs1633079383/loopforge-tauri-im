// retrospector.mjs — 回路健康指标（loop-engine LE-9·SPEC §9 ② Retrospector / §10 RETRO_SCHEMA）
//
// 角色（SPEC §9 表 ②）：每 N issue → Retrospector agent 读 events.jsonl 指标 →
//   交给 Optimizer（③·JS 硬包络内调阈值）。本模块算四个指标 + 产 metrics 事件：
//     regen_rate       再生率 = 再生发射 / 总 gap 发射（churn·[0,1]·越低越好）
//     convergence_min  收敛分钟 = issue_ready→issue_green 的中位耗时（分钟·null=尚无绿）
//     override_freq    人工干预频率 = parked / (green + parked) 终态占比（[0,1]·越低越自治）
//     pattern_count    重复 pattern 数 = 反复再生的 distinct sig 数（meta-DoD §8：应单调下降）
//   并据此给 Optimizer 一个**硬包络内**的 recommendation:{N?,K?}。
//
// 真源依赖：事件 schema 见 SPEC §5 / state-ledger.mjs EVENT_TYPES；
//           硬包络默认见 state-ledger.DEFAULT_GAIN_ENVELOPE（N∈[Nmin,Nmax]）。
//
// 控制面禁触（SPEC §8）：本模块**只读** events，绝不就地改；指标计算全是无 IO 纯函数，
//   便于 node:test 真断言（C008 可证伪——破坏实现即 fail，无墙钟下界、无 tautology）。
//   IO（读盘 / append metrics 事件）收敛到文件末尾 CLI。

import { DEFAULT_GAIN_ENVELOPE, appendEventToFile } from './state-ledger.mjs';

// ── 默认整定阈值（Optimizer 决策用·控制面常量）──────────────────────────────
// 引擎自调有界（SPEC §3/§8）：高 churn / 高人工干预 → 升 N（更对抗）；低且自治顺 → 降 N（省开销）。
export const DEFAULT_THRESHOLDS = Object.freeze({
  regenHigh: 0.3, // regen_rate ≥ 此 → 收紧（升 N）
  regenLow: 0.05, // regen_rate ≤ 此 且 override 低 → 放松（降 N）
  overrideHigh: 0.25, // override_freq ≥ 此 → 收紧（升 N）
  overrideLow: 0.1, // override_freq < 此 才允许放松
});

/**
 * 四舍五入到 d 位小数（确定性·避免浮点尾噪污染断言）。
 * @param {number} n
 * @param {number} d
 * @returns {number}
 */
export function roundTo(n, d) {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/**
 * 中位数（升序取中；偶数取中间两数均值）。空数组 → null。纯函数。
 * @param {number[]} xs
 * @returns {number|null}
 */
export function median(xs) {
  if (!Array.isArray(xs) || xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 按 sig 折叠 gap 再生账（emit 次数 + quarantine.regen 取大者）。纯函数。
 * @param {object[]} events
 * @returns {Map<any, {emits:number, regen:number}>}
 */
function foldGapsBySig(events) {
  const bySig = new Map();
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'gap_emit') {
      if (e.sig === undefined || e.sig === null || e.sig === '') continue;
      const g = bySig.get(e.sig) || { emits: 0, regen: 0 };
      g.emits += 1;
      bySig.set(e.sig, g);
    } else if (e.type === 'quarantine') {
      if (e.sig === undefined || e.sig === null || e.sig === '') continue;
      const g = bySig.get(e.sig) || { emits: 0, regen: 0 };
      if (Number.isInteger(e.regen) && e.regen > g.regen) g.regen = e.regen;
      bySig.set(e.sig, g);
    }
  }
  // 每 sig 的有效再生 = max(emits-1, quarantine.regen)；recurring = regen>0
  for (const [, g] of bySig) {
    g.regen = Math.max(g.emits - 1, g.regen);
  }
  return bySig;
}

/**
 * 计算回路健康指标（核心·纯函数·无 IO）。
 *
 * @param {object[]} events  已解析的事件数组（append-only 日志折叠）
 * @param {{pass?: number}} [opts]  显式 pass 号；省略则 = 既有 metrics 事件数 + 1
 * @returns {{
 *   pass: number,
 *   regen_rate: number,
 *   convergence_min: (number|null),
 *   override_freq: number,
 *   pattern_count: number,
 *   breakdown: {
 *     totalGapEmits: number, totalRegens: number, distinctSigs: number, recurringSigs: number,
 *     greenIssues: number, parkedIssues: number, convergenceSamples: number[]
 *   }
 * }}
 */
export function computeMetrics(events, { pass } = {}) {
  if (!Array.isArray(events)) throw new TypeError('events 必须是数组');

  // ── regen_rate / pattern_count（按 sig）──
  const bySig = foldGapsBySig(events);
  let totalGapEmits = 0;
  let totalRegens = 0;
  let recurringSigs = 0;
  for (const [, g] of bySig) {
    totalGapEmits += g.emits;
    totalRegens += g.regen;
    if (g.regen > 0) recurringSigs += 1;
  }
  const distinctSigs = bySig.size;
  // churn 比：再生发射占总发射；quarantine 覆盖可能略超 → 上夹 1（[0,1] 守恒）
  const regen_rate =
    totalGapEmits > 0 ? roundTo(Math.min(1, totalRegens / totalGapEmits), 4) : 0;
  const pattern_count = recurringSigs;

  // ── convergence_min（issue_ready 最早 → issue_green 配对·中位耗时）──
  const firstReadyTs = new Map(); // issue -> 最早 ready 的 ms
  const greenIssueSet = new Set();
  const parkedIssueSet = new Set();
  const convergenceSamples = [];
  for (const e of events) {
    if (!e || typeof e !== 'object' || !Number.isInteger(e.issue)) continue;
    if (e.type === 'issue_ready') {
      const t = Date.parse(e.ts);
      if (Number.isFinite(t) && !firstReadyTs.has(e.issue)) firstReadyTs.set(e.issue, t);
    } else if (e.type === 'parked') {
      parkedIssueSet.add(e.issue);
    } else if (e.type === 'issue_green') {
      greenIssueSet.add(e.issue);
      const gt = Date.parse(e.ts);
      const rt = firstReadyTs.get(e.issue);
      if (Number.isFinite(gt) && Number.isFinite(rt) && gt >= rt) {
        convergenceSamples.push((gt - rt) / 60000); // ms → 分钟
      }
    }
  }
  const med = median(convergenceSamples);
  const convergence_min = med === null ? null : roundTo(med, 1);

  // ── override_freq（终态人工干预占比）──
  // 一个 issue 既绿又 parked（先 park 后白天回流转绿）按其最终绿计：从 parked 集剔除已绿的。
  for (const n of greenIssueSet) parkedIssueSet.delete(n);
  const greenIssues = greenIssueSet.size;
  const parkedIssues = parkedIssueSet.size;
  const denom = greenIssues + parkedIssues;
  const override_freq = denom > 0 ? roundTo(parkedIssues / denom, 4) : 0;

  // ── pass 号：显式优先，否则 = 既有 metrics 事件数 + 1 ──
  let resolvedPass;
  if (Number.isInteger(pass)) {
    resolvedPass = pass;
  } else {
    const priorMetrics = events.filter((e) => e && e.type === 'metrics').length;
    resolvedPass = priorMetrics + 1;
  }

  return {
    pass: resolvedPass,
    regen_rate,
    convergence_min,
    override_freq,
    pattern_count,
    breakdown: {
      totalGapEmits,
      totalRegens,
      distinctSigs,
      recurringSigs,
      greenIssues,
      parkedIssues,
      convergenceSamples,
    },
  };
}

/**
 * 取既有 metrics 事件中最后一条的 pattern_count（用于趋势比较·K 推荐）。
 * @param {object[]} events
 * @returns {number|null}
 */
export function lastPatternCount(events) {
  if (!Array.isArray(events)) return null;
  let last = null;
  for (const e of events) {
    if (e && e.type === 'metrics' && Number.isInteger(e.pattern_count)) last = e.pattern_count;
  }
  return last;
}

/**
 * 夹取到 [lo, hi]。
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Optimizer 建议（③·硬包络内调阈值·SPEC §9）。纯函数·有界（防元层震荡）。
 *
 * 规则：
 *  - 高 churn（regen_rate≥regenHigh）或高人工干预（override_freq≥overrideHigh）→ 升 N（更对抗·夹 Nmax）。
 *  - 低 churn 且低人工干预（regen_rate≤regenLow 且 override_freq<overrideLow）→ 降 N（省开销·夹 Nmin）。
 *  - pattern_count 较上一 pass 上升 → 降 K（更早 quarantine·防"修了又裂"无限再生），下限 2。
 *  - 只在与当前值**不同**时才放进 recommendation（true recommendation = 要改动）。
 *
 * @param {object} metrics  computeMetrics 的返回
 * @param {{gainEnvelope?: object, prevPatternCount?: (number|null), thresholds?: object}} [opts]
 * @returns {{N?: number, K?: number}}
 */
export function recommend(metrics, { gainEnvelope, prevPatternCount = null, thresholds } = {}) {
  const env = { ...DEFAULT_GAIN_ENVELOPE, ...(gainEnvelope || {}) };
  const th = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  const rec = {};

  const tighten = metrics.regen_rate >= th.regenHigh || metrics.override_freq >= th.overrideHigh;
  const relax =
    metrics.regen_rate <= th.regenLow && metrics.override_freq < th.overrideLow && !tighten;

  let N = env.N;
  if (tighten) N = clamp(env.N + 1, env.Nmin, env.Nmax);
  else if (relax) N = clamp(env.N - 1, env.Nmin, env.Nmax);
  if (N !== env.N) rec.N = N;

  if (Number.isInteger(prevPatternCount) && metrics.pattern_count > prevPatternCount) {
    const K = Math.max(2, env.K - 1);
    if (K !== env.K) rec.K = K;
  }

  return rec;
}

/**
 * 端到端：折叠 events → 产一个完整的 **metrics 事件对象**（可直接 append 进 events.jsonl）。
 * 纯函数（不写盘·ts 可注入以便确定性测试）。
 *
 * @param {object} input
 * @param {object[]} input.events
 * @param {number} [input.pass]
 * @param {object} [input.gainEnvelope]
 * @param {object} [input.thresholds]
 * @param {() => string} [input.now]   ts 来源（默认 ISO 当前时间）
 * @returns {{
 *   type: 'metrics', ts: string, pass: number,
 *   regen_rate: number, convergence_min: (number|null),
 *   override_freq: number, pattern_count: number,
 *   recommendation: {N?: number, K?: number}
 * }}
 */
export function retrospect({ events, pass, gainEnvelope, thresholds, now } = {}) {
  const m = computeMetrics(events, { pass });
  const prevPatternCount = lastPatternCount(events);
  const recommendation = recommend(m, { gainEnvelope, prevPatternCount, thresholds });
  return {
    type: 'metrics',
    ts: now ? now() : new Date().toISOString(),
    pass: m.pass,
    regen_rate: m.regen_rate,
    convergence_min: m.convergence_min,
    override_freq: m.override_freq,
    pattern_count: m.pattern_count,
    recommendation,
  };
}

// ── CLI 入口（被 Retrospector agent / 手动调用）─────────────────────────────
// 用法：node retrospector.mjs <events.jsonl 路径> [--append]
//   默认：把算出的 metrics 事件 JSON 打到 stdout（agent 自行决定是否 append）。
//   --append：以 append-only（'a' flag）追加该 metrics 事件到同一 events.jsonl（复用 state-ledger）。
async function main(argv) {
  const fs = await import('node:fs');
  const path = argv[2];
  const doAppend = argv.includes('--append');
  if (!path) {
    console.error('用法: node retrospector.mjs <events.jsonl 路径> [--append]');
    return 2;
  }
  if (!fs.existsSync(path)) {
    console.error(`  ❌ ${path} 不存在 — 无 events 可折叠`);
    return 2;
  }
  const text = fs.readFileSync(path, 'utf8');
  const events = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      events.push(JSON.parse(raw));
    } catch {
      events.push({ __bad__: raw }); // 坏行 → 进折叠时被跳过（不静默吞·与 state-ledger 一致）
    }
  }

  const ev = retrospect({ events });
  console.log(JSON.stringify(ev));

  if (doAppend) {
    await appendEventToFile(path, ev);
    console.error(`  ✅ metrics 事件已 append → ${path}（pass=${ev.pass}）`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv).then((code) => process.exit(code));
}

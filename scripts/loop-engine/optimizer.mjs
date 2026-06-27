// optimizer.mjs — 增益自调·硬包络（loop-engine LE-10·SPEC §9 ③ Optimizer / §3 / §8）
//
// 角色（SPEC §9 表 ③）：retro 后吃 metrics（RETRO_SCHEMA·含 recommendation）→ 在**硬包络内**
//   调阈值 N∈[Nmin,Nmax] / K∈[Kmin,Kmax]，产出新的 gainEnvelope。
//
// 与 LE-9 retrospector 的边界（避免重复）：
//   - LE-9 `recommend()` = **决策**（看指标该升 N 还是降 K，给出 delta recommendation）。
//   - LE-10 optimizer  = **执行 + 不变量护栏**：把任意 recommendation/任意（哪怕已损坏的）入参
//     envelope 收敛进硬包络。**核心不变量：任意输入 → 输出恒在包络内（越界被钳）**。
//
// 控制面禁触（SPEC §8 / §3 元护栏 / 元护栏「增益包络改 = HITL」）：
//   - optimizer **只调 N/K**（界内的旋钮），**绝不动包络边界本身** Nmin/Nmax/Kmin/Kmax。
//   - recommendation 里若夹带 Nmin/Nmax/Kmin/Kmax 等改界字段 → **一律忽略**（改界 = 人工·HITL）。
//   - 引擎自调有界（防元层震荡）：每 pass 至多 ±1 步（沿用 LE-9 recommend 的 ±1 决策），
//     再经本模块硬钳保证不越界。
//
// 纯函数 · 零 IO · 零副作用 · 不可变（不就地改入参 envelope）→ 便于 node:test 钉死边界（C008 可证伪）。

import { DEFAULT_GAIN_ENVELOPE } from './state-ledger.mjs';
import { recommend } from './retrospector.mjs';

// ── 硬包络默认边界（冻结·改界 = HITL）──────────────────────────────────────
// state-ledger.DEFAULT_GAIN_ENVELOPE 只带 Nmin/Nmax；K 的边界（issue #68：K∈[2,4]）在此补全。
export const DEFAULT_K_BOUNDS = Object.freeze({ Kmin: 2, Kmax: 4 });

// 完整硬包络默认（N/K 当前值 + 四条边界）。任何缺失字段回退到此。
export const DEFAULT_ENVELOPE = Object.freeze({
  ...DEFAULT_GAIN_ENVELOPE, // { N:3, K:3, Nmin:2, Nmax:5 }
  ...DEFAULT_K_BOUNDS, // { Kmin:2, Kmax:4 }
});

/** 仅这两个字段是 optimizer 可写的旋钮；其余（边界）只读（HITL）。 */
const TUNABLE_KEYS = Object.freeze(['N', 'K']);

/**
 * 取整 + 钳到 [lo, hi]。非有限数 / 非数 → 回退 fallback（已知界内的当前值），不产 NaN。
 * 这是「越界被钳」不变量的最底层执行点。
 * @param {*} v 候选值（可能越界 / 非整 / NaN / 非数）
 * @param {number} lo 下界（含）
 * @param {number} hi 上界（含）
 * @param {number} fallback v 不可用时的回退（调用方保证已在界内）
 * @returns {number} 整数·∈[lo,hi]
 */
export function clampInt(v, lo, hi, fallback) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 规整一个（可能不完整 / 已损坏 / 越界）的 envelope 到合法硬包络：
 *   - 缺失的边界 / N / K → 回退 DEFAULT_ENVELOPE。
 *   - 边界做基本健全化（Nmin≤Nmax / Kmin≤Kmax；倒置则回退默认界，**不**接受调用方拓宽/收窄到非法）。
 *   - 当前 N/K **强制钳进**边界 → 保证「任意输入 envelope 输出恒在界内」（哪怕入参 N=99）。
 * 不可变：返回全新对象，不改入参。
 * @param {object} [envelope]
 * @returns {{N:number, K:number, Nmin:number, Nmax:number, Kmin:number, Kmax:number}}
 */
export function normalizeEnvelope(envelope = {}) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('envelope 必须是对象');
  }
  const d = DEFAULT_ENVELOPE;

  // 边界：取入参整数边界，倒置 / 非整 → 回退默认（边界由控制面定，不信任损坏输入）。
  const intOr = (v, fb) => (typeof v === 'number' && Number.isInteger(v) ? v : fb);
  let Nmin = intOr(envelope.Nmin, d.Nmin);
  let Nmax = intOr(envelope.Nmax, d.Nmax);
  let Kmin = intOr(envelope.Kmin, d.Kmin);
  let Kmax = intOr(envelope.Kmax, d.Kmax);
  if (Nmin > Nmax) [Nmin, Nmax] = [d.Nmin, d.Nmax];
  if (Kmin > Kmax) [Kmin, Kmax] = [d.Kmin, d.Kmax];

  // 当前值：钳进界（fallback 用界内中点而非默认，避免默认值本身落在自定义界外）。
  const Nfb = Math.min(Nmax, Math.max(Nmin, intOr(d.N, Nmin)));
  const Kfb = Math.min(Kmax, Math.max(Kmin, intOr(d.K, Kmin)));
  const N = clampInt(envelope.N, Nmin, Nmax, Nfb);
  const K = clampInt(envelope.K, Kmin, Kmax, Kfb);

  return { N, K, Nmin, Nmax, Kmin, Kmax };
}

/**
 * 不变量谓词：envelope 的 N/K 是否都为整数且落在各自硬界内。
 * 测试与运行期断言共用（C008：破坏即可被此谓词照出）。
 * @param {object} env
 * @returns {boolean}
 */
export function isWithinEnvelope(env) {
  if (!env || typeof env !== 'object') return false;
  const { N, K, Nmin, Nmax, Kmin, Kmax } = env;
  return (
    Number.isInteger(N) &&
    Number.isInteger(K) &&
    Number.isInteger(Nmin) &&
    Number.isInteger(Nmax) &&
    Number.isInteger(Kmin) &&
    Number.isInteger(Kmax) &&
    N >= Nmin &&
    N <= Nmax &&
    K >= Kmin &&
    K <= Kmax
  );
}

/**
 * 把一个 recommendation（delta·只含 N?/K?）应用到 envelope，**强制钳进硬界**。
 *
 * HITL 护栏：
 *   - 只读 recommendation.N / recommendation.K（旋钮）；
 *   - **忽略** recommendation 里任何改界字段（Nmin/Nmax/Kmin/Kmax）—— 改界 = 人工。
 *   - 输出边界恒等于（规整后的）输入边界。
 *
 * 不可变：返回全新 envelope，不改入参。
 * @param {object} envelope 当前包络（可不完整 / 越界，内部先 normalize）
 * @param {{N?:number, K?:number}} [recommendation]
 * @returns {{
 *   envelope: {N:number,K:number,Nmin:number,Nmax:number,Kmin:number,Kmax:number},
 *   applied: {N?:number, K?:number},
 *   clamped: {N?:boolean, K?:boolean},
 *   changed: boolean
 * }}
 */
export function applyRecommendation(envelope, recommendation = {}) {
  const env = normalizeEnvelope(envelope);
  if (recommendation === null || typeof recommendation !== 'object' || Array.isArray(recommendation)) {
    throw new TypeError('recommendation 必须是对象');
  }

  const next = { ...env };
  const applied = {};
  const clamped = {};

  for (const key of TUNABLE_KEYS) {
    if (recommendation[key] === undefined) continue; // 无该旋钮建议 → 保持当前值
    const lo = key === 'N' ? env.Nmin : env.Kmin;
    const hi = key === 'N' ? env.Nmax : env.Kmax;
    const want = recommendation[key];
    const val = clampInt(want, lo, hi, env[key]);
    next[key] = val;
    applied[key] = val;
    // clamped = 建议值是有限数但与钳后结果不同（即真的越界被压回）。
    clamped[key] = typeof want === 'number' && Number.isFinite(want) && Math.round(want) !== val;
  }

  // HITL 终检：边界绝不被本函数改动。
  if (
    next.Nmin !== env.Nmin ||
    next.Nmax !== env.Nmax ||
    next.Kmin !== env.Kmin ||
    next.Kmax !== env.Kmax
  ) {
    throw new Error('不变量违反：optimizer 不得改动硬包络边界（改界 = HITL）');
  }
  if (!isWithinEnvelope(next)) {
    throw new Error('不变量违反：输出 envelope 越界（clampInt 失效）');
  }

  const changed = next.N !== env.N || next.K !== env.K;
  return { envelope: next, applied, clamped, changed };
}

/**
 * 端到端 Optimizer（③）：吃 metrics（RETRO_SCHEMA）→ 决策（复用 LE-9 recommend）→ 硬钳应用。
 *
 * 入参 metrics 支持两种来源：
 *   - 原始指标对象（regen_rate / override_freq / pattern_count …）→ 内部调 recommend() 出 delta。
 *   - 若 metrics 已带 `recommendation`（retrospector.retrospect 产物）且未显式关闭 → 也走 recommend
 *     重算（单一决策真源），但调用方可传 `useGivenRecommendation:true` 直接采用 metrics.recommendation。
 *
 * 核心保证（issue #68）：**无论 metrics / envelope / recommendation 怎样越界 / 损坏，
 *   返回 envelope 恒在硬包络内**；**绝不改包络边界**。
 *
 * @param {object} metrics computeMetrics / RETRO_SCHEMA 形态
 * @param {object} [opts]
 * @param {object} [opts.gainEnvelope] 当前包络（默认 DEFAULT_ENVELOPE）
 * @param {number|null} [opts.prevPatternCount] 上一 pass pattern_count（K 决策用）
 * @param {object} [opts.thresholds] 整定阈值（透传 recommend）
 * @param {boolean} [opts.useGivenRecommendation=false] 直接采用 metrics.recommendation 而非重算
 * @returns {{
 *   envelope: object, recommendation: {N?:number,K?:number},
 *   applied: object, clamped: object, changed: boolean, withinEnvelope: boolean
 * }}
 */
export function optimize(metrics, opts = {}) {
  if (metrics === null || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new TypeError('metrics 必须是对象');
  }
  const { gainEnvelope, prevPatternCount = null, thresholds, useGivenRecommendation = false } = opts;

  const env = normalizeEnvelope(gainEnvelope || DEFAULT_ENVELOPE);

  let recommendation;
  if (useGivenRecommendation && metrics.recommendation && typeof metrics.recommendation === 'object') {
    // 只取旋钮键，丢弃可能夹带的改界字段（HITL）。
    recommendation = {};
    for (const key of TUNABLE_KEYS) {
      if (metrics.recommendation[key] !== undefined) recommendation[key] = metrics.recommendation[key];
    }
  } else {
    recommendation = recommend(metrics, { gainEnvelope: env, prevPatternCount, thresholds });
  }

  const { envelope, applied, clamped, changed } = applyRecommendation(env, recommendation);
  return {
    envelope,
    recommendation,
    applied,
    clamped,
    changed,
    withinEnvelope: isWithinEnvelope(envelope),
  };
}

// ── CLI 入口（被 Optimizer 调用点 / 手动调用）─────────────────────────────
// 用法：node optimizer.mjs <events.jsonl 路径>
//   折叠 events → 取末条 metrics → optimize（采用其 recommendation）→ 打印新 envelope（JSON·只读不写盘）。
async function main(argv) {
  const fs = await import('node:fs');
  const path = argv[2];
  if (!path) {
    console.error('用法: node optimizer.mjs <events.jsonl 路径>');
    return 2;
  }
  if (!fs.existsSync(path)) {
    console.error(`  ❌ ${path} 不存在`);
    return 2;
  }
  const text = fs.readFileSync(path, 'utf8');
  const events = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      events.push(JSON.parse(raw));
    } catch {
      /* 坏行跳过（与 state-ledger 一致） */
    }
  }
  // 取末条 metrics 事件 + 其前一条的 pattern_count。
  const metricsEvents = events.filter((e) => e && e.type === 'metrics');
  if (metricsEvents.length === 0) {
    console.error('  ❌ 无 metrics 事件 — 先跑 retrospector');
    return 2;
  }
  const last = metricsEvents[metricsEvents.length - 1];
  const prev = metricsEvents.length >= 2 ? metricsEvents[metricsEvents.length - 2] : null;
  const prevPatternCount = prev && Number.isInteger(prev.pattern_count) ? prev.pattern_count : null;

  const result = optimize(last, { prevPatternCount, useGivenRecommendation: true });
  console.log(JSON.stringify(result));
  console.error(
    `  ✅ optimize: N=${result.envelope.N} K=${result.envelope.K} ` +
      `(N∈[${result.envelope.Nmin},${result.envelope.Nmax}] K∈[${result.envelope.Kmin},${result.envelope.Kmax}]) ` +
      `changed=${result.changed} withinEnvelope=${result.withinEnvelope}`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv).then((code) => process.exit(code));
}

// retrospector.test.mjs — node:test 真断言（C008 可证伪：破坏实现即 fail·无墙钟下界·无 tautology）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundTo,
  median,
  computeMetrics,
  lastPatternCount,
  recommend,
  retrospect,
  DEFAULT_THRESHOLDS,
} from './retrospector.mjs';

// ── helper：构造确定性 ts（分钟偏移）──
const base = Date.parse('2026-06-28T00:00:00.000Z');
const at = (min) => new Date(base + min * 60000).toISOString();

// ── roundTo / median 基础 ──────────────────────────────────────────────────
test('roundTo 截到指定小数位', () => {
  assert.equal(roundTo(0.123456, 4), 0.1235);
  assert.equal(roundTo(1 / 3, 2), 0.33);
});

test('median：奇数取中、偶数取均值、空 → null', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
});

// ── computeMetrics：空 events ──────────────────────────────────────────────
test('空 events → 全零/ null·pass=1', () => {
  const m = computeMetrics([]);
  assert.equal(m.pass, 1);
  assert.equal(m.regen_rate, 0);
  assert.equal(m.convergence_min, null);
  assert.equal(m.override_freq, 0);
  assert.equal(m.pattern_count, 0);
  assert.equal(m.breakdown.distinctSigs, 0);
});

// ── regen_rate / pattern_count ──────────────────────────────────────────────
test('3 sig 无再生 → regen_rate=0·pattern_count=0', () => {
  const events = [
    { type: 'gap_emit', sig: 'a', issue: 1, kind: 'logic' },
    { type: 'gap_emit', sig: 'b', issue: 2, kind: 'logic' },
    { type: 'gap_emit', sig: 'c', issue: 3, kind: 'ui-design' },
  ];
  const m = computeMetrics(events);
  assert.equal(m.regen_rate, 0);
  assert.equal(m.pattern_count, 0);
  assert.equal(m.breakdown.totalGapEmits, 3);
  assert.equal(m.breakdown.distinctSigs, 3);
});

test('sig a 发 3 次（再生 2）+ b 1 次 → regen_rate=2/4=0.5·pattern_count=1', () => {
  const events = [
    { type: 'gap_emit', sig: 'a', issue: 1, kind: 'logic' },
    { type: 'gap_emit', sig: 'a', issue: 1, kind: 'logic' },
    { type: 'gap_emit', sig: 'a', issue: 1, kind: 'logic' },
    { type: 'gap_emit', sig: 'b', issue: 2, kind: 'logic' },
  ];
  const m = computeMetrics(events);
  assert.equal(m.regen_rate, 0.5);
  assert.equal(m.pattern_count, 1);
  assert.equal(m.breakdown.totalRegens, 2);
  assert.equal(m.breakdown.recurringSigs, 1);
});

test('quarantine.regen 覆盖 emit 计数（取大者）·上夹 1', () => {
  const events = [
    { type: 'gap_emit', sig: 'a', issue: 1, kind: 'logic' },
    { type: 'quarantine', sig: 'a', regen: 3 }, // quarantine 说再生 3，emits-1=0 → 取 3
  ];
  const m = computeMetrics(events);
  // totalRegens=3, totalGapEmits=1 → 3/1=3 → 夹到 1
  assert.equal(m.regen_rate, 1);
  assert.equal(m.pattern_count, 1);
  assert.equal(m.breakdown.totalRegens, 3);
});

// ── convergence_min（ready→green 中位耗时·分钟）────────────────────────────
test('convergence_min = ready→green 中位耗时（分钟）', () => {
  const events = [
    { type: 'issue_ready', issue: 1, phase: 1, ts: at(0) },
    { type: 'issue_green', issue: 1, ts: at(10) }, // 10 min
    { type: 'issue_ready', issue: 2, phase: 1, ts: at(0) },
    { type: 'issue_green', issue: 2, ts: at(20) }, // 20 min
    { type: 'issue_ready', issue: 3, phase: 1, ts: at(0) },
    { type: 'issue_green', issue: 3, ts: at(30) }, // 30 min
  ];
  const m = computeMetrics(events);
  assert.equal(m.convergence_min, 20); // median(10,20,30)=20
  assert.deepEqual(m.breakdown.convergenceSamples, [10, 20, 30]);
});

test('green 早于 ready（时钟异常）→ 不入样本（不产负耗时）', () => {
  const events = [
    { type: 'issue_ready', issue: 1, ts: at(10) },
    { type: 'issue_green', issue: 1, ts: at(5) }, // 早于 ready → skip
    { type: 'issue_ready', issue: 2, ts: at(0) },
    { type: 'issue_green', issue: 2, ts: at(8) }, // 8 min
  ];
  const m = computeMetrics(events);
  assert.equal(m.convergence_min, 8);
  assert.deepEqual(m.breakdown.convergenceSamples, [8]);
});

test('取最早 ready 与 green 配对（重复 ready 不取后者）', () => {
  const events = [
    { type: 'issue_ready', issue: 1, ts: at(0) }, // 最早
    { type: 'issue_ready', issue: 1, ts: at(5) }, // 后续 ready 忽略
    { type: 'issue_green', issue: 1, ts: at(12) }, // 12 min（自最早 ready）
  ];
  const m = computeMetrics(events);
  assert.equal(m.convergence_min, 12);
});

test('无任何绿 → convergence_min=null', () => {
  const events = [{ type: 'issue_ready', issue: 1, ts: at(0) }];
  const m = computeMetrics(events);
  assert.equal(m.convergence_min, null);
});

// ── override_freq（人工干预占比）────────────────────────────────────────────
test('override_freq = parked / (green + parked)', () => {
  const events = [
    { type: 'issue_green', issue: 1 },
    { type: 'issue_green', issue: 2 },
    { type: 'issue_green', issue: 3 },
    { type: 'parked', issue: 4, reason: 'contract-stale' },
  ];
  const m = computeMetrics(events);
  assert.equal(m.override_freq, 0.25); // 1/(3+1)
  assert.equal(m.breakdown.greenIssues, 3);
  assert.equal(m.breakdown.parkedIssues, 1);
});

test('先 park 后转绿的 issue 按最终绿计（不重复计 override）', () => {
  const events = [
    { type: 'parked', issue: 1, reason: 'x' },
    { type: 'issue_green', issue: 1 }, // 白天回流转绿
    { type: 'parked', issue: 2, reason: 'y' }, // 仍 parked
  ];
  const m = computeMetrics(events);
  // green={1}, parked={2}（1 被剔除）→ 1/(1+1)=0.5
  assert.equal(m.override_freq, 0.5);
  assert.equal(m.breakdown.greenIssues, 1);
  assert.equal(m.breakdown.parkedIssues, 1);
});

test('无终态 issue → override_freq=0（不除零）', () => {
  const m = computeMetrics([{ type: 'gap_emit', sig: 'a', issue: 1 }]);
  assert.equal(m.override_freq, 0);
});

// ── pass 号 ────────────────────────────────────────────────────────────────
test('pass 显式优先', () => {
  assert.equal(computeMetrics([], { pass: 7 }).pass, 7);
});

test('pass 省略 → 既有 metrics 事件数 + 1', () => {
  const events = [
    { type: 'metrics', pass: 1, pattern_count: 4 },
    { type: 'metrics', pass: 2, pattern_count: 3 },
  ];
  assert.equal(computeMetrics(events).pass, 3);
});

// ── lastPatternCount ────────────────────────────────────────────────────────
test('lastPatternCount 取最后一条 metrics 的 pattern_count', () => {
  const events = [
    { type: 'metrics', pass: 1, pattern_count: 5 },
    { type: 'metrics', pass: 2, pattern_count: 3 },
    { type: 'gap_emit', sig: 'a', issue: 1 },
  ];
  assert.equal(lastPatternCount(events), 3);
  assert.equal(lastPatternCount([]), null);
});

// ── recommend（Optimizer·硬包络内）──────────────────────────────────────────
test('高 churn → 升 N（夹 Nmax）', () => {
  const env = { N: 3, K: 3, Nmin: 2, Nmax: 5 };
  const rec = recommend({ regen_rate: 0.5, override_freq: 0, pattern_count: 2 }, { gainEnvelope: env });
  assert.equal(rec.N, 4);
});

test('N 升不超 Nmax（包络夹取）', () => {
  const env = { N: 5, K: 3, Nmin: 2, Nmax: 5 };
  const rec = recommend({ regen_rate: 0.9, override_freq: 0, pattern_count: 2 }, { gainEnvelope: env });
  // 5+1=6 → 夹回 5 → 与当前同 → 不放进 rec
  assert.equal(rec.N, undefined);
});

test('高人工干预（override_freq 高）也触发升 N', () => {
  const env = { N: 2, K: 3, Nmin: 2, Nmax: 5 };
  const rec = recommend({ regen_rate: 0, override_freq: 0.4, pattern_count: 1 }, { gainEnvelope: env });
  assert.equal(rec.N, 3);
});

test('低 churn 且低干预 → 降 N（夹 Nmin）', () => {
  const env = { N: 3, K: 3, Nmin: 2, Nmax: 5 };
  const rec = recommend({ regen_rate: 0.02, override_freq: 0.05, pattern_count: 0 }, { gainEnvelope: env });
  assert.equal(rec.N, 2);
});

test('N 降不低于 Nmin', () => {
  const env = { N: 2, K: 3, Nmin: 2, Nmax: 5 };
  const rec = recommend({ regen_rate: 0, override_freq: 0, pattern_count: 0 }, { gainEnvelope: env });
  // 2-1=1 → 夹回 2 → 与当前同 → 不放进 rec
  assert.equal(rec.N, undefined);
});

test('中区（不高不低）→ 不动 N', () => {
  const env = { N: 3, K: 3, Nmin: 2, Nmax: 5 };
  const rec = recommend({ regen_rate: 0.15, override_freq: 0.15, pattern_count: 1 }, { gainEnvelope: env });
  assert.equal(rec.N, undefined);
});

test('pattern_count 较上一 pass 上升 → 降 K（更早 quarantine·下限 2）', () => {
  const env = { N: 3, K: 3, Nmin: 2, Nmax: 5 };
  const rec = recommend(
    { regen_rate: 0.15, override_freq: 0.15, pattern_count: 5 },
    { gainEnvelope: env, prevPatternCount: 3 }
  );
  assert.equal(rec.K, 2);
});

test('pattern_count 持平/下降 → 不动 K', () => {
  const env = { N: 3, K: 3, Nmin: 2, Nmax: 5 };
  const recDown = recommend(
    { regen_rate: 0.15, override_freq: 0.15, pattern_count: 2 },
    { gainEnvelope: env, prevPatternCount: 4 }
  );
  assert.equal(recDown.K, undefined);
  const recFlat = recommend(
    { regen_rate: 0.15, override_freq: 0.15, pattern_count: 4 },
    { gainEnvelope: env, prevPatternCount: 4 }
  );
  assert.equal(recFlat.K, undefined);
});

test('K 降不低于 2', () => {
  const env = { N: 3, K: 2, Nmin: 2, Nmax: 5 };
  const rec = recommend(
    { regen_rate: 0.15, override_freq: 0.15, pattern_count: 9 },
    { gainEnvelope: env, prevPatternCount: 3 }
  );
  // max(2, 2-1)=2 → 与当前 K 同 → 不放进 rec
  assert.equal(rec.K, undefined);
});

test('DEFAULT_THRESHOLDS 被外部 thresholds 覆盖', () => {
  const env = { N: 3, K: 3, Nmin: 2, Nmax: 5 };
  // regen_rate=0.2 在默认 regenHigh=0.3 下不触发；把阈值降到 0.1 → 触发升 N
  const recDefault = recommend({ regen_rate: 0.2, override_freq: 0, pattern_count: 1 }, { gainEnvelope: env });
  assert.equal(recDefault.N, undefined);
  const recTuned = recommend(
    { regen_rate: 0.2, override_freq: 0, pattern_count: 1 },
    { gainEnvelope: env, thresholds: { regenHigh: 0.1 } }
  );
  assert.equal(recTuned.N, 4);
  // 确认默认阈值常量值（防漂移）
  assert.equal(DEFAULT_THRESHOLDS.regenHigh, 0.3);
});

// ── retrospect 端到端：产 metrics 事件 ──────────────────────────────────────
test('retrospect 产合法 metrics 事件（含 RETRO_SCHEMA 字段 + 注入 ts）', () => {
  const events = [
    { type: 'issue_ready', issue: 1, ts: at(0) },
    { type: 'issue_green', issue: 1, ts: at(15) },
    { type: 'issue_ready', issue: 2, ts: at(0) },
    { type: 'issue_green', issue: 2, ts: at(25) },
    { type: 'gap_emit', sig: 'a', issue: 9 },
    { type: 'gap_emit', sig: 'a', issue: 9 }, // a 再生 1 次
    { type: 'gap_emit', sig: 'b', issue: 10 },
    { type: 'parked', issue: 11, reason: 'contract-stale' },
  ];
  const ev = retrospect({ events, now: () => at(99) });
  assert.equal(ev.type, 'metrics');
  assert.equal(ev.ts, at(99));
  assert.equal(ev.pass, 1);
  // gap emits: a×2 + b×1 = 3; regens: 1 → 1/3
  assert.equal(ev.regen_rate, roundTo(1 / 3, 4));
  assert.equal(ev.pattern_count, 1);
  // convergence median(15,25)=20
  assert.equal(ev.convergence_min, 20);
  // override: green={1,2}, parked={11} → 1/3
  assert.equal(ev.override_freq, roundTo(1 / 3, 4));
  assert.ok(ev.recommendation && typeof ev.recommendation === 'object');
});

test('retrospect 高 churn 场景 recommendation 升 N', () => {
  const events = [
    { type: 'gap_emit', sig: 'a', issue: 1 },
    { type: 'gap_emit', sig: 'a', issue: 1 },
    { type: 'gap_emit', sig: 'a', issue: 1 }, // a 再生 2，总 emits 3 → regen_rate 2/3
  ];
  const ev = retrospect({ events, gainEnvelope: { N: 3, K: 3, Nmin: 2, Nmax: 5 }, now: () => at(0) });
  assert.equal(ev.recommendation.N, 4);
});

test('retrospect pass 自增（既有 metrics 事件 + 1）', () => {
  const events = [{ type: 'metrics', pass: 1, pattern_count: 2 }];
  const ev = retrospect({ events, now: () => at(0) });
  assert.equal(ev.pass, 2);
});

test('computeMetrics 非数组入参即抛（C008 不放过坏入参）', () => {
  assert.throws(() => computeMetrics(null), /必须是数组/);
});

// ── 折叠幂等（C008·同 events 两次结果相同·无外部状态泄漏）──────────────────
test('computeMetrics 幂等：同 events 两次结果一致', () => {
  const events = [
    { type: 'gap_emit', sig: 'a', issue: 1 },
    { type: 'gap_emit', sig: 'a', issue: 1 },
    { type: 'issue_ready', issue: 2, ts: at(0) },
    { type: 'issue_green', issue: 2, ts: at(10) },
  ];
  const m1 = computeMetrics(events);
  const m2 = computeMetrics(events);
  assert.deepEqual(m1, m2);
});

// state-ledger.test.mjs — node:test 真断言（C008 可证伪：破坏即 fail）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPES,
  DEFAULT_GAIN_ENVELOPE,
  isKnownEventType,
  serializeEvent,
  appendEvent,
  foldState,
  renderPatternTrend,
  renderStatus,
} from './state-ledger.mjs';

// 固定 ts，确定性（C008：禁墙钟下界）
const T = '2026-06-28T00:00:00.000Z';
const now = () => T;

// ── EVENT_TYPES 全集 ────────────────────────────────────────────────────────
test('EVENT_TYPES 覆盖 SPEC §5 全部 9 个事件类型', () => {
  assert.deepEqual(
    [...EVENT_TYPES].sort(),
    [
      'assumption',
      'fix',
      'gap_emit',
      'issue_green',
      'issue_ready',
      'metrics',
      'parked',
      'phase_tag',
      'quarantine',
    ]
  );
  assert.equal(isKnownEventType('issue_green'), true);
  assert.equal(isKnownEventType('not_a_type'), false);
});

// ── serializeEvent ──────────────────────────────────────────────────────────
test('serializeEvent 合法事件 → JSONL 行', () => {
  const line = serializeEvent({ type: 'issue_green', ts: T, issue: 10, facets: '4/4' });
  assert.equal(JSON.parse(line).type, 'issue_green');
  assert.equal(JSON.parse(line).issue, 10);
});

test('serializeEvent 未知类型即抛（写入侧不放过）', () => {
  assert.throws(() => serializeEvent({ type: 'bogus' }), /未知事件类型/);
  assert.throws(() => serializeEvent(null), /必须是对象/);
});

// ── appendEvent: append-only / 不就地改 ─────────────────────────────────────
test('appendEvent 返回新数组，不就地改入参 events', () => {
  const ev = [];
  const ev2 = appendEvent(ev, { type: 'metrics', ts: T, pass: 1 });
  assert.equal(ev.length, 0); // 原数组未变
  assert.equal(ev2.length, 1);
  assert.notEqual(ev, ev2); // 不同引用
});

test('appendEvent 不就地改入参 event 对象（造新对象补 ts）', () => {
  const original = { type: 'metrics', pass: 1 };
  const [stamped] = appendEvent([], original, { now });
  assert.equal(original.ts, undefined); // 入参未被加 ts
  assert.equal(stamped.ts, T); // 新对象补了 ts
  assert.equal(stamped.pass, 1);
  assert.notEqual(stamped, original);
});

test('appendEvent 保留已有 ts（不覆盖）', () => {
  const [stamped] = appendEvent([], { type: 'metrics', ts: 'fixed-ts', pass: 1 }, { now });
  assert.equal(stamped.ts, 'fixed-ts');
});

test('appendEvent 未知类型即抛', () => {
  assert.throws(() => appendEvent([], { type: 'bogus' }), /未知事件类型/);
  assert.throws(() => appendEvent('not-array', { type: 'metrics' }), /必须是数组/);
});

test('appendEvent 链式追加保持顺序', () => {
  let log = [];
  log = appendEvent(log, { type: 'issue_ready', ts: T, issue: 10, phase: 2, blockers: [] });
  log = appendEvent(log, { type: 'issue_green', ts: T, issue: 10 });
  assert.equal(log.length, 2);
  assert.equal(log[0].type, 'issue_ready');
  assert.equal(log[1].type, 'issue_green');
});

// ── foldState: 幂等 ─────────────────────────────────────────────────────────
function fullLog() {
  return [
    { type: 'issue_ready', ts: T, issue: 10, phase: 2, blockers: [8] },
    { type: 'issue_ready', ts: T, issue: 11, phase: 2, blockers: [] },
    { type: 'assumption', ts: T, issue: 10, decision: '字段叫 pin_state', provenance: 'projection-schema.md:L42', reversible: true },
    { type: 'fix', ts: T, repo: 'helix', branch: 'fix/wire', issue: 10, facet: 'outbound' },
    { type: 'issue_green', ts: T, issue: 10, corr_key: 'k1', facets: '4/4' },
    { type: 'gap_emit', ts: T, sig: 'a1b2', issue: 52, kind: 'ui-design' },
    { type: 'gap_emit', ts: T, sig: 'c3d4', issue: 53, kind: 'logic' },
    { type: 'quarantine', ts: T, sig: 'c3d4', regen: 3 },
    { type: 'parked', ts: T, issue: 11, reason: 'contract-stale', need: 'NEEDS_HUMAN_x.md' },
    { type: 'metrics', ts: T, pass: 1, regen_rate: 0.2, convergence_min: 14, pattern_count: 5 },
    { type: 'metrics', ts: T, pass: 2, regen_rate: 0.1, convergence_min: 12, pattern_count: 3 },
    { type: 'phase_tag', ts: T, phase: 2, tag: 'v0.x-phase2-send' },
  ];
}

test('foldState 幂等：同 events 两次 fold 结果相同', () => {
  const log = fullLog();
  const a = foldState(log);
  const b = foldState(log);
  assert.deepEqual(a, b);
});

test('foldState 不就地改入参 events 数组与元素', () => {
  const log = fullLog();
  const snapshot = JSON.parse(JSON.stringify(log));
  foldState(log);
  assert.deepEqual(log, snapshot); // 入参逐字段未变
});

// ── foldState: 事件类型全覆盖 ───────────────────────────────────────────────
test('foldState 覆盖全部事件类型并正确折叠', () => {
  const s = foldState(fullLog());

  // issue_ready + issue_green + parked
  const i10 = s.issues.find((i) => i.n === 10);
  const i11 = s.issues.find((i) => i.n === 11);
  assert.equal(i10.state, 'green'); // issue_green 覆盖 ready
  assert.equal(i10.phase, 2);
  assert.deepEqual(i10.blockers, [8]);
  assert.equal(i11.state, 'parked'); // parked 覆盖 ready
  assert.equal(i11.parkReason, 'contract-stale');

  // gap_emit + quarantine
  const gOpen = s.gapLedger.find((g) => g.sig === 'a1b2');
  const gQuar = s.gapLedger.find((g) => g.sig === 'c3d4');
  assert.equal(gOpen.state, 'open');
  assert.equal(gOpen.issue, 52);
  assert.equal(gQuar.state, 'quarantine');
  assert.equal(gQuar.regen, 3);

  // assumption
  assert.equal(s.assumptions.length, 1);
  assert.equal(s.assumptions[0].decision, '字段叫 pin_state');
  assert.equal(s.assumptions[0].reversible, true);

  // fix
  assert.equal(s.fixes.length, 1);
  assert.equal(s.fixes[0].repo, 'helix');
  assert.equal(s.fixes[0].facet, 'outbound');

  // metrics（取最新）+ patternTrend（按序累积）
  assert.equal(s.metrics.pass, 2);
  assert.equal(s.metrics.pattern_count, 3);
  assert.deepEqual(s.patternTrend, [5, 3]);

  // phase_tag → phasesRemaining 移除已 tag 的 phase 2
  assert.deepEqual(s.tags, [{ phase: 2, tag: 'v0.x-phase2-send' }]);
  assert.deepEqual(s.phasesRemaining, []);

  // logCursor = 折叠事件数
  assert.equal(s.logCursor, 12);
});

test('foldState phasesRemaining = 见过 phase 减去已 tag', () => {
  const s = foldState([
    { type: 'issue_ready', ts: T, issue: 1, phase: 0, blockers: [] },
    { type: 'issue_ready', ts: T, issue: 2, phase: 1, blockers: [] },
    { type: 'issue_ready', ts: T, issue: 3, phase: 2, blockers: [] },
    { type: 'phase_tag', ts: T, phase: 0, tag: 't0' },
  ]);
  assert.deepEqual(s.phasesRemaining, [1, 2]); // 0 已 tag 收口
});

test('foldState 空日志 → 稳定默认快照', () => {
  const s = foldState([]);
  assert.deepEqual(s.issues, []);
  assert.deepEqual(s.gapLedger, []);
  assert.deepEqual(s.phasesRemaining, []);
  assert.equal(s.logCursor, 0);
  assert.deepEqual(s.metrics, { pass: 0, regen_rate: null, convergence_min: null, pattern_count: null });
  assert.deepEqual(s.gainEnvelope, { N: 3, K: 3, Nmin: 2, Nmax: 5 });
});

test('foldState 坏/未知事件进 unknown（不静默吞·不抛）', () => {
  const s = foldState([
    { type: 'issue_green', ts: T, issue: 1 },
    { type: 'bogus', ts: T },
    null,
    { ts: T }, // 无 type
  ]);
  assert.equal(s.unknown.length, 3);
  assert.equal(s.issues.length, 1);
  assert.equal(s.logCursor, 4); // cursor 仍计全部行
});

// ── gainEnvelope: 硬包络夹取 ────────────────────────────────────────────────
test('foldState gainEnvelope 按 metrics.recommendation 在界内夹取', () => {
  const s = foldState([
    { type: 'metrics', ts: T, pass: 1, pattern_count: 4, recommendation: { N: 9, K: 7 } },
  ]);
  assert.equal(s.gainEnvelope.N, 5); // 9 越上界 → 夹到 Nmax=5
  assert.equal(s.gainEnvelope.K, 7); // K 无界
});

test('foldState gainEnvelope recommendation 低于下界夹到 Nmin', () => {
  const s = foldState([
    { type: 'metrics', ts: T, pass: 1, recommendation: { N: 1 } },
  ]);
  assert.equal(s.gainEnvelope.N, 2);
});

test('foldState 接受控制面 gainEnvelope 覆盖默认', () => {
  const s = foldState([], { gainEnvelope: { N: 4, K: 2, Nmin: 2, Nmax: 6 } });
  assert.equal(s.gainEnvelope.N, 4);
  assert.equal(s.gainEnvelope.Nmax, 6);
});

// ── renderPatternTrend ──────────────────────────────────────────────────────
test('renderPatternTrend 下降 → ↓ 且 rising=false（meta-DoD 期望）', () => {
  const r = renderPatternTrend([5, 4, 2]);
  assert.equal(r.text, '5 → 4 → 2 (↓)');
  assert.equal(r.rising, false);
});

test('renderPatternTrend 上升 → ↑ 且 rising=true（报警）', () => {
  const r = renderPatternTrend([2, 4, 6]);
  assert.equal(r.text, '2 → 4 → 6 (↑)');
  assert.equal(r.rising, true);
});

test('renderPatternTrend 空 → （无 metrics）', () => {
  assert.equal(renderPatternTrend([]).text, '（无 metrics）');
  assert.equal(renderPatternTrend([3]).text, '3');
});

// ── renderStatus ────────────────────────────────────────────────────────────
test('renderStatus 终态行计数正确（绿/park/quarantine + 趋势）', () => {
  const s = foldState(fullLog());
  const md = renderStatus(s);
  assert.match(md, /✅ 1 绿 \/ 1 park \/ 1 quarantine · pattern 趋势 5 → 3 \(↓\)/);
  assert.match(md, /# loop-Engine — STATUS/);
  assert.match(md, /logCursor: 12/);
  assert.match(md, /#10/); // issue 表含 #10
  assert.match(md, /a1b2/); // gap 表含 sig
});

test('renderStatus pattern 上升时插入报警行', () => {
  const s = foldState([
    { type: 'metrics', ts: T, pass: 1, pattern_count: 2 },
    { type: 'metrics', ts: T, pass: 2, pattern_count: 5 },
  ]);
  const md = renderStatus(s);
  assert.match(md, /⚠️ pattern 数上升/);
});

test('renderStatus 无报警时不含 ⚠️（破坏即 fail·避免 tautology）', () => {
  const s = foldState([
    { type: 'metrics', ts: T, pass: 1, pattern_count: 5 },
    { type: 'metrics', ts: T, pass: 2, pattern_count: 2 },
  ]);
  const md = renderStatus(s);
  assert.equal(md.includes('⚠️ pattern 数上升'), false);
});

test('renderStatus 空快照可渲染（无 issue/gap 占位文案）', () => {
  const md = renderStatus(foldState([]));
  assert.match(md, /_（无 issue 事件）_/);
  assert.match(md, /_（无 gap）_/);
  assert.match(md, /✅ 0 绿 \/ 0 park \/ 0 quarantine/);
});

test('renderStatus 非对象入参即抛', () => {
  assert.throws(() => renderStatus(null), /必须是对象/);
});

// ── 端到端：appendEvent 串 → foldState → renderStatus ───────────────────────
test('端到端：append 链 → fold → renderStatus 自洽', () => {
  let log = [];
  for (const e of fullLog()) log = appendEvent(log, e, { now });
  const state = foldState(log);
  const md = renderStatus(state);
  // append 后再 fold 与直接 fold 同源数据一致（仅 ts 已规范化）
  assert.equal(state.logCursor, 12);
  assert.match(md, /✅ 1 绿 \/ 1 park \/ 1 quarantine/);
});

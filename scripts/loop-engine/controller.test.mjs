// controller.test.mjs — node:test 真断言(C008 可证伪:每个阀边界值钉死,破坏阈值即 fail)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THRESHOLDS,
  budgetGuard,
  failureCap,
  regenQuarantine,
  settled,
  antiThrash,
  flakyGate,
  loopGuard,
  issueGuard,
} from './controller.mjs';

// ── ① budgetGuard ─────────────────────────────────────────────────────────
test('budgetGuard: 边界 remaining===0.15 不跳闸(恰好到线视为安全)', () => {
  const d = budgetGuard(0.15);
  assert.equal(d.trip, false);
  assert.equal(d.action, 'continue');
});

test('budgetGuard: 0.1499 < 15% → stop', () => {
  const d = budgetGuard(0.1499);
  assert.equal(d.trip, true);
  assert.equal(d.action, 'stop');
});

test('budgetGuard: 0.1501 ≥ 15% → continue', () => {
  assert.equal(budgetGuard(0.1501).trip, false);
});

test('budgetGuard: 极端 0 → stop, 1 → continue', () => {
  assert.equal(budgetGuard(0).trip, true);
  assert.equal(budgetGuard(1).trip, false);
});

test('budgetGuard: 自定义阈值生效', () => {
  assert.equal(budgetGuard(0.25, 0.3).trip, true);
  assert.equal(budgetGuard(0.35, 0.3).trip, false);
});

test('budgetGuard: 非法输入抛错(NaN / >1 / <0 / 字符串 / null)', () => {
  assert.throws(() => budgetGuard(NaN), TypeError);
  assert.throws(() => budgetGuard(1.5), RangeError);
  assert.throws(() => budgetGuard(-0.1), RangeError);
  assert.throws(() => budgetGuard('0.1'), TypeError);
  assert.throws(() => budgetGuard(null), TypeError);
});

// ── ② failureCap ──────────────────────────────────────────────────────────
test('failureCap: 边界 2 不跳闸, 3 → park', () => {
  assert.equal(failureCap(2).trip, false);
  const d = failureCap(3);
  assert.equal(d.trip, true);
  assert.equal(d.action, 'park');
});

test('failureCap: 0 不跳闸, 5 → park', () => {
  assert.equal(failureCap(0).trip, false);
  assert.equal(failureCap(5).trip, true);
});

test('failureCap: 默认 cap = THRESHOLDS.FAILURE_CAP', () => {
  assert.equal(THRESHOLDS.FAILURE_CAP, 3);
});

test('failureCap: 自定义 cap', () => {
  assert.equal(failureCap(2, 2).trip, true);
  assert.equal(failureCap(1, 2).trip, false);
});

test('failureCap: 非法输入抛错(非整数 / 负 / 字符串)', () => {
  assert.throws(() => failureCap(2.5), TypeError);
  assert.throws(() => failureCap(-1), TypeError);
  assert.throws(() => failureCap('3'), TypeError);
  assert.throws(() => failureCap(3, 0), TypeError); // cap 必须 ≥1
});

// ── ③ regenQuarantine ─────────────────────────────────────────────────────
test('regenQuarantine: 边界 2 不跳闸, 第 3 次复燃 → quarantine', () => {
  assert.equal(regenQuarantine(2).trip, false);
  const d = regenQuarantine(3);
  assert.equal(d.trip, true);
  assert.equal(d.action, 'quarantine');
});

test('regenQuarantine: 0 / 1 不跳闸', () => {
  assert.equal(regenQuarantine(0).trip, false);
  assert.equal(regenQuarantine(1).trip, false);
});

test('regenQuarantine: 自定义阈值', () => {
  assert.equal(regenQuarantine(2, 2).trip, true);
});

test('regenQuarantine: 非法输入抛错', () => {
  assert.throws(() => regenQuarantine(-1), TypeError);
  assert.throws(() => regenQuarantine(1.5), TypeError);
});

// ── ④ settled ─────────────────────────────────────────────────────────────
test('settled: 历史不足 2 pass → 不跳闸', () => {
  assert.equal(settled([]).trip, false);
  assert.equal(settled([{ newGreen: 0, newGap: 0 }]).trip, false);
});

test('settled: 连 2 pass 全 0 → converge', () => {
  const d = settled([
    { newGreen: 1, newGap: 0 },
    { newGreen: 0, newGap: 0 },
    { newGreen: 0, newGap: 0 },
  ]);
  assert.equal(d.trip, true);
  assert.equal(d.action, 'converge');
});

test('settled: 近 2 pass 有新绿 → 不收敛', () => {
  const d = settled([
    { newGreen: 0, newGap: 0 },
    { newGreen: 2, newGap: 0 },
  ]);
  assert.equal(d.trip, false);
});

test('settled: 近 2 pass 有新 gap → 不收敛', () => {
  const d = settled([
    { newGreen: 0, newGap: 0 },
    { newGreen: 0, newGap: 1 },
  ]);
  assert.equal(d.trip, false);
});

test('settled: 只看尾部 need 个 — 早期 0 但最近进展则不收敛', () => {
  const d = settled([
    { newGreen: 0, newGap: 0 },
    { newGreen: 0, newGap: 0 },
    { newGreen: 1, newGap: 0 }, // 最新 pass 有进展
  ]);
  assert.equal(d.trip, false);
});

test('settled: 自定义 need=3', () => {
  const zeros3 = [
    { newGreen: 0, newGap: 0 },
    { newGreen: 0, newGap: 0 },
    { newGreen: 0, newGap: 0 },
  ];
  assert.equal(settled(zeros3, 3).trip, true);
  assert.equal(settled(zeros3.slice(0, 2), 3).trip, false); // 仅 2 < need 3
});

test('settled: 非法输入抛错(非数组 / 坏元素)', () => {
  assert.throws(() => settled('nope'), TypeError);
  assert.throws(() => settled([{ newGreen: -1, newGap: 0 }]), TypeError);
  assert.throws(() => settled([null]), TypeError);
  assert.throws(() => settled([{ newGreen: 0 }]), TypeError); // 缺 newGap
});

// ── ⑤ antiThrash ──────────────────────────────────────────────────────────
test('antiThrash: 同 UC 本 pass 未碰过 → allow', () => {
  const d = antiThrash({ uc: 'uc-1.1', pass: 0, touchLog: {} });
  assert.equal(d.trip, false);
  assert.equal(d.action, 'allow');
});

test('antiThrash: 同 UC 本 pass 已碰 1 次 → block', () => {
  const d = antiThrash({ uc: 'uc-1.1', pass: 0, touchLog: { '0::uc-1.1': 1 } });
  assert.equal(d.trip, true);
  assert.equal(d.action, 'block');
});

test('antiThrash: 不同 pass 同 UC 独立(pass 1 不受 pass 0 影响)', () => {
  const log = { '0::uc-1.1': 1 };
  assert.equal(antiThrash({ uc: 'uc-1.1', pass: 1, touchLog: log }).trip, false);
});

test('antiThrash: 同 pass 不同 UC 独立', () => {
  const log = { '0::uc-1.1': 1 };
  assert.equal(antiThrash({ uc: 'uc-1.2', pass: 0, touchLog: log }).trip, false);
});

test('antiThrash: key 由 pass::uc 组成', () => {
  assert.equal(antiThrash({ uc: 'uc-5.1', pass: 3, touchLog: {} }).key, '3::uc-5.1');
});

test('antiThrash: 默认 maxTouch=1', () => {
  assert.equal(THRESHOLDS.THRASH_MAX_TOUCH, 1);
});

test('antiThrash: 非法输入抛错(空 uc / 负 pass / touchLog 非对象)', () => {
  assert.throws(() => antiThrash({ uc: '', pass: 0 }), TypeError);
  assert.throws(() => antiThrash({ uc: 'x', pass: -1 }), TypeError);
  assert.throws(() => antiThrash({ uc: 'x', pass: 0, touchLog: [] }), TypeError);
});

// ── ⑥ flakyGate ───────────────────────────────────────────────────────────
test('flakyGate: green → accept(不跳闸)', () => {
  const d = flakyGate('green');
  assert.equal(d.action, 'accept');
  assert.equal(d.trip, false);
  assert.equal(d.retry, false);
});

test('flakyGate: red 首次(retriesDone=0) → retry,不当 gap', () => {
  const d = flakyGate('red', 0);
  assert.equal(d.action, 'retry');
  assert.equal(d.retry, true);
  assert.equal(d.trip, false); // 抖动不污染 ledger
});

test('flakyGate: red 重试过 1 次仍红 → gap(trip)', () => {
  const d = flakyGate('red', 1);
  assert.equal(d.action, 'gap');
  assert.equal(d.trip, true);
  assert.equal(d.retry, false);
});

test('flakyGate: red 重试 ≥ max 一律 gap', () => {
  assert.equal(flakyGate('red', 2).action, 'gap');
});

test('flakyGate: 默认 maxRetries=1', () => {
  assert.equal(THRESHOLDS.FLAKY_RETRIES, 1);
});

test('flakyGate: 自定义 maxRetries=2 → 重试 1 次仍 retry', () => {
  assert.equal(flakyGate('red', 1, 2).action, 'retry');
  assert.equal(flakyGate('red', 2, 2).action, 'gap');
});

test('flakyGate: 非法 verdict / retriesDone 抛错', () => {
  assert.throws(() => flakyGate('yellow'), TypeError);
  assert.throws(() => flakyGate('gap'), TypeError); // gap 不是原始 verdict
  assert.throws(() => flakyGate('red', -1), TypeError);
});

// ── 组合 loopGuard ────────────────────────────────────────────────────────
test('loopGuard: 预算优先 — 预算不足且已收敛时,governing=budgetGuard', () => {
  const d = loopGuard({
    remaining: 0.1,
    passes: [
      { newGreen: 0, newGap: 0 },
      { newGreen: 0, newGap: 0 },
    ],
  });
  assert.equal(d.trip, true);
  assert.equal(d.governing, 'budgetGuard');
  assert.equal(d.action, 'stop');
});

test('loopGuard: 预算够但已收敛 → settled converge', () => {
  const d = loopGuard({
    remaining: 0.5,
    passes: [
      { newGreen: 0, newGap: 0 },
      { newGreen: 0, newGap: 0 },
    ],
  });
  assert.equal(d.trip, true);
  assert.equal(d.governing, 'settled');
  assert.equal(d.action, 'converge');
});

test('loopGuard: 预算够且未收敛 → continue', () => {
  const d = loopGuard({ remaining: 0.5, passes: [{ newGreen: 1, newGap: 0 }] });
  assert.equal(d.trip, false);
  assert.equal(d.action, 'continue');
});

// ── 组合 issueGuard ───────────────────────────────────────────────────────
test('issueGuard: 连败优先于复燃 — 两者都触发时 governing=failureCap', () => {
  const d = issueGuard({ consecutiveFailures: 3, regenCount: 3 });
  assert.equal(d.trip, true);
  assert.equal(d.governing, 'failureCap');
  assert.equal(d.action, 'park');
});

test('issueGuard: 仅复燃达标 → quarantine', () => {
  const d = issueGuard({ consecutiveFailures: 1, regenCount: 3 });
  assert.equal(d.trip, true);
  assert.equal(d.governing, 'regenQuarantine');
});

test('issueGuard: 均未达标 → continue', () => {
  const d = issueGuard({ consecutiveFailures: 1, regenCount: 1 });
  assert.equal(d.trip, false);
  assert.equal(d.action, 'continue');
});

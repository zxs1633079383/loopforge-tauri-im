// scheduler.test.mjs — node:test 真断言（C008 可证伪：破坏即 fail · 无 tautology）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readySet,
  phaseBarrier,
  detectCycles,
  validateGraph,
  phasesInOrder,
  GREEN,
  PARKED,
} from './scheduler.mjs';

// ── readySet：拓扑前沿（验收①「给定 DAG → 正确 ready-set·blockers 未绿不入」）──

test('readySet 独立项（无 blockers·未绿）全部入前沿 = 可并行', () => {
  const issues = [
    { n: 1, phase: 0, blockers: [], state: 'open' },
    { n: 2, phase: 0, blockers: [], state: 'open' },
    { n: 3, phase: 0, blockers: [], state: 'open' },
  ];
  assert.deepEqual(readySet(0, issues), [1, 2, 3]);
});

test('readySet 依赖项：blocker 未绿 → 不入（验收·blockers 未绿不入）', () => {
  const issues = [
    { n: 1, phase: 0, blockers: [], state: 'open' }, // A 未绿
    { n: 2, phase: 0, blockers: [1], state: 'open' }, // B 依赖 A
  ];
  // 只有 A 在前沿，B 因 blocker 1 未绿被挡
  assert.deepEqual(readySet(0, issues), [1]);
});

test('readySet 依赖项：blocker 转绿后下一次调用才入 = 串行解锁', () => {
  const before = [
    { n: 1, phase: 0, blockers: [], state: 'open' },
    { n: 2, phase: 0, blockers: [1], state: 'open' },
  ];
  assert.deepEqual(readySet(0, before), [1]);
  // A 转绿 → 重算前沿，B 解锁；A 已绿不再派发
  const after = [
    { n: 1, phase: 0, blockers: [], state: GREEN },
    { n: 2, phase: 0, blockers: [1], state: 'open' },
  ];
  assert.deepEqual(readySet(0, after), [2]);
});

test('readySet 多 blocker：一个未绿即整体不入', () => {
  const issues = [
    { n: 1, phase: 0, blockers: [], state: GREEN },
    { n: 2, phase: 0, blockers: [], state: 'open' }, // 未绿
    { n: 3, phase: 0, blockers: [1, 2], state: 'open' }, // 依赖 1(绿)+2(未绿)
  ];
  // 3 不入（blocker 2 未绿）；2 自身无 blocker → 入
  assert.deepEqual(readySet(0, issues), [2]);
});

test('readySet 多 blocker 全绿 → 入', () => {
  const issues = [
    { n: 1, phase: 0, blockers: [], state: GREEN },
    { n: 2, phase: 0, blockers: [], state: GREEN },
    { n: 3, phase: 0, blockers: [1, 2], state: 'open' },
  ];
  assert.deepEqual(readySet(0, issues), [3]);
});

test('readySet 已绿 issue 不重复入前沿', () => {
  const issues = [
    { n: 1, phase: 0, blockers: [], state: GREEN },
    { n: 2, phase: 0, blockers: [], state: 'open' },
  ];
  assert.deepEqual(readySet(0, issues), [2]);
});

test('readySet 已泊(parked) issue 永不自动入前沿', () => {
  const issues = [
    { n: 1, phase: 0, blockers: [], state: PARKED },
    { n: 2, phase: 0, blockers: [], state: 'open' },
  ];
  assert.deepEqual(readySet(0, issues), [2]);
});

test('readySet 只返回目标 phase 的 issue（phase 隔离）', () => {
  const issues = [
    { n: 1, phase: 0, blockers: [], state: 'open' },
    { n: 2, phase: 1, blockers: [], state: 'open' },
    { n: 3, phase: 1, blockers: [], state: 'open' },
  ];
  assert.deepEqual(readySet(1, issues), [2, 3]);
  assert.deepEqual(readySet(0, issues), [1]);
});

test('readySet 跨 phase blocker：前一 phase issue 作 blocker 正确解锁', () => {
  const blocked = [
    { n: 1, phase: 0, blockers: [], state: 'open' }, // phase0 未绿
    { n: 2, phase: 1, blockers: [1], state: 'open' }, // phase1 依赖 phase0 的 1
  ];
  assert.deepEqual(readySet(1, blocked), []); // 1 未绿 → phase1 无前沿
  const unblocked = [
    { n: 1, phase: 0, blockers: [], state: GREEN },
    { n: 2, phase: 1, blockers: [1], state: 'open' },
  ];
  assert.deepEqual(readySet(1, unblocked), [2]);
});

test('readySet blocker 引用不存在的 issue → 宽松不入（不抛）', () => {
  const issues = [{ n: 2, phase: 0, blockers: [999], state: 'open' }];
  assert.deepEqual(readySet(0, issues), []);
});

test('readySet 缺 blockers 字段视为无依赖', () => {
  const issues = [{ n: 1, phase: 0, state: 'open' }];
  assert.deepEqual(readySet(0, issues), [1]);
});

test('readySet 坏输入抛 TypeError（验收③错误处理）', () => {
  assert.throws(() => readySet(undefined, []), TypeError);
  assert.throws(() => readySet(null, []), TypeError);
  assert.throws(() => readySet(0, 'not-array'), TypeError);
});

// ── phaseBarrier：phase 全绿才进下一 phase ──

test('phaseBarrier 全绿 → passed=true', () => {
  const issues = [
    { n: 1, phase: 0, state: GREEN },
    { n: 2, phase: 0, state: GREEN },
  ];
  const r = phaseBarrier(0, issues);
  assert.equal(r.passed, true);
  assert.equal(r.green, 2);
  assert.equal(r.total, 2);
  assert.equal(r.pending, 0);
});

test('phaseBarrier 有 pending → passed=false', () => {
  const issues = [
    { n: 1, phase: 0, state: GREEN },
    { n: 2, phase: 0, state: 'open' },
  ];
  const r = phaseBarrier(0, issues);
  assert.equal(r.passed, false);
  assert.equal(r.green, 1);
  assert.equal(r.pending, 1);
});

test('phaseBarrier 有 parked → passed=false 且计数', () => {
  const issues = [
    { n: 1, phase: 0, state: GREEN },
    { n: 2, phase: 0, state: PARKED },
  ];
  const r = phaseBarrier(0, issues);
  assert.equal(r.passed, false);
  assert.equal(r.parked, 1);
  assert.equal(r.green, 1);
});

test('phaseBarrier 只统计目标 phase', () => {
  const issues = [
    { n: 1, phase: 0, state: GREEN },
    { n: 2, phase: 1, state: 'open' }, // 别的 phase 不该污染
  ];
  const r = phaseBarrier(0, issues);
  assert.equal(r.total, 1);
  assert.equal(r.passed, true);
});

test('phaseBarrier 空 phase（total=0）→ passed=false（没 issue 不算完成）', () => {
  const r = phaseBarrier(7, [{ n: 1, phase: 0, state: GREEN }]);
  assert.equal(r.total, 0);
  assert.equal(r.passed, false);
});

test('phaseBarrier 坏输入抛 TypeError', () => {
  assert.throws(() => phaseBarrier(undefined, []), TypeError);
  assert.throws(() => phaseBarrier(0, 42), TypeError);
});

// ── detectCycles：环检测（验收③） ──

test('detectCycles 无环 DAG → []', () => {
  const issues = [
    { n: 1, blockers: [] },
    { n: 2, blockers: [1] },
    { n: 3, blockers: [1, 2] },
  ];
  assert.deepEqual(detectCycles(issues), []);
});

test('detectCycles 2 环（A↔B）→ 检出', () => {
  const issues = [
    { n: 1, blockers: [2] },
    { n: 2, blockers: [1] },
  ];
  const cycles = detectCycles(issues);
  assert.equal(cycles.length, 1);
  // 闭合路径：首尾相同
  const c = cycles[0];
  assert.equal(c[0], c[c.length - 1]);
  assert.deepEqual(new Set(c), new Set([1, 2]));
});

test('detectCycles 3 环（A→B→C→A）→ 检出', () => {
  const issues = [
    { n: 1, blockers: [3] },
    { n: 2, blockers: [1] },
    { n: 3, blockers: [2] },
  ];
  const cycles = detectCycles(issues);
  assert.equal(cycles.length, 1);
  assert.deepEqual(new Set(cycles[0].slice(0, -1)), new Set([1, 2, 3]));
});

test('detectCycles 自环（issue 阻塞自己）→ 检出', () => {
  const cycles = detectCycles([{ n: 5, blockers: [5] }]);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], [5, 5]);
});

test('detectCycles 缺失引用不当作环', () => {
  assert.deepEqual(detectCycles([{ n: 1, blockers: [999] }]), []);
});

test('detectCycles 坏输入抛 TypeError', () => {
  assert.throws(() => detectCycles('x'), TypeError);
});

// ── validateGraph：图完整性总闸（验收③错误处理） ──

test('validateGraph 干净 DAG → ok=true', () => {
  const issues = [
    { n: 1, phase: 0, blockers: [] },
    { n: 2, phase: 0, blockers: [1] },
  ];
  const r = validateGraph(issues);
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.cycles.length, 0);
});

test('validateGraph 重复 issue 号 → ok=false', () => {
  const r = validateGraph([
    { n: 1, blockers: [] },
    { n: 1, blockers: [] },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.kind === 'duplicate' && e.issue === 1));
});

test('validateGraph 缺失 blocker 引用 → ok=false', () => {
  const r = validateGraph([{ n: 1, blockers: [999] }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.kind === 'missing-blocker' && e.blocker === 999));
});

test('validateGraph 自我阻塞 → ok=false（self-ref + cycle 都报）', () => {
  const r = validateGraph([{ n: 7, blockers: [7] }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.kind === 'self-ref' && e.issue === 7));
  assert.ok(r.errors.some((e) => e.kind === 'cycle'));
});

test('validateGraph 环 → ok=false 且 cycles 出账', () => {
  const r = validateGraph([
    { n: 1, blockers: [2] },
    { n: 2, blockers: [1] },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.cycles.length, 1);
  assert.ok(r.errors.some((e) => e.kind === 'cycle'));
});

test('validateGraph 缺合法整数 n → shape 错', () => {
  const r = validateGraph([{ phase: 0, blockers: [] }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.kind === 'shape'));
});

test('validateGraph 非数组 → type 错（不抛）', () => {
  const r = validateGraph(null);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].kind, 'type');
});

// ── phasesInOrder：phase 迭代序 ──

test('phasesInOrder 数字 phase 升序去重', () => {
  const issues = [
    { n: 1, phase: 2 },
    { n: 2, phase: 0 },
    { n: 3, phase: 1 },
    { n: 4, phase: 0 },
  ];
  assert.deepEqual(phasesInOrder(issues), [0, 1, 2]);
});

test('phasesInOrder 跳过缺 phase 的项', () => {
  const issues = [{ n: 1, phase: 1 }, { n: 2 }, { n: 3, phase: 0 }];
  assert.deepEqual(phasesInOrder(issues), [0, 1]);
});

// ── 集成：SPEC §2 串行推进一个 5 issue DAG 直到全绿 ──

test('集成：依赖序推进 5-issue DAG，phase barrier 全绿前不放行', () => {
  // 1(独立) → 2,3(依赖1) → 4(依赖2,3) ；5 独立
  let issues = [
    { n: 1, phase: 1, blockers: [], state: 'open' },
    { n: 2, phase: 1, blockers: [1], state: 'open' },
    { n: 3, phase: 1, blockers: [1], state: 'open' },
    { n: 4, phase: 1, blockers: [2, 3], state: 'open' },
    { n: 5, phase: 1, blockers: [], state: 'open' },
  ];
  const greenify = (arr, nums) =>
    arr.map((it) => (nums.includes(it.n) ? { ...it, state: GREEN } : it));

  // pass 1：1 和 5 独立 → 并行前沿
  assert.deepEqual(readySet(1, issues).sort(), [1, 5]);
  assert.equal(phaseBarrier(1, issues).passed, false);

  // 完成 1、5
  issues = greenify(issues, [1, 5]);
  // pass 2：2、3 解锁（4 仍被 2/3 挡）
  assert.deepEqual(readySet(1, issues).sort(), [2, 3]);
  assert.equal(phaseBarrier(1, issues).passed, false);

  // 完成 2、3
  issues = greenify(issues, [2, 3]);
  // pass 3：4 解锁
  assert.deepEqual(readySet(1, issues), [4]);
  assert.equal(phaseBarrier(1, issues).passed, false);

  // 完成 4 → 全绿 → barrier 放行
  issues = greenify(issues, [4]);
  assert.deepEqual(readySet(1, issues), []);
  assert.equal(phaseBarrier(1, issues).passed, true);
});

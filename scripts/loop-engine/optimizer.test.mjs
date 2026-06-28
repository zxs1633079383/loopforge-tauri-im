// optimizer.test.mjs — node:test 真断言（LE-10·SPEC §9 ③）
// C008 可证伪：每条断言破坏实现即 fail·无墙钟下界·无 tautology。
// 核心被测不变量（issue #68）：任意输入 → 输出 N/K 恒在硬包络内（越界被钳）；optimizer 绝不改包络边界（改界=HITL）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENVELOPE,
  DEFAULT_K_BOUNDS,
  clampInt,
  normalizeEnvelope,
  isWithinEnvelope,
  applyRecommendation,
  optimize,
} from './optimizer.mjs';

// ── 默认硬界常量（issue #68：N∈[2,5] K∈[2,4]）─────────────────────────────
test('DEFAULT_ENVELOPE 硬界 = N∈[2,5] K∈[2,4]', () => {
  assert.equal(DEFAULT_ENVELOPE.Nmin, 2);
  assert.equal(DEFAULT_ENVELOPE.Nmax, 5);
  assert.equal(DEFAULT_K_BOUNDS.Kmin, 2);
  assert.equal(DEFAULT_K_BOUNDS.Kmax, 4);
  assert.equal(DEFAULT_ENVELOPE.Kmin, 2);
  assert.equal(DEFAULT_ENVELOPE.Kmax, 4);
});

// ── clampInt：边界与越界（非 tautology：界内/界上/界外三态可区分）────────────
test('clampInt 钳到 [lo,hi]·取整·非有限回退', () => {
  assert.equal(clampInt(3, 2, 5, 2), 3); // 界内原样
  assert.equal(clampInt(5, 2, 5, 2), 5); // 上界含
  assert.equal(clampInt(2, 2, 5, 5), 2); // 下界含
  assert.equal(clampInt(6, 2, 5, 2), 5); // 越上界 → 钳 5（≠6 证明真钳）
  assert.equal(clampInt(99, 2, 5, 2), 5);
  assert.equal(clampInt(-7, 2, 5, 5), 2); // 越下界 → 钳 2
  assert.equal(clampInt(3.4, 2, 5, 2), 3); // 取整 round
  assert.equal(clampInt(4.6, 2, 5, 2), 5);
  assert.equal(clampInt(NaN, 2, 5, 4), 4); // 非有限 → fallback
  assert.equal(clampInt(Infinity, 2, 5, 3), 3); // Infinity 非有限 → fallback（不产越界）
  assert.equal(clampInt(-Infinity, 2, 5, 4), 4); // 同上
  assert.equal(clampInt('x', 2, 5, 3), 3); // 非数 → fallback
  assert.equal(clampInt(undefined, 2, 5, 2), 2);
});

// ── normalizeEnvelope：损坏 / 越界入参收敛进合法硬包络 ──────────────────────
test('normalizeEnvelope：缺字段回退默认硬界', () => {
  const e = normalizeEnvelope({});
  assert.deepEqual(e, { N: 3, K: 3, Nmin: 2, Nmax: 5, Kmin: 2, Kmax: 4 });
});

test('normalizeEnvelope：当前 N/K 越界被强制钳进界（任意输入恒在界内）', () => {
  const e = normalizeEnvelope({ N: 99, K: -5 });
  assert.equal(e.N, 5); // 99 → Nmax
  assert.equal(e.K, 2); // -5 → Kmin
  assert.ok(isWithinEnvelope(e));
});

test('normalizeEnvelope：倒置边界回退默认（不信任损坏边界）', () => {
  const e = normalizeEnvelope({ Nmin: 9, Nmax: 1, Kmin: 8, Kmax: 0 });
  assert.equal(e.Nmin, 2);
  assert.equal(e.Nmax, 5);
  assert.equal(e.Kmin, 2);
  assert.equal(e.Kmax, 4);
});

test('normalizeEnvelope：自定义合法边界被尊重·当前值钳进自定义界', () => {
  const e = normalizeEnvelope({ N: 10, K: 10, Nmin: 3, Nmax: 4, Kmin: 2, Kmax: 3 });
  assert.equal(e.Nmin, 3);
  assert.equal(e.Nmax, 4);
  assert.equal(e.N, 4); // 10 钳到自定义 Nmax=4
  assert.equal(e.K, 3); // 10 钳到自定义 Kmax=3
  assert.ok(isWithinEnvelope(e));
});

test('normalizeEnvelope：非对象入参抛错', () => {
  assert.throws(() => normalizeEnvelope(null), TypeError);
  assert.throws(() => normalizeEnvelope([]), TypeError);
  assert.throws(() => normalizeEnvelope(42), TypeError);
});

test('normalizeEnvelope：不可变（不改入参）', () => {
  const input = { N: 99, K: 99 };
  normalizeEnvelope(input);
  assert.equal(input.N, 99); // 入参未被就地改
  assert.equal(input.K, 99);
});

// ── isWithinEnvelope 谓词 ───────────────────────────────────────────────────
test('isWithinEnvelope：界内 true·越界 false', () => {
  const base = { Nmin: 2, Nmax: 5, Kmin: 2, Kmax: 4 };
  assert.ok(isWithinEnvelope({ ...base, N: 3, K: 3 }));
  assert.ok(isWithinEnvelope({ ...base, N: 2, K: 4 })); // 边界含
  assert.equal(isWithinEnvelope({ ...base, N: 6, K: 3 }), false); // N 越上界
  assert.equal(isWithinEnvelope({ ...base, N: 1, K: 3 }), false); // N 越下界
  assert.equal(isWithinEnvelope({ ...base, N: 3, K: 5 }), false); // K 越上界
  assert.equal(isWithinEnvelope({ ...base, N: 3.5, K: 3 }), false); // 非整
  assert.equal(isWithinEnvelope(null), false);
});

// ── applyRecommendation：核心「越界被钳」───────────────────────────────────
test('applyRecommendation：界内建议原样应用·changed 标记', () => {
  const r = applyRecommendation(DEFAULT_ENVELOPE, { N: 4 });
  assert.equal(r.envelope.N, 4);
  assert.equal(r.envelope.K, 3); // 未建议 K → 保持
  assert.equal(r.changed, true);
  assert.equal(r.clamped.N, false); // 4 在界内·未钳
});

test('applyRecommendation：N 建议 99 → 钳到 Nmax=5（越界被钳·clamped 标真）', () => {
  const r = applyRecommendation(DEFAULT_ENVELOPE, { N: 99 });
  assert.equal(r.envelope.N, 5);
  assert.equal(r.clamped.N, true);
  assert.ok(isWithinEnvelope(r.envelope));
});

test('applyRecommendation：N 建议 -10 → 钳到 Nmin=2', () => {
  const r = applyRecommendation(DEFAULT_ENVELOPE, { N: -10 });
  assert.equal(r.envelope.N, 2);
  assert.equal(r.clamped.N, true);
});

test('applyRecommendation：K 建议 99/0 → 钳到 Kmax=4 / Kmin=2', () => {
  const hi = applyRecommendation(DEFAULT_ENVELOPE, { K: 99 });
  assert.equal(hi.envelope.K, 4);
  assert.equal(hi.clamped.K, true);
  const lo = applyRecommendation(DEFAULT_ENVELOPE, { K: 0 });
  assert.equal(lo.envelope.K, 2);
  assert.equal(lo.clamped.K, true);
});

test('applyRecommendation：损坏入参 envelope（N=99）+ 无建议 → 输出仍钳进界', () => {
  const r = applyRecommendation({ N: 99, K: 99 }, {});
  assert.equal(r.envelope.N, 5);
  assert.equal(r.envelope.K, 4);
  assert.ok(isWithinEnvelope(r.envelope));
  assert.equal(r.changed, false); // 相对规整后的 env 无旋钮改动
});

test('applyRecommendation：HITL — recommendation 夹带改界字段被忽略·边界恒不变', () => {
  const r = applyRecommendation(DEFAULT_ENVELOPE, { N: 4, Nmax: 100, Kmax: 100, Nmin: 0 });
  assert.equal(r.envelope.Nmax, 5); // 改界字段被忽略
  assert.equal(r.envelope.Nmin, 2);
  assert.equal(r.envelope.Kmax, 4);
  assert.equal(r.envelope.N, 4); // 旋钮照常生效
  assert.ok(isWithinEnvelope(r.envelope));
});

test('applyRecommendation：NaN 建议 → 保持当前值·不产 NaN', () => {
  const r = applyRecommendation({ ...DEFAULT_ENVELOPE, N: 4 }, { N: NaN });
  assert.equal(r.envelope.N, 4); // 回退当前值
  assert.equal(r.clamped.N, false); // 非有限 → 不算「越界被钳」
  assert.ok(isWithinEnvelope(r.envelope));
});

test('applyRecommendation：不可变（不改入参 envelope）', () => {
  const input = { ...DEFAULT_ENVELOPE };
  const snapshot = { ...input };
  applyRecommendation(input, { N: 99 });
  assert.deepEqual(input, snapshot);
});

test('applyRecommendation：非对象 recommendation 抛错', () => {
  assert.throws(() => applyRecommendation(DEFAULT_ENVELOPE, null), TypeError);
  assert.throws(() => applyRecommendation(DEFAULT_ENVELOPE, []), TypeError);
});

// ── 属性测试：任意输入恒在界内（issue #68 核心验收）─────────────────────────
test('属性：任意（含极端越界 / 非整 / 非数）建议 → 输出恒在硬包络内', () => {
  const candidates = [
    -1000, -7, -1, 0, 1, 2, 3, 4, 5, 6, 7, 100, 1000,
    2.5, 3.49, 4.51, NaN, Infinity, -Infinity, 'x', null, undefined, {},
  ];
  for (const n of candidates) {
    for (const k of candidates) {
      const r = applyRecommendation(DEFAULT_ENVELOPE, { N: n, K: k });
      assert.ok(
        isWithinEnvelope(r.envelope),
        `越界泄漏：N=${String(n)} K=${String(k)} → ${JSON.stringify(r.envelope)}`,
      );
    }
  }
});

test('属性：任意损坏 envelope 当前值 → normalize 后恒在界内', () => {
  const candidates = [-99, 0, 1, 6, 99, 2.5, NaN, Infinity, 'x', null, undefined];
  for (const n of candidates) {
    for (const k of candidates) {
      const e = normalizeEnvelope({ N: n, K: k });
      assert.ok(isWithinEnvelope(e), `normalize 泄漏：N=${String(n)} K=${String(k)}`);
    }
  }
});

// ── optimize 端到端：metrics 驱动决策 + 硬钳 ───────────────────────────────
test('optimize：高 churn（regen_rate≥0.3）→ 升 N·但钳在 Nmax', () => {
  // 当前 N 已在 Nmax=5：升 N 应被钳，不越界。
  const r = optimize(
    { regen_rate: 0.9, override_freq: 0, pattern_count: 0 },
    { gainEnvelope: { ...DEFAULT_ENVELOPE, N: 5 } },
  );
  assert.equal(r.envelope.N, 5); // 已在上界 → recommend 不给 delta（界内 ±1 也会被钳）
  assert.ok(isWithinEnvelope(r.envelope));
});

test('optimize：高 churn 从 N=3 → N=4（升一步·界内）', () => {
  const r = optimize(
    { regen_rate: 0.9, override_freq: 0, pattern_count: 0 },
    { gainEnvelope: { ...DEFAULT_ENVELOPE, N: 3 } },
  );
  assert.equal(r.envelope.N, 4);
  assert.equal(r.changed, true);
  assert.ok(isWithinEnvelope(r.envelope));
});

test('optimize：低 churn 且低人工干预 → 降 N 一步（省开销）', () => {
  const r = optimize(
    { regen_rate: 0.0, override_freq: 0.0, pattern_count: 0 },
    { gainEnvelope: { ...DEFAULT_ENVELOPE, N: 4 } },
  );
  assert.equal(r.envelope.N, 3);
  assert.ok(isWithinEnvelope(r.envelope));
});

test('optimize：pattern_count 较上一 pass 上升 → 降 K（早 quarantine）·钳在 Kmin', () => {
  const r = optimize(
    { regen_rate: 0.1, override_freq: 0, pattern_count: 5 },
    { gainEnvelope: { ...DEFAULT_ENVELOPE, K: 3 }, prevPatternCount: 2 },
  );
  assert.equal(r.envelope.K, 2); // 3→2
  assert.ok(isWithinEnvelope(r.envelope));
  // K 已在 Kmin 再降仍钳 2
  const r2 = optimize(
    { regen_rate: 0.1, override_freq: 0, pattern_count: 9 },
    { gainEnvelope: { ...DEFAULT_ENVELOPE, K: 2 }, prevPatternCount: 5 },
  );
  assert.equal(r2.envelope.K, 2);
});

test('optimize：useGivenRecommendation 直接采用 metrics.recommendation·改界字段被剥离', () => {
  const r = optimize(
    { regen_rate: 0, recommendation: { N: 99, Nmax: 100 } },
    { gainEnvelope: DEFAULT_ENVELOPE, useGivenRecommendation: true },
  );
  assert.equal(r.envelope.N, 5); // 99 钳到 Nmax
  assert.equal(r.envelope.Nmax, 5); // 夹带的 Nmax=100 被剥离
  assert.ok(isWithinEnvelope(r.envelope));
});

test('optimize：默认无 gainEnvelope → 用 DEFAULT_ENVELOPE', () => {
  const r = optimize({ regen_rate: 0.1, override_freq: 0.15, pattern_count: 0 });
  assert.ok(isWithinEnvelope(r.envelope));
  assert.equal(r.envelope.Nmin, 2);
  assert.equal(r.envelope.Nmax, 5);
});

test('optimize：幂等（稳态 metrics 连跑两次结果一致·不震荡）', () => {
  const m = { regen_rate: 0.1, override_freq: 0.15, pattern_count: 3 };
  const r1 = optimize(m, { gainEnvelope: { ...DEFAULT_ENVELOPE, N: 3, K: 3 } });
  const r2 = optimize(m, { gainEnvelope: r1.envelope });
  assert.deepEqual(r1.envelope, r2.envelope);
});

test('optimize：非对象 metrics 抛错', () => {
  assert.throws(() => optimize(null), TypeError);
  assert.throws(() => optimize([]), TypeError);
});

test('optimize：withinEnvelope 字段恒 true（不变量自证）', () => {
  const r = optimize(
    { regen_rate: 0.99, override_freq: 0.99, pattern_count: 100, recommendation: { N: 1e9, K: -1e9 } },
    { gainEnvelope: { N: 1e9, K: -1e9 }, useGivenRecommendation: true, prevPatternCount: 0 },
  );
  assert.equal(r.withinEnvelope, true);
  assert.ok(isWithinEnvelope(r.envelope));
});

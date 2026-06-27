// run.test.mjs — LE-8 编排器测试（真行为断言·C008 可证伪·禁 tautology）
//
// 覆盖：① dry-run 计划正确（phase 顺序 + 拓扑前沿波次 + 路由决策）
//      ② 安全阀生效（预算 / 连败 park / 收敛 / 再生隔离 quarantine / 防震荡）
//      ③ Learner(LE-11)/Architect(LE-12) 判定分支真触发
//      ④ append-only 不变量 + 确定性 + 图非法即拒（C008）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  runEngine,
  planDryRun,
  renderPlan,
  clampEnvelope,
  learnerDecide,
  architectDecide,
  finalStatusLine,
  makeStubAdapters,
  makeBudget,
  SAMPLE_VERDICTS,
} from './run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(here, 'fixtures', 'uc-rollout-issues.json'), 'utf8'));

// 确定性时间戳工厂（注入 now，杜绝墙钟·C008）
function makeNow() {
  let t = 0;
  return () => new Date(1700000000000 + t++ * 1000).toISOString();
}

// 脚本化 adapters：按 issue.n + attempt 决定 runReduce 结果。
function scriptedAdapters(script) {
  const base = makeStubAdapters();
  return {
    ...base,
    authorImplement: script.authorImplement || base.authorImplement,
    runReduce: script.runReduce,
    proposeHarnessCard: script.proposeHarnessCard || base.proposeHarnessCard,
    proposeDesign: script.proposeDesign || base.proposeDesign,
    retro: script.retro || base.retro,
  };
}

// ── ① dry-run 计划 ───────────────────────────────────────────────────────────

test('dry-run: phase 顺序 = 0→7（依赖序）', () => {
  const plan = planDryRun(FIXTURE);
  assert.ok(plan.ok, '依赖图应合法');
  assert.deepEqual(plan.phases, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(plan.issueCount, 34);
});

test('dry-run: phase 1 拓扑前沿分两波（#8 解锁 #9）', () => {
  const plan = planDryRun(FIXTURE);
  const p1 = plan.phasePlan.find((p) => p.phase === 1);
  assert.deepEqual(p1.waves, [[8], [9]], '#9 blocker=#8 → #8 绿后才入前沿');
  assert.ok(p1.barrier.passed);
});

test('dry-run: phase 2 三个独立项同波并行', () => {
  const plan = planDryRun(FIXTURE);
  const p2 = plan.phasePlan.find((p) => p.phase === 2);
  assert.deepEqual(p2.waves, [[10, 11, 12]], '同 blocker #8·无互相依赖 → 同波');
});

test('dry-run: phase 7 #40 被 #39 阻塞排到第二波', () => {
  const plan = planDryRun(FIXTURE);
  const p7 = plan.phasePlan.find((p) => p.phase === 7);
  assert.deepEqual(p7.waves, [[38, 39, 41], [40]], '#40 blocker=#39 → 后一波');
});

test('dry-run: 路由决策覆盖六诊断分支', () => {
  const plan = planDryRun(FIXTURE);
  assert.equal(plan.routingSamples.length, SAMPLE_VERDICTS.length);
  const byLabel = Object.fromEntries(plan.routingSamples.map((s) => [s.label, s.decision]));
  assert.equal(byLabel['四面全绿'].verdict, 'green');
  assert.equal(byLabel['①出站红·缺字段'].action, 'helix-branch-fix-repin');
  assert.equal(byLabel['③DOM红·投影有该字段'].action, 'loopforge-fix-binding');
  assert.equal(byLabel['③DOM红·缺语义区'].action, 'pencil-design-region');
  assert.equal(byLabel['后端挂(health 000)'].action, 'restart-cses-im-server');
  assert.equal(byLabel['契约过时(后端默认对·2 UC)'].verdict, 'park');
  assert.equal(byLabel['flaky(重跑绿)'].verdict, 'flaky');
  assert.equal(byLabel['需合 helix main(不可逆)'].reversible, false);
});

test('dry-run: renderPlan 文本含 phase 顺序与波次', () => {
  const txt = renderPlan(planDryRun(FIXTURE));
  assert.match(txt, /phase 顺序: \[0 → 1 → 2 → 3 → 4 → 5 → 6 → 7\]/);
  assert.match(txt, /wave 1: \[#9\]/);
  assert.match(txt, /wave 1: \[#40\]/);
});

test('planDryRun 拒绝非数组（C008 不静默吞）', () => {
  assert.throws(() => planDryRun('nope'), /必须是数组/);
});

test('dry-run: 依赖环 → ok=false 出账（C008）', () => {
  const cyclic = [
    { n: 1, phase: 0, blockers: [2], state: 'ready' },
    { n: 2, phase: 0, blockers: [1], state: 'ready' },
  ];
  const plan = planDryRun(cyclic);
  assert.equal(plan.ok, false);
  assert.ok(plan.graph.errors.some((e) => e.kind === 'cycle'));
});

// ── ② 编排 happy path ────────────────────────────────────────────────────────

test('runEngine: 全绿 stub → 34 绿·8 phase 全 tag·0 park', () => {
  const r = runEngine({ issues: FIXTURE, now: makeNow() });
  assert.ok(r.ok);
  assert.equal(r.issuesProcessed, 34);
  assert.deepEqual(r.taggedPhases, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(r.parkedPhases, []);
  assert.equal(r.state.issues.filter((i) => i.state === 'green').length, 34);
  assert.deepEqual(r.resumeManifest.phasesRemaining, []);
  assert.match(r.finalLine, /✅ 34 绿 \/ 0 park \/ 0 quarantine/);
});

// ── ③ 安全阀 ─────────────────────────────────────────────────────────────────

test('安全阀·预算：remaining<15% → 立即停·0 处理', () => {
  const r = runEngine({ issues: FIXTURE, now: makeNow(), budget: makeBudget(0.1) });
  assert.equal(r.stoppedBy, 'budgetGuard');
  assert.equal(r.issuesProcessed, 0);
  assert.deepEqual(r.taggedPhases, []);
});

test('安全阀·收敛：连 2 pass 全 flaky(无新绿无新 gap) → settled 停', () => {
  // 单 issue·每次 attempt0 红 / attempt1 绿 → flaky（不绿不 gap）
  const adapters = scriptedAdapters({
    runReduce: (_issue, { attempt }) =>
      attempt === 0
        ? { rawVerdict: 'red', brokenFacet: 'storage', logFeatures: {} }
        : { rawVerdict: 'green', brokenFacet: null, logFeatures: {} },
  });
  const issues = [{ n: 1, phase: 0, blockers: [], uc: '0.1', state: 'ready' }];
  const r = runEngine({ issues, adapters, now: makeNow() });
  assert.equal(r.stoppedBy, 'settled');
  // flaky 不污染：无 gap、无绿
  assert.equal(r.state.gapLedger.length, 0);
  assert.equal(r.state.issues[0].state, 'ready');
});

test('安全阀·连败 park：always-red issue 连败 3 次 → parked', () => {
  const adapters = scriptedAdapters({
    runReduce: () => ({ rawVerdict: 'red', brokenFacet: 'projection', logFeatures: { missing: 'field_x' } }),
  });
  const issues = [{ n: 1, phase: 0, blockers: [], uc: '0.1', state: 'ready' }];
  const r = runEngine({ issues, adapters, now: makeNow() });
  assert.equal(r.state.issues[0].state, 'parked');
  assert.deepEqual(r.parkedPhases, [0]); // phase barrier 未过
  // 连败 park 事件存在
  assert.ok(r.events.some((e) => e.type === 'parked' && e.issue === 1));
});

test('安全阀·再生隔离：同 sig 复燃 3 次 → quarantine 事件', () => {
  const adapters = scriptedAdapters({
    runReduce: () => ({ rawVerdict: 'red', brokenFacet: 'projection', logFeatures: { missing: 'same_field' } }),
  });
  const issues = [{ n: 1, phase: 0, blockers: [], uc: '0.1', state: 'ready' }];
  const r = runEngine({ issues, adapters, now: makeNow() });
  const quar = r.events.filter((e) => e.type === 'quarantine');
  assert.equal(quar.length, 1);
  assert.equal(quar[0].regen, 3);
  assert.ok(r.state.gapLedger.some((g) => g.state === 'quarantine'));
});

test('安全阀·防震荡：同 UC 一 pass 内不重复处理', () => {
  // 同一 issue 在前沿只出现一次/ pass；antiThrash 守 touchLog。
  // 用一个会一直红的 issue 跑两个 pass：每 pass 只处理 1 次（fail 计数线性增长）。
  let calls = 0;
  const adapters = scriptedAdapters({
    runReduce: () => {
      calls++;
      return { rawVerdict: 'red', brokenFacet: 'projection', logFeatures: { missing: 'f' } };
    },
  });
  const issues = [{ n: 1, phase: 0, blockers: [], uc: '0.1', state: 'ready' }];
  runEngine({ issues, adapters, now: makeNow() });
  // 3 pass × (1 attempt0 + 1 retry attempt1) = 6 次；若 antiThrash 失效会爆量。
  assert.equal(calls, 6);
});

// ── ④ Learner(LE-11) / Architect(LE-12) ─────────────────────────────────────

test('Learner: 同根因(sig) ≥3 → 触发 harness card 提示', () => {
  const cards = [];
  const adapters = scriptedAdapters({
    runReduce: () => ({ rawVerdict: 'red', brokenFacet: 'projection', logFeatures: { missing: 'recur' } }),
    proposeHarnessCard: (hit) => cards.push(hit),
  });
  const issues = [{ n: 1, phase: 0, blockers: [], uc: '0.1', state: 'ready' }];
  const r = runEngine({ issues, adapters, now: makeNow() });
  assert.equal(r.learnerHints.length, 1);
  assert.equal(r.learnerHints[0].count, 3);
  assert.equal(cards.length, 1, 'proposeHarnessCard 注入点被调一次');
});

test('Architect: 同类 gap 跨 2 个不同 sig → 触发设计提案', () => {
  const designs = [];
  // 两个 issue·同 projection 面·不同 missing → 同 gapKind·不同 sig
  const adapters = scriptedAdapters({
    runReduce: (issue) => ({
      rawVerdict: 'red',
      brokenFacet: 'projection',
      logFeatures: { missing: `field_${issue.n}` },
    }),
    proposeDesign: (hit) => designs.push(hit),
  });
  const issues = [
    { n: 1, phase: 0, blockers: [], uc: '0.1', state: 'ready' },
    { n: 2, phase: 0, blockers: [], uc: '0.2', state: 'ready' },
  ];
  const r = runEngine({ issues, adapters, now: makeNow() });
  assert.ok(r.architectHints.some((h) => h.gapKind === 'projection-business' && h.distinctSigs >= 2));
  assert.ok(designs.length >= 1, 'proposeDesign 注入点被调');
});

// ── ⑤ 路由 → gap 回流 / park ─────────────────────────────────────────────────

test('路由·契约过时 → park（不开回流 fix·不可逆）', () => {
  const adapters = scriptedAdapters({
    runReduce: () => ({
      rawVerdict: 'red',
      brokenFacet: 'projection',
      logFeatures: { backendDefaultCorrect: true, corroboratingUCs: 2 },
    }),
  });
  const issues = [{ n: 1, phase: 0, blockers: [], uc: '0.1', state: 'ready' }];
  const r = runEngine({ issues, adapters, now: makeNow() });
  assert.equal(r.state.issues[0].state, 'parked');
  assert.ok(r.events.some((e) => e.type === 'parked' && e.reason === 'contract-stale'));
  // 契约过时是 park 非 fix → 不应产生 fix 事件
  assert.equal(r.events.filter((e) => e.type === 'fix').length, 0);
});

test('路由·outbound 红 → helix 分支修(可逆 fix)·开回流 + fix 事件', () => {
  const adapters = scriptedAdapters({
    runReduce: (_i, { pass }) =>
      pass === 0
        ? { rawVerdict: 'red', brokenFacet: 'outbound', logFeatures: { missing: 'channelId' } }
        : { rawVerdict: 'green', brokenFacet: null, logFeatures: {} }, // 修后转绿
  });
  const issues = [{ n: 1, phase: 0, blockers: [], uc: '0.1', state: 'ready' }];
  const r = runEngine({ issues, adapters, now: makeNow() });
  // pass0 gap+fix，pass1 绿
  assert.ok(r.events.some((e) => e.type === 'fix' && e.repo === 'helix' && e.facet === 'outbound'));
  assert.ok(r.events.some((e) => e.type === 'gap_emit'));
  assert.equal(r.state.issues[0].state, 'green', '修复后下一 pass 转绿收口');
});

// ── ⑥ 控制面纯函数 ───────────────────────────────────────────────────────────

test('clampEnvelope: N 越界夹回·K 透传·null 无副作用', () => {
  const env = { N: 3, K: 3, Nmin: 2, Nmax: 5 };
  assert.deepEqual(clampEnvelope(env, { N: 9 }), { N: 5, K: 3, Nmin: 2, Nmax: 5 });
  assert.deepEqual(clampEnvelope(env, { N: 0 }), { N: 2, K: 3, Nmin: 2, Nmax: 5 });
  assert.deepEqual(clampEnvelope(env, { K: 7 }), { N: 3, K: 7, Nmin: 2, Nmax: 5 });
  assert.deepEqual(clampEnvelope(env, null), env);
  assert.notEqual(clampEnvelope(env, null), env, '返回新对象（不就地改）');
});

test('learnerDecide: 阈值边界（2 不触·3 触）', () => {
  assert.deepEqual(learnerDecide({ a: 2 }), []);
  assert.deepEqual(learnerDecide({ a: 3, b: 1 }), [{ sig: 'a', count: 3 }]);
  const m = new Map([['x', 5]]);
  assert.deepEqual(learnerDecide(m), [{ sig: 'x', count: 5 }]);
});

test('architectDecide: 单 sig 不触·2 distinct sig 触', () => {
  assert.deepEqual(architectDecide(new Map([['k', new Set(['s1'])]])), []);
  assert.deepEqual(architectDecide(new Map([['k', new Set(['s1', 's2'])]])), [
    { gapKind: 'k', distinctSigs: 2 },
  ]);
});

test('finalStatusLine: 计数 + 趋势格式', () => {
  const state = {
    issues: [{ state: 'green' }, { state: 'parked' }, { state: 'ready' }],
    gapLedger: [{ state: 'quarantine' }],
    patternTrend: [3, 2, 1],
  };
  assert.match(finalStatusLine(state), /✅ 1 绿 \/ 1 park \/ 1 quarantine · pattern 趋势 3 → 2 → 1 \(↓\)/);
});

// ── ⑦ 不变量：append-only + 确定性 ───────────────────────────────────────────

test('append-only：runEngine 不就地改入参 issues/events', () => {
  const issuesCopy = FIXTURE.map((i) => ({ ...i }));
  const events = [];
  runEngine({ issues: issuesCopy, events, now: makeNow() });
  assert.equal(events.length, 0, 'caller 的 events 数组未被改');
  assert.equal(issuesCopy[0].state, 'ready', 'caller 的 issues 未被改');
});

test('确定性：同输入两次跑 → events 长度与终态行一致', () => {
  const r1 = runEngine({ issues: FIXTURE, now: makeNow() });
  const r2 = runEngine({ issues: FIXTURE, now: makeNow() });
  assert.equal(r1.events.length, r2.events.length);
  assert.equal(r1.finalLine, r2.finalLine);
});

test('图非法（环）→ runEngine ok=false + 不推进', () => {
  const cyclic = [
    { n: 1, phase: 0, blockers: [2], state: 'ready' },
    { n: 2, phase: 0, blockers: [1], state: 'ready' },
  ];
  const r = runEngine({ issues: cyclic, now: makeNow() });
  assert.equal(r.ok, false);
  assert.equal(r.stoppedBy, 'invalid-graph');
  assert.ok(r.graphErrors.some((e) => e.kind === 'cycle'));
});

test('resume manifest：跨天续跑锚点字段齐备', () => {
  const r = runEngine({ issues: FIXTURE, now: makeNow(), resumeFromRunId: 'run-42' });
  assert.equal(r.resumeManifest.resumeFromRunId, 'run-42');
  assert.equal(typeof r.resumeManifest.logCursor, 'number');
  assert.ok(Array.isArray(r.resumeManifest.phasesRemaining));
  assert.ok(r.resumeManifest.gainEnvelope.N >= 2);
});

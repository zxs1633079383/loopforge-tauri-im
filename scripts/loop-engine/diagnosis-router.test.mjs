// diagnosis-router.test.mjs — node:test 真断言（C008 可证伪：破坏即 fail）
// 覆盖 SPEC §4 路由全表 + issue #63 验收清单。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  route,
  FACET,
  REPO,
  VERDICT,
  ACTION,
  GAP_KIND,
  CONTRACT_STALE_MIN_UCS,
} from './diagnosis-router.mjs';

// ── SPEC §4 行 ① 出站红 → helix 分支修（可逆自决）────────────────────────
test('①出站红·body 缺字段 → helix wire 构造修·可逆自决', () => {
  const r = route({ brokenFacet: FACET.OUTBOUND }, { outboundAllZero: false });
  assert.equal(r.verdict, VERDICT.FIX);
  assert.equal(r.faultRepo, REPO.HELIX);
  assert.equal(r.reversible, true);
  assert.equal(r.action, ACTION.HELIX_BRANCH_FIX);
  assert.equal(r.gapKind, GAP_KIND.WIRE_BUILD);
});

// ── SPEC §4 行 ② ④ 投影/落库红 → helix 投影/业务修 ───────────────────────
test('②投影红 → helix 投影/业务修·可逆自决', () => {
  const r = route({ brokenFacet: FACET.PROJECTION }, {});
  assert.equal(r.verdict, VERDICT.FIX);
  assert.equal(r.faultRepo, REPO.HELIX);
  assert.equal(r.reversible, true);
  assert.equal(r.gapKind, GAP_KIND.PROJECTION_BUSINESS);
});

test('④落库红 → helix 投影/业务修·可逆自决', () => {
  const r = route({ brokenFacet: FACET.STORAGE }, {});
  assert.equal(r.faultRepo, REPO.HELIX);
  assert.equal(r.action, ACTION.HELIX_BRANCH_FIX);
  assert.equal(r.gapKind, GAP_KIND.PROJECTION_BUSINESS);
});

test('③DOM 红但投影也缺该字段 → 仍是 helix（投影未吐）·非壳绑定', () => {
  const r = route({ brokenFacet: FACET.DOM }, { projectionHasField: false });
  assert.equal(r.faultRepo, REPO.HELIX);
  assert.equal(r.gapKind, GAP_KIND.PROJECTION_BUSINESS);
});

// ── SPEC §4 行 ③ DOM 红·投影有该字段 → loopforge 壳绑定（C013）────────────
test('③DOM 红·投影有该字段·语义区存在 → loopforge 修绑定·可逆', () => {
  const r = route(
    { brokenFacet: FACET.DOM },
    { projectionHasField: true, domRegionExists: true }
  );
  assert.equal(r.verdict, VERDICT.FIX);
  assert.equal(r.faultRepo, REPO.LOOPFORGE);
  assert.equal(r.reversible, true);
  assert.equal(r.action, ACTION.FIX_BINDING);
  assert.equal(r.gapKind, GAP_KIND.UI_BINDING);
});

test('③DOM 红·投影有该字段·缺语义区 → loopforge pencil 设计回流（§6）', () => {
  const r = route(
    { brokenFacet: FACET.DOM },
    { projectionHasField: true, domRegionExists: false }
  );
  assert.equal(r.faultRepo, REPO.LOOPFORGE);
  assert.equal(r.action, ACTION.PENCIL_DESIGN);
  assert.equal(r.gapKind, GAP_KIND.UI_DESIGN);
});

// ── SPEC §4 行 health 000 → 重启 cses-im-server（仅重启）─────────────────
test('health 0 → 重启 cses-im-server·可逆·仅重启不改逻辑', () => {
  const r = route({ brokenFacet: FACET.OUTBOUND }, { health: 0 });
  assert.equal(r.verdict, VERDICT.FIX);
  assert.equal(r.faultRepo, REPO.CSES);
  assert.equal(r.reversible, true);
  assert.equal(r.action, ACTION.RESTART_BACKEND);
  assert.equal(r.gapKind, GAP_KIND.BACKEND_DOWN);
});

test("health '000' 字符串 → 同样判后端挂", () => {
  const r = route({ brokenFacet: FACET.PROJECTION }, { health: '000' });
  assert.equal(r.faultRepo, REPO.CSES);
  assert.equal(r.action, ACTION.RESTART_BACKEND);
});

test('出站全 000 且日志无 listening → 后端挂·重启', () => {
  const r = route(
    { brokenFacet: FACET.OUTBOUND },
    { outboundAllZero: true, backendListening: false }
  );
  assert.equal(r.faultRepo, REPO.CSES);
  assert.equal(r.action, ACTION.RESTART_BACKEND);
});

test('出站全 000 但日志有 listening → 不判后端挂（落到 helix wire 修）', () => {
  // 证伪护栏：listening=true 时不得误判后端挂（否则永远重启不修真因）
  const r = route(
    { brokenFacet: FACET.OUTBOUND },
    { outboundAllZero: true, backendListening: true }
  );
  assert.notEqual(r.faultRepo, REPO.CSES);
  assert.equal(r.faultRepo, REPO.HELIX);
});

// ── SPEC §4 行 四面 diff·≥2 UC 佐证 → 契约提案 park（不可逆）──────────────
test('四面 diff·后端默认对·≥2 UC 佐证 → 契约提案 park·不可逆', () => {
  const r = route(
    { brokenFacet: FACET.OUTBOUND },
    { backendDefaultCorrect: true, corroboratingUCs: CONTRACT_STALE_MIN_UCS }
  );
  assert.equal(r.verdict, VERDICT.PARK);
  assert.equal(r.reversible, false);
  assert.equal(r.action, ACTION.PARK_CONTRACT);
  assert.equal(r.gapKind, GAP_KIND.CONTRACT_STALE);
  assert.equal(r.faultRepo, null);
});

test('仅 1 UC 佐证 → 不达 ≥2 阈值 → 不 park，落到 helix 修（证伪阈值）', () => {
  // 证伪护栏：阈值必须真生效，1 UC 不得橡皮章成契约 park
  const r = route(
    { brokenFacet: FACET.OUTBOUND },
    { backendDefaultCorrect: true, corroboratingUCs: 1 }
  );
  assert.notEqual(r.verdict, VERDICT.PARK);
  assert.equal(r.faultRepo, REPO.HELIX);
});

test('后端默认对未声明 → 即使多 UC 也不契约 park（需后端默认对前提）', () => {
  const r = route(
    { brokenFacet: FACET.PROJECTION },
    { corroboratingUCs: 5 } // backendDefaultCorrect 缺
  );
  assert.notEqual(r.verdict, VERDICT.PARK);
  assert.equal(r.faultRepo, REPO.HELIX);
});

// ── SPEC §4 行 单次红·重跑绿 → flaky（不开 gap）─────────────────────────
test('单次红·重跑绿 → flaky·不开 gap', () => {
  const r = route({ brokenFacet: FACET.STORAGE }, { rerunGreen: true });
  assert.equal(r.verdict, VERDICT.FLAKY);
  assert.equal(r.action, ACTION.RETRY_ONCE);
  assert.equal(r.gapKind, GAP_KIND.FLAKY);
  assert.equal(r.faultRepo, null);
});

test('flaky 优先级最高：rerunGreen 压过红 facet（不误开 gap）', () => {
  // 若 flaky 未优先，会被误路由到 helix 开 gap → 污染 gap-ledger
  const r = route(
    { brokenFacet: FACET.OUTBOUND },
    { rerunGreen: true, requiresHelixMainMerge: true }
  );
  assert.equal(r.verdict, VERDICT.FLAKY);
});

// ── issue #63：helix 合 main → park；cses-im-server 不改逻辑 ───────────────
test('helix 修需合 main（对外发布）→ park·不可逆', () => {
  const r = route(
    { brokenFacet: FACET.OUTBOUND },
    { requiresHelixMainMerge: true }
  );
  assert.equal(r.verdict, VERDICT.PARK);
  assert.equal(r.faultRepo, REPO.HELIX);
  assert.equal(r.reversible, false);
  assert.equal(r.action, ACTION.PARK_HELIX_MAIN);
  assert.equal(r.gapKind, GAP_KIND.HELIX_MAIN_MERGE);
});

test('helix 分支修可逆 vs 合 main 不可逆：可逆性必须区分（非 tautology）', () => {
  const branch = route({ brokenFacet: FACET.PROJECTION }, {});
  const main = route({ brokenFacet: FACET.PROJECTION }, { requiresHelixMainMerge: true });
  assert.equal(branch.reversible, true);
  assert.equal(main.reversible, false);
  assert.notEqual(branch.verdict, main.verdict);
});

test('cses-im-server 路由只产 restart 动作·永不产改逻辑动作', () => {
  const r = route({ brokenFacet: FACET.OUTBOUND }, { health: '000' });
  assert.equal(r.faultRepo, REPO.CSES);
  assert.equal(r.action, ACTION.RESTART_BACKEND);
  // 后端永远只重启：动作集合里没有任何「改 cses 逻辑」的动作
  assert.ok(r.action === ACTION.RESTART_BACKEND);
});

test('backend down 优先于契约 park（infra 根因先于契约怀疑）', () => {
  const r = route(
    { brokenFacet: FACET.OUTBOUND },
    { health: 0, backendDefaultCorrect: true, corroboratingUCs: 3 }
  );
  assert.equal(r.faultRepo, REPO.CSES);
  assert.equal(r.action, ACTION.RESTART_BACKEND);
});

// ── green / 输入校验（C008 不静默吞坏输入）────────────────────────────────
test('brokenFacet=null → green·无动作', () => {
  const r = route({ brokenFacet: null }, {});
  assert.equal(r.verdict, VERDICT.GREEN);
  assert.equal(r.action, ACTION.NONE);
  assert.equal(r.faultRepo, null);
});

test('logFeatures 省略 → 默认空·green facet=null 正常', () => {
  const r = route({ brokenFacet: null });
  assert.equal(r.verdict, VERDICT.GREEN);
});

test('未知 brokenFacet → 抛 RangeError（不静默吞）', () => {
  assert.throws(() => route({ brokenFacet: 'bogus' }, {}), /未知 brokenFacet/);
});

test('reducerVerdict 非对象 → 抛 TypeError', () => {
  assert.throws(() => route(null, {}), /reducerVerdict/);
  assert.throws(() => route('outbound', {}), /reducerVerdict/);
});

test('每条结论都带 reason 说明（可审计·非空）', () => {
  const samples = [
    route({ brokenFacet: null }, {}),
    route({ brokenFacet: FACET.OUTBOUND }, {}),
    route({ brokenFacet: FACET.DOM }, { projectionHasField: true, domRegionExists: true }),
    route({ brokenFacet: FACET.OUTBOUND }, { health: 0 }),
    route({ brokenFacet: FACET.STORAGE }, { rerunGreen: true }),
  ];
  for (const r of samples) {
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.length > 0);
  }
});

// gap-emitter.test.mjs — node:test 真断言（C008 可证伪：破坏即 fail·禁 tautology）
// 覆盖 issue #64 验收：同输入同 sig·易变量剥离稳定·dedup 不重开·复现 reopen·kind→label 路由正确。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  sig,
  emitGap,
  normalizeVolatile,
  routeOf,
  labelsFor,
  buildIssue,
  makeGhCli,
  makeDryRunGh,
  GapKind,
  Facet,
  ROUTE_TABLE,
  CONTRACT_STALE_MIN_UCS,
} from './gap-emitter.mjs';

// 造一个 fake gh，记录所有调用（可断言 emitGap 真的 create/reopen 了）。
function fakeGh() {
  const calls = { created: [], reopened: [] };
  let next = 100;
  return {
    calls,
    createIssue(params) {
      next += 1;
      calls.created.push({ params, number: next });
      return { number: next };
    },
    reopenIssue(number, comment) {
      calls.reopened.push({ number, comment });
    },
  };
}

// ── classify：Part 2.4 决策树全路径 ─────────────────────────────────────────

test('classify: health != 200 → backend-down（先于一切）', () => {
  // 即便 facet=dom + 语义区在，health 挂也优先 backend-down
  const k = classify({ uc_id: 'UC-1.1', facet: Facet.DOM, health: 502, evidence: { semanticRegionPresent: true, projectionHasField: true } });
  assert.equal(k, GapKind.BACKEND_DOWN);
});

test('classify: facet=coverage → coverage-hole', () => {
  assert.equal(classify({ uc_id: 'UC-9.9', facet: Facet.COVERAGE, evidence: { missing: 'POST /x' } }), GapKind.COVERAGE_HOLE);
});

test('classify: dom + 投影有字段 + 语义区在 → ui-bind', () => {
  const k = classify({ uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { projectionHasField: true, semanticRegionPresent: true, missing: 'data-pin-state' } });
  assert.equal(k, GapKind.UI_BIND);
});

test('classify: dom + 投影有字段 + 语义区不在 → ui-design', () => {
  const k = classify({ uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { projectionHasField: true, semanticRegionPresent: false, missing: 'data-pin-state' } });
  assert.equal(k, GapKind.UI_DESIGN);
});

test('classify: dom + 投影根本没该字段 → logic-red（缺投影非缺 UI·C013）', () => {
  const k = classify({ uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { projectionHasField: false, missing: 'data-pin-state' } });
  assert.equal(k, GapKind.LOGIC_RED);
});

test('classify: outbound 单次失配 → logic-red（默认改实现·C004）', () => {
  const k = classify({ uc_id: 'UC-1.1', facet: Facet.OUTBOUND, evidence: { corroboration: 1, missing: 'urgent' } });
  assert.equal(k, GapKind.LOGIC_RED);
});

test('classify: outbound ≥2 UC 佐证 + 后端默认对 → contract-stale', () => {
  const k = classify({ uc_id: 'UC-1.1', facet: Facet.OUTBOUND, evidence: { corroboration: 2, backendConsistent: true, missing: 'urgent' } });
  assert.equal(k, GapKind.CONTRACT_STALE);
});

test('classify: ≥2 UC 佐证但后端未确认一致 → 仍 logic-red（不轻易动契约）', () => {
  const k = classify({ uc_id: 'UC-1.1', facet: Facet.STORAGE, evidence: { corroboration: 3, backendConsistent: false, missing: 'seq' } });
  assert.equal(k, GapKind.LOGIC_RED);
});

test('classify: 未知 facet 即抛（C008 可证伪·不静默吞）', () => {
  assert.throws(() => classify({ uc_id: 'X', facet: 'bogus', evidence: {} }), /未知 facet/);
});

test('classify: CONTRACT_STALE_MIN_UCS 常量 = 2（C004 判据）', () => {
  assert.equal(CONTRACT_STALE_MIN_UCS, 2);
});

// ── sig：同输入同指纹 + 易变量剥离稳定（Sentry 教训）──────────────────────

test('sig: 同输入 → 同 sig（确定性·40-hex）', () => {
  const gap = { uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { projectionHasField: true, semanticRegionPresent: false, missing: 'data-pin-state' } };
  const a = sig(gap);
  const b = sig({ ...gap, evidence: { ...gap.evidence } });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test('sig: tmp_id 不同 → 同 sig（剥离 tmp_id）', () => {
  const base = { uc_id: 'UC-3.2', facet: Facet.OUTBOUND, evidence: { corroboration: 1 } };
  const a = sig({ ...base, evidence: { ...base.evidence, missing: 'row tmp_17 缺 seq' } });
  const b = sig({ ...base, evidence: { ...base.evidence, missing: 'row tmp_99 缺 seq' } });
  assert.equal(a, b);
});

test('sig: 时间戳/server_id 不同 → 同 sig（剥离 ts + 长 hex + 长数字）', () => {
  const base = { uc_id: 'UC-2.1', facet: Facet.STORAGE, evidence: { corroboration: 1 } };
  const a = sig({ ...base, evidence: { ...base.evidence, missing: 'msg deadbeefcafe1234 at 2026-06-28T10:00:00.123Z seq 1717000000000' } });
  const b = sig({ ...base, evidence: { ...base.evidence, missing: 'msg ffeeddccbbaa9988 at 2026-06-28T11:30:45Z seq 1717999999999' } });
  assert.equal(a, b);
});

test('sig: corr_key（天然 volatile）不进指纹 → 不影响 sig', () => {
  const base = { uc_id: 'UC-1.1', facet: Facet.OUTBOUND, evidence: { missing: 'urgent', corroboration: 1 } };
  const a = sig({ ...base, corr_key: 'ch_a#tmp_1' });
  const b = sig({ ...base, corr_key: 'ch_z#tmp_999' });
  assert.equal(a, b);
});

test('sig: 实质不同（不同 missing 根因）→ 不同 sig（证伪：不是恒等返回）', () => {
  const base = { uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { projectionHasField: true, semanticRegionPresent: false } };
  const a = sig({ ...base, evidence: { ...base.evidence, missing: 'data-pin-state' } });
  const b = sig({ ...base, evidence: { ...base.evidence, missing: 'data-read-state' } });
  assert.notEqual(a, b);
});

test('sig: 不同 uc_id / facet / kind → 不同 sig', () => {
  const ev = { missing: 'x', projectionHasField: true, semanticRegionPresent: false, corroboration: 1 };
  const dom = sig({ uc_id: 'UC-1', facet: Facet.DOM, evidence: ev }); // ui-design
  const out = sig({ uc_id: 'UC-1', facet: Facet.OUTBOUND, evidence: ev }); // logic-red
  const uc2 = sig({ uc_id: 'UC-2', facet: Facet.DOM, evidence: ev });
  assert.notEqual(dom, out);
  assert.notEqual(dom, uc2);
});

test('normalizeVolatile: 占位符替换正确（直接可证伪）', () => {
  assert.equal(normalizeVolatile('a tmp_17 b'), 'a tmp_<ID> b');
  assert.equal(normalizeVolatile('t 2026-06-28T10:00:00Z e'), 't <TS> e');
  assert.equal(normalizeVolatile('id deadbeefcafe end'), 'id <HEX> end');
  assert.equal(normalizeVolatile('n 1717000000000 z'), 'n <N> z');
});

// ── 路由表：kind → label（Part 2.5）──────────────────────────────────────────

test('routeOf/labelsFor: logic-red → ready-for-agent + gap:logic·弧 A·auto', () => {
  const r = routeOf(GapKind.LOGIC_RED);
  assert.equal(r.triage, 'ready-for-agent');
  assert.deepEqual(r.gapLabels, ['gap:logic']);
  assert.equal(r.arc, 'A');
  assert.equal(r.runner, 'auto');
  assert.deepEqual(labelsFor(GapKind.LOGIC_RED), ['ready-for-agent', 'gap:logic']);
});

test('routeOf/labelsFor: contract-stale → ready-for-human + gap:contract·弧 B·human', () => {
  const r = routeOf(GapKind.CONTRACT_STALE);
  assert.equal(r.triage, 'ready-for-human');
  assert.equal(r.arc, 'B');
  assert.equal(r.runner, 'human');
  assert.deepEqual(labelsFor(GapKind.CONTRACT_STALE), ['ready-for-human', 'gap:contract']);
});

test('routeOf/labelsFor: ui-bind → gap:ui-bind·弧 C·auto', () => {
  assert.deepEqual(labelsFor(GapKind.UI_BIND), ['ready-for-agent', 'gap:ui-bind']);
  assert.equal(routeOf(GapKind.UI_BIND).arc, 'C');
});

test('routeOf/labelsFor: ui-design → gap:ui-design + needs-pencil·弧 C', () => {
  assert.deepEqual(labelsFor(GapKind.UI_DESIGN), ['ready-for-agent', 'gap:ui-design', 'needs-pencil']);
});

test('routeOf/labelsFor: coverage-hole → gap:coverage·弧 frontend', () => {
  assert.deepEqual(labelsFor(GapKind.COVERAGE_HOLE), ['ready-for-agent', 'gap:coverage']);
  assert.equal(routeOf(GapKind.COVERAGE_HOLE).arc, 'frontend');
});

test('routeOf: backend-down → 无 triage·不开 issue·仅 ops 告警', () => {
  const r = routeOf(GapKind.BACKEND_DOWN);
  assert.equal(r.triage, null);
  assert.equal(r.opensIssue, false);
  assert.equal(r.runner, 'alert');
  assert.deepEqual(labelsFor(GapKind.BACKEND_DOWN), []);
});

test('routeOf: 未知 kind 即抛（C008）', () => {
  assert.throws(() => routeOf('nope'), /未知 GapKind/);
});

test('ROUTE_TABLE 覆盖全 6 个 GapKind（无遗漏）', () => {
  const kinds = Object.values(GapKind);
  for (const k of kinds) assert.ok(ROUTE_TABLE[k], `路由表缺 ${k}`);
  assert.equal(Object.keys(ROUTE_TABLE).length, kinds.length);
});

// ── buildIssue：body 含 gap-key + 正确标签（Part 2.7）─────────────────────────

test('buildIssue: title/labels/body 结构正确·body 嵌 gap-key 注释', () => {
  const gap = { uc_id: 'UC-3.2', facet: Facet.DOM, corr_key: 'ch_abc#tmp_17', blockedBy: [40], evidence: { missing: 'data-pin-state', semanticRegionPresent: false, projectionHasField: true, corroboration: 1 } };
  const s = sig(gap);
  const issue = buildIssue(gap, GapKind.UI_DESIGN, s);
  assert.equal(issue.title, '[gap] UC-3.2 facet:dom missing data-pin-state');
  assert.deepEqual(issue.labels, ['ready-for-agent', 'gap:ui-design', 'needs-pencil']);
  assert.ok(issue.body.includes(`<!-- gap-key: ${s} -->`));
  assert.ok(issue.body.includes('**kind**: ui-design'));
  assert.ok(issue.body.includes('#40')); // blocked by
  assert.ok(issue.body.includes('pencil')); // ui-design 建议
});

// ── emitGap：create / dedup / reopen / alert（Part 2.6 心脏）─────────────────

const fixedNow = () => '2026-06-28T00:00:00.000Z';

test('emitGap: 新 sig → created（开 issue + 追 ledger + 写 gap_emit 事件）', () => {
  const gh = fakeGh();
  const gap = { uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { missing: 'data-pin-state', semanticRegionPresent: true, projectionHasField: true } };
  const r = emitGap(gap, { gh, now: fixedNow });
  assert.equal(r.action, 'created');
  assert.equal(r.kind, GapKind.UI_BIND);
  assert.equal(gh.calls.created.length, 1); // 真调了 createIssue
  assert.equal(r.issue, 101);
  // ledger 追了一条 open 条目
  assert.equal(r.ledger.length, 1);
  assert.equal(r.ledger[0].state, 'open');
  assert.equal(r.ledger[0].sig, r.sig);
  // events 追了一条 gap_emit
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'gap_emit');
  assert.equal(r.events[0].issue, 101);
  assert.equal(r.events[0].kind, GapKind.UI_BIND);
});

test('emitGap: 同 sig 已 open → deduped（不重开 issue·不重写事件·bump last_seen）', () => {
  const gh = fakeGh();
  const gap = { uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { missing: 'data-pin-state', semanticRegionPresent: true, projectionHasField: true } };
  const first = emitGap(gap, { gh, now: fixedNow });
  // 第二次同 gap（甚至 corr_key/tmp_id 不同）
  const again = emitGap({ ...gap, corr_key: 'ch_x#tmp_777' }, {
    gh,
    ledger: first.ledger,
    events: first.events,
    now: () => '2026-06-28T01:00:00.000Z',
  });
  assert.equal(again.action, 'deduped');
  assert.equal(gh.calls.created.length, 1); // 仍只 create 过 1 次
  assert.equal(again.issue, 101); // 指回原 issue
  assert.equal(again.ledger.length, 1); // 不新增条目
  assert.equal(again.ledger[0].last_seen, '2026-06-28T01:00:00.000Z'); // bump
  assert.equal(again.events.length, first.events.length); // 不重写 gap_emit
});

test('emitGap: 同 sig 已 closed 复现 → reopened（不重建 issue·写 regression 事件）', () => {
  const gh = fakeGh();
  const gap = { uc_id: 'UC-1.1', facet: Facet.OUTBOUND, evidence: { missing: 'urgent', corroboration: 1 } };
  const created = emitGap(gap, { gh, now: fixedNow });
  // 模拟该 gap 被 reconcile 关闭
  const closedLedger = created.ledger.map((e) => ({ ...e, state: 'closed' }));
  // 复现
  const reopened = emitGap(gap, { gh, ledger: closedLedger, events: created.events, now: () => '2026-06-28T02:00:00.000Z' });
  assert.equal(reopened.action, 'reopened');
  assert.equal(gh.calls.created.length, 1); // 没有再 create 新 issue
  assert.equal(gh.calls.reopened.length, 1); // 真调了 reopenIssue
  assert.equal(gh.calls.reopened[0].number, created.issue);
  assert.match(gh.calls.reopened[0].comment, /regression/);
  // ledger 同一条回到 open（不新增）
  assert.equal(reopened.ledger.length, 1);
  assert.equal(reopened.ledger[0].state, 'open');
  // 写了一条新的 gap_emit（regression 也是一次 emit）
  assert.equal(reopened.events.length, created.events.length + 1);
  assert.equal(reopened.events.at(-1).type, 'gap_emit');
});

test('emitGap: backend-down → alert（不开 issue·不动 ledger/events）', () => {
  const gh = fakeGh();
  const gap = { uc_id: 'UC-1.1', facet: Facet.OUTBOUND, health: 500, evidence: { missing: 'x' } };
  const r = emitGap(gap, { gh, ledger: [], events: [] });
  assert.equal(r.action, 'alert');
  assert.equal(r.kind, GapKind.BACKEND_DOWN);
  assert.equal(r.issue, null);
  assert.equal(gh.calls.created.length, 0); // 没开 issue
  assert.equal(r.ledger.length, 0);
  assert.equal(r.events.length, 0);
});

test('emitGap: 不就地改入参 ledger/events（append-only·对齐 LE-1）', () => {
  const gh = fakeGh();
  const ledger = [];
  const events = [];
  const gap = { uc_id: 'UC-5.1', facet: Facet.PROJECTION, evidence: { missing: 'channel_name', corroboration: 1 } };
  const r = emitGap(gap, { gh, ledger, events, now: fixedNow });
  assert.equal(ledger.length, 0); // 原数组没被改
  assert.equal(events.length, 0);
  assert.equal(r.ledger.length, 1); // 返回新数组
  assert.equal(r.events.length, 1);
  assert.notEqual(r.ledger, ledger);
  assert.notEqual(r.events, events);
});

test('emitGap: 两个不同 gap → 两条独立 ledger + 两个 issue（不误判去重）', () => {
  const gh = fakeGh();
  const a = emitGap({ uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { missing: 'data-pin-state', semanticRegionPresent: false, projectionHasField: true } }, { gh, now: fixedNow });
  const b = emitGap({ uc_id: 'UC-3.2', facet: Facet.DOM, evidence: { missing: 'data-read-state', semanticRegionPresent: false, projectionHasField: true } }, { gh, ledger: a.ledger, events: a.events, now: fixedNow });
  assert.equal(b.action, 'created');
  assert.equal(gh.calls.created.length, 2);
  assert.equal(b.ledger.length, 2);
  assert.notEqual(a.sig, b.sig);
});

// ── makeGhCli：真适配器解析 issue 号（exec 注入·不真跑 gh）────────────────────

test('makeGhCli.createIssue: 解析 gh 输出里的 issue 号', () => {
  const seen = [];
  const gh = makeGhCli({ exec: (file, args) => { seen.push([file, args]); return 'https://github.com/o/r/issues/207\n'; } });
  const { number } = gh.createIssue({ title: 't', labels: ['gap:logic'], body: 'b' });
  assert.equal(number, 207);
  assert.equal(seen[0][0], 'gh');
  assert.ok(seen[0][1].includes('--label'));
  assert.ok(seen[0][1].includes('gap:logic'));
});

test('makeGhCli.reopenIssue: 调 gh issue reopen + comment', () => {
  const seen = [];
  const gh = makeGhCli({ exec: (file, args) => { seen.push(args); return ''; } });
  gh.reopenIssue(207, 'regression x');
  assert.deepEqual(seen[0], ['issue', 'reopen', '207']);
  assert.deepEqual(seen[1], ['issue', 'comment', '207', '--body', 'regression x']);
});

test('makeGhCli: 缺 exec 即抛（C008）', () => {
  assert.throws(() => makeGhCli({}), /注入 exec/);
});

test('makeDryRunGh: 默认 dry-run 返回合成负号·不真开 issue', () => {
  const gh = makeDryRunGh();
  assert.equal(gh.dryRun, true);
  assert.equal(gh.createIssue().number, -1);
  assert.equal(gh.createIssue().number, -2);
});

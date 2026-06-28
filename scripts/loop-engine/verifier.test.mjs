// verifier.test.mjs — node:test 真断言（C008 可证伪：破坏即 fail，无 tautology）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProvenance,
  provenanceGate,
  verifyDepth,
  escalateDepth,
  panelVerdict,
  divergenceTest,
  verifyClaim,
} from './verifier.mjs';

// ── classifyProvenance ─────────────────────────────────────────────────────
test('classifyProvenance 识别 file:line / commit / 契约文件 / 未知', () => {
  assert.equal(classifyProvenance('projection-schema.md:L42'), 'file-line');
  assert.equal(classifyProvenance('src-tauri/src/foo.rs:120'), 'file-line');
  assert.equal(classifyProvenance('a1b2c3d'), 'commit'); // 7位 hex
  assert.equal(classifyProvenance('commit a1b2c3d4e5f6'), 'commit');
  assert.equal(classifyProvenance('真机curl真源.md'), 'contract');
  assert.equal(classifyProvenance('相信我，没问题'), 'unknown');
  assert.equal(classifyProvenance(''), 'unknown');
  assert.equal(classifyProvenance(42), 'unknown');
});

// ── provenanceGate（验收：无 provenance 断言被 block）────────────────────────
test('provenanceGate 无 provenance 字段 → block', () => {
  const r = provenanceGate({ statement: 'x' });
  assert.equal(r.blocked, true);
  assert.equal(r.ok, false);
  assert.match(r.reason, /无 provenance/);
});

test('provenanceGate provenance 为空数组 → block', () => {
  const r = provenanceGate({ provenance: [] });
  assert.equal(r.blocked, true);
});

test('provenanceGate 全是无法识别的自由文本 → block（不放过假出处）', () => {
  const r = provenanceGate({ provenance: ['相信我', '应该对'] });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /无合法出处/);
});

test('provenanceGate 合法 file:line → 通过', () => {
  const r = provenanceGate({ provenance: 'projection-schema.md:L42' });
  assert.equal(r.blocked, false);
  assert.equal(r.ok, true);
  assert.equal(r.provenance.length, 1);
  assert.equal(r.provenance[0].kind, 'file-line');
});

test('provenanceGate 混合合法+垃圾 → 通过但只保留合法出处', () => {
  const r = provenanceGate({ provenance: ['foo.rs:10', '瞎编的'] });
  assert.equal(r.blocked, false);
  assert.equal(r.provenance.length, 1);
  assert.equal(r.provenance[0].entry, 'foo.rs:10');
});

test('provenanceGate null/undefined claim → block（不崩）', () => {
  assert.equal(provenanceGate(null).blocked, true);
  assert.equal(provenanceGate(undefined).blocked, true);
});

// ── verifyDepth（验收：爆炸半径→正确深度，helix/契约→tournament）──────────────
test('verifyDepth 字符串等级映射', () => {
  assert.equal(verifyDepth('low'), 'light');
  assert.equal(verifyDepth('light'), 'light');
  assert.equal(verifyDepth('medium'), 'medium');
  assert.equal(verifyDepth('high'), 'tournament');
  assert.equal(verifyDepth('tournament'), 'tournament');
  assert.equal(verifyDepth('中'), 'medium');
  assert.equal(verifyDepth('高'), 'tournament');
});

test('verifyDepth 改 helix → tournament', () => {
  assert.equal(verifyDepth({ repo: 'helix', scope: 'projection' }), 'tournament');
  assert.equal(verifyDepth('改 helix-im 投影'), 'tournament');
});

test('verifyDepth 契约提案 → tournament', () => {
  assert.equal(verifyDepth({ repo: 'loopforge', contractChange: true }), 'tournament');
  assert.equal(verifyDepth({ target: 'projection-schema.md', repo: 'loopforge' }), 'tournament');
});

test('verifyDepth 不可逆 → tournament（最高审查）', () => {
  assert.equal(verifyDepth({ repo: 'loopforge', reversible: false, scope: 'visual' }), 'tournament');
});

test('verifyDepth 可逆 + 低风险范围 → light', () => {
  assert.equal(verifyDepth({ repo: 'loopforge', reversible: true, scope: 'visual' }), 'light');
  assert.equal(verifyDepth({ repo: 'loopforge', scope: 'doc' }), 'light');
});

test('verifyDepth 默认（无信息 / 普通壳绑定）→ medium', () => {
  assert.equal(verifyDepth({}), 'medium');
  assert.equal(verifyDepth({ repo: 'loopforge', scope: 'shell-binding' }), 'medium');
  assert.equal(verifyDepth(undefined), 'medium');
  assert.equal(verifyDepth('啥都没说'), 'medium');
});

test('verifyDepth 升重优先于降重（不可逆的 visual 仍 tournament）', () => {
  // scope=visual 本会降到 light，但 reversible:false 升重应胜出
  assert.equal(verifyDepth({ scope: 'visual', reversible: false }), 'tournament');
});

// ── escalateDepth ──────────────────────────────────────────────────────────
test('escalateDepth 逐级收紧，tournament 封顶', () => {
  assert.equal(escalateDepth('light'), 'medium');
  assert.equal(escalateDepth('medium'), 'tournament');
  assert.equal(escalateDepth('tournament'), 'tournament');
  assert.equal(escalateDepth('unknown'), 'medium');
});

// ── panelVerdict（验收：多数反驳=block）──────────────────────────────────────
test('panelVerdict 多数反驳 → block', () => {
  const r = panelVerdict(['refute', 'refute', 'accept']);
  assert.equal(r.blocked, true);
  assert.equal(r.verdict, 'block');
  assert.equal(r.refute, 2);
  assert.equal(r.accept, 1);
});

test('panelVerdict 多数接受 → 通过', () => {
  const r = panelVerdict(['accept', 'accept', 'refute']);
  assert.equal(r.blocked, false);
  assert.equal(r.verdict, 'accept');
});

test('panelVerdict 平票 → divergent（不直接 block）', () => {
  const r = panelVerdict(['accept', 'refute']);
  assert.equal(r.blocked, false);
  assert.equal(r.divergent, true);
  assert.equal(r.verdict, 'divergent');
});

test('panelVerdict abstain 不计入决定性多数', () => {
  const r = panelVerdict(['accept', 'abstain', 'abstain']);
  assert.equal(r.blocked, false);
  assert.equal(r.verdict, 'accept');
  assert.equal(r.abstain, 2);
});

test('panelVerdict 空 / 全弃权 → no-quorum → block（无法独立证）', () => {
  assert.equal(panelVerdict([]).verdict, 'no-quorum');
  assert.equal(panelVerdict([]).blocked, true);
  const r = panelVerdict(['abstain', 'abstain']);
  assert.equal(r.verdict, 'no-quorum');
  assert.equal(r.blocked, true);
});

test('panelVerdict 对象票 + 同义词归一（reject/pass）', () => {
  const r = panelVerdict([{ verdict: 'reject' }, { verdict: 'pass' }, { verdict: 'pass' }]);
  assert.equal(r.refute, 1);
  assert.equal(r.accept, 2);
  assert.equal(r.blocked, false);
});

test('panelVerdict C009 禁自评：剔除作者本人投票', () => {
  // 作者自投 accept 想把 2-1 反驳翻成 2-2，剔除后仍 1 accept vs ... 实际：
  const votes = [
    { verdict: 'refute', by: 'skepticA' },
    { verdict: 'refute', by: 'skepticB' },
    { verdict: 'accept', by: 'author1' }, // 自评应被剔除
  ];
  const r = panelVerdict(votes, { author: 'author1' });
  assert.equal(r.selfVotesDropped, 1);
  assert.equal(r.accept, 0);
  assert.equal(r.refute, 2);
  assert.equal(r.blocked, true);
});

// ── divergenceTest（验收：分歧测试逻辑）─────────────────────────────────────
test('divergenceTest 两 verifier 分歧 → tighten', () => {
  const r = divergenceTest('accept', 'refute');
  assert.equal(r.divergent, true);
  assert.equal(r.action, 'tighten');
});

test('divergenceTest 两 verifier 一致 → none', () => {
  assert.equal(divergenceTest('accept', 'pass').divergent, false); // 同义归一
  assert.equal(divergenceTest('refute', 'reject').divergent, false);
  assert.equal(divergenceTest('accept', 'accept').action, 'none');
});

// ── verifyClaim 端到端编排 ──────────────────────────────────────────────────
test('verifyClaim 无 provenance → 短路 block（不跑 panel）', () => {
  const r = verifyClaim({
    claim: { statement: 'x' },
    blastRadius: 'medium',
    votes: ['accept', 'accept'],
  });
  assert.equal(r.admitted, false);
  assert.equal(r.stage, 'provenance');
  assert.equal(r.panel, null); // 未跑 panel
});

test('verifyClaim provenance 合法 + panel 多数反驳 → 不录用', () => {
  const r = verifyClaim({
    claim: { provenance: 'foo.rs:10' },
    blastRadius: { repo: 'loopforge', scope: 'shell-binding' },
    votes: ['refute', 'refute', 'accept'],
  });
  assert.equal(r.admitted, false);
  assert.equal(r.stage, 'panel');
  assert.equal(r.depth, 'medium');
});

test('verifyClaim provenance 合法 + 多数接受 → 录用（带深度）', () => {
  const r = verifyClaim({
    claim: { provenance: ['projection-schema.md:L42'] },
    blastRadius: { repo: 'helix' }, // 改 helix → tournament
    votes: ['accept', 'accept', 'refute'],
  });
  assert.equal(r.admitted, true);
  assert.equal(r.stage, 'admitted');
  assert.equal(r.depth, 'tournament');
});

test('verifyClaim panel 分歧 → divergent + 收紧建议', () => {
  const r = verifyClaim({
    claim: { provenance: 'foo.rs:10' },
    blastRadius: 'light',
    votes: ['accept', 'refute'],
  });
  assert.equal(r.admitted, false);
  assert.equal(r.stage, 'divergent');
  assert.equal(r.recommendation, 'tighten:medium'); // light → medium
});

test('verifyClaim 作者自评票被剔除后才裁（C009 贯通 verifyClaim）', () => {
  const r = verifyClaim({
    claim: { provenance: 'foo.rs:10', author: 'gen1' },
    blastRadius: 'medium',
    votes: [
      { verdict: 'refute', by: 'skA' },
      { verdict: 'accept', by: 'gen1' }, // 自评剔除 → 仅剩 1 refute → block
    ],
  });
  assert.equal(r.panel.selfVotesDropped, 1);
  assert.equal(r.admitted, false);
});

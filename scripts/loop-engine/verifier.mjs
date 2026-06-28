// verifier.mjs — 反幻觉验证深模块（loop-engine LE-6 · SPEC §7）
//
// 引擎自产物（spec / 决策 / 修复）的验证深度随**爆炸半径 / 可逆性**自适应缩放：
//   - 默认（中 medium）：provenance 闸（每条断言带出处，无出处禁进）
//     + N-skeptic 对抗 panel（多数反驳 = 打回）+ 分歧测试（两 verifier 分歧 → 收紧）。
//   - 高爆炸半径自动升重（改 helix / 契约提案 / 不可逆）→ tournament（多路裁判 panel）。
//   - C009 升到 spec 层：生成 agent ≠ 验证 agent，禁自评（panel 自动剔除作者投票）。
//
// 本模块**纯逻辑 · 零 IO · 零依赖**（仅 ESM export），所有裁决都是确定性纯函数，
// 便于 node:test 真断言（C008 可证伪：破坏即 fail，禁 tautology）。
// 控制面归 JS（SPEC §1）：验证逻辑写死在引擎外，agent 改不了。

// ── provenance 出处分类 ────────────────────────────────────────────────────
// SPEC §7：断言出处接受三种形态 —— file:line / commit / 契约文件。
const SHA_RE = /^[0-9a-f]{7,40}$/i; //  裸 git sha
const COMMIT_PREFIX_RE = /^commit\s+[0-9a-f]{7,40}$/i; //  "commit <sha>"
const FILE_LINE_RE = /^.+\.[A-Za-z0-9]+:L?\d+$/; //  foo.rs:120 / projection-schema.md:L42
const FILE_RE = /^.+\.[A-Za-z0-9]+$/; //  裸文件引用（契约文档）

/**
 * 分类单条 provenance 出处。
 * @param {unknown} entry
 * @returns {'file-line'|'commit'|'contract'|'unknown'}
 */
export function classifyProvenance(entry) {
  if (typeof entry !== 'string') return 'unknown';
  const s = entry.trim();
  if (s === '') return 'unknown';
  if (FILE_LINE_RE.test(s)) return 'file-line';
  if (COMMIT_PREFIX_RE.test(s) || SHA_RE.test(s)) return 'commit';
  if (FILE_RE.test(s)) return 'contract';
  return 'unknown';
}

/**
 * provenance 闸：无出处即 block（SPEC §7「无出处禁进」）。
 * 不仅校验 provenance 字段存在，还校验每条出处形态合法（file:line / commit / 契约文件）；
 * 全是无法识别的自由文本（如「相信我」）同样视为无出处 → block。
 *
 * @param {{provenance?: string|string[]}|null|undefined} claim
 * @returns {{
 *   ok: boolean,
 *   blocked: boolean,
 *   reason: string|null,
 *   provenance: {entry: string, kind: string}[]   // 仅保留合法出处
 * }}
 */
export function provenanceGate(claim) {
  const raw = claim == null ? undefined : claim.provenance;
  let entries = [];
  if (Array.isArray(raw)) entries = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') entries = [raw];

  const classified = entries
    .map((e) => ({ entry: typeof e === 'string' ? e.trim() : String(e), kind: classifyProvenance(e) }))
    .filter((c) => c.kind !== 'unknown');

  if (classified.length === 0) {
    return {
      ok: false,
      blocked: true,
      reason:
        entries.length === 0
          ? '断言无 provenance（无出处禁进·SPEC §7）'
          : 'provenance 无合法出处（须 file:line / commit / 契约文件）',
      provenance: [],
    };
  }
  return { ok: true, blocked: false, reason: null, provenance: classified };
}

// ── 验证深度自适应 ──────────────────────────────────────────────────────────
const DEPTH_ORDER = ['light', 'medium', 'tournament'];
const HIGH_BLAST_RE = /helix|contract|契约|projection-schema|真源|真机curl/;
const LOW_RISK_SCOPES = new Set([
  'visual',
  'ui-visual',
  'doc',
  'docs',
  'comment',
  'comments',
  'status',
  'style',
  'log',
]);

/**
 * 根据爆炸半径 / 可逆性裁定验证深度（SPEC §7）。
 *   tournament：改 helix / 契约提案 / 不可逆 / 高爆炸半径。
 *   light：可逆 + 低风险范围（纯视觉 / 文档 / 注释 / 日志）。
 *   medium：默认（SPEC §7「默认 中」）。
 *
 * 入参可为：
 *   - 字符串等级：'low'|'light' / 'medium'|'mid' / 'high'|'tournament'|'critical'（含中文 低/中/高），
 *     或含 helix/契约 关键词的自由描述。
 *   - 描述对象：{repo, target, scope, reversible, contractChange}。
 *
 * @param {string|{repo?:string,target?:string,scope?:string,reversible?:boolean,contractChange?:boolean}} blastRadius
 * @returns {'light'|'medium'|'tournament'}
 */
export function verifyDepth(blastRadius) {
  if (typeof blastRadius === 'string') {
    const s = blastRadius.toLowerCase().trim();
    if (s === 'light' || s === 'low' || s === '低') return 'light';
    if (s === 'tournament' || s === 'high' || s === 'critical' || s === '高') return 'tournament';
    if (s === 'medium' || s === 'mid' || s === '中') return 'medium';
    if (HIGH_BLAST_RE.test(s)) return 'tournament';
    return 'medium'; // 未知自由串 → 默认中
  }

  if (blastRadius && typeof blastRadius === 'object') {
    const { repo, target, scope, reversible, contractChange } = blastRadius;
    // —— 升重（tournament）优先：任一命中即最高强度 ——
    if (contractChange === true) return 'tournament'; // 契约提案
    if (reversible === false) return 'tournament'; // 不可逆 = 最高审查
    if (repo != null && String(repo).toLowerCase() === 'helix') return 'tournament'; // 改 helix
    const blob = `${repo || ''} ${target || ''} ${scope || ''}`.toLowerCase();
    if (HIGH_BLAST_RE.test(blob)) return 'tournament';
    // —— 降重（light）：可逆 + 低风险范围 ——
    if (reversible !== false && scope != null && LOW_RISK_SCOPES.has(String(scope).toLowerCase())) {
      return 'light';
    }
    return 'medium';
  }

  return 'medium'; // 无信息 → 默认中
}

/**
 * 把深度收紧一级（分歧测试命中时用）：light→medium→tournament，已是 tournament 则封顶。
 * @param {'light'|'medium'|'tournament'} depth
 * @returns {'light'|'medium'|'tournament'}
 */
export function escalateDepth(depth) {
  const i = DEPTH_ORDER.indexOf(depth);
  if (i < 0) return 'medium';
  return DEPTH_ORDER[Math.min(i + 1, DEPTH_ORDER.length - 1)];
}

// ── N-skeptic 对抗 panel ───────────────────────────────────────────────────
function normVerdict(x) {
  const v = String(x || '').toLowerCase().trim();
  if (v === 'refute' || v === 'reject' || v === 'block') return 'refute';
  if (v === 'accept' || v === 'pass' || v === 'approve') return 'accept';
  if (v === 'abstain') return 'abstain';
  return 'invalid';
}

function normVote(v) {
  if (typeof v === 'string') return { verdict: normVerdict(v), by: undefined };
  if (v && typeof v === 'object') return { verdict: normVerdict(v.verdict), by: v.by };
  return { verdict: 'invalid', by: undefined };
}

/**
 * N-skeptic panel 裁定（SPEC §7「多数反驳 = 打回」）。
 *   - refute > accept           → blocked（多数反驳）。
 *   - accept > refute           → 通过。
 *   - refute === accept（均 >0）→ divergent（分歧），不直接 block，建议收紧。
 *   - 无决定性票（全 abstain/invalid/空）→ no-quorum → blocked（无法独立证 → 保守拦）。
 * abstain / invalid 不计入决定性多数。
 *
 * C009 禁自评：传 opts.author 时，by===author 的投票被剔除（生成者不得给自己投票）。
 *
 * @param {(string|{verdict:string, by?:any, reason?:string})[]} votes
 * @param {{author?: any}} [opts]
 * @returns {{
 *   blocked: boolean,
 *   verdict: 'accept'|'block'|'divergent'|'no-quorum',
 *   refute: number, accept: number, abstain: number, invalid: number,
 *   total: number, divergent: boolean, selfVotesDropped: number
 * }}
 */
export function panelVerdict(votes, opts = {}) {
  const author = opts.author;
  const all = Array.isArray(votes) ? votes.map(normVote) : [];

  let selfVotesDropped = 0;
  const considered = all.filter((v) => {
    if (author !== undefined && v.by !== undefined && v.by === author) {
      selfVotesDropped++;
      return false;
    }
    return true;
  });

  let refute = 0;
  let accept = 0;
  let abstain = 0;
  let invalid = 0;
  for (const v of considered) {
    if (v.verdict === 'refute') refute++;
    else if (v.verdict === 'accept') accept++;
    else if (v.verdict === 'abstain') abstain++;
    else invalid++;
  }

  const base = { refute, accept, abstain, invalid, total: considered.length, selfVotesDropped };

  if (refute + accept === 0) {
    return { ...base, blocked: true, verdict: 'no-quorum', divergent: false };
  }
  if (refute > accept) {
    return { ...base, blocked: true, verdict: 'block', divergent: false };
  }
  if (accept > refute) {
    return { ...base, blocked: false, verdict: 'accept', divergent: false };
  }
  // 平票（refute === accept 且均 > 0）= 两路分歧
  return { ...base, blocked: false, verdict: 'divergent', divergent: true };
}

/**
 * 分歧测试（SPEC §7「两 verifier 分歧 → 收紧」）。
 * 两个独立 verifier 结论不一致 → divergent → 建议把验证深度收紧一级。
 * @param {string} verdictA
 * @param {string} verdictB
 * @returns {{divergent: boolean, action: 'tighten'|'none', a: string, b: string}}
 */
export function divergenceTest(verdictA, verdictB) {
  const a = normVerdict(verdictA);
  const b = normVerdict(verdictB);
  const divergent = a !== b;
  return { divergent, action: divergent ? 'tighten' : 'none', a, b };
}

/**
 * 端到端验证编排：provenance 闸 → 深度裁定 → panel 多数 → 分歧收紧建议。
 * 任一前置门 block 即短路（不再跑后续 panel）。
 *
 * @param {object} input
 * @param {{provenance?: string|string[], author?: any}} input.claim
 * @param {string|object} input.blastRadius
 * @param {(string|object)[]} input.votes
 * @returns {{
 *   admitted: boolean,
 *   stage: 'provenance'|'panel'|'divergent'|'admitted',
 *   reason: string|null,
 *   depth: 'light'|'medium'|'tournament'|null,
 *   provenance: {entry:string,kind:string}[],
 *   panel: object|null,
 *   recommendation: string|null
 * }}
 */
export function verifyClaim({ claim, blastRadius, votes } = {}) {
  const pg = provenanceGate(claim);
  if (pg.blocked) {
    return {
      admitted: false,
      stage: 'provenance',
      reason: pg.reason,
      depth: null,
      provenance: [],
      panel: null,
      recommendation: null,
    };
  }

  const depth = verifyDepth(blastRadius);
  const panel = panelVerdict(votes, { author: claim ? claim.author : undefined });

  if (panel.divergent) {
    return {
      admitted: false,
      stage: 'divergent',
      reason: 'panel 分歧（平票）— 收紧后重验',
      depth,
      provenance: pg.provenance,
      panel,
      recommendation: `tighten:${escalateDepth(depth)}`,
    };
  }
  if (panel.blocked) {
    return {
      admitted: false,
      stage: 'panel',
      reason: panel.verdict === 'no-quorum' ? 'panel 无决定性票（无法独立证）' : 'panel 多数反驳',
      depth,
      provenance: pg.provenance,
      panel,
      recommendation: null,
    };
  }
  return {
    admitted: true,
    stage: 'admitted',
    reason: null,
    depth,
    provenance: pg.provenance,
    panel,
    recommendation: null,
  };
}

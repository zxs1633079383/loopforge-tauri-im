// gap-emitter.mjs — loop-engine gap 发射器（深模块 LE-5·SPEC §4/§10·pipeline-closed-loop.md Part 2）
//
// 职责（Part 2.1 铁律）：**只分类 + 路由 + 去重**，不判绿/红（绿由 reducer 裁定·C009）。
//   classify(gap) → GapKind        Part 2.4 分类决策树
//   sig(gap)      → 稳定指纹        Part 2.3，剥离 tmp_id / 时间戳 / server_id（Sentry 分组教训）
//   emitGap(gap)  → gh issue 参数 + events gap_emit + dedup
//                                   Part 2.6：同 sig open 跳过 / closed 复现 reopen
//
// 依赖 LE-1 state-ledger：复用 appendEvent 写 gap_emit 事件（append-only·机器真相）。
//
// C008 可证伪：分类输入缺 facet / 未知 facet 即抛；dedup/drop 全 log() 出账（C011 诚实）。
// C013：dom gap 先分 ui-bind（壳加 1:1 绑定）vs logic-red（缺投影→去 helix），不在壳写业务。

import { createHash } from 'node:crypto';
import { appendEvent } from './state-ledger.mjs';

// ── GapKind 全集（Part 2.4 决策树叶子·canonical 6 类）──────────────────────
export const GapKind = Object.freeze({
  LOGIC_RED: 'logic-red', // 改实现（helix/loopforge）— 默认（C004）
  CONTRACT_STALE: 'contract-stale', // 契约可能过时 — 人闸提案（C004·≥2 UC 佐证）
  UI_BIND: 'ui-bind', // 语义区已在·只差 data-* 绑定（C013 壳职责）
  UI_DESIGN: 'ui-design', // 语义区不存在·需新结构 → pencil MCP
  COVERAGE_HOLE: 'coverage-hole', // HTTP/WS 没绑 UC → author spec+expect
  BACKEND_DOWN: 'backend-down', // 后端未起/挂 → 仅 ops 告警·不开 issue
});

const GAP_KIND_SET = new Set(Object.values(GapKind));

// ── facet 全集（Part 2.3）──────────────────────────────────────────────────
export const Facet = Object.freeze({
  OUTBOUND: 'outbound',
  PROJECTION: 'projection',
  DOM: 'dom',
  STORAGE: 'storage',
  COVERAGE: 'coverage',
});

const FACET_SET = new Set(Object.values(Facet));

// 契约过时升级的最小佐证 UC 数（Part 2.4 / C004：≥2 UC 命中同一 divergence）。
export const CONTRACT_STALE_MIN_UCS = 2;

// 后端健康判据（Part 2.4：health != 200 → backend-down）。
export const HEALTHY_STATUS = 200;

// ── 路由表（Part 2.5：GapKind → 标签 → 弧 → runner）────────────────────────
export const ROUTE_TABLE = Object.freeze({
  [GapKind.LOGIC_RED]: { triage: 'ready-for-agent', gapLabels: ['gap:logic'], arc: 'A', runner: 'auto', opensIssue: true },
  [GapKind.CONTRACT_STALE]: { triage: 'ready-for-human', gapLabels: ['gap:contract'], arc: 'B', runner: 'human', opensIssue: true },
  [GapKind.UI_BIND]: { triage: 'ready-for-agent', gapLabels: ['gap:ui-bind'], arc: 'C', runner: 'auto', opensIssue: true },
  [GapKind.UI_DESIGN]: { triage: 'ready-for-agent', gapLabels: ['gap:ui-design', 'needs-pencil'], arc: 'C', runner: 'auto', opensIssue: true },
  [GapKind.COVERAGE_HOLE]: { triage: 'ready-for-agent', gapLabels: ['gap:coverage'], arc: 'frontend', runner: 'auto', opensIssue: true },
  [GapKind.BACKEND_DOWN]: { triage: null, gapLabels: [], arc: 'ops', runner: 'alert', opensIssue: false },
});

/**
 * 取 kind 的路由项（Part 2.5）。未知 kind 即抛（C008）。
 * @param {string} kind
 * @returns {{triage:string|null, gapLabels:string[], arc:string, runner:string, opensIssue:boolean}}
 */
export function routeOf(kind) {
  const r = ROUTE_TABLE[kind];
  if (!r) throw new Error(`未知 GapKind: ${JSON.stringify(kind)}（合法集 ${Object.values(GapKind).join('/')}）`);
  return r;
}

/**
 * 完整标签列表（triage 标签 + gap:* 标签）。backend-down 无标签。
 * @param {string} kind
 * @returns {string[]}
 */
export function labelsFor(kind) {
  const r = routeOf(kind);
  return r.triage ? [r.triage, ...r.gapLabels] : [...r.gapLabels];
}

// ── 分类（Part 2.4 决策树·发射器的心脏）────────────────────────────────────

/**
 * 对一个非绿 facet 裁决分类为 GapKind（Part 2.4）。
 * 输入 GapSignal：
 *   {
 *     uc_id, facet,                     // facet ∈ Facet
 *     health?,                          // 后端健康状态码（缺省视为健康）
 *     evidence: {
 *       missing,                        // 缺的 token/字段/endpoint
 *       corroboration?,                 // 同 divergence 命中的 UC 数（契约判据）
 *       semanticRegionPresent?,         // dom：语义区(data-region)是否已存在
 *       projectionHasField?,            // dom：投影里是否有该字段
 *       backendConsistent?,             // 契约判据：后端是否默认对/一致回此值
 *     }
 *   }
 * 不自判绿红（C009）：只对**已是非绿**的 facet 分类。
 *
 * @param {object} gap
 * @param {{contractStaleMinUcs?: number}} [opts]
 * @returns {string} GapKind
 */
export function classify(gap, { contractStaleMinUcs = CONTRACT_STALE_MIN_UCS } = {}) {
  if (!gap || typeof gap !== 'object') throw new TypeError('gap 必须是对象');
  const facet = gap.facet;
  if (!FACET_SET.has(facet)) {
    throw new Error(`未知 facet: ${JSON.stringify(facet)}（合法集 ${Object.values(Facet).join('/')}）`);
  }
  const ev = gap.evidence || {};

  // ① health != 200 → backend-down（先于一切·不开 issue 走 ops）
  if (gap.health != null && gap.health !== HEALTHY_STATUS) return GapKind.BACKEND_DOWN;

  // ② coverage（无 UC 绑）→ coverage-hole
  if (facet === Facet.COVERAGE) return GapKind.COVERAGE_HOLE;

  // ③ dom：分 ui-bind / ui-design / logic-red
  if (facet === Facet.DOM) {
    // 投影里根本没该字段 → 缺投影不是缺 UI（C013）→ logic-red（实际归 projection 面）
    if (ev.projectionHasField === false) return GapKind.LOGIC_RED;
    // 投影有该字段 but DOM 缺元素：语义区在 → 只差绑定；不在 → 需新结构 pencil
    return ev.semanticRegionPresent ? GapKind.UI_BIND : GapKind.UI_DESIGN;
  }

  // ④ outbound/projection/storage：契约 diff vs logic-red（默认改实现·C004）
  const corroboration = Number.isInteger(ev.corroboration) ? ev.corroboration : 1;
  if (corroboration >= contractStaleMinUcs && ev.backendConsistent === true) {
    return GapKind.CONTRACT_STALE;
  }
  return GapKind.LOGIC_RED;
}

// ── 稳定指纹（Part 2.3：sha1(uc_id|facet|kind|norm(missing))）────────────────

/**
 * 剥离易变量（Sentry 分组教训）：tmp_id / 时间戳 / server_id(长 hex) / 长数字 →
 * 占位符，使「同一逻辑 gap」跨 run 归一为同一指纹（不同 run 只差 tmp_17 vs tmp_99
 * 不该算两个 gap）。corr_key 本身不进指纹（天然 volatile）。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeVolatile(value) {
  return String(value ?? '')
    // ISO 时间戳 2026-06-28T10:00:00.123Z
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?/gi, '<TS>')
    // tmp_17 / tmp-abc / tmp17（含其后的标识）
    .replace(/tmp[_-]?[0-9a-z]+/gi, 'tmp_<ID>')
    // 纯长数字（epoch ms / 自增 id）— 先于 hex，避免纯数字被当 hex
    .replace(/\b\d{3,}\b/g, '<N>')
    // 长 hex / uuid 段（server_id 等·含字母）
    .replace(/\b[0-9a-f]{8,}\b/gi, '<HEX>')
    .trim();
}

/**
 * 计算 gap 的稳定去重指纹（Part 2.3·2.6）。
 * 公式：sha1(uc_id | facet | kind | norm(missing))。kind 缺省时即时 classify。
 * **不含** corr_key / tmp_id / 时间戳 → 同一逻辑 gap 跨 run 同 sig。
 * @param {object} gap
 * @param {{contractStaleMinUcs?: number}} [opts]
 * @returns {string} 40-hex sha1
 */
export function sig(gap, opts = {}) {
  if (!gap || typeof gap !== 'object') throw new TypeError('gap 必须是对象');
  const kind = GAP_KIND_SET.has(gap.kind) ? gap.kind : classify(gap, opts);
  const missing = normalizeVolatile(gap.evidence?.missing);
  const material = [gap.uc_id ?? '', gap.facet ?? '', kind, missing].join('|');
  return createHash('sha1').update(material).digest('hex');
}

// ── issue 参数构造（Part 2.7 body 模板）──────────────────────────────────────

/**
 * 构造 gh issue 创建参数（title / labels / body）。不调用 gh —— 纯函数（可测）。
 * @param {object} gap
 * @param {string} kind
 * @param {string} signature
 * @returns {{title:string, labels:string[], body:string}}
 */
export function buildIssue(gap, kind, signature) {
  const ev = gap.evidence || {};
  const route = routeOf(kind);
  const title = `[gap] ${gap.uc_id} facet:${gap.facet} missing ${ev.missing ?? '(unknown)'}`;
  const labels = labelsFor(kind);
  const blockedBy = Array.isArray(gap.blockedBy) && gap.blockedBy.length
    ? gap.blockedBy.map((n) => `#${n}`).join(' ')
    : '(无)';
  const body = [
    `<!-- gap-key: ${signature} -->`,
    `**UC**: ${gap.uc_id} | **facet**: ${gap.facet} | **kind**: ${kind} | **arc**: ${route.arc}`,
    '',
    '## 证据',
    `- corr_key: \`${gap.corr_key ?? '—'}\``,
    `- reducer 断点: ${ev.hop ?? gap.facet} hop — ${ev.reducer_diff ?? `missing ${ev.missing ?? '(unknown)'}`}`,
    `- crossmap: ${ev.crossmap_row ?? '—'}`,
    `- corroboration: ${ev.corroboration ?? 1} UC`,
    '',
    '## 建议',
    `- runner: ${route.runner}（弧 ${route.arc}）`,
    suggestionFor(kind),
    '',
    '## Blocked by',
    `- ${blockedBy}`,
  ].join('\n');
  return { title, labels, body };
}

function suggestionFor(kind) {
  switch (kind) {
    case GapKind.UI_DESIGN:
      return '- 语义区不存在 → 需新 UI 结构 → 调 pencil MCP 设计展示位（守 C013：好看=纯展示，不掺业务）';
    case GapKind.UI_BIND:
      return '- 语义区已在 → 壳补 1:1 `data-*` 绑定（C013 壳职责）';
    case GapKind.LOGIC_RED:
      return '- 默认改实现（C004）：缺投影/业务 → helix-im 分支修 + loopforge re-pin（可逆自决）';
    case GapKind.CONTRACT_STALE:
      return '- ≥2 UC 佐证 + 后端默认对 → 契约变更提案交人审（C004·不自改冻结 oracle）';
    case GapKind.COVERAGE_HOLE:
      return '- HTTP/WS 未绑 UC → author 新 spec + expect（前端弧）';
    default:
      return '- —';
  }
}

// ── 注入式 gh 适配器（可测·默认 dry-run 不真开 issue）────────────────────────

/**
 * dry-run gh：不真调 gh CLI，返回合成 issue 号（负数·一眼可辨非真号）。
 * 用于默认与测试，杜绝意外开真 issue。
 * @returns {{createIssue:Function, reopenIssue:Function, dryRun:boolean}}
 */
export function makeDryRunGh() {
  let counter = 0;
  return {
    dryRun: true,
    createIssue() {
      counter += 1;
      return { number: -counter };
    },
    reopenIssue() {
      /* dry-run：no-op */
    },
  };
}

/**
 * 真 gh CLI 适配器（execFile 注入便于测试）。createIssue 走 `gh issue create`，
 * reopenIssue 走 `gh issue reopen` + comment。仅在 autonomous 真发 issue 时用。
 * @param {{exec: (file:string, args:string[]) => string}} deps
 */
export function makeGhCli({ exec }) {
  if (typeof exec !== 'function') throw new TypeError('makeGhCli 需注入 exec(file,args)→stdout');
  return {
    dryRun: false,
    createIssue({ title, labels, body }) {
      const args = ['issue', 'create', '--title', title, '--body', body];
      for (const l of labels) args.push('--label', l);
      const out = exec('gh', args);
      const m = String(out).match(/\/issues\/(\d+)/) || String(out).match(/#?(\d+)\s*$/);
      return { number: m ? Number(m[1]) : null };
    },
    reopenIssue(number, comment) {
      exec('gh', ['issue', 'reopen', String(number)]);
      if (comment) exec('gh', ['issue', 'comment', String(number), '--body', comment]);
    },
  };
}

// ── 发射（Part 2.6 dedup → emit / reopen / skip）─────────────────────────────

/**
 * 发射一个 gap：分类 → 算 sig → 查 ledger 去重 → 开/复 issue + 写 gap_emit 事件。
 *
 * dedup 语义（Part 2.6）：
 *   - sig 已在 ledger 且 state=open      → skip（deduped·bump last_seen·不重开）
 *   - sig 已在 ledger 且 state=closed    → reopen（regression·state=open·不重建）
 *   - sig 新                              → create
 *   - kind=backend-down                   → alert（不开 issue·走 ops）
 *
 * **纯**：不就地改入参 ledger / events，返回新数组（append-only·对齐 LE-1）。
 *
 * @param {object} gap
 * @param {{
 *   ledger?: object[],          // 现有 gap-ledger 条目
 *   events?: object[],          // 现有 events（LE-1）
 *   gh?: object,                // 注入 gh 适配器（默认 dry-run）
 *   now?: () => string,         // 确定性时间戳
 *   contractStaleMinUcs?: number
 * }} [opts]
 * @returns {{
 *   action: 'created'|'reopened'|'deduped'|'alert',
 *   kind: string, sig: string, issue: (number|null),
 *   issueParams: (object|null),
 *   ledger: object[], events: object[],
 *   log: string
 * }}
 */
export function emitGap(gap, opts = {}) {
  const {
    ledger = [],
    events = [],
    gh = makeDryRunGh(),
    now,
    contractStaleMinUcs = CONTRACT_STALE_MIN_UCS,
  } = opts;
  if (!Array.isArray(ledger)) throw new TypeError('ledger 必须是数组');
  if (!Array.isArray(events)) throw new TypeError('events 必须是数组');

  const ts = now ? now() : new Date().toISOString();
  const kind = classify(gap, { contractStaleMinUcs });
  const route = routeOf(kind);
  const signature = sig({ ...gap, kind }, { contractStaleMinUcs });

  // backend-down：不开 issue，仅告警（Part 2.5）
  if (!route.opensIssue) {
    return {
      action: 'alert',
      kind,
      sig: signature,
      issue: null,
      issueParams: null,
      ledger, // 不动
      events, // 不动
      log: `[gap-emit] alert kind=${kind} uc=${gap.uc_id} — 后端未起/挂·走 ops 不开 issue`,
    };
  }

  const idx = ledger.findIndex((e) => e && e.sig === signature);
  const existing = idx >= 0 ? ledger[idx] : null;

  // ── deduped：同 sig open → 跳过 + bump last_seen ──────────────────────────
  if (existing && existing.state === 'open') {
    const newLedger = ledger.map((e, i) => (i === idx ? { ...e, last_seen: ts } : e));
    return {
      action: 'deduped',
      kind,
      sig: signature,
      issue: existing.issue,
      issueParams: null,
      ledger: newLedger,
      events, // dedup 不重写 gap_emit 事件
      log: `[gap-emit] deduped sig=${signature.slice(0, 8)} → 已开 issue #${existing.issue}（bump last_seen）`,
    };
  }

  const issueParams = buildIssue(gap, kind, signature);

  // ── reopened：同 sig closed 复现 → reopen·不重建 ──────────────────────────
  if (existing && existing.state === 'closed') {
    gh.reopenIssue(existing.issue, `regression: gap ${signature.slice(0, 8)} 复现（${kind}）`);
    const newLedger = ledger.map((e, i) => (i === idx ? { ...e, state: 'open', last_seen: ts } : e));
    const newEvents = appendEvent(events, { type: 'gap_emit', sig: signature, issue: existing.issue, kind }, { now: () => ts });
    return {
      action: 'reopened',
      kind,
      sig: signature,
      issue: existing.issue,
      issueParams,
      ledger: newLedger,
      events: newEvents,
      log: `[gap-emit] reopened issue #${existing.issue} sig=${signature.slice(0, 8)}（regression·${kind}）`,
    };
  }

  // ── created：sig 新 → 开 issue + 追 ledger + 写 gap_emit ────────────────────
  const { number } = gh.createIssue(issueParams);
  const entry = {
    sig: signature,
    uc: gap.uc_id,
    facet: gap.facet,
    kind,
    issue: number,
    state: 'open',
    first_seen: ts,
    last_seen: ts,
  };
  const newLedger = [...ledger, entry];
  const newEvents = appendEvent(events, { type: 'gap_emit', sig: signature, issue: number, kind }, { now: () => ts });
  return {
    action: 'created',
    kind,
    sig: signature,
    issue: number,
    issueParams,
    ledger: newLedger,
    events: newEvents,
    log: `[gap-emit] created issue #${number} sig=${signature.slice(0, 8)} kind=${kind} labels=[${issueParams.labels.join(',')}]`,
  };
}

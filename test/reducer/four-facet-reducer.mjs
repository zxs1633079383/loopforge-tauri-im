// 四面 reducer —— 自动修复 agent 的「眼睛」（CLAUDE.md §5 / spec §7）。
//
// 输入：run.jsonl 的 HopEvent 行 + e2e 注入的 DOM 面 + 一份四面期望文件。
// 流程：
//   1. 解析 JSONL → HopEvent[]
//   2. 按 corr_key 领域规则（corr-key.mjs）把同一逻辑事件的 outbound/projection/storage/ws-recv 聚成一束
//   3. 注入 DOM 面（e2e 读 data-* 给的终态）
//   4. 与四面期望逐面 diff
//   5. 出「断在哪一跳」报告对象（绿=四面齐且对齐）
//
// 纯函数、零依赖（Node 22 原生）：喂样例 JSONL 即可单测自洽，不依赖真跑（spec §9 注）。
//
// 四面 ↔ facet/hop 映射（event.rs schema）：
//   ① outbound  : facet=outbound, hop∈{http-req, ws-send}      → 取 body / 帧
//   ② projection: facet=projection, hop=projection             → 取 {event,data}
//   ④ storage   : facet=storage, hop=storage                   → 取 {op,table,rows}
//   WsRecv(输入): facet=ws-recv, hop∈{ws-recv, http-resp}      → 串 corr_key 用（echo 帧带 sid）
//   ③ DOM       : 不在 JSONL，由 e2e 注入

import { extractDims, dimsToKey, sameEvent, mergeDims, parseKey } from './corr-key.mjs';

/** 解析 JSONL 文本 → HopEvent[]（跳空行；坏行收集进 parseErrors）。 */
export function parseJsonl(text) {
  /** @type {Array<object>} */
  const events = [];
  /** @type {Array<{line:number,raw:string,error:string}>} */
  const parseErrors = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    try {
      events.push(JSON.parse(raw));
    } catch (e) {
      parseErrors.push({ line: i + 1, raw, error: String(e?.message ?? e) });
    }
  }
  return { events, parseErrors };
}

/**
 * 把一组 HopEvent 按 uc_id 过滤后，按领域键聚成「束」（bundle）。
 * 一束 = 一个逻辑事件的四面 hop 集合（spec §3 领域键绑四面）。
 *
 * @param {Array<object>} events
 * @param {string} ucId  只聚该 UC 窗口内的帧（其余落 __quiescence__ 不串）
 * @returns {Array<{key:string|null, dims:object, hops:Array<object>}>}
 */
export function bundleByCorrKey(events, ucId) {
  /** @type {Array<{dims:object, hops:Array<object>}>} */
  const bundles = [];
  for (const ev of events) {
    if (ucId !== undefined && ev.uc_id !== ucId) continue;
    // 优先用装饰器已抽的 corr_key（顶层字段），抽不到再从 payload 现抽（领域规则更强）。
    const dims = ev.corr_key ? parseKey(ev.corr_key) : extractDims(ev.payload);
    // payload 里能补出的维度并进来（装饰器 corr_key 可能只命中部分维度）。
    const fromPayload = extractDims(ev.payload);
    const fullDims = mergeDims(dims, fromPayload);
    // 无任何领域维 → 不串（如纯 lifecycle connect/close），单独归 unkeyed。
    if (Object.keys(fullDims).length === 0) {
      bundles.push({ dims: {}, hops: [ev], _unkeyed: true });
      continue;
    }
    const existing = bundles.find((b) => !b._unkeyed && sameEvent(b.dims, fullDims));
    if (existing) {
      existing.dims = mergeDims(existing.dims, fullDims);
      existing.hops.push(ev);
    } else {
      bundles.push({ dims: fullDims, hops: [ev] });
    }
  }
  return bundles.map((b) => ({ key: dimsToKey(b.dims), dims: b.dims, hops: b.hops }));
}

/** 从一束里取某面的代表 hop（facet + 可选 hop 名过滤）。 */
function pickFacet(bundle, facet, hopNames) {
  return bundle.hops.find(
    (h) => h.facet === facet && (!hopNames || hopNames.includes(h.hop))
  );
}

// ── 四面提取器：从束里抽出可与期望 diff 的「实际值」 ───────────────────────────

/** ① outbound：HTTP 优先（method/url/body），退而取 ws-send 帧。 */
function actualOutbound(bundle) {
  const http = pickFacet(bundle, 'outbound', ['http-req']);
  if (http) {
    return {
      kind: 'http',
      method: http.payload?.method,
      url: http.payload?.url,
      body: http.payload?.body ?? {},
    };
  }
  const ws = pickFacet(bundle, 'outbound', ['ws-send']);
  if (ws) return { kind: 'ws', body: ws.payload };
  return null;
}

/**
 * ② projection：取 {event, data}（data 键集是冻结对象）。
 *
 * send 束含**两条**投影：`im:post:sending`（瘦·乐观转圈）+ `im:post:received`（fat·echo 字段集）。
 * ② 字段集 oracle 是 fat 那条 → 优先按期望 event 选；无匹配则取**最后一条**
 * （received 在 sending 之后 emit）。绝不取「第一条」（那是 sending 瘦集，会误判缺 12 字段）。
 */
function actualProjection(bundle, preferEvent) {
  const projs = bundle.hops.filter((h) => h.facet === 'projection' && h.hop === 'projection');
  if (projs.length === 0) return null;
  const p =
    (preferEvent && projs.find((h) => h.payload?.event === preferEvent)) ||
    projs[projs.length - 1];
  return { event: p.payload?.event, data: p.payload?.data ?? {} };
}

/** ④ storage：取首个匹配的写 op（{op,table,rows}）。
 *  影响计数字段随 op 异名：batch_upsert/insert → `rows`；batch_update/delete → `keys`（更新的键数）；
 *  scan → `rows`。统一归一为 rows（取 rows ?? keys ?? count），使 minRows 判据跨 op 一致。 */
function actualStorage(bundle, table) {
  const writes = bundle.hops.filter((h) => h.facet === 'storage' && h.payload?.op);
  const hit = writes.find((h) => !table || h.payload?.table === table) ?? writes[0];
  if (!hit) return null;
  const rows = hit.payload.rows ?? hit.payload.keys ?? hit.payload.count;
  return { op: hit.payload.op, table: hit.payload.table, rows };
}

// ── 逐面 diff（期望 → 实际），返回 facet 报告 ─────────────────────────────────

/** body 关键字段对齐：期望列的每个键都要在实际 body 出现且值相等（实际允许多字段）。 */
function diffOutbound(expect, actual) {
  if (!actual) return facetFail('outbound', '无出站命令体（断在 invoke→HTTP 这跳）', { expect });
  const issues = [];
  if (expect.method && actual.method !== expect.method)
    issues.push(`method 期望 ${expect.method} 实得 ${actual.method}`);
  if (expect.urlEndsWith && !String(actual.url ?? '').endsWith(expect.urlEndsWith))
    issues.push(`url 期望以 ${expect.urlEndsWith} 结尾，实得 ${actual.url}`);
  const body = actual.body ?? {};
  for (const [k, want] of Object.entries(expect.bodyFields ?? {})) {
    if (!(k in body)) issues.push(`body 缺字段 ${k}`);
    else if (want !== '*' && !valEq(body[k], want))
      issues.push(`body.${k} 期望 ${JSON.stringify(want)} 实得 ${JSON.stringify(body[k])}`);
  }
  // 禁出现的字段（如 snake_case 旧形态泄漏 → send 无回声真因）。
  for (const k of expect.bodyForbidden ?? []) {
    if (k in body) issues.push(`body 不该有字段 ${k}（旧形态泄漏）`);
  }
  return facetReport('outbound', issues, actual);
}

/** ② 投影字段集严格对齐：缺/多即 fail（projection-schema 冻结语义）。 */
function diffProjection(expect, actual) {
  if (!actual) return facetFail('projection', '无投影 emit（断在 gate→投影这跳）', { expect });
  const issues = [];
  if (expect.event && actual.event !== expect.event)
    issues.push(`channel 期望 ${expect.event} 实得 ${actual.event}`);
  const got = Object.keys(actual.data ?? {}).sort();
  const want = [...(expect.dataKeys ?? [])].sort();
  const missing = want.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !want.includes(k));
  if (missing.length) issues.push(`投影缺字段: ${missing.join(', ')}`);
  if (extra.length) issues.push(`投影多字段: ${extra.join(', ')}`);
  // 可选：值断言（命名陷阱锚 createAt 非 createdAt 等已由键集覆盖；值用 expect.dataValues）。
  for (const [k, want2] of Object.entries(expect.dataValues ?? {})) {
    if (want2 !== '*' && !valEq(actual.data?.[k], want2))
      issues.push(`投影 data.${k} 期望 ${JSON.stringify(want2)} 实得 ${JSON.stringify(actual.data?.[k])}`);
  }
  return facetReport('projection', issues, { event: actual.event, dataKeys: got });
}

/** ④ storage：op + table 对齐，rows ≥ minRows。 */
function diffStorage(expect, actual) {
  if (!actual) return facetFail('storage', '无落库写（断在 reconcile→Storage 这跳）', { expect });
  const issues = [];
  if (expect.op && actual.op !== expect.op) issues.push(`op 期望 ${expect.op} 实得 ${actual.op}`);
  if (expect.table && actual.table !== expect.table)
    issues.push(`table 期望 ${expect.table} 实得 ${actual.table}`);
  if (expect.minRows != null && !(actual.rows >= expect.minRows))
    issues.push(`rows 期望 ≥${expect.minRows} 实得 ${actual.rows}`);
  return facetReport('storage', issues, actual);
}

/** ③ DOM：e2e 注入的 data-* 终态对齐。 */
function diffDom(expect, actualDom) {
  if (!actualDom) return facetFail('dom', '无 DOM 面（e2e 未注入 / 行未渲染）', { expect });
  const issues = [];
  for (const [k, want] of Object.entries(expect.dataAttrs ?? {})) {
    const got = actualDom[k];
    if (want === '*') {
      if (got == null || got === '') issues.push(`DOM data-${k} 缺值`);
    } else if (want === '!tmp') {
      // 语义：echo 后 data-msg-id 必须 ≠ temporaryId（tmp→server 覆写发生）。
      if (got == null || got === actualDom._temporaryId)
        issues.push(`DOM data-${k} 应 ≠ temporaryId（tmp→server 覆写未发生），实得 ${got}`);
    } else if (!valEq(got, want)) {
      issues.push(`DOM data-${k} 期望 ${JSON.stringify(want)} 实得 ${JSON.stringify(got)}`);
    }
  }
  return facetReport('dom', issues, actualDom);
}

// ── 报告构造 ─────────────────────────────────────────────────────────────────

function facetReport(facet, issues, actual) {
  return { facet, ok: issues.length === 0, issues, actual };
}
function facetFail(facet, reason, extra = {}) {
  return { facet, ok: false, issues: [reason], actual: null, ...extra };
}

/** 宽松值比较：number 与其字符串形态视作相等（JSONL 里 seq 可能 number/string 混）。 */
function valEq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return String(a) === String(b);
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * 主入口：跑四面对账，出报告。
 *
 * @param {object} args
 * @param {string} args.jsonl        run.jsonl 全文
 * @param {object} args.expect       四面期望文件（解析后的对象）
 * @param {object} [args.dom]        e2e 注入的 DOM 面终态（data-* 扁平对象，键去 data- 前缀）
 * @param {string} [args.ucId]       默认取 expect.ucId
 * @returns {object} 报告
 */
export function runFourFacet({ jsonl, expect, dom, ucId }) {
  const uc = ucId ?? expect.ucId;
  const { events, parseErrors } = parseJsonl(jsonl);
  const bundles = bundleByCorrKey(events, uc);

  // 选「目标束」：领域键最匹配期望领域锚。
  // 优先 tmp（send 主事件）；无 tmp 时用 ch 锚（UC-4.1 批量 sync：outbound cursors[0].channelId
  // + per-channel projection/storage 经同 ch 聚一束·target 须锁那个 ch 而非任取首束）。
  const tmpAnchor = expect.corrAnchor?.tmp;
  const chAnchor = expect.corrAnchor?.ch;
  let target =
    (tmpAnchor && bundles.find((b) => b.dims.tmp === tmpAnchor)) ||
    bundles.find((b) => b.dims.tmp) ||
    (chAnchor && bundles.find((b) => b.dims.ch === chAnchor && !b.dims.tmp)) ||
    bundles.find((b) => b.key) ||
    null;

  const facets = {
    outbound: diffOutbound(expect.outbound ?? {}, target && actualOutbound(target)),
    projection: diffProjection(expect.projection ?? {}, target && actualProjection(target, expect.projection?.event)),
    storage: diffStorage(expect.storage ?? {}, target && actualStorage(target, expect.storage?.table)),
    dom: diffDom(expect.dom ?? {}, dom ?? null),
  };

  // 「断在哪一跳」：按链路顺序找第一个红面。
  const order = ['outbound', 'projection', 'storage', 'dom'];
  const brokenAt = order.find((f) => !facets[f].ok) ?? null;
  const green = brokenAt === null && parseErrors.length === 0;

  return {
    ucId: uc,
    green,
    brokenAt, // null = 四面齐绿
    corrKey: target?.key ?? null,
    facets,
    bundleCount: bundles.length,
    parseErrors,
    summary: green
      ? `✅ ${uc} 四面全绿（corr_key=${target?.key ?? 'n/a'}）`
      : `❌ ${uc} 断在 [${brokenAt ?? 'parse'}] 面：${
          brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${parseErrors.length} 行坏`
        }`,
  };
}

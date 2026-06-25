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

/** ① outbound：HTTP 优先（method/url/body），退而取 ws-send 帧。
 *
 * UC-4.1 batch fallback：目标束（锚 ch）可能无 outbound（① 是单条批量 channels/load/increment
 * 请求·cursors[0] 未必是锚 ch → 该批请求归别束）。此时在 `batchOutbound`（窗口内所有 outbound
 * http-req）里找 cursors 覆盖锚 ch 的批请求作 ①——faithful（该批确实请求了锚 ch 的增量），
 * 非 tautology（cursors 不含锚 ch 则不命中 → ① 仍红，见单测可证伪对偶）。
 */
function actualOutbound(bundle, opts = {}) {
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

  // batch fallback：用窗口内覆盖锚 ch 的批请求（cursors[*].channelId 含锚 ch）。
  const { batchOutbound, anchorCh, createOutbound } = opts;
  if (anchorCh && Array.isArray(batchOutbound)) {
    const hit = batchOutbound.find((h) => {
      const cursors = h.payload?.body?.cursors;
      return (
        Array.isArray(cursors) &&
        cursors.some((c) => c && (c.channelId === anchorCh || c.channel_id === anchorCh))
      );
    });
    if (hit) {
      return {
        kind: 'http',
        method: hit.payload?.method,
        url: hit.payload?.url,
        body: hit.payload?.body ?? {},
      };
    }
  }

  // create fallback（UC-5.1 建群·spec §1）：建群出站 body 无 server 分配的 channelId → 出站
  // hop 抽不到 corr_key 归 unkeyed，目标束（锚 server 分配 ch）不含它。在 createOutbound
  // （窗口内 URL endsWith expectUrlEndsWith 的请求，建群语义=窗口内唯一一条）里取之作 ①——
  // faithful（该次 create 确实是本 UC 触发的建群请求·窗口隔离保证唯一），非 tautology
  // （无 create 请求则不命中 → ① 仍红，见单测可证伪对偶）。
  if (Array.isArray(createOutbound) && createOutbound.length > 0) {
    const hit = createOutbound[0];
    return {
      kind: 'http',
      method: hit.payload?.method,
      url: hit.payload?.url,
      body: hit.payload?.body ?? {},
    };
  }
  return null;
}

/** 取束内**所有** outbound http-req hop（多阶段 UC 用·如 UC-1.9 加急两段 urgentPost+urgentConfirm）。 */
function allOutboundHttp(bundle) {
  return bundle.hops
    .filter((h) => h.facet === 'outbound' && h.hop === 'http-req')
    .map((h) => ({
      method: h.payload?.method,
      url: h.payload?.url,
      body: h.payload?.body ?? {},
    }));
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
 *  scan → `rows`。统一归一为 rows（取 rows ?? keys ?? count），使 minRows 判据跨 op 一致。
 *
 *  scanFallback（读族 Scan·UC-2.1/UC-2.3 定位）：读路径 Scan op 的 payload 仅 {op,rows,table}
 *  （防隐私·无 channel_id）→ 装饰器抽不出 corr_key → 该 storage 事件落 unkeyed 束·不进 ch 锚 target。
 *  故当 target 束内无匹配 table 的 storage hop 时，回退窗口内 uc_id 同 + table 同的 scan 事件
 *  （与 createOutbound/batchOutbound 的窗口 fallback 同模式·窗口隔离保证本 UC 内唯一）。 */
function actualStorage(bundle, table, scanFallback) {
  const writes = bundle ? bundle.hops.filter((h) => h.facet === 'storage' && h.payload?.op) : [];
  // table 指定时只认 table 匹配的 storage hop；不匹配则不抢答（让位给 scanFallback）。
  // `?? writes[0]` 的 catch-all 仅在 table 未指定（通配）时启用——否则 target 束里偶现的
  // 无关 keyed 写（如切群触发的 batch_upsert channel_member）会把读族 expect(scan message)
  // 错配为 batch_upsert，导致环境漂移下假红（2026-06-25 UC-2.1 实测）。
  let hit = table
    ? writes.find((h) => h.payload?.table === table)
    : (writes[0] ?? null);
  // 读族 Scan 回退：target 束无匹配 table 的 storage hop → 取窗口内同 uc + 同 table 的 scan 事件。
  if (!hit && Array.isArray(scanFallback) && scanFallback.length > 0) {
    hit = scanFallback.find((h) => !table || h.payload?.table === table) ?? scanFallback[0];
  }
  if (!hit) return null;
  const rows = hit.payload.rows ?? hit.payload.keys ?? hit.payload.count;
  return { op: hit.payload.op, table: hit.payload.table, rows };
}

// ── 逐面 diff（期望 → 实际），返回 facet 报告 ─────────────────────────────────

/** 出站期望是否「无约束 optional」（读族纯本地 Scan·UC-2.1/UC-2.3 定位 ① N/A）：
 *  method/urlEndsWith 皆 `*` 且无 bodyFields/bodyForbidden 约束 → 不约束出站（有无 HTTP 都合法）。
 *  这不是放水：读族本地 Scan **本就不产 HTTP 出站**，强求 ① 反而是假阳；契约把 ① 显式标 optional
 *  （expect.outbound.method=* url=* 空 body）即声明本 UC ① N/A（与 send 族实 body 约束区分·守可证伪）。 */
function isOutboundOptional(expect) {
  return (
    (expect.method ?? '*') === '*' &&
    (expect.urlEndsWith ?? '*') === '*' &&
    Object.keys(expect.bodyFields ?? {}).length === 0 &&
    (expect.bodyForbidden ?? []).length === 0
  );
}

/** body 关键字段对齐：期望列的每个键都要在实际 body 出现且值相等（实际允许多字段）。 */
function diffOutbound(expect, actual) {
  // 读族 optional 出站（① N/A）：无约束期望 → 总绿（不论有无 HTTP hop·见 isOutboundOptional 注）。
  if (isOutboundOptional(expect)) return facetReport('outbound', [], actual ?? { optional: true });
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

/**
 * 多阶段 outbound 对齐（UC-1.9 加急：phase1_urgentPost + phase2_urgentConfirm 等）。
 *
 * expect.outbound 含 `phase*` 子对象时启用：每个 phase 是一份 flat outbound 期望
 * （{method, urlEndsWith, bodyFields, bodyForbidden}）。在束内**所有** outbound http-req 里
 * 按 urlEndsWith 找匹配那条逐字段断言——任一 phase 无匹配请求或字段偏离即 fail。
 * faithful（两段都必须出现且 body 对齐），非 tautology（少发一段 → 该 phase 红·见单测可证伪对偶）。
 */
function diffOutboundPhases(phases, httpHops) {
  const issues = [];
  const seen = [];
  for (const [phaseName, pexp] of Object.entries(phases)) {
    const hit = httpHops.find(
      (h) => pexp.urlEndsWith && String(h.url ?? '').endsWith(pexp.urlEndsWith)
    );
    if (!hit) {
      issues.push(`${phaseName}: 无匹配出站（期望 url 以 ${pexp.urlEndsWith} 结尾）`);
      continue;
    }
    seen.push(phaseName);
    const sub = diffOutbound(pexp, { kind: 'http', method: hit.method, url: hit.url, body: hit.body });
    for (const iss of sub.issues) issues.push(`${phaseName}: ${iss}`);
  }
  return facetReport('outbound', issues, { phases: seen, httpCount: httpHops.length });
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

// ── 多频道四面对账（UC-1.7 转发 forward to N channels）──────────────────────────
//
// 与单事件 runFourFacet 的差异：转发 = **单出站 HTTP（createPosts）→ N 目标频道 echo**。
// 单 outbound 携 channelIds 数组（≥2 目标）；每个目标频道独立 im:post:received 投影 + message
// 落库行。故四面对账按「单 ① + N ②③④」展开：
//   ① 窗口内唯一 posts/createPosts 出站（body.channelIds 覆盖目标·camelCase·无 PascalCase 泄漏）
//   ② 每个目标频道须有一条 im:post:received（fat 字段集严格对齐 perChannelDataKeys）
//   ④ message 表写 ≥ minRows 行（转发逐目标频道各落一行）
//   ③ DOM ≥ N 行·各自 channel-id ∈ 目标集·msg-id 非 tmp（server 覆写）·status=sent
//
// faithful（每个目标频道都须出现投影 + DOM 行·少一个即红），非 tautology（漏发某频道 → ② 红·
// 见单测可证伪对偶）。本入口是机器件（非冻结 oracle）·按 expect.json 的 multiChannel 形态消费。

/** ① 找窗口内唯一 createPosts 出站，逐字段断言（覆盖目标频道 + camelCase + 无 PascalCase 泄漏）。 */
function diffRelayOutbound(expect, httpHops, targetChannels) {
  const exp = expect.outbound ?? {};
  const hits = httpHops.filter((h) =>
    exp.urlEndsWith ? String(h.url ?? '').endsWith(exp.urlEndsWith) : true
  );
  if (hits.length === 0) {
    return facetFail('outbound', `无 createPosts 出站（期望 url 以 ${exp.urlEndsWith} 结尾）`, { expect: exp });
  }
  const hit = hits[0];
  const issues = [];
  if (exp.method && hit.method !== exp.method)
    issues.push(`method 期望 ${exp.method} 实得 ${hit.method}`);
  const body = hit.body ?? {};
  // bodyFields：posts / channelIds 必须存在（值用 * 占位·非空校验在下）。
  for (const k of Object.keys(exp.bodyFields ?? {})) {
    if (!(k in body)) issues.push(`body 缺字段 ${k}`);
  }
  // PascalCase 泄漏 / snake 泄漏锚（bodyForbidden）。
  for (const k of exp.bodyForbidden ?? []) {
    if (k in body) issues.push(`body 不该有字段 ${k}（旧形态泄漏）`);
  }
  // channelIds 须是数组且覆盖全部目标频道（faithful·非任取）。
  const chIds = body.channelIds;
  if (!Array.isArray(chIds)) {
    issues.push('body.channelIds 非数组（转发须 camelCase channelIds 数组）');
  } else {
    const missing = (targetChannels ?? []).filter((c) => !chIds.includes(c));
    if (missing.length) issues.push(`body.channelIds 未覆盖目标频道: ${missing.join(', ')}`);
    if (chIds.length < 2) issues.push(`body.channelIds 仅 ${chIds.length} 个（转发须 ≥2 目标·多频道特征）`);
  }
  // posts 须是非空数组。
  if (!Array.isArray(body.posts) || body.posts.length === 0) {
    issues.push('body.posts 非空数组缺失（转发须携待转发 Post 对象数组）');
  }
  return facetReport('outbound', issues, { url: hit.url, channelIds: chIds });
}

/** ② 每个目标频道须有一条 im:post:received（fat），字段集严格对齐 perChannelDataKeys。 */
function diffRelayProjections(expect, events, uc, targetChannels) {
  const exp = expect.projection ?? {};
  const event = exp.perChannelEvent ?? 'im:post:received';
  const wantKeys = [...(exp.perChannelDataKeys ?? [])].sort();
  const issues = [];
  // 窗口内全部 im:post:received 投影，按 channelId 索引。
  const byCh = new Map();
  for (const ev of events) {
    if (uc !== undefined && ev.uc_id !== uc) continue;
    if (ev.facet !== 'projection' || ev.hop !== 'projection') continue;
    const p = ev.payload ?? {};
    if (p.event !== event) continue;
    const ch = p.data?.channelId ?? p.data?.channel_id;
    if (ch && (targetChannels ?? []).includes(ch)) {
      if (!byCh.has(ch)) byCh.set(ch, p.data ?? {});
    }
  }
  for (const ch of targetChannels ?? []) {
    const data = byCh.get(ch);
    if (!data) {
      issues.push(`目标频道 ${ch} 无 ${event} 投影（断在 createPosts→WS post→投影 这跳）`);
      continue;
    }
    const got = Object.keys(data).sort();
    const missing = wantKeys.filter((k) => !got.includes(k));
    const extra = got.filter((k) => !wantKeys.includes(k));
    if (missing.length) issues.push(`频道 ${ch} 投影缺字段: ${missing.join(', ')}`);
    if (extra.length) issues.push(`频道 ${ch} 投影多字段: ${extra.join(', ')}`);
  }
  return facetReport('projection', issues, { channelCount: byCh.size, event });
}

/** ④ message 表写计数 ≥ minRows（转发逐目标频道各落一行）。 */
function diffRelayStorage(expect, events, uc) {
  const exp = expect.storage ?? {};
  const table = exp.table ?? 'message';
  let rowCount = 0;
  let sawOp = null;
  for (const ev of events) {
    if (uc !== undefined && ev.uc_id !== uc) continue;
    if (ev.facet !== 'storage') continue;
    const p = ev.payload ?? {};
    if (!p.op || (table && p.table !== table)) continue;
    sawOp = p.op;
    rowCount += p.rows ?? p.keys ?? p.count ?? 1;
  }
  const issues = [];
  if (sawOp == null) {
    return facetFail('storage', `无 ${table} 落库写（断在 reconcile→Storage 这跳）`, { expect: exp });
  }
  if (exp.minRows != null && !(rowCount >= exp.minRows))
    issues.push(`${table} 落库行 期望 ≥${exp.minRows} 实得 ${rowCount}`);
  return facetReport('storage', issues, { op: sawOp, table, rows: rowCount });
}

/** ③ DOM ≥ N 行·各自 channel-id ∈ 目标集·msg-id 非 tmp（server 覆写）·status=sent。 */
function diffRelayDom(expect, domRows, targetChannels) {
  const exp = expect.dom ?? {};
  if (!Array.isArray(domRows) || domRows.length === 0) {
    return facetFail('dom', '无转发 DOM 行（e2e 未注入 / 行未渲染）', { expect: exp });
  }
  const issues = [];
  const seenCh = new Set();
  const attrs = exp.perRowDataAttrs ?? {};
  for (const row of domRows) {
    const ch = row['channel-id'];
    if (!(targetChannels ?? []).includes(ch)) {
      issues.push(`DOM 行 channel-id=${ch} 不在目标频道集（非转发行混入）`);
      continue;
    }
    seenCh.add(ch);
    for (const [k, want] of Object.entries(attrs)) {
      const got = row[k];
      if (want === '*') {
        if (got == null || got === '') issues.push(`频道 ${ch} 行 data-${k} 缺值`);
      } else if (want === '!tmp') {
        if (got == null || got === row['temporary-id'])
          issues.push(`频道 ${ch} 行 data-${k} 应 ≠ temporaryId（server 覆写未发生），实得 ${got}`);
      } else if (!valEq(got, want)) {
        issues.push(`频道 ${ch} 行 data-${k} 期望 ${JSON.stringify(want)} 实得 ${JSON.stringify(got)}`);
      }
    }
  }
  // 每个目标频道都须有一行（faithful·少一个即红）。
  const missing = (targetChannels ?? []).filter((c) => !seenCh.has(c));
  if (missing.length) issues.push(`目标频道无转发 DOM 行: ${missing.join(', ')}`);
  return facetReport('dom', issues, { rowCount: domRows.length, channels: [...seenCh] });
}

/**
 * 多频道四面对账入口（UC-1.7 转发）。
 *
 * @param {object} args
 * @param {string} args.jsonl            run.jsonl 全文
 * @param {object} args.expect          四面期望文件（multiChannel 形态）
 * @param {Array<object>} args.domRows  e2e 注入的转发 DOM 行（各目标频道·data-* 扁平对象）
 * @param {Array<string>} args.targetChannels  目标频道 id 集（≥2）
 * @param {string} [args.ucId]
 * @returns {object} 报告
 */
export function runFourFacetMultiChannel({ jsonl, expect, domRows, targetChannels, ucId }) {
  const uc = ucId ?? expect.ucId;
  const { events, parseErrors } = parseJsonl(jsonl);

  const httpHops = events
    .filter(
      (e) =>
        (uc === undefined || e.uc_id === uc) &&
        e.facet === 'outbound' &&
        e.hop === 'http-req'
    )
    .map((e) => ({ method: e.payload?.method, url: e.payload?.url, body: e.payload?.body ?? {} }));

  const facets = {
    outbound: diffRelayOutbound(expect, httpHops, targetChannels),
    projection: diffRelayProjections(expect, events, uc, targetChannels),
    storage: diffRelayStorage(expect, events, uc),
    dom: diffRelayDom(expect, domRows, targetChannels),
  };

  const order = ['outbound', 'projection', 'storage', 'dom'];
  const brokenAt = order.find((f) => !facets[f].ok) ?? null;
  const green = brokenAt === null && parseErrors.length === 0;

  return {
    ucId: uc,
    green,
    brokenAt,
    targetChannels,
    facets,
    parseErrors,
    summary: green
      ? `✅ ${uc} 多频道四面全绿（targets=${(targetChannels ?? []).join(',')}）`
      : `❌ ${uc} 断在 [${brokenAt ?? 'parse'}] 面：${
          brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${parseErrors.length} 行坏`
        }`,
  };
}

// ── 读族（request-response）对账（UC-2.4 getReplies/getReplyBranch）─────────────────
//
// 与写族 runFourFacet 的差异（projection-schema §1.2 / spec read-family）：
//   - **无 corr_key 束**：读族 outbound wire body 携 server postId（replyId/replyFirstLevelId·非
//     ch/tmp/sid 别名）→ 抽不到领域键；projection `im:read:result{req_id, body}` 的 req_id 也非
//     四维之一。故不走 bundleByCorrKey，而是在 **UC 窗口（uc_id 过滤）** 内按 endpoint + req_id 直找。
//   - **四面退化为 ①②**：① 出站 wire body 逐字检（urlEndsWith + bodyFields + bodyForbidden）；
//     ② 投影 `im:read:result` 外层键集 {req_id, body} 严格对齐 + req_id 匹配 corrAnchor.req_id（如指定）。
//     ③ DOM / ④ storage = N/A（读路径无 write 驱动 DOM·不落新行·cursor 不推进）→ 自动 ok（不参与裁定）。
//   - **窗口隔离保证唯一**：e2e 每个读 endpoint 在独立 set_uc 窗口里 invoke 一次 → 窗口内 outbound
//     http-req（按 endpoint 过滤）唯一·im:read:result projection 唯一·非 tautology（少发即 ① 红·
//     少回灌即 ② 红·见可证伪对偶）。
//
// 机器件归属（非改冻结 oracle·C009）：本入口与抽键规则同属 reducer 领域件·读族契约 URL+body-shape
// 由 expect.outbound（真机curl真源派生）冻结·绿由本 reducer 裁定。
//
// @param {object} args
// @param {string} args.jsonl   run.jsonl 全文
// @param {object} args.expect  读族期望（expect.outbound flat·expect.projection {event,dataKeys}）
// @param {string} args.reqId   本次 invoke 生成的 req_id（projection ② 面锚·outbound ① 不携·按 endpoint 找）
// @param {string} [args.ucId]  默认取 expect.ucId
// @returns {object} 报告（facets.outbound / facets.projection）
export function runFourFacetRead({ jsonl, expect, reqId, ucId }) {
  const uc = ucId ?? expect.ucId;
  const { events, parseErrors } = parseJsonl(jsonl);

  const exp = expect.outbound ?? {};
  const urlEnds = exp.urlEndsWith;

  // ① 出站：UC 窗口内按 endpoint（urlEndsWith）找 read outbound http-req（窗口隔离保证唯一·
  // 多于一个取最后一条——同窗口同 endpoint 重发取最新·一般唯一）。
  const httpHops = events
    .filter(
      (e) =>
        (uc === undefined || e.uc_id === uc) &&
        e.facet === 'outbound' &&
        e.hop === 'http-req' &&
        (!urlEnds || urlEnds === '*' || String(e.payload?.url ?? '').endsWith(urlEnds))
    )
    .map((e) => ({ method: e.payload?.method, url: e.payload?.url, body: e.payload?.body ?? {} }));
  const httpHit = httpHops.length ? httpHops[httpHops.length - 1] : null;
  const outboundFacet = diffOutbound(exp, httpHit);

  // ② 投影：UC 窗口内找 im:read:result projection·req_id 匹配 reqId（如提供）。
  const pexp = expect.projection ?? {};
  const projHops = events.filter(
    (e) =>
      (uc === undefined || e.uc_id === uc) &&
      e.facet === 'projection' &&
      e.hop === 'projection' &&
      (e.payload?.event ?? e.payload?.channel) === (pexp.event ?? 'im:read:result')
  );
  // req_id 锚：优先精确匹配本次 reqId（窗口可能多次回灌·锁本束）；缺 reqId 则取窗口内首条。
  const matchProj =
    (reqId &&
      projHops.find(
        (e) => (e.payload?.data?.req_id ?? e.payload?.data?.reqId) === reqId
      )) ||
    projHops[0] ||
    null;
  const projActual = matchProj
    ? {
        event: matchProj.payload?.event ?? matchProj.payload?.channel,
        data: matchProj.payload?.data ?? {},
      }
    : null;
  const projFacet = diffProjection(pexp, projActual);
  // req_id 值锚（如 expect/reqId 指定·守「回灌的 req_id 确为本次 invoke 生成」非任取）。
  if (projFacet.ok && reqId) {
    const got = projActual?.data?.req_id ?? projActual?.data?.reqId;
    if (got !== reqId)
      projFacet.issues.push(`im:read:result req_id 期望 ${reqId} 实得 ${got}`);
    projFacet.ok = projFacet.issues.length === 0;
  }

  // 读族断面：① 出站 + ② 投影（③④ N/A 不裁定）。
  const facets = {
    outbound: outboundFacet,
    projection: projFacet,
  };
  const order = ['outbound', 'projection'];
  const brokenAt = order.find((f) => !facets[f].ok) ?? null;
  const green = brokenAt === null && parseErrors.length === 0;

  return {
    ucId: uc,
    green,
    brokenAt,
    reqId: reqId ?? null,
    facets,
    parseErrors,
    summary: green
      ? `✅ ${uc} 读族双面全绿（req_id=${reqId ?? 'n/a'}·endpoint=${urlEnds}）`
      : `❌ ${uc} 读族断在 [${brokenAt ?? 'parse'}] 面：${
          brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${parseErrors.length} 行坏`
        }`,
  };
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
  // sid 锚（UC-1.9 加急·两阶段同 server postId）：corrAnchor.postId / .sid → 锁 sid 那束
  //   （加急 post_update 投影 msg_id + 出站 postId + 落库 id 经 sid 聚一束·见 corr-key msg_id 别名）。
  const sidAnchor = expect.corrAnchor?.sid ?? expect.corrAnchor?.postId;
  // 锚优先级：① 显式 tmp 锚（send 族主事件）② 显式 ch 锚的纯频道束（UC-4.1 hello 增量·锚 ch
  // 无 tmp/sid）—— **须先于** generic any-tmp 兜底，否则 UC-4.1 窗口里混入的 post 束（带 tmp）
  // 会被任取为 target → ②④ 误锚 post 而非锚频道增量。③ generic any-tmp（无显式锚的 send 自测）
  // ④ 任意有键束兜底。
  let target =
    (tmpAnchor && bundles.find((b) => b.dims.tmp === tmpAnchor)) ||
    (sidAnchor && bundles.find((b) => b.dims.sid === sidAnchor)) ||
    (chAnchor && bundles.find((b) => b.dims.ch === chAnchor && !b.dims.tmp)) ||
    bundles.find((b) => b.dims.tmp) ||
    bundles.find((b) => b.key) ||
    null;

  // batch 出站候选（窗口内所有 outbound http-req）：供 UC-4.1 ① fallback 按 cursors 覆盖锚 ch 命中。
  const batchOutbound = events.filter(
    (e) =>
      (uc === undefined || e.uc_id === uc) &&
      e.facet === 'outbound' &&
      e.hop === 'http-req' &&
      Array.isArray(e.payload?.body?.cursors)
  );
  const anchorCh = chAnchor ?? target?.dims?.ch ?? null;

  // create 出站候选（UC-5.1 建群 ①·窗口内 URL endsWith expect.outbound.urlEndsWith 的 http-req）：
  // 建群 body 无 server 分配 channelId → 出站 hop 归 unkeyed 不进锚 ch 束；此候选供 createOutbound
  // fallback 取之。窗口隔离（uc_id 过滤）保证本 UC 内建群请求唯一（≥1 才命中·否则 ① 红·非放水）。
  // 仅对**非批量**出站启用 create fallback（body 无 cursors）——批量请求归 batchOutbound 域
  // （按 cursors 覆盖锚 ch 命中·不命中则 ① 红·守该路径可证伪对偶），不被 create fallback 抢答。
  const createUrlEnds = expect.outbound?.urlEndsWith;
  const createOutbound = createUrlEnds
    ? events.filter(
        (e) =>
          (uc === undefined || e.uc_id === uc) &&
          e.facet === 'outbound' &&
          e.hop === 'http-req' &&
          !Array.isArray(e.payload?.body?.cursors) &&
          String(e.payload?.url ?? '').endsWith(createUrlEnds)
      )
    : [];

  // 多阶段 outbound（UC-1.9 加急两段）：expect.outbound 有 `phase*` 子对象 → 走 phases 对齐。
  const outboundExp = expect.outbound ?? {};
  const phaseKeys = Object.keys(outboundExp).filter((k) => k.startsWith('phase'));
  const outboundFacet =
    phaseKeys.length > 0
      ? diffOutboundPhases(
          Object.fromEntries(phaseKeys.map((k) => [k, outboundExp[k]])),
          target ? allOutboundHttp(target) : []
        )
      : diffOutbound(
          outboundExp,
          target && actualOutbound(target, { batchOutbound, anchorCh, createOutbound })
        );

  // 读族 Scan storage fallback（UC-2.1/UC-2.3 定位·expect.storage.op=scan）：窗口内 uc 同 + scan op
  // 的 storage 事件（payload 无 channel_id → unkeyed·不进 ch 锚 target）。仅 scan 期望时启用，
  // 避免抢答 keyed 写 op（send 族 batch_upsert/insert 仍走 target 束·守可证伪）。
  const scanFallback =
    expect.storage?.op === 'scan'
      ? events.filter(
          (e) =>
            (uc === undefined || e.uc_id === uc) &&
            e.facet === 'storage' &&
            e.payload?.op === 'scan'
        )
      : [];

  const facets = {
    outbound: outboundFacet,
    projection: diffProjection(expect.projection ?? {}, target && actualProjection(target, expect.projection?.event)),
    storage: diffStorage(expect.storage ?? {}, actualStorage(target, expect.storage?.table, scanFallback)),
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

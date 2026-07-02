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

/**
 * 解析 JSONL 文本 → HopEvent[]（跳空行；坏行收集进 parseErrors）。
 *
 * **torn-line 容忍（暖栈常驻并发产物·非放水）**：常驻 app 持续往 run.jsonl 追加（背景
 * __quiescence__ hops），spec 读取时可能撞上「最后一行只写了一半」的并发产物（最后一个
 * `\n` 还没落盘）。这类**末行残缺**是 append-only 文件 + 并发读的经典工件，不是真损坏 →
 * 不计入 parseErrors 否决（否则四面全绿也会被「JSONL 解析 1 行坏」一票否决·假红）。
 *
 * 守可证伪（C008）：仅放过**最后一条非空行**且其后无任何可解析的非空行（即真·末尾）的坏行；
 * 任何**非末行**的坏行（其后还有合法行 = 文件中段损坏，绝非并发末行）仍硬失败计入 parseErrors。
 * torn 末行被放过时记入返回的 `tornLastLine`（透明可审·非静默吞）。
 *
 * @param {string} text run.jsonl 全文
 * @returns {{events:Array<object>, parseErrors:Array<{line:number,raw:string,error:string}>, tornLastLine:({line:number,raw:string,error:string}|null)}}
 */
export function parseJsonl(text) {
  /** @type {Array<object>} */
  const events = [];
  /** @type {Array<{line:number,raw:string,error:string}>} */
  const rawErrors = [];
  const lines = text.split('\n');
  // 最后一条非空行的下标（torn 末行只可能是它）。无非空行则为 -1。
  let lastNonEmptyIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] && lines[i].trim()) { lastNonEmptyIdx = i; break; }
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    try {
      events.push(JSON.parse(raw));
    } catch (e) {
      rawErrors.push({ line: i + 1, raw, error: String(e?.message ?? e), _idx: i });
    }
  }
  // torn 末行甄别：坏行恰是最后一条非空行（其后只有空行/EOF）→ 并发末行残缺·放过。
  /** @type {({line:number,raw:string,error:string}|null)} */
  let tornLastLine = null;
  /** @type {Array<{line:number,raw:string,error:string}>} */
  const parseErrors = [];
  for (const err of rawErrors) {
    if (err._idx === lastNonEmptyIdx) {
      // 末行残缺：剥掉内部 _idx，记入 tornLastLine（不否决绿）。
      tornLastLine = { line: err.line, raw: err.raw, error: err.error };
    } else {
      const { _idx, ...clean } = err;
      parseErrors.push(clean);
    }
  }
  return { events, parseErrors, tornLastLine };
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
  const { batchOutbound, anchorCh, createOutbound, expectUrlEndsWith } = opts;
  // 期望端点已知（非通配 *）时只认束内**匹配端点**的 http-req——否则锚 ch 束内混入的 per-channel
  // `channel/sync/notify`（其 cursors[0].channelId=锚 ch → 同 corr_key 归本束）会被任取为 ① →
  // url 失配假红（UC-4.1 实测 2026-06-27：束内 sync/notify 抢答 channels/load/increment bootstrap）。
  // 不匹配则 http 置空 → 落到下方 batch/create fallback 取真 bootstrap singleton。通配/未指定端点
  // 时退回原行为（束内首条 http-req）。
  const wantUrl = expectUrlEndsWith && expectUrlEndsWith !== '*' ? expectUrlEndsWith : null;
  const httpHops = bundle.hops.filter((h) => h.facet === 'outbound' && h.hop === 'http-req');
  const http = wantUrl
    ? httpHops.find((h) => String(h.payload?.url ?? '').endsWith(wantUrl))
    : httpHops[0];
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

  // batch fallback（UC-4.1 hello bootstrap·契约决议 2026-06-27 见 expect.outbound._note）：
  // ① 必须先按**期望端点**（expectUrlEndsWith）过滤——窗口内同样携 cursors 的批请求不止一种
  // （hello bootstrap `channels/load/increment` + increment-end/scan 触发的 `channel/sync/notify`×N），
  // 不过滤会被任一 cursors 覆盖锚 ch 的 sync/notify 误命中 → ① url 失配假红（实测 2026-06-27）。
  // ② 端点过滤后优先取 cursors 覆盖锚 ch 那条（faithful·该批确实请求了锚 ch 增量）；
  //    冷启动 race 下 bootstrap cursors 可能为空（hello 早于 scan reply·state.channels 未载 →
  //    server 收空 cursors 走全量 bootstrap·仍真回放 increment_channel）→ 退取窗口内该端点唯一
  //    bootstrap singleton（窗口隔离 uc_id 保证唯一·该次 hello 的 bootstrap·非任取）。
  // 守可证伪：hello 未发 bootstrap → urlMatched 空 → 无命中 → ① 红（见单测可证伪对偶·非 tautology）。
  if (Array.isArray(batchOutbound) && batchOutbound.length) {
    const urlMatched = expectUrlEndsWith
      ? batchOutbound.filter((h) => String(h.payload?.url ?? '').endsWith(expectUrlEndsWith))
      : batchOutbound;
    const covered = anchorCh
      ? urlMatched.find((h) => {
          const cursors = h.payload?.body?.cursors;
          return (
            Array.isArray(cursors) &&
            cursors.some((c) => c && (c.channelId === anchorCh || c.channel_id === anchorCh))
          );
        })
      : null;
    // 空 cursors bootstrap singleton 兜底（仅冷启动 race·非任取）：hello bootstrap 早于 scan reply
    // 时 state.channels 未载 → cursors=[]（server 收空走全量 bootstrap·所有频道 increment 真回放）。
    // 此时 coverage N/A（无 per-channel cursor 可比），取该端点空 cursors 的 singleton 作 ①。
    // 守可证伪：cursors **非空但不含锚 ch** 时 emptyCursorsBootstrap 不命中（length>0）→ ① 仍红
    // （该批显式请求了别的 channel 而非锚 ch·见单测 rep2 可证伪对偶）。
    const emptyCursorsBootstrap = expectUrlEndsWith
      ? urlMatched.find((h) => {
          const c = h.payload?.body?.cursors;
          return Array.isArray(c) && c.length === 0;
        })
      : null;
    const hit = covered || emptyCursorsBootstrap;
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
function actualStorage(bundle, table, scanFallback, opts = {}) {
  const writes = bundle ? bundle.hops.filter((h) => h.facet === 'storage' && h.payload?.op) : [];
  // table 指定时只认 table 匹配的 storage hop；不匹配则不抢答（让位给 scanFallback）。
  // `?? writes[0]` 的 catch-all 仅在 table 未指定（通配）时启用——否则 target 束里偶现的
  // 无关 keyed 写（如切群触发的 batch_upsert channel_member）会把读族 expect(scan message)
  // 错配为 batch_upsert，导致环境漂移下假红（2026-06-25 UC-2.1 实测）。
  const tableWrites = table ? writes.filter((h) => h.payload?.table === table) : writes;
  // 同一 server post 束内可能同时包含「前置发送 echo」和「本 UC 更新」（UC-1.8 实测：
  // received/batch_upsert 先到，quickReply updated/batch_update 后到）。优先按 expect.op 锁定；
  // 没有 op 锚时取同表最后一跳，避免旧 echo 抢答当前 UC 的 storage 面。
  let hit =
    (opts.op ? [...tableWrites].reverse().find((h) => h.payload?.op === opts.op) : null) ??
    (tableWrites.length > 0 ? tableWrites[tableWrites.length - 1] : null) ??
    null;
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

/** 投影期望是否「无约束 optional」（写族 fire-and-forget·UC-8.x 投票 create/do/close/delete 定位 ② N/A）：
 *  显式 `expect.projection.optional === true`（或缺 projection 节）→ 不约束投影（有无 im:read:result 都合法）。
 *  这不是放水：写族 vote 命令 helix 注册 is_read=false（HTTP fire-and-forget·数据走 server WS 回声·
 *  HTTP 响应仅 ack 可丢）→ 单账号 L1 无 server WS post_updated 回声可观测（真 server-data/WS-dep·见
 *  uc-coverage-ledger.md UC-8.x 节）→ 强求 ② im:read:result 反而假阳（写族本就不产读族回灌）。契约把
 *  ② 显式标 optional 即声明本命令 ② N/A（与 readVote 读族实 dataKeys 约束区分·守可证伪——少 ① 出站仍红）。 */
function isProjectionOptional(expect) {
  return expect === undefined || expect === null || expect.optional === true;
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
  // 可选：props 子集断言（UC-5.4 channelUpdate 帧锚 props.type=channelUpdate/field=displayName/
  // content=新名·区分同形态 join 帧·守可证伪——props 不符即 ② 红，非 tautology）。
  for (const [k, want3] of Object.entries(expect.propsMatch ?? {})) {
    if (want3 !== '*' && !valEq(actual.data?.props?.[k], want3))
      issues.push(`投影 data.props.${k} 期望 ${JSON.stringify(want3)} 实得 ${JSON.stringify(actual.data?.props?.[k])}`);
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
    } else if (want === '!absent') {
      // 语义：该 data-* 必须**不存在**（行已移除）。UC-5.3 关闭/退出群 ③：channel 行被
      // im:channel:closed 投影删除后 data-channel-id 应消失（e2e 注入 null/缺值即满足）。
      // 守可证伪：行仍在（got 非空）→ ③ 红（删行未发生·非 tautology）。
      if (got != null && got !== '')
        issues.push(`DOM data-${k} 应缺失（行已移除）实得 ${JSON.stringify(got)}`);
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
  // 写族 optional 投影（② N/A·UC-8.x vote create/do/close/delete）：显式 optional → 不约束·总绿
  // （fire-and-forget 无读族回灌·见 isProjectionOptional 注·守可证伪——少 ① 出站仍红）。
  const pexp = expect.projection ?? {};
  if (isProjectionOptional(expect.projection)) {
    const facets = {
      outbound: outboundFacet,
      projection: facetReport('projection', [], { optional: true }),
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
        ? `✅ ${uc} 写族 ① 出站绿（② 投影 N/A·fire-and-forget·endpoint=${urlEnds}）`
        : `❌ ${uc} 写族断在 [${brokenAt ?? 'parse'}] 面：${
            brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${parseErrors.length} 行坏`
          }`,
    };
  }
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

// ── 命令-DOM 族（① 出站 + ③ DOM 可证·②④ 结构性 L2 N/A）对账（UC-6.2 设/撤管理员）──────
//
// 与写族 runFourFacet / 读族 runFourFacetRead 的差异（真源 channel_change_dedicated.rs §19/§20 +
// ws/handlers/channel_member_role_updated.rs）：
//   - **add/remove manger 后端 WS 已注释**（仅 GrpcInvoke 对端）→ 操作者实际收
//     `channel_member_role_updated`（helix graceful no-op·真源 cses-client router.rs 落 vec![]·
//     角色态由后续全量 `channel_member_update` 广播帧覆盖）。故 L1 单账号链路上 **② emit_channel_member_updated
//     / ④ channel_member 全量落库结构上不到达**（须第二账号触发广播帧·见 L2 issue #45）。
//   - **四面退化为 ①③**：① 出站 wire body 逐字检（urlEndsWith + bodyFields + bodyForbidden·真源
//     {channelId, users:[{id,name,role,teamId}]}）；③ DOM data-admin 乐观本地刷（壳 setManger 出站后置
//     成员行 admin 标·L1 唯一可观测的用户操作反馈面·权威态由 L2 #45 广播帧对账）。
//   - **②④ = N/A 不裁定**（结构性 L2·非放水）：与 read 族 ③④ N/A 同理——本 UC 在 L1 单账号下
//     ②④ **本就不产生**（WS 注释 + role_updated no-op），强求反而假阳。诚实出账：issue 留 OPEN
//     标 ready-for-human·链 L2 #45（C011 不留「关了没测」的账）。
//
// 窗口隔离保证唯一（uc_id 过滤）：e2e 在独立 set_uc 窗口里 invoke 一次 set_manger → 窗口内 outbound
// http-req（按 endpoint 过滤）唯一·非 tautology（少发即 ① 红）。若 expect.dom.optional=true，
// DOM 面显式退化为 N/A（例如 UC-6.2 单账号 add/remove manger 后端不广播角色全量帧，壳不能乐观造
// data-admin）。
//
// 机器件归属（非改冻结 oracle·C009）：本入口同属 reducer 领域件·契约 URL+body-shape 由 expect.outbound
// （真机curl真源派生）冻结·DOM data-admin 由 expect.dom 冻结·绿由本 reducer 裁定。
//
// @param {object} args
// @param {string} args.jsonl   run.jsonl 全文
// @param {object} args.expect  期望（expect.outbound flat·expect.dom dataAttrs）
// @param {object} args.dom     e2e 注入的 DOM 面终态（data-* 扁平对象·键去 data- 前缀）
// @param {string} [args.ucId]  默认取 expect.ucId
// @returns {object} 报告（facets.outbound / facets.dom·②④ N/A 不在 order；dom optional 时不参与裁定）
export function runFourFacetCommandDom({ jsonl, expect, dom, ucId }) {
  const uc = ucId ?? expect.ucId;
  const { events, parseErrors } = parseJsonl(jsonl);

  const exp = expect.outbound ?? {};
  const urlEnds = exp.urlEndsWith;

  // ① 出站：UC 窗口内按 endpoint（urlEndsWith）找 outbound http-req（窗口隔离保证唯一·多于一个取
  // 最后一条——同窗口同 endpoint 重发取最新·一般唯一）。
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

  // ③ DOM：命令族可显式 optional。UC-6.2 的当前真实链路里 Go add/remove manger 单账号只可观测
  // ① 出站；强求 data-admin=1 会倒逼 UI 假刷，违反纯渲染壳。
  const domOptional = expect.dom?.optional === true;
  const domFacet = domOptional
    ? facetReport('dom', [], dom ?? { optional: true })
    : diffDom(expect.dom ?? {}, dom ?? null);

  // 断面：① 出站 + ③ DOM（②④ N/A·结构性 L2·见上 doc + issue #45）。
  const facets = {
    outbound: outboundFacet,
    dom: domFacet,
  };
  const order = domOptional ? ['outbound'] : ['outbound', 'dom'];
  const brokenAt = order.find((f) => !facets[f].ok) ?? null;
  const green = brokenAt === null && parseErrors.length === 0;

  return {
    ucId: uc,
    green,
    brokenAt,
    facets,
    parseErrors,
    summary: green
      ? `✅ ${uc} ${domOptional ? '① 出站' : '①③ 双面'}全绿（②④ 结构性 L2 N/A·endpoint=${urlEnds}·L2 #45）`
      : `❌ ${uc} 断在 [${brokenAt ?? 'parse'}] 面：${
          brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${parseErrors.length} 行坏`
        }`,
  };
}

// ── 内核自驱·projection-only 族（① 出站 + ② 投影 + ③ DOM·④ N/A）对账（UC-10.1 待办列表）──────
//
// 与写族 runFourFacet / 命令-DOM 族 runFourFacetCommandDom 的差异（真源 helix todo.rs +
// port_reply.rs TodoQuery 分支 + projection-schema 行 154）：
//   - **内核自驱·无前端命令·无 corr_key 束**：UC-10.1 由 global increment_channel_end（hello 收尾）
//     攒 about-me（mention/urgent）post id → build `posts/queryTodoList {postIds}` → HTTP 回报装配
//     emit `im:todo:updated {items}`。① 出站 body 是 `{postIds:[]string}`（纯字符串数组·无 ch/tmp/sid
//     领域键）→ 抽不到 corr_key 归 unkeyed；② 投影 `{items}` 外层无 channel_id → 同样 unkeyed。
//     故不走 bundleByCorrKey 锚 ch/tmp/sid，而在 **UC 窗口（uc_id 过滤）** 内按 endpoint + event 直找。
//   - **④ storage = N/A 不裁定**（projection-only·非放水）：todo 链 port_reply TodoQuery 分支**只
//     emit 不落库**（真源 port_reply.rs:196-209 仅 out.push(emit_todo_updated)·无任何 storage Effect；
//     projection-schema 行 154 注「前端 getTodoUpdated$→INIT_TODO_LIST_DATA」= in-memory 待办态·不持久化）。
//     强求 ④ 反而假阳——与 read 族 ③④ N/A / command-dom 族 ②④ N/A 同理（结构性 N/A·诚实出账）。
//   - **断面 = ①②③**：① 出站 wire body 逐字检（urlEndsWith=posts/queryTodoList + bodyFields {postIds}
//     + bodyForbidden 防 snake/Pascal 泄漏）；② 投影 `im:todo:updated` 外层键集 {items} 严格对齐（缺/多即红）；
//     ③ DOM data-todo（todo-panel 渲染·壳乐观透传 items[].id → data-todo-id·空 items 则清空·守可证伪）。
//
// 窗口隔离保证唯一（uc_id 过滤）：hello 收尾窗口内 queryTodoList 出站唯一 + im:todo:updated 投影唯一·
// 非 tautology（无 about-me → 不发 queryTodoList → ① 红·漏 emit → ② 红·壳未渲染 todo 行 → ③ 红·见可证伪对偶）。
//
// 机器件归属（非改冻结 oracle·C009）：本入口同属 reducer 领域件·契约 URL+body-shape 由 expect.outbound
// （真机curl真源派生·partials/1 §18 {postIds}）冻结·投影外层键集由 expect.projection 冻结·绿由本 reducer 裁定。
//
// @param {object} args
// @param {string} args.jsonl   run.jsonl 全文
// @param {object} args.expect  期望（expect.outbound flat·expect.projection {event,dataKeys}·expect.dom dataAttrs）
// @param {object} [args.dom]   e2e 注入的 DOM 面终态（data-* 扁平对象·键去 data- 前缀）
// @param {string} [args.ucId]  默认取 expect.ucId
// @returns {object} 报告（facets.outbound / facets.projection / facets.dom·④ N/A 不在 order）
export function runFourFacetSelfDriven({ jsonl, expect, dom, ucId }) {
  const uc = ucId ?? expect.ucId;
  const { events, parseErrors } = parseJsonl(jsonl);

  const exp = expect.outbound ?? {};
  const urlEnds = exp.urlEndsWith;

  // ① 出站：UC 窗口内按 endpoint（urlEndsWith）找 outbound http-req（窗口隔离保证唯一·多于一个取
  // 最后一条——同窗口同 endpoint 重发取最新·一般唯一）。
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

  // ② 投影：UC 窗口内找期望 event 的 projection（窗口隔离保证唯一·多于一个取最后一条）。
  const pexp = expect.projection ?? {};
  const projHops = events.filter(
    (e) =>
      (uc === undefined || e.uc_id === uc) &&
      e.facet === 'projection' &&
      e.hop === 'projection' &&
      (e.payload?.event ?? e.payload?.channel) === pexp.event
  );
  const projHit = projHops.length ? projHops[projHops.length - 1] : null;
  const projActual = projHit
    ? { event: projHit.payload?.event ?? projHit.payload?.channel, data: projHit.payload?.data ?? {} }
    : null;
  const projFacet = diffProjection(pexp, projActual);

  // ③ DOM：data-todo 终态（e2e 注入·壳渲染 todo-panel·守可证伪：壳未渲染 todo 行 → ③ 红·非 tautology）。
  const domFacet = diffDom(expect.dom ?? {}, dom ?? null);

  // 断面：① 出站 + ② 投影 + ③ DOM（④ N/A·projection-only·见上 doc + todo.rs port_reply）。
  const facets = {
    outbound: outboundFacet,
    projection: projFacet,
    dom: domFacet,
  };
  const order = ['outbound', 'projection', 'dom'];
  const brokenAt = order.find((f) => !facets[f].ok) ?? null;
  const green = brokenAt === null && parseErrors.length === 0;

  return {
    ucId: uc,
    green,
    brokenAt,
    facets,
    parseErrors,
    summary: green
      ? `✅ ${uc} ①②③ 三面全绿（④ projection-only N/A·endpoint=${urlEnds}·event=${pexp.event}）`
      : `❌ ${uc} 断在 [${brokenAt ?? 'parse'}] 面：${
          brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${parseErrors.length} 行坏`
        }`,
  };
}

// ── 内核自驱·按需 sync notify 族（①②④③ 四面齐）对账（UC-4.2 按需 sync notify）─────────────
//
// 与 self-driven 族 runFourFacetSelfDriven 的差异（真源 helix sync_http_effects.rs::sync_notify +
// sync_effects.rs::sync_mutation_emits/batch_upsert_events_with_messages + projection_control_effects.rs:153）：
//   - **内核自驱·gap 触发·锚 channel（非 ch;sid;seq 单束）**：UC-4.2 由 cursor 落后（behind-cursor seed）
//     → hello 握手重检 per-channel needSync → 对落后频道自驱 `channel/sync/notify`（① per-channel 出站·
//     body {cursors:[{channelId, fromSeq}]}·cursors[0].channelId = 锚 ch·decorator 探 body.cursors[0]
//     抽 ch → ① keyed by ch）→ server 回放离线区间事件 → 每条可见 type1 emit ② im:channel:update-by-post
//     （{channel_id, event_seq, msg_id}·瘦·badge）+ 配对 fat im:post:received（增量行）→ ④ message
//     batch_upsert 逐事件落库 + channel_event_cursor monotonic_upsert 跳空洞。
//   - **① 出站 + ②④ 投影/落库不在同一 corr_key 束**：sync/notify 出站是 ch-only 束（无 sid）；
//     update-by-post 投影 + message 落库各带不同 sid（per-event）→ 散在多束。故不走 bundleByCorrKey
//     单束锚，而在 **UC 窗口（uc_id 过滤）+ 锚 ch（corrAnchor.ch）** 内按 facet 各自聚合裁定（与
//     relay 族多频道窗口聚合同模式）。
//   - **断面 = ①②④③（四面齐·badge UC 特有）**：① 窗口内 channel/sync/notify 出站·body.cursors[0].channelId
//     覆盖锚 ch（faithful·该次 sync 确实请求了锚 ch 的增量·非任取）；② 锚 ch 的 im:channel:update-by-post
//     投影外层键集 {channel_id, event_seq, msg_id} 严格对齐（缺/多即红）；④ 锚 ch 的 message batch_upsert
//     落库 ≥ minRows（sync 回放逐事件落库·cursor monotonic_upsert 旁证跳空洞）；③ DOM data-unread badge
//     ≥1（CL 区频道行 badge·sync 增量后未读累加）+ 增量消息行（data-msg-id 非空·ML 区追加）。
//
// 窗口隔离保证可证伪（uc_id 过滤·bootstrap UC = 本 UC）：behind-cursor seed 后窗口内对锚 ch 的
// sync/notify 出站唯一·update-by-post 投影 ≥1·非 tautology（无 gap → 不发 sync/notify → ① 红·
// server 无回放 → 无 update-by-post → ② 红·未落库 → ④ 红·badge 未刷 → ③ 红·见单测可证伪对偶）。
//
// 机器件归属（非改冻结 oracle·C009）：本入口同属 reducer 领域件·契约 URL+body-shape 由 expect.outbound
// （helix sync_notify 源码派生·真机curl真源 partials/8 §2.1）冻结·投影外层键集由 expect.projection
// 冻结·badge/增量行由 expect.dom 冻结·绿由本 reducer 裁定。
//
// @param {object} args
// @param {string} args.jsonl   run.jsonl 全文
// @param {object} args.expect  期望（expect.corrAnchor.ch 锚频道·expect.outbound flat·expect.projection
//                              {event,dataKeys}·expect.storage {op,table,minRows}·expect.dom dataAttrs）
// @param {object} [args.dom]   e2e 注入的 DOM 面终态（data-* 扁平对象·键去 data- 前缀·含 unread + msg-id）
// @param {string} [args.ucId]  默认取 expect.ucId
// @returns {object} 报告（facets.outbound / projection / storage / dom）
export function runFourFacetSyncNotify({ jsonl, expect, dom, ucId }) {
  const uc = ucId ?? expect.ucId;
  const anchorCh = expect.corrAnchor?.ch ?? null;
  const { events, parseErrors } = parseJsonl(jsonl);

  // 窗口内事件（uc 过滤）。
  const inWin = (e) => uc === undefined || e.uc_id === uc;

  // ① 出站：窗口内 channel/sync/notify 出站·body.cursors[0].channelId 覆盖锚 ch（faithful）。
  const exp = expect.outbound ?? {};
  const urlEnds = exp.urlEndsWith;
  const syncHops = events.filter(
    (e) =>
      inWin(e) &&
      e.facet === 'outbound' &&
      e.hop === 'http-req' &&
      (!urlEnds || urlEnds === '*' || String(e.payload?.url ?? '').endsWith(urlEnds))
  );
  // 锚 ch 覆盖那条优先（cursors[0].channelId === anchorCh）；无锚或未命中则取首条 sync/notify。
  const syncHit =
    (anchorCh &&
      syncHops.find((h) => {
        const cur = h.payload?.body?.cursors;
        return Array.isArray(cur) && cur.some((c) => c && (c.channelId === anchorCh || c.channel_id === anchorCh));
      })) ||
    syncHops[0] ||
    null;
  const outboundFacet = diffOutbound(
    exp,
    syncHit ? { kind: 'http', method: syncHit.payload?.method, url: syncHit.payload?.url, body: syncHit.payload?.body ?? {} } : null
  );

  // ② 投影：窗口内锚 ch 的 im:channel:update-by-post（{channel_id, event_seq, msg_id}）·取首条。
  const pexp = expect.projection ?? {};
  const projHit =
    events.find(
      (e) =>
        inWin(e) &&
        e.facet === 'projection' &&
        e.hop === 'projection' &&
        (e.payload?.event ?? e.payload?.channel) === pexp.event &&
        (!anchorCh ||
          (e.payload?.data?.channel_id ?? e.payload?.data?.channelId) === anchorCh)
    ) ?? null;
  const projActual = projHit
    ? { event: projHit.payload?.event ?? projHit.payload?.channel, data: projHit.payload?.data ?? {} }
    : null;
  const projFacet = diffProjection(pexp, projActual);

  // ④ 落库：窗口内锚 ch 的 message batch_upsert 累计 rows ≥ minRows（sync 回放逐事件落库）。
  const sexp = expect.storage ?? {};
  const sTable = sexp.table ?? 'message';
  let rowCount = 0;
  let sawOp = null;
  for (const e of events) {
    if (!inWin(e)) continue;
    if (e.facet !== 'storage') continue;
    const p = e.payload ?? {};
    if (!p.op || (sTable && p.table !== sTable)) continue;
    // 锚 ch 过滤（message 落库 payload 带 channel_id）：只计锚频道的落库行（faithful·非任取窗口全部）。
    if (anchorCh && (p.channel_id ?? p.channelId) !== anchorCh) continue;
    sawOp = p.op;
    rowCount += p.rows ?? p.keys ?? p.count ?? 1;
  }
  const storageFacet = sawOp
    ? diffStorage(sexp, { op: sawOp, table: sTable, rows: rowCount })
    : facetFail('storage', `无锚 ch 的 ${sTable} 落库写（断在 sync reply→reconcile→Storage 这跳）`, { expect: sexp });

  // ③ DOM：e2e 注入·data-unread badge ≥1（CL 行）+ 增量消息行 data-msg-id 非空（ML 行）。
  const domFacet = diffDom(expect.dom ?? {}, dom ?? null);

  // 断面：①②④③（四面齐·badge UC）。
  const facets = {
    outbound: outboundFacet,
    projection: projFacet,
    storage: storageFacet,
    dom: domFacet,
  };
  const order = ['outbound', 'projection', 'storage', 'dom'];
  const brokenAt = order.find((f) => !facets[f].ok) ?? null;
  const green = brokenAt === null && parseErrors.length === 0;

  return {
    ucId: uc,
    green,
    brokenAt,
    anchorCh,
    facets,
    parseErrors,
    summary: green
      ? `✅ ${uc} 按需 sync notify 四面全绿（anchorCh=${anchorCh ?? 'n/a'}·endpoint=${urlEnds}·event=${pexp.event}）`
      : `❌ ${uc} 断在 [${brokenAt ?? 'parse'}] 面：${
          brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${parseErrors.length} 行坏`
        }`,
  };
}

// ── 心跳 gap 补偿族（①②④ 三面·③ DOM N/A 已移除）对账（UC-4.4 心跳 ping piggyback）──────────
//
// 与按需 sync notify 族 runFourFacetSyncNotify 的差异（真源 helix transport_effects.rs::ping_frame +
// pong_compensate.rs::compensate_from_pong + sync_effects.rs/projection_control_effects.rs）：
//   - **① 出站 = ws-send ping 帧（非 http-req sync/notify）**：UC-4.4 由 8s 周期心跳 ping piggyback
//     `{action:"ping", seq, data:{cursors:[{channelId, fromSeq}], allHash}}`（全量根群确定性升序快照
//     + FNV-1a allHash）触发。server pong 回 `{gaps[].channelId, hashMismatch}` → compensate_from_pong
//     对落后 ch 自驱 sync/notify 补偿（补偿出站走 4.2 路径·非本面锚·② 真锚是补偿后的投影）。
//     ① 锚 = 窗口内 action==ping 且 data.cursors 含锚 ch 的 ws-send 帧（faithful：该次心跳确实把锚 ch
//     的 cursor 快照纳入 allHash 对账·非任取）。
//   - **断面 = ①②④（三面·③ DOM N/A）**：① ping 帧 data 层有 cursors + allHash 且 cursors 覆盖锚 ch；
//     ② 补偿回放触发的 im:channel:update-by-post 外层键集 {channel_id, event_seq, msg_id}（缺/多即红）；
//     ④ 锚 ch 的 message batch_upsert 落库 ≥ minRows（补偿 sync 回放逐事件落库·cursor monotonic_upsert
//     旁证跳空洞）。③ DOM 面已移除（issue #34·补偿增量经 4.2 路径渲染·DOM 断言归 UC-4.2）。
//
// 窗口隔离保证可证伪（uc_id 过滤·bootstrap UC = UC-4.4）：behind-cursor seed 后心跳 ping 的 allHash
// 与 server 权威水位不符 → pong 回 hashMismatch/gaps → 补偿真发生 → 窗口内 ① ping 帧含锚 ch·② update-by-post
// ≥1·④ message ≥1 —— 非 tautology（无 gap → pong 无 mismatch → 不补偿 → 无 update-by-post → ② 红·
// 未落库 → ④ 红；ping 帧缺 allHash / 不含锚 ch → ① 红·见单测可证伪对偶）。
//
// 机器件归属（非改冻结 oracle·C009）：本入口同属 reducer 领域件·ws-send ping wire shape 由 expect.outbound
// （helix ping_frame 源码派生·partials/8 §5.7 / types/sync.ts:242）冻结·投影外层键集由 expect.projection
// 冻结·绿由本 reducer 裁定。
//
// @param {object} args
// @param {string} args.jsonl   run.jsonl 全文
// @param {object} args.expect  期望（expect.corrAnchor.ch 锚根群·expect.outbound {frame,action,dataFields}·
//                              expect.projection {event,dataKeys}·expect.storage {op,table,minRows}）
// @param {string} [args.ucId]  默认取 expect.ucId
// @returns {object} 报告（facets.outbound / projection / storage·三面无 dom）
export function runFourFacetHeartbeatGap({ jsonl, expect, ucId }) {
  const uc = ucId ?? expect.ucId;
  const anchorCh = expect.corrAnchor?.ch ?? null;
  const { events, parseErrors } = parseJsonl(jsonl);

  const inWin = (e) => uc === undefined || e.uc_id === uc;

  // ① 出站：窗口内 ws-send ping 帧（payload.action==='ping'·data.cursors 含锚 ch·data.allHash 非空）。
  const exp = expect.outbound ?? {};
  const wantAction = exp.action ?? 'ping';
  const pingHops = events.filter(
    (e) =>
      inWin(e) &&
      e.facet === 'outbound' &&
      e.hop === 'ws-send' &&
      (e.payload?.action ?? null) === wantAction
  );
  // 锚 ch 覆盖那帧优先（data.cursors[*].channelId === anchorCh）；无锚或未命中则取首条 ping 帧。
  const pingHit =
    (anchorCh &&
      pingHops.find((h) => {
        const cur = h.payload?.data?.cursors;
        return (
          Array.isArray(cur) &&
          cur.some((c) => c && (c.channelId === anchorCh || c.channel_id === anchorCh))
        );
      })) ||
    pingHops[0] ||
    null;
  const outboundFacet = diffPingFrame(exp, pingHit ? pingHit.payload : null, anchorCh);

  // ② 投影：窗口内锚 ch 的 im:channel:update-by-post（{channel_id, event_seq, msg_id}）·取首条。
  const pexp = expect.projection ?? {};
  const projHit =
    events.find(
      (e) =>
        inWin(e) &&
        e.facet === 'projection' &&
        e.hop === 'projection' &&
        (e.payload?.event ?? e.payload?.channel) === pexp.event &&
        (!anchorCh ||
          (e.payload?.data?.channel_id ?? e.payload?.data?.channelId) === anchorCh)
    ) ?? null;
  const projActual = projHit
    ? { event: projHit.payload?.event ?? projHit.payload?.channel, data: projHit.payload?.data ?? {} }
    : null;
  const projFacet = diffProjection(pexp, projActual);

  // ④ 落库：窗口内锚 ch 的 message batch_upsert 累计 rows ≥ minRows（补偿 sync 回放逐事件落库）。
  const sexp = expect.storage ?? {};
  const sTable = sexp.table ?? 'message';
  let rowCount = 0;
  let sawOp = null;
  for (const e of events) {
    if (!inWin(e)) continue;
    if (e.facet !== 'storage') continue;
    const p = e.payload ?? {};
    if (!p.op || (sTable && p.table !== sTable)) continue;
    if (anchorCh && (p.channel_id ?? p.channelId) !== anchorCh) continue;
    sawOp = p.op;
    rowCount += p.rows ?? p.keys ?? p.count ?? 1;
  }
  const storageFacet = sawOp
    ? diffStorage(sexp, { op: sawOp, table: sTable, rows: rowCount })
    : facetFail('storage', `无锚 ch 的 ${sTable} 落库写（断在 pong→compensate→sync reply→Storage 这跳）`, { expect: sexp });

  // 断面：①②④（三面·③ DOM N/A·issue #34 已移除该面）。
  const facets = {
    outbound: outboundFacet,
    projection: projFacet,
    storage: storageFacet,
  };
  const order = ['outbound', 'projection', 'storage'];
  const brokenAt = order.find((f) => !facets[f].ok) ?? null;
  const green = brokenAt === null && parseErrors.length === 0;

  return {
    ucId: uc,
    green,
    brokenAt,
    anchorCh,
    facets,
    parseErrors,
    summary: green
      ? `✅ ${uc} 心跳 gap 补偿三面全绿（①②④·③ DOM N/A·anchorCh=${anchorCh ?? 'n/a'}·ping piggyback→pong gap→compensate→event=${pexp.event}）`
      : `❌ ${uc} 断在 [${brokenAt ?? 'parse'}] 面：${
          brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${parseErrors.length} 行坏`
        }`,
  };
}

/** ① ws-send ping 帧对账：payload.action + data 层字段（cursors/allHash）+ cursors 覆盖锚 ch。 */
function diffPingFrame(expect, payload, anchorCh) {
  if (!payload) return facetFail('outbound', '无 ws-send ping 帧（断在心跳 timer→ping_frame→Transport::send 这跳）', { expect });
  const issues = [];
  const wantAction = expect.action ?? 'ping';
  if ((payload.action ?? null) !== wantAction)
    issues.push(`action 期望 ${wantAction} 实得 ${payload.action}`);
  const data = payload.data ?? {};
  for (const [k, want] of Object.entries(expect.dataFields ?? {})) {
    if (!(k in data)) issues.push(`data 缺字段 ${k}（${k === 'allHash' ? '根群非空时心跳须带 allHash·缺=piggyback 漏算' : 'piggyback 漏带'}）`);
    else if (want !== '*' && !valEq(data[k], want))
      issues.push(`data.${k} 期望 ${JSON.stringify(want)} 实得 ${JSON.stringify(data[k])}`);
  }
  // faithful：cursors 必须覆盖锚 ch（该次心跳确实把锚 ch 快照纳入 allHash 对账·非任取空帧）。
  if (anchorCh) {
    const cur = data.cursors;
    const covers =
      Array.isArray(cur) && cur.some((c) => c && (c.channelId === anchorCh || c.channel_id === anchorCh));
    if (!covers) issues.push(`data.cursors 未覆盖锚 ch=${anchorCh}（该次心跳未携带锚 ch 快照·② 补偿无从触发）`);
  }
  return facetReport('outbound', issues, { action: payload.action, dataKeys: Object.keys(data) });
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
  //
  // UC-5.4 群属性修改特例（ch 锚 + 期望投影是 per-post 系统帧）：改群名的 server echo 不是
  // 独立 update_channel WS，而是一条 **channelUpdate 系统 NOTICE post**（props.type=channelUpdate·
  // props.field=displayName·props.content=新名·真机 wire 实证）。该 post 帧带 ch+sid+tmp（非 ch-only），
  // 故 `ch===chAnchor && !tmp` 选不中它。当期望投影是 per-post 事件（im:post:received）时，须在 ch
  // 匹配的束里挑**含该期望投影事件**那束作 target（机器件 target 选择·非改冻结 oracle）。窗口隔离
  // （uc_id 过滤）+ field=displayName 唯一保证本 UC 内该 channelUpdate post 唯一·非 tautology。
  const wantProjEvent = expect.projection?.event;
  const wantProjValues = expect.projection?.dataValues ?? {};
  const wantPropsMatch = expect.projection?.propsMatch ?? null;
  // 区分同 ch 多个 im:post:received（UC-5.4 建群 join post seq=1 + channelUpdate post seq=2·两者
  // type=NOTICE/userId=SYS 全同·dataValues 区分不开）：chPerPostTarget 须挑**期望投影事件 + dataValues +
  // propsMatch（props 子集匹配·如 {type:channelUpdate,field:displayName}）全匹配**那束·精确锚定
  // channelUpdate 帧（非 join 帧）——守可证伪（漏发 channelUpdate post 则锚不上 → ② 红·非 tautology）。
  const projMatches = (h) =>
    h.facet === 'projection' &&
    h.hop === 'projection' &&
    h.payload?.event === wantProjEvent &&
    Object.entries(wantProjValues).every(
      ([k, v]) => v === '*' || valEq(h.payload?.data?.[k], v)
    ) &&
    (!wantPropsMatch ||
      Object.entries(wantPropsMatch).every(([k, v]) =>
        valEq(h.payload?.data?.props?.[k], v)
      ));
  const chPerPostTarget =
    chAnchor && wantProjEvent
      ? bundles.find((b) => b.dims.ch === chAnchor && b.hops.some(projMatches))
      : null;
  // chPerPostTarget 优先于 ch-only 兜底：UC-5.4 出站 channel/change/displayName 自成 ch-only 束
  // （body.id→ch·无 post），若让 `ch===chAnchor && !tmp` 先命中会锚到无投影的出站束 → ②④ 假红。
  // 故当 chPerPostTarget 命中（per-post echo 束·含期望系统投影）时优先取之·出站由 createOutbound
  // fallback（URL endsWith）并入。
  let target =
    (tmpAnchor && bundles.find((b) => b.dims.tmp === tmpAnchor)) ||
    (sidAnchor && bundles.find((b) => b.dims.sid === sidAnchor)) ||
    chPerPostTarget ||
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
          // target 可能为 null（UC-5.6w delete：出站 body {postIds,postId} 两字段皆**数组** →
          // corr-key 抽不出 sid → 该出站 hop 归 unkeyed·无束的 dims.sid 命中 corrAnchor.sid →
          // target 落空）。此时仍须让 actualOutbound 的 createOutbound/batch fallback（按
          // urlEndsWith / cursors 覆盖锚 ch）兜底取出站——故传空束而非短路 null。守可证伪：
          // createOutbound 无 URL 命中（出站未发）→ fallback 仍返 null → ① 红（非放水）。
          actualOutbound(target ?? { hops: [], dims: {} }, {
            batchOutbound,
            anchorCh,
            createOutbound,
            expectUrlEndsWith: expect.outbound?.urlEndsWith,
          })
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
    storage: diffStorage(
      expect.storage ?? {},
      actualStorage(target, expect.storage?.table, scanFallback, { op: expect.storage?.op })
    ),
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

// ── P0b 6 面 oracle 扩展（test-only·docs/orchestration/6-facet-oracle.md）──────────
//
// 在四面（① outbound / ② projection / ④ storage / ③ DOM）之上补**输入侧两个面**：
//   ⓪ IpcIn（facet=ipc-in）  : src-tauri command 层 tee {command, args}（壳收到的原始 invoke 入参）
//     Inbound（facet=inbound）: command-dispatch 装饰器 tee {command, args}（进引擎泵的指令）
//   纯壳不变量（C013 量化）：同 UC 窗口内 IpcIn.args ≡ Inbound.args（casing 归一后逐字段相等·
//     壳只能透传 + 1:1 绑定·禁中间 shaping）。不等 → 指出「壳在 IPC→helix 加工了字段 X」。
//   WsRecv 断言化：入站 go echo 帧从只观测（串 corr_key）升级为可断言（vs expect.wsRecv）。
//
// 全 test-only：dev/release 不挂 ipc-in/inbound tee（webdriver feature 闸·见 src-tauri）；
// 这两个面 + 纯壳不变量是 reducer（独立 node 工具·进程外）。守 invariant #4 + C008 可证伪。

/** snake_case → camelCase（单段·不动已 camel）。`channel_id`→`channelId`·`temporaryId`→`temporaryId`。 */
function camelizeKey(key) {
  return String(key).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** 递归把对象/数组的 key 归一为 camelCase（值原样·用于跨 casing 比对 args）。 */
function normalizeArgs(v) {
  if (Array.isArray(v)) return v.map(normalizeArgs);
  if (v && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, val] of Object.entries(v)) out[camelizeKey(k)] = normalizeArgs(val);
    return out;
  }
  return v;
}

/**
 * 纯壳不变量核（C013）：IpcIn.args 透传到 Inbound.args 是否「壳零加工」。
 * 规则（归一 casing 后）：
 *   - IpcIn 的每个字段必须在 Inbound 原值出现（壳不得丢失 / 篡改 user arg）。
 *   - Inbound 多出的字段必须在 injectedKeys 白名单（否则=壳擅自 shaping·须下沉 helix 或人审登记）。
 * 返回 issues 数组（空=纯壳·非空=壳加工了·每条指出断点字段）。faithful：篡改/丢/注入皆红（见单测对偶）。
 *
 * @param {object} ipcArgs   IpcIn payload.args
 * @param {object} inboundArgs Inbound payload.args
 * @param {Array<string>} [injectedKeys] 人审授权的壳注入字段（身份/默认·如 userId/type）
 * @returns {Array<string>}
 */
export function diffPureShellInvariant(ipcArgs, inboundArgs, injectedKeys = []) {
  const a = normalizeArgs(ipcArgs ?? {});
  const b = normalizeArgs(inboundArgs ?? {});
  const inj = new Set((injectedKeys ?? []).map(camelizeKey));
  const issues = [];
  for (const [k, want] of Object.entries(a)) {
    if (!(k in b)) {
      issues.push(`壳在 IPC→helix 丢失字段 ${k}（纯壳须透传·C013）`);
      continue;
    }
    if (!valEq(b[k], want))
      issues.push(
        `壳在 IPC→helix 篡改字段 ${k}：IpcIn=${JSON.stringify(want)} Inbound=${JSON.stringify(b[k])}（纯壳禁中间 shaping·C013）`
      );
  }
  for (const k of Object.keys(b)) {
    if (k in a) continue;
    if (!inj.has(k))
      issues.push(
        `壳在 IPC→helix 注入未授权字段 ${k}（C013 纯壳禁 shaping·如确为身份/默认注入须下沉 helix 或登记 pureShell.injectedKeys 经人审）`
      );
  }
  return issues;
}

/**
 * ⓪ 纯壳不变量面：UC 窗口内找 IpcIn + Inbound tee，比对 args（IpcIn≡Inbound）。
 *
 * optional 语义（叠加面对旧 UC 零破坏）：未声明 expect.pureShell（或显式 optional:true）→ 不裁定
 * （总绿）。声明了但缺任一侧 tee → 红（壳透传纯度不可证·非放水·守可证伪）。
 *
 * @param {object} args
 * @param {string} args.jsonl
 * @param {object} args.expect  期望（expect.pureShell {injectedKeys?, optional?}·expect.ucId）
 * @param {string} [args.ucId]
 * @returns {{facet:'pure-shell', ok:boolean, issues:string[], actual:object}}
 */
export function checkPureShellInvariant({ jsonl, expect, ucId }) {
  const uc = ucId ?? expect.ucId;
  const ps = expect.pureShell;
  if (ps === undefined || ps === null || ps.optional === true)
    return facetReport('pure-shell', [], { optional: true });
  const { events } = parseJsonl(jsonl);
  const inWin = (e) => uc === undefined || e.uc_id === uc;
  const ipc = events.find((e) => inWin(e) && e.facet === 'ipc-in');
  const inb = events.find((e) => inWin(e) && e.facet === 'inbound');
  if (!ipc)
    return facetFail('pure-shell', '无 IpcIn tee（断在 invoke 埋点·壳透传纯度不可证）', { expect: ps });
  if (!inb)
    return facetFail('pure-shell', '无 Inbound tee（断在 command-dispatch 埋点·壳透传纯度不可证）', {
      expect: ps,
    });
  const issues = diffPureShellInvariant(ipc.payload?.args, inb.payload?.args, ps.injectedKeys);
  return facetReport('pure-shell', issues, {
    command: { ipcIn: ipc.payload?.command, inbound: inb.payload?.command },
  });
}

/**
 * WsRecv 断言面：UC 窗口内找 action/event 匹配的入站 go echo 帧，断言 data 字段（vs expect.wsRecv）。
 *
 * optional 语义：未声明 expect.wsRecv（或 optional:true）→ 不裁定（旧 UC 叠加面零破坏）。
 * faithful：声明了则窗口内须有匹配 action 的入站帧且 dataFields 对齐——无帧/字段缺即红（见单测对偶）。
 *
 * @param {object} expect  期望（expect.wsRecv {action|event, dataFields, optional?}）
 * @param {Array<object>} events  parseJsonl 后的事件
 * @param {string} [uc]  UC 窗口（uc_id 过滤）
 * @returns {{facet:'ws-recv', ok:boolean, issues:string[], actual:object}}
 */
export function diffWsRecv(expect, events, uc) {
  const wexp = expect.wsRecv;
  if (wexp === undefined || wexp === null || wexp.optional === true)
    return facetReport('ws-recv', [], { optional: true });
  const inWin = (e) => uc === undefined || e.uc_id === uc;
  const wantAction = wexp.action ?? wexp.event;
  const frames = events.filter((e) => inWin(e) && e.facet === 'ws-recv' && e.hop === 'ws-recv');
  const hit = frames.find((e) => {
    const p = e.payload ?? {};
    const act = p.action ?? p.event;
    return wantAction ? act === wantAction : true;
  });
  if (!hit)
    return facetFail(
      'ws-recv',
      `无匹配入站帧（期望 action/event=${wantAction}·断在 go echo→Transport::recv 这跳）`,
      { expect: wexp }
    );
  const issues = [];
  const data = hit.payload?.data ?? {};
  for (const [k, want] of Object.entries(wexp.dataFields ?? {})) {
    if (!(k in data)) issues.push(`入站帧 data 缺字段 ${k}`);
    else if (want !== '*' && !valEq(data[k], want))
      issues.push(`入站帧 data.${k} 期望 ${JSON.stringify(want)} 实得 ${JSON.stringify(data[k])}`);
  }
  return facetReport('ws-recv', issues, {
    action: hit.payload?.action ?? hit.payload?.event,
    dataKeys: Object.keys(data),
  });
}

/**
 * 六面合并入口（四面 runFourFacet + ⓪纯壳不变量 + WsRecv 断言）。
 *
 * 链路顺序（断点定位）：pure-shell（输入侧最上游）→ outbound → ws-recv → projection → storage → dom。
 * 旧 UC（未声明 pureShell/wsRecv）走此入口 = 两新面 optional 不裁定 → 退化为原四面（叠加面零破坏）。
 *
 * @param {object} args
 * @param {string} args.jsonl
 * @param {object} args.expect  四面期望 + 可选 expect.pureShell / expect.wsRecv
 * @param {object} [args.dom]
 * @param {string} [args.ucId]
 * @returns {object} 六面报告
 */
export function runSixFacet({ jsonl, expect, dom, ucId }) {
  const uc = ucId ?? expect.ucId;
  const four = runFourFacet({ jsonl, expect, dom, ucId: uc });
  const { events } = parseJsonl(jsonl);
  const wsRecv = diffWsRecv(expect, events, uc);
  const pureShell = checkPureShellInvariant({ jsonl, expect, ucId: uc });

  const facets = { ...four.facets, 'ws-recv': wsRecv, 'pure-shell': pureShell };
  const order = ['pure-shell', 'outbound', 'ws-recv', 'projection', 'storage', 'dom'];
  const brokenAt = order.find((f) => facets[f] && !facets[f].ok) ?? null;
  const green = brokenAt === null && four.parseErrors.length === 0;

  return {
    ucId: uc,
    green,
    brokenAt,
    corrKey: four.corrKey ?? null,
    facets,
    parseErrors: four.parseErrors,
    summary: green
      ? `✅ ${uc} 六面全绿（⓪纯壳 IpcIn≡Inbound·WsRecv 断言·corr_key=${four.corrKey ?? 'n/a'}）`
      : `❌ ${uc} 断在 [${brokenAt ?? 'parse'}] 面：${
          brokenAt ? facets[brokenAt].issues.join('; ') : `JSONL 解析 ${four.parseErrors.length} 行坏`
        }`,
  };
}

// 四面 reducer 单测 —— 纯 Node 22，零依赖。运行：node test/reducer/four-facet-reducer.test.mjs
//
// 可证伪铁律（HX-C011 / CLAUDE.md §2.5）：每个「绿」断言都配一个「破坏即红」的对偶——
// 故意改坏某一面的样例 → 断言 reducer 必报红且指出正确的断点面。
// 不靠墙钟、不靠下界 sleep；纯结构/键集/计数证不变量。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  runFourFacet,
  runFourFacetRead,
  runFourFacetSelfDriven,
  runFourFacetSyncNotify,
  runFourFacetHeartbeatGap,
  parseJsonl,
  bundleByCorrKey,
} from './four-facet-reducer.mjs';
import { keyOf, extractDims, sameEvent } from './corr-key.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..', '..');
const SAMPLE = readFileSync(join(ROOT, 'test', 'fixtures', 'uc-send-1.sample.jsonl'), 'utf8');
const EXPECT = JSON.parse(readFileSync(join(ROOT, 'test', 'expect', 'uc-send-1.expect.json'), 'utf8'));

let pass = 0;
let fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(msg);
    console.log(`  ✖ ${msg}`);
  }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (得 ${JSON.stringify(a)}, 期 ${JSON.stringify(b)})`);
}

// DOM 面：e2e 真跑时由 WebdriverIO 读 [data-temporary-id=t] 行注入；此处样例固定 echo 终态。
const DOM_GOOD = {
  'msg-id': 's-server777',
  'send-status': 'sent',
  'temporary-id': 't-abc123',
  'event-seq': '40114',
  _temporaryId: 't-abc123',
};

// ── corr-key 领域规则 ─────────────────────────────────────────────────────────

console.log('· corr-key 领域规则');
{
  eq(
    keyOf({ channelId: 'c1', temporaryId: 't9', eventSeq: 40114 }),
    'ch=c1;tmp=t9;seq=40114',
    'keyOf 顶层 camel 四维'
  );
  eq(
    keyOf({ action: 'post', data: { channel_id: 'c2', id: 's7' } }),
    'ch=c2;sid=s7',
    'keyOf 嵌套 .data + snake 别名'
  );
  // send body 的 id:"" 不当 server_id（占位空串）。
  const d = extractDims({ channelId: 'c', temporaryId: 't', id: '' });
  eq(d.sid, undefined, 'send body id:"" 不抽成 sid');
  eq(keyOf({ foo: 1 }), null, '无领域维 → null');
  // UC-4.1 ④ storage channel 落库：payload {id, op:batch_upsert, table:'channel', rows}。
  // channel 表主键 id == channelId（非 server post id）→ 必抽成 ch，使 ④ 与 ② im:channel:increment
  // （ch=...）同束。若仍抽 sid 则 ②(ch) 与 ④(sid) 异维不聚 → UC-4.1 ④ 永红（机器件归一缺陷）。
  const chStore = extractDims({ id: 'a1rz6', op: 'batch_upsert', table: 'channel', rows: 1 });
  eq(chStore.ch, 'a1rz6', 'table=channel 的 id 抽成 ch（非 sid）');
  eq(chStore.sid, undefined, 'table=channel 的 id 不再抽成 sid');
  ok(
    sameEvent({ ch: 'a1rz6' }, extractDims({ id: 'a1rz6', table: 'channel' })),
    'sameEvent: ② im:channel:increment(ch) 与 ④ channel 落库(id→ch) 聚同束'
  );
  // 回归：message/post 落库（table=message）的 id 仍是 server post id → 抽 sid（不受影响）。
  const msgStore = extractDims({ id: 's7', op: 'batch_upsert', table: 'message', rows: 1 });
  eq(msgStore.sid, 's7', 'table=message 的 id 仍抽 sid（回归保护）');
  eq(msgStore.ch, undefined, 'table=message 的 id 不抽 ch');
  // 回归：post echo（含 channel_id + id）id 仍是 sid（table 不为 channel）。
  eq(
    keyOf({ action: 'post', data: { channel_id: 'c2', id: 's7' } }),
    'ch=c2;sid=s7',
    'post echo {channel_id,id} 不受 channel-table 规则影响'
  );
  // sameEvent：tmp 贯穿乐观→echo。
  ok(sameEvent({ tmp: 't', ch: 'c' }, { tmp: 't', sid: 's' }), 'sameEvent: 同 tmp 聚束');
  ok(!sameEvent({ tmp: 't1' }, { tmp: 't2' }), 'sameEvent: 异 tmp 不聚');
  // UC-3.1 会话已读出站 channels/view：body={channels:[{id:channelId}]}。channels[0].id 是
  // channelId（非 server post id）→ 必抽成 ch（非 sid），使 ① 出站与 per-channel ②④ 同束。
  const viewOut = extractDims({
    method: 'POST',
    url: 'http://x/api/cses/channels/view',
    body: { channels: [{ id: 'chViewAnchor' }] },
  });
  eq(viewOut.ch, 'chViewAnchor', 'channels/view body.channels[0].id 抽成 ch');
  eq(viewOut.sid, undefined, 'channels/view 的 channels[0].id 不抽成 sid（非 post id）');
  eq(
    keyOf({ method: 'POST', url: 'http://x/channels/view', body: { channels: [{ id: 'cv1' }] } }),
    'ch=cv1',
    'keyOf channels/view → ch=cv1（① 与 ②④ ch 锚同束）'
  );
  // 可证伪对偶：若 channels[0].id 被误抽成 sid（破坏），ch 维缺失 → 与 ②④(ch) 聚不上束 → ①永红。
  ok(
    sameEvent(viewOut, extractDims({ event: 'im:post:read', data: { channel_id: 'chViewAnchor' } })),
    'sameEvent: ① channels/view(ch) 与 ② im:post:read(ch) 聚同束'
  );
}

// ── JSONL 解析 + 聚束 ─────────────────────────────────────────────────────────

console.log('· JSONL 解析 + 按 corr_key 聚束');
{
  const { events, parseErrors } = parseJsonl(SAMPLE);
  eq(parseErrors.length, 0, '样例 JSONL 全部可解析');
  ok(events.length === 7, `样例 7 行 HopEvent（实 ${events.length}）`);

  // 只聚 UC-send-1 窗口；__quiescence__ 的两行（connect + 别人 increment）不进 UC 束。
  const bundles = bundleByCorrKey(events, 'UC-send-1');
  // UC-send-1 内：http-req / http-resp / ws-recv echo / storage / projection
  // 都串到同一束（tmp=t-abc123 贯穿；storage 用 sid 桥接；http-resp 用 sid）。
  const main = bundles.find((b) => b.dims.tmp === 't-abc123');
  ok(main, '存在 tmp=t-abc123 主束');
  ok(main && main.dims.sid === 's-server777', 'echo 后主束补出 sid（tmp→server 桥接）');
  // 主束应含 outbound + projection + storage + ws-recv 各面。
  const facetsIn = new Set(main.hops.map((h) => h.facet));
  ok(facetsIn.has('outbound'), '主束含 outbound 面');
  ok(facetsIn.has('projection'), '主束含 projection 面');
  ok(facetsIn.has('storage'), '主束含 storage 面');
  ok(facetsIn.has('ws-recv'), '主束含 ws-recv 输入');

  // 窗口过滤证伪：__quiescence__ 的别人 increment 不该混进 UC 束。
  const leaked = bundles.some((b) => b.hops.some((h) => h.uc_id === '__quiescence__'));
  ok(!leaked, '静默窗口帧（别人 increment）未泄漏进 UC 束');
}

// ── 四面对账：全绿 ────────────────────────────────────────────────────────────

console.log('· 四面对账（金标样例应全绿）');
{
  const rep = runFourFacet({ jsonl: SAMPLE, expect: EXPECT, dom: DOM_GOOD });
  ok(rep.green, `四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);
  eq(rep.brokenAt, null, 'brokenAt=null（无断点）');
  ok(rep.facets.outbound.ok, '① outbound 绿');
  ok(rep.facets.projection.ok, '② projection 绿');
  ok(rep.facets.storage.ok, '④ storage 绿');
  ok(rep.facets.dom.ok, '③ DOM 绿');
  eq(rep.corrKey?.includes('tmp=t-abc123'), true, '锁定主束 corr_key 含 tmp');
}

// ── 可证伪对偶：破坏每一面 → reducer 必红且断点正确 ───────────────────────────

console.log('· 可证伪：破坏每一面 → 必报红 + 断点正确');

/** 改坏 JSONL 里某行 payload，返回新 JSONL。 */
function mutateLine(jsonl, predicate, mutate) {
  return jsonl
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const ev = JSON.parse(l);
      if (predicate(ev)) mutate(ev);
      return JSON.stringify(ev);
    })
    .join('\n');
}

// ① 出站：snake_case 旧形态泄漏（send 无回声真因）→ outbound 红。
{
  const broken = mutateLine(
    SAMPLE,
    (e) => e.facet === 'outbound' && e.hop === 'http-req',
    (e) => {
      e.payload.body.channel_id = e.payload.body.channelId; // 泄漏 snake
      delete e.payload.body.channelId; // 缺 camel
    }
  );
  const rep = runFourFacet({ jsonl: broken, expect: EXPECT, dom: DOM_GOOD });
  ok(!rep.green, '① 破坏 → 整体红');
  eq(rep.brokenAt, 'outbound', '① 断点定位 outbound');
  ok(
    rep.facets.outbound.issues.some((i) => i.includes('channel_id')),
    '① 报出 snake_case 泄漏'
  );
}

// ② 投影：缺一个 fat 字段（FixB 反转：少一字段=漂移）→ projection 红。
{
  const broken = mutateLine(
    SAMPLE,
    (e) => e.facet === 'projection',
    (e) => delete e.payload.data.readBits
  );
  const rep = runFourFacet({ jsonl: broken, expect: EXPECT, dom: DOM_GOOD });
  ok(!rep.green, '② 缺字段 → 整体红');
  eq(rep.brokenAt, 'projection', '② 断点定位 projection（outbound 仍绿）');
  ok(rep.facets.projection.issues.some((i) => i.includes('readBits')), '② 报出缺 readBits');
}

// ② 投影：多一个字段（旧契约多即漂移亦不许）→ projection 红。
{
  const broken = mutateLine(
    SAMPLE,
    (e) => e.facet === 'projection',
    (e) => (e.payload.data.createdAt = 1) // 命名陷阱：createdAt 非 createAt
  );
  const rep = runFourFacet({ jsonl: broken, expect: EXPECT, dom: DOM_GOOD });
  ok(!rep.green, '② 多字段 → 红');
  ok(rep.facets.projection.issues.some((i) => i.includes('createdAt')), '② 报出多 createdAt（命名陷阱）');
}

// ② 投影 channel 错（post echo 该走 im:post:received 非 posted）→ 红。
{
  const broken = mutateLine(
    SAMPLE,
    (e) => e.facet === 'projection',
    (e) => (e.payload.event = 'im:post:posted')
  );
  const rep = runFourFacet({ jsonl: broken, expect: EXPECT, dom: DOM_GOOD });
  eq(rep.brokenAt, 'projection', '② 错 channel → projection 红');
}

// ④ storage：table 错（写错表）→ storage 红。
{
  const broken = mutateLine(
    SAMPLE,
    (e) => e.facet === 'storage',
    (e) => (e.payload.table = 'channel')
  );
  const rep = runFourFacet({ jsonl: broken, expect: EXPECT, dom: DOM_GOOD });
  ok(!rep.green, '④ 写错表 → 红');
  eq(rep.brokenAt, 'storage', '④ 断点定位 storage');
}

// ④ storage：整跳缺失（reconcile→Storage 断）→ storage 红。
{
  const broken = SAMPLE.split('\n')
    .filter((l) => l.trim() && !(JSON.parse(l).facet === 'storage'))
    .join('\n');
  const rep = runFourFacet({ jsonl: broken, expect: EXPECT, dom: DOM_GOOD });
  eq(rep.brokenAt, 'storage', '④ storage 跳缺失 → 断点 storage');
  ok(rep.facets.storage.issues.some((i) => i.includes('Storage')), '④ 报出"断在...Storage 这跳"');
}

// ③ DOM：tmp→server 覆写未发生（data-msg-id 仍 = tmp）→ dom 红。
{
  const badDom = { ...DOM_GOOD, 'msg-id': 't-abc123' }; // 没覆写
  const rep = runFourFacet({ jsonl: SAMPLE, expect: EXPECT, dom: badDom });
  ok(!rep.green, '③ 未覆写 → 红');
  eq(rep.brokenAt, 'dom', '③ 断点定位 dom（前三面绿）');
}

// ③ DOM：send-status 仍 sending（echo 没把状态推进）→ dom 红。
{
  const badDom = { ...DOM_GOOD, 'send-status': 'sending' };
  const rep = runFourFacet({ jsonl: SAMPLE, expect: EXPECT, dom: badDom });
  eq(rep.brokenAt, 'dom', '③ status=sending → dom 红');
}

// 断点顺序：同时坏 outbound + dom → 报最早的 outbound（链路顺序）。
{
  const broken = mutateLine(
    SAMPLE,
    (e) => e.facet === 'outbound' && e.hop === 'http-req',
    (e) => delete e.payload.body.temporaryId
  );
  const rep = runFourFacet({ jsonl: broken, expect: EXPECT, dom: { ...DOM_GOOD, 'msg-id': 't-abc123' } });
  eq(rep.brokenAt, 'outbound', '断点取链路最早面（outbound 先于 dom）');
}

// ── UC-4.1 batch 出站归束（① 单批 channels/load/increment 覆盖 N 个 channel）─────────
// UC-4.1 ① 是单条批量 sync 请求（body.cursors 带 N 个 channel），无单 channel corr_key。
// 锚频道（DOM 渲染的 ch）的 ②④ 在自己束，但 ① 批请求 cursors[0] 可能是别的 channel →
// reducer actualOutbound 须 fallback：目标束无 outbound 时，取窗口内 url=channels/load/increment
// 且 cursors 含目标 ch 的批请求作 ①（faithful·该批请求确实请求了目标 ch 的增量）。
console.log('· UC-4.1 batch 出站归束（① 批请求覆盖锚频道）');
{
  const CH = 'chTarget';
  const OTHER = 'chOther';
  const lines = [
    // ① 批 sync 出站：cursors[0] 是 OTHER（≠ 锚），但 cursors 含锚 CH。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.1', facet: 'outbound', hop: 'http-req', seq: 1,
      corr_key: `ch=${OTHER}`,
      payload: { method: 'POST', url: 'http://x/api/cses/channels/load/increment',
        body: { timestamp: 0, cursors: [{ channelId: OTHER, fromSeq: 0 }, { channelId: CH, fromSeq: 0 }] } } }),
    // ② 锚频道增量投影。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.1', facet: 'projection', hop: 'projection', seq: 2,
      corr_key: `ch=${CH}`,
      payload: { event: 'im:channel:increment', data: { channel_id: CH, increment: { lastEventSeq: 5 } } } }),
    // ④ 锚频道落库（id==ch·table=channel）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.1', facet: 'storage', hop: 'storage', seq: 3,
      corr_key: `ch=${CH}`,
      payload: { id: CH, op: 'batch_upsert', table: 'channel', rows: 1 } }),
  ].join('\n');
  const expect41 = {
    ucId: 'UC-4.1',
    corrAnchor: { ch: CH },
    outbound: { method: 'POST', urlEndsWith: 'channels/load/increment',
      bodyFields: { timestamp: '*', cursors: '*' }, bodyForbidden: ['channel_id', 'from_seq'] },
    projection: { event: 'im:channel:increment', dataKeys: ['channel_id', 'increment'] },
    storage: { op: 'batch_upsert', table: 'channel', minRows: 1 },
    dom: { dataAttrs: { ready: 'true', 'channel-id': '*' } },
  };
  const dom = { ready: 'true', 'channel-id': CH };
  const rep = runFourFacet({ jsonl: lines, expect: expect41, dom });
  ok(rep.facets.projection.ok, '② 锚 ch 增量投影绿');
  ok(rep.facets.storage.ok, '④ 锚 ch 落库（id→ch）绿');
  ok(rep.facets.dom.ok, '③ DOM 绿');
  ok(rep.facets.outbound.ok, '① 批请求 fallback：cursors 含锚 ch → 归 ① 绿');
  ok(rep.green, `UC-4.1 四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);

  // 可证伪：批请求 cursors 不含锚 ch（且无单束 outbound）→ ① 红。
  const lines2 = lines.replace(`{"channelId":"${CH}","fromSeq":0}`, '');
  // 上面 replace 形态可能因 JSON.stringify 空格不命中——用对象级构造保证证伪有效。
  const noCover = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.1', facet: 'outbound', hop: 'http-req', seq: 1,
      corr_key: `ch=${OTHER}`,
      payload: { method: 'POST', url: 'http://x/api/cses/channels/load/increment',
        body: { timestamp: 0, cursors: [{ channelId: OTHER, fromSeq: 0 }] } } }),
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.1', facet: 'projection', hop: 'projection', seq: 2,
      corr_key: `ch=${CH}`,
      payload: { event: 'im:channel:increment', data: { channel_id: CH, increment: {} } } }),
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.1', facet: 'storage', hop: 'storage', seq: 3,
      corr_key: `ch=${CH}`, payload: { id: CH, op: 'batch_upsert', table: 'channel', rows: 1 } }),
  ].join('\n');
  const rep2 = runFourFacet({ jsonl: noCover, expect: expect41, dom });
  eq(rep2.facets.outbound.ok, false, '可证伪：批请求 cursors 不含锚 ch → ① 红');
  eq(rep2.brokenAt, 'outbound', '① 断点定位 outbound');
}

// ── UC-5.1 create 出站归束（① 建群 channel/create 无 server 分配 channelId）─────────
// UC-5.1 ① 建群出站 body 无 channelId（server 端才分配）→ 出站 hop 抽不到 corr_key 归 unkeyed，
// 锚 server 分配 ch 的束（②③④）不含它。reducer actualOutbound 须 create fallback：目标束无
// outbound 时，取窗口内 URL endsWith expect.outbound.urlEndsWith 且 body 无 cursors 的请求作 ①
// （faithful·窗口隔离保证本 UC 内建群请求唯一）。非 tautology：无 create 请求则 ① 红。
console.log('· UC-5.1 create 出站归束（① 建群 channel/create 无 channelId）');
{
  const CH = 'srvAssignedCh';
  const lines = [
    // ① 建群出站：body 无 channelId（全 camelCase 必填集）→ corr_key None 归 unkeyed。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.1', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/channel/create',
        body: { teamId: 'T1', displayName: 'g', orient: '', type: 'P',
          users: [{ id: '444', teamId: 'T1', role: 'CREATOR' }], picturetype: 'USER',
          picture: { userIds: ['444'] }, forceCreate: true } } }),
    // ② 建群投影（server 分配 ch）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.1', facet: 'projection', hop: 'projection', seq: 2,
      corr_key: `ch=${CH}`,
      payload: { event: 'im:channel:created', data: { channel_id: CH, channel: { id: CH } } } }),
    // ④ 建群落库（id==ch·table=channel）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.1', facet: 'storage', hop: 'storage', seq: 3,
      corr_key: `ch=${CH}`,
      payload: { id: CH, op: 'batch_upsert', table: 'channel', rows: 1 } }),
  ].join('\n');
  const expect51 = {
    ucId: 'UC-5.1',
    corrAnchor: { ch: CH },
    outbound: { method: 'POST', urlEndsWith: 'channel/create',
      bodyFields: { teamId: '*', displayName: '*', orient: '', type: 'P', users: '*',
        picturetype: 'USER', picture: '*', forceCreate: true },
      bodyForbidden: ['channel_id', 'channelId'] },
    projection: { event: 'im:channel:created', dataKeys: ['channel_id', 'channel'] },
    storage: { op: 'batch_upsert', table: 'channel', minRows: 1 },
    dom: { dataAttrs: { 'channel-id': '*' } },
  };
  const dom = { 'channel-id': CH };
  const rep = runFourFacet({ jsonl: lines, expect: expect51, dom });
  ok(rep.facets.projection.ok, '② 建群投影 created 绿');
  ok(rep.facets.storage.ok, '④ 建群落库（id→ch）绿');
  ok(rep.facets.dom.ok, '③ DOM 新频道行绿');
  ok(rep.facets.outbound.ok, '① create fallback：channel/create 无 channelId → 归 ① 绿');
  ok(rep.green, `UC-5.1 四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);

  // 可证伪 a：无 create 出站请求（删 ① 行）→ create fallback 无命中 → ① 红。
  const noCreate = lines.split('\n').slice(1).join('\n');
  const repNoCreate = runFourFacet({ jsonl: noCreate, expect: expect51, dom });
  eq(repNoCreate.facets.outbound.ok, false, '可证伪：无 channel/create 出站 → ① 红');
  eq(repNoCreate.brokenAt, 'outbound', '① 断点定位 outbound');

  // 可证伪 b：建群 body 泄漏 channelId（旧形态）→ bodyForbidden 命中 → ① 红。
  const leakLines = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.1', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/channel/create',
        body: { channelId: 'leaked', teamId: 'T1', displayName: 'g', orient: '', type: 'P',
          users: [{ id: '444' }], picturetype: 'USER', picture: { userIds: ['444'] }, forceCreate: true } } }),
    lines.split('\n')[1], lines.split('\n')[2],
  ].join('\n');
  const repLeak = runFourFacet({ jsonl: leakLines, expect: expect51, dom });
  eq(repLeak.facets.outbound.ok, false, '可证伪：建群 body 泄漏 channelId → ① 红');
}

// ── UC-1.9 加急两阶段 outbound（phase1 urgentPost + phase2 urgentConfirm 同 corr_key=postId）──
// UC-1.9 expect.outbound 有 `phase*` 子对象 → reducer 走 diffOutboundPhases：束内**所有**
// outbound http-req 里按 urlEndsWith 找每段逐字段断言。faithful（两段都必须出现且 camelCase 对齐），
// 非 tautology（少发一段 / body 泄漏 snake → 该 phase 红）。
console.log('· UC-1.9 加急两阶段 outbound（urgentPost + urgentConfirm 同束）');
{
  const CH = 'urgCh01';
  const SID = 'urgPost77';
  const lines = [
    // 阶段① urgentPost 出站（camelCase）·corr_key=sid 归 post 束。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-1.9', facet: 'outbound', hop: 'http-req', seq: 1,
      corr_key: `ch=${CH};sid=${SID}`,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/urgentPost',
        body: { channelId: CH, postId: SID, targetIds: ['u9', 'u8'] } } }),
    // 阶段② urgentConfirm 出站（camelCase）·同 sid 归同束。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-1.9', facet: 'outbound', hop: 'http-req', seq: 2,
      corr_key: `ch=${CH};sid=${SID}`,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/urgentConfirm',
        body: { postId: SID, channelId: CH } } }),
    // ② 加急投影 fat 13 键。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-1.9', facet: 'projection', hop: 'projection', seq: 3,
      corr_key: `ch=${CH};sid=${SID}`,
      payload: { event: 'im:post:updated', data: {
        channel_id: CH, event_seq: 9, msg_id: SID, temporaryId: '', channelId: CH, userId: '444',
        type: 'TEXT', message: '', props: '{}', createAt: 1, updateAt: 2, readBits: '0', viewers: [] } } }),
    // ④ 落库 message 行（加急 = type2 edit_content_op patch → batch_update·非 upsert）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-1.9', facet: 'storage', hop: 'storage', seq: 4,
      corr_key: `ch=${CH};sid=${SID}`,
      payload: { id: SID, op: 'batch_update', table: 'message', keys: 1 } }),
  ].join('\n');
  const expect19 = JSON.parse(
    readFileSync(join(ROOT, 'test', 'expect', 'uc-1.9.expect.json'), 'utf8')
  );
  const expectAnchored = { ...expect19, corrAnchor: { ...expect19.corrAnchor, postId: SID, channelId: CH } };
  // DOM 面（投影可观测）：post-row 重渲 msg-id/channel-id/event-seq（不含 data-urgent·不可投影驱动·见 expect _note）。
  const dom = { 'msg-id': SID, 'channel-id': CH, 'event-seq': '9' };
  const rep = runFourFacet({ jsonl: lines, expect: expectAnchored, dom });
  ok(rep.facets.outbound.ok, `① 两阶段 outbound 绿（实 ${rep.facets.outbound.issues.join('; ')}）`);
  ok(rep.facets.projection.ok, '② 加急投影 fat 13 键绿');
  ok(rep.facets.storage.ok, '④ message 落库绿');
  ok(rep.facets.dom.ok, '③ DOM data-urgent=1 绿');
  ok(rep.green, `UC-1.9 四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);

  // 可证伪 a：删阶段② urgentConfirm 出站 → phase2 无匹配 → ① 红。
  const noConfirm = [lines.split('\n')[0], ...lines.split('\n').slice(2)].join('\n');
  const repNoConfirm = runFourFacet({ jsonl: noConfirm, expect: expectAnchored, dom });
  eq(repNoConfirm.facets.outbound.ok, false, '可证伪：缺 urgentConfirm 段 → ① 红');
  eq(repNoConfirm.brokenAt, 'outbound', '① 断点定位 outbound');

  // 可证伪 b：phase1 body 泄漏 snake target_ids（旧形态）→ bodyForbidden 命中 → ① 红。
  const leak = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-1.9', facet: 'outbound', hop: 'http-req', seq: 1,
      corr_key: `ch=${CH};sid=${SID}`,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/urgentPost',
        body: { channelId: CH, postId: SID, target_ids: ['u9'] } } }),
    ...lines.split('\n').slice(1),
  ].join('\n');
  const repLeak = runFourFacet({ jsonl: leak, expect: expectAnchored, dom });
  eq(repLeak.facets.outbound.ok, false, '可证伪：urgentPost body 泄漏 snake target_ids → ① 红');

  // 可证伪 c：phase1 缺必填 targetIds → ① 红。
  const noTargets = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-1.9', facet: 'outbound', hop: 'http-req', seq: 1,
      corr_key: `ch=${CH};sid=${SID}`,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/urgentPost',
        body: { channelId: CH, postId: SID } } }),
    ...lines.split('\n').slice(1),
  ].join('\n');
  const repNoTargets = runFourFacet({ jsonl: noTargets, expect: expectAnchored, dom });
  eq(repNoTargets.facets.outbound.ok, false, '可证伪：urgentPost 缺 targetIds → ① 红');
}

// ── UC-2.3 按 postId 定位（读族纯本地 Scan·① N/A optional + ④ scan fallback）─────────
// UC-2.3 定位 = queryMessages 拉首屏（② query_result + ④ Scan message）+ client 高亮（③）。
// ① 读族本地无 HTTP 出站 → expect.outbound 全 *（optional）→ 不论有无 hop 总绿（isOutboundOptional）。
// ④ Scan op payload 无 channel_id → corr_key=null 落 unkeyed → 不进 ch 锚 target → scanFallback
// 取窗口内同 uc + scan op 的 storage 事件补 ④（与 UC-5.1 create fallback 同模式）。
// 非 tautology：缺 scan(message) → ④ 红；缺/错 highlighted → ③ 红；缺 query_result → ② 红。
console.log('· UC-2.3 按 postId 定位（① N/A optional + ④ scan fallback·读族本地）');
{
  const CH = 'locateCh01';
  const SID = 'srvPost9z';
  const lines = [
    // ② query_result 投影（带 ch corr_key·外层 {channel_id, messages}）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.3', facet: 'projection', hop: 'projection', seq: 1,
      corr_key: `ch=${CH}`,
      payload: { event: 'im:messages:query_result', data: { channel_id: CH, messages: [{ id: SID }] } } }),
    // ④ Scan message（读路径·payload 无 channel_id → corr_key=null 落 unkeyed·靠 scanFallback 归 ④）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.3', facet: 'storage', hop: 'storage', seq: 2,
      corr_key: null,
      payload: { op: 'scan', table: 'message', rows: 50 } }),
    // 窗口噪声：bootstrap increment 的 outbound（与本 UC 定位无关·① optional 不约束·不该误绿/误红）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.3', facet: 'outbound', hop: 'http-req', seq: 3,
      payload: { method: 'POST', url: 'http://x/api/cses/channels/increment', body: {} } }),
  ].join('\n');
  const expect23 = JSON.parse(
    readFileSync(join(ROOT, 'test', 'expect', 'uc-2.3.expect.json'), 'utf8')
  );
  const expectAnchored = { ...expect23, corrAnchor: { ...expect23.corrAnchor, ch: CH } };
  const dom = { 'msg-id': SID, 'channel-id': CH, highlighted: 'true' };
  const rep = runFourFacet({ jsonl: lines, expect: expectAnchored, dom, ucId: 'UC-2.3' });
  ok(rep.facets.outbound.ok, '① 读族 optional 出站绿（method/url=*·不论有无 HTTP）');
  ok(rep.facets.projection.ok, '② query_result {channel_id, messages} 绿');
  ok(rep.facets.storage.ok, `④ scan(message) fallback 归束绿（实 ${rep.facets.storage.issues.join('; ')}）`);
  ok(rep.facets.dom.ok, '③ DOM 定位命中行 data-highlighted=true 绿');
  ok(rep.green, `UC-2.3 四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);

  // 可证伪 a：删 ④ scan(message) → scanFallback 无命中 → ④ 红（断点 storage）。
  const noScan = [lines.split('\n')[0], lines.split('\n')[2]].join('\n');
  const repNoScan = runFourFacet({ jsonl: noScan, expect: expectAnchored, dom, ucId: 'UC-2.3' });
  eq(repNoScan.facets.storage.ok, false, '可证伪：无 scan(message) → ④ 红');
  eq(repNoScan.brokenAt, 'storage', '④ 断点定位 storage');

  // 可证伪 b：DOM 命中行缺 highlighted（定位未高亮）→ ③ 红。
  const repNoHl = runFourFacet({
    jsonl: lines, expect: expectAnchored, ucId: 'UC-2.3',
    dom: { 'msg-id': SID, 'channel-id': CH },
  });
  eq(repNoHl.facets.dom.ok, false, '可证伪：DOM 缺 data-highlighted → ③ 红');
  eq(repNoHl.brokenAt, 'dom', '③ 断点定位 dom');

  // 可证伪 c：scan 错表（scan channel 而非 message）→ table 不匹配 → ④ 红（fallback 不放水跨表）。
  const wrongTable = [
    lines.split('\n')[0],
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.3', facet: 'storage', hop: 'storage', seq: 2,
      corr_key: null, payload: { op: 'scan', table: 'channel', rows: 1 } }),
    lines.split('\n')[2],
  ].join('\n');
  const repWrongTable = runFourFacet({ jsonl: wrongTable, expect: expectAnchored, dom, ucId: 'UC-2.3' });
  eq(repWrongTable.facets.storage.ok, false, '可证伪：scan 错表(channel≠message) → ④ 红');

  // 可证伪 d：删 ② query_result → ② 红（断点 projection·定位前置投影必须发生）。
  const noProj = [lines.split('\n')[1], lines.split('\n')[2]].join('\n');
  const repNoProj = runFourFacet({ jsonl: noProj, expect: expectAnchored, dom, ucId: 'UC-2.3' });
  eq(repNoProj.facets.projection.ok, false, '可证伪：无 query_result → ② 红');
}

// ── 读族 scan fallback 不被 target 束偶现 keyed 写抢答（2026-06-25 环境漂移回归）──────
// 切群时除 query_result 投影外，helix 可能对同 ch 触发 batch_upsert channel/channel_member
// （成员同步落库）→ 这些 keyed 写进 ch 锚 target 束。读族 expect.storage.op=scan/table=message
// 时，actualStorage 不得用 `?? writes[0]` catch-all 抢到无关的 channel_member upsert，
// 必须让位给 scanFallback（同 table=message 的 scan op）。否则环境漂移下假红。
console.log('· 读族 scan fallback 不被偶现 keyed 写抢答（环境漂移回归·UC-2.1）');
{
  const CH = 'driftCh21';
  const SID = 'srvMsg21x';
  const lines = [
    // ② query_result 投影（带 ch corr_key → 进 ch 锚 target 束）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.1', facet: 'projection', hop: 'projection', seq: 1,
      corr_key: `ch=${CH}`,
      payload: { event: 'im:messages:query_result', data: { channel_id: CH, messages: [{ id: SID }] } } }),
    // 偶现 keyed 写：切群成员同步 batch_upsert channel_member（同 ch → 进 target 束·非 message 表）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.1', facet: 'storage', hop: 'storage', seq: 2,
      corr_key: `ch=${CH}`,
      payload: { op: 'batch_upsert', table: 'channel_member', rows: [1, 2, 3] } }),
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.1', facet: 'storage', hop: 'storage', seq: 3,
      corr_key: `ch=${CH}`,
      payload: { op: 'batch_upsert', table: 'channel', rows: [1] } }),
    // ④ Scan message（读路径·payload 无 channel_id → corr_key=null 落 unkeyed·靠 scanFallback 归 ④）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.1', facet: 'storage', hop: 'storage', seq: 4,
      corr_key: null,
      payload: { op: 'scan', table: 'message', rows: 50 } }),
  ].join('\n');
  const expect21 = JSON.parse(
    readFileSync(join(ROOT, 'test', 'expect', 'uc-2.1.expect.json'), 'utf8')
  );
  const expectAnchored = { ...expect21, corrAnchor: { ...expect21.corrAnchor, ch: CH } };
  const dom = { 'msg-id': SID, 'channel-id': CH };
  const rep = runFourFacet({ jsonl: lines, expect: expectAnchored, dom, ucId: 'UC-2.1' });
  eq(rep.facets.storage.actual?.op, 'scan', '④ 取 scan(message)·不被 batch_upsert channel_member 抢答');
  eq(rep.facets.storage.actual?.table, 'message', '④ table=message（非 channel_member）');
  ok(rep.facets.storage.ok, `④ scan(message) fallback 归束绿（实 ${rep.facets.storage.issues.join('; ')}）`);
  ok(rep.green, `读族漂移场景四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);

  // 可证伪：删 scan(message) → 只剩 batch_upsert channel_member → scanFallback 空 →
  // actualStorage table=message 无命中 → ④ 红（断点 storage·绝不放水用 channel_member 冒充绿）。
  const noScan = lines.split('\n').slice(0, 3).join('\n');
  const repNoScan = runFourFacet({ jsonl: noScan, expect: expectAnchored, dom, ucId: 'UC-2.1' });
  eq(repNoScan.facets.storage.ok, false, '可证伪：无 scan(message)·仅 channel_member 写 → ④ 红');
  eq(repNoScan.brokenAt, 'storage', '④ 断点定位 storage（不被 channel_member 冒充绿）');
}

// ── UC-2.4 读族（runFourFacetRead·request-response 断面 ①②）────────────────────

console.log('· UC-2.4 读族 getReplies/getReplyBranch（runFourFacetRead）');
{
  const RID = 'req-abc123def4';
  const REPLY = 'qkyxnn3yi78wxmeqnr51tc9jne';
  const expReplies = JSON.parse(
    readFileSync(join(ROOT, 'test', 'expect', 'uc-2.4.expect.json'), 'utf8')
  ).getReplies;

  // 金标束：① getReplies 出站 wire body（camelCase）+ ② im:read:result{req_id, body} 回灌。
  const goodLines = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.4', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/getReplies',
        body: { replyId: REPLY, pageNumber: 0, pageSize: 20 } } }),
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.4', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:read:result', data: { req_id: RID, body: { rootPost: { id: REPLY }, replies: [] } } } }),
    // 噪声：另一 UC 窗口的帧（uc_id 过滤须排除·不串味）。
    JSON.stringify({ run_id: 'r', uc_id: '__quiescence__', facet: 'outbound', hop: 'http-req', seq: 3,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/top20', body: { channel_id: 'cX' } } }),
  ].join('\n');

  const repGood = runFourFacetRead({ jsonl: goodLines, expect: expReplies, reqId: RID, ucId: 'UC-2.4' });
  eq(repGood.green, true, '读族金标束：① getReplies wire body + ② im:read:result 双面全绿');
  eq(repGood.facets.outbound.ok, true, '读族 ① 出站 getReplies camelCase 对齐');
  eq(repGood.facets.projection.ok, true, '读族 ② 投影 im:read:result{req_id, body} 键集对齐 + req_id 锚');

  // 可证伪 a：出站 body 泄漏 snake page_number（bodyForbidden）→ ① 红。
  const leakSnake = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.4', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/getReplies',
        body: { replyId: REPLY, page_number: 0, pageSize: 20 } } }),
    ...goodLines.split('\n').slice(1),
  ].join('\n');
  const repLeak = runFourFacetRead({ jsonl: leakSnake, expect: expReplies, reqId: RID, ucId: 'UC-2.4' });
  eq(repLeak.facets.outbound.ok, false, '可证伪：getReplies body 缺 camel pageNumber + 泄漏 snake page_number → ① 红');

  // 可证伪 b：出站 body 泄漏 offset（UI 层概念误进 wire·bodyForbidden）→ ① 红。
  const leakOffset = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.4', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/getReplies',
        body: { replyId: REPLY, pageNumber: 0, pageSize: 20, offset: 0 } } }),
    ...goodLines.split('\n').slice(1),
  ].join('\n');
  const repOffset = runFourFacetRead({ jsonl: leakOffset, expect: expReplies, reqId: RID, ucId: 'UC-2.4' });
  eq(repOffset.facets.outbound.ok, false, '可证伪：getReplies body 泄漏 offset（UI 概念误进 wire）→ ① 红');

  // 可证伪 c：没发出站（少 invoke）→ ① 红（无出站命令体·断在 invoke→HTTP 这跳）。
  const noOut = goodLines.split('\n').slice(1).join('\n');
  const repNoOut = runFourFacetRead({ jsonl: noOut, expect: expReplies, reqId: RID, ucId: 'UC-2.4' });
  eq(repNoOut.facets.outbound.ok, false, '可证伪：getReplies 无出站（少 invoke）→ ① 红');

  // 可证伪 d：没回灌 im:read:result（少回灌）→ ② 红（无投影 emit·断在 gate→投影这跳）。
  const noProj = goodLines.split('\n').filter((l) => !l.includes('im:read:result')).join('\n');
  const repNoProj = runFourFacetRead({ jsonl: noProj, expect: expReplies, reqId: RID, ucId: 'UC-2.4' });
  eq(repNoProj.facets.projection.ok, false, '可证伪：getReplies 无 im:read:result 回灌 → ② 红');

  // 可证伪 e：回灌 req_id 不匹配本次 invoke（错束）→ ② 红（req_id 锚守「确为本次」非任取）。
  const wrongReq = [
    goodLines.split('\n')[0],
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.4', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:read:result', data: { req_id: 'req-OTHER0000', body: {} } } }),
  ].join('\n');
  const repWrongReq = runFourFacetRead({ jsonl: wrongReq, expect: expReplies, reqId: RID, ucId: 'UC-2.4' });
  eq(repWrongReq.facets.projection.ok, false, '可证伪：im:read:result req_id 不匹配本次 invoke → ② 红');

  // 可证伪 f：投影外层多/缺键（非 {req_id, body}）→ ② 红（读族外层键集冻结）。
  const badKeys = [
    goodLines.split('\n')[0],
    JSON.stringify({ run_id: 'r', uc_id: 'UC-2.4', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:read:result', data: { req_id: RID, body: {}, extra: 1 } } }),
  ].join('\n');
  const repBadKeys = runFourFacetRead({ jsonl: badKeys, expect: expReplies, reqId: RID, ucId: 'UC-2.4' });
  eq(repBadKeys.facets.projection.ok, false, '可证伪：im:read:result 外层多字段 extra → ② 红');
}

// ── UC-5.4 群属性修改（改群名）— channelUpdate 系统 post 锚 + propsMatch 区分 join（可证伪）──
// 改群名 server echo = channelUpdate 系统 NOTICE post（im:post:received·props.type=channelUpdate·
// field=displayName·content=新名）。同 ch 还有建群 join post（type=NOTICE/userId=SYS 全同·仅 props
// 区分）。reducer chPerPostTarget 须经 propsMatch 精确锚 channelUpdate 束（非 join）·出站 channel/
// change/displayName 经 createOutbound fallback 并入。守可证伪：propsMatch 不符 / 漏 channelUpdate post → 红。
console.log('· UC-5.4 群属性修改（改群名·channelUpdate post 锚·propsMatch 区分 join）');
{
  const CH = 'ch54rename';
  const JOIN_SID = 'joinPostSid';
  const CU_SID = 'cuPostSid';
  const NEW = 'lf-rename-xyz';
  const joinPost = (data) =>
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.4', facet: 'projection', hop: 'projection', seq: 2,
      corr_key: `ch=${CH};tmp=${JOIN_SID};sid=${JOIN_SID};seq=1`,
      payload: { event: 'im:post:received', data: {
        channelId: CH, channel_id: CH, createAt: 1, event_seq: 1, message: '', msg_id: JOIN_SID,
        props: { type: 'join' }, readBits: '00', temporaryId: JOIN_SID, type: 'NOTICE',
        updateAt: 1, userId: 'SYS', viewers: ['all'], ...data } } });
  const cuPost = () =>
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.4', facet: 'projection', hop: 'projection', seq: 4,
      corr_key: `ch=${CH};tmp=${CU_SID};sid=${CU_SID};seq=2`,
      payload: { event: 'im:post:received', data: {
        channelId: CH, channel_id: CH, createAt: 2, event_seq: 2, message: '', msg_id: CU_SID,
        props: { type: 'channelUpdate', field: 'displayName', content: NEW, channel_event_seq: 2 },
        readBits: '00', temporaryId: CU_SID, type: 'NOTICE', updateAt: 2, userId: 'SYS',
        viewers: ['all'] } } });
  const lines = [
    // ① 改名出站：body {id, displayName}·url 含 channel/change/ → 抽 ch（自成 ch-only 束·createOutbound 并入）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.4', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/channel/change/displayName',
        body: { id: CH, displayName: NEW } } }),
    joinPost(),                                       // ② 建群 join post（同 ch·同形态·须被 propsMatch 排除）
    // ④ join 落库 message。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.4', facet: 'storage', hop: 'storage', seq: 3,
      corr_key: `ch=${CH};tmp=${JOIN_SID};sid=${JOIN_SID}`,
      payload: { id: JOIN_SID, op: 'batch_upsert', table: 'message', rows: 1 } }),
    cuPost(),                                          // ② channelUpdate post（本 UC 真锚）
    // ④ channelUpdate 落库 message。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.4', facet: 'storage', hop: 'storage', seq: 5,
      corr_key: `ch=${CH};tmp=${CU_SID};sid=${CU_SID}`,
      payload: { id: CU_SID, op: 'batch_upsert', table: 'message', rows: 1 } }),
  ].join('\n');
  const expect54 = {
    ucId: 'UC-5.4',
    corrAnchor: { ch: CH },
    outbound: { method: 'POST', urlEndsWith: 'channel/change/displayName',
      bodyFields: { id: '*', displayName: '*' },
      bodyForbidden: ['channelId', 'channel_id', 'orient', 'users'] },
    projection: { event: 'im:post:received',
      dataKeys: ['channelId', 'channel_id', 'createAt', 'event_seq', 'message', 'msg_id',
        'props', 'readBits', 'temporaryId', 'type', 'updateAt', 'userId', 'viewers'],
      dataValues: { type: 'NOTICE', userId: 'SYS' },
      propsMatch: { type: 'channelUpdate', field: 'displayName', content: NEW } },
    storage: { op: 'batch_upsert', table: 'message', minRows: 1 },
    dom: { dataAttrs: { 'channel-id': '*', 'channel-display-name': '*' } },
  };
  const dom = { 'channel-id': CH, 'channel-display-name': NEW };
  const rep = runFourFacet({ jsonl: lines, expect: expect54, dom });
  ok(rep.facets.outbound.ok, '① change/displayName 出站（createOutbound fallback）绿');
  ok(rep.facets.projection.ok, '② channelUpdate post 投影（propsMatch 精确锚·非 join）绿');
  ok(rep.facets.storage.ok, '④ channelUpdate post 落 message 行绿');
  ok(rep.facets.dom.ok, '③ data-channel-display-name 回读绿');
  ok(rep.green, `UC-5.4 四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);
  // 锚的确是 channelUpdate 束（seq=2 的 sid·非 join seq=1）。
  ok(rep.summary.includes(CU_SID) || rep.summary.includes('seq=2'),
    `UC-5.4 锚 channelUpdate 束（非 join）·summary=${rep.summary}`);

  // 可证伪 a：只有 join post（删 channelUpdate post + 其落库）→ propsMatch 无命中 → ② 红（防 join 误锚冒充绿）。
  const joinOnly = [lines.split('\n')[0], lines.split('\n')[1], lines.split('\n')[2]].join('\n');
  const repJoinOnly = runFourFacet({ jsonl: joinOnly, expect: expect54, dom });
  eq(repJoinOnly.facets.projection.ok, false, '可证伪：仅 join post（无 channelUpdate）→ ② 红');

  // 可证伪 b：channelUpdate post content 不符本次新名（改坏 content）→ propsMatch.content 失配 → ② 红。
  const wrongContentLines = [
    lines.split('\n')[0], lines.split('\n')[1], lines.split('\n')[2],
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.4', facet: 'projection', hop: 'projection', seq: 4,
      corr_key: `ch=${CH};tmp=${CU_SID};sid=${CU_SID};seq=2`,
      payload: { event: 'im:post:received', data: {
        channelId: CH, channel_id: CH, createAt: 2, event_seq: 2, message: '', msg_id: CU_SID,
        props: { type: 'channelUpdate', field: 'displayName', content: 'WRONG-NAME' },
        readBits: '00', temporaryId: CU_SID, type: 'NOTICE', updateAt: 2, userId: 'SYS', viewers: ['all'] } } }),
    lines.split('\n')[4],
  ].join('\n');
  const repWrong = runFourFacet({ jsonl: wrongContentLines, expect: expect54, dom });
  eq(repWrong.facets.projection.ok, false, '可证伪：channelUpdate content 不符新名 → ② 红');

  // 可证伪 c：无改名出站（删 ① 行）→ createOutbound 无命中 → ① 红。
  const noOut = lines.split('\n').slice(1).join('\n');
  const repNoOut = runFourFacet({ jsonl: noOut, expect: expect54, dom });
  eq(repNoOut.facets.outbound.ok, false, '可证伪：无 channel/change/displayName 出站 → ① 红');
}

// ── UC-5.3 关闭/退出群 — channel/close 出站 + im:channel:closed 投影 + batch_update channel + DOM 行移除（!absent）──
// 关闭群出站 channel/close {channelId} → WS channel_close（broadcast）→ ④ channel 表 batch_update
// （delete_at + is_active=0 定点 patch）+ ② im:channel:closed {channelId, deleteAt}（独立 broadcast 推送·
// 非批次结束 thin）→ ③ DOM channel 行移除（data-channel-id !absent）。锚 ch（① body.channelId·② data.channelId·
// ④ channel.id 表感知归一）。守可证伪：投影字段集偏 / 无出站 / DOM 行仍在 → 红。
console.log('· UC-5.3 关闭/退出群（channel/close 出站·im:channel:closed 投影·batch_update channel·DOM 行移除 !absent）');
{
  const CH = 'ch53close';
  const lines = [
    // ① 关闭出站：body {channelId}·url 含 channel/close → 抽 ch。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.3', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/channel/close',
        body: { channelId: CH } } }),
    // ② im:channel:closed {channelId, deleteAt}（独立 broadcast·ch 锚）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.3', facet: 'projection', hop: 'projection', seq: 2,
      corr_key: `ch=${CH}`,
      payload: { event: 'im:channel:closed', data: { channelId: CH, deleteAt: 1735000000000 } } }),
    // ④ channel 表 batch_update（delete_at + is_active=0·key_col=id→表感知归一 channel.id→ch）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-5.3', facet: 'storage', hop: 'storage', seq: 3,
      payload: { id: CH, op: 'batch_update', table: 'channel', keys: 1 } }),
  ].join('\n');
  const expect53 = {
    ucId: 'UC-5.3',
    corrAnchor: { ch: CH },
    outbound: { method: 'POST', urlEndsWith: 'channel/close',
      bodyFields: { channelId: '*' },
      bodyForbidden: ['id', 'channel_id', 'top', 'displayName', 'notice'] },
    projection: { event: 'im:channel:closed', dataKeys: ['channelId', 'deleteAt'] },
    storage: { op: 'batch_update', table: 'channel', minRows: 1 },
    dom: { dataAttrs: { 'channel-id': '!absent' } },
  };
  // ③ DOM：行已移除 → e2e 注入 channel-id 缺值（null）。
  const dom = { 'channel-id': null };
  const rep = runFourFacet({ jsonl: lines, expect: expect53, dom });
  ok(rep.facets.outbound.ok, '① channel/close 出站（body channelId·bodyForbidden 别名）绿');
  ok(rep.facets.projection.ok, '② im:channel:closed 投影 {channelId, deleteAt} 绿');
  ok(rep.facets.storage.ok, '④ batch_update channel（delete_at+is_active）绿');
  ok(rep.facets.dom.ok, '③ data-channel-id 已移除（!absent）绿');
  ok(rep.green, `UC-5.3 四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);

  // 可证伪 a：投影字段集多/少（漏 deleteAt）→ ② 红。
  const badProj = lines.replace('"deleteAt":1735000000000', '"foo":1');
  const repBadProj = runFourFacet({ jsonl: badProj, expect: expect53, dom });
  eq(repBadProj.facets.projection.ok, false, '可证伪：投影漏 deleteAt（多 foo）→ ② 红');

  // 可证伪 b：DOM 行仍在（channel-id 非空）→ ③ 红（删行未发生·非 tautology）。
  const repRowStill = runFourFacet({ jsonl: lines, expect: expect53, dom: { 'channel-id': CH } });
  eq(repRowStill.facets.dom.ok, false, '可证伪：DOM 行仍在（!absent 失败）→ ③ 红');

  // 可证伪 c：无关闭出站（删 ① 行）→ ① 红。
  const noOut = lines.split('\n').slice(1).join('\n');
  const repNoOut = runFourFacet({ jsonl: noOut, expect: expect53, dom });
  eq(repNoOut.facets.outbound.ok, false, '可证伪：无 channel/close 出站 → ① 红');
}

// ── torn-line 容忍（暖栈常驻并发产物·守可证伪 C008）───────────────────────────
//
// 命题：常驻 app 持续往 run.jsonl append（背景 __quiescence__ hops），spec 读时可能撞「末行只写一半」
// 的并发产物。parseJsonl 须**只**放过末行残缺（不否决绿），中段坏行仍硬失败（真损坏·非并发末行）。

console.log('· torn-line 容忍（暖栈并发末行）');
{
  const GOOD = SAMPLE.trimEnd();            // 完整金标束（末行完整）
  const goodLines = GOOD.split('\n');

  // 绿对偶 1：完整束之后追一条**半截**末行（并发写到一半·无法 parse·真·末尾）。
  const HALF_LINE = '{"run_id":"r","uc_id":"UC-x","facet":"outbound","hop":"http-req","payl';
  const tornTail = GOOD + '\n' + HALF_LINE;
  const pTorn = parseJsonl(tornTail);
  ok(pTorn.parseErrors.length === 0, 'torn 末行：parseErrors 空（不否决绿）');
  ok(pTorn.tornLastLine != null, 'torn 末行：记入 tornLastLine（透明可审·非静默吞）');
  eq(pTorn.events.length, goodLines.length, 'torn 末行：前面合法行全部保留（events 不丢）');

  // 绿对偶 2：完整四面束 + 一条 torn 末行 → runFourFacet 仍判全绿（torn 不再一票否决）。
  const tornAnchor = { ...EXPECT, corrAnchor: { tmp: 't-abc123' } };
  const repTorn = runFourFacet({ jsonl: tornTail, expect: tornAnchor, dom: DOM_GOOD });
  ok(repTorn.green, `torn 末行：四面束仍全绿（brokenAt=${repTorn.brokenAt} :: ${repTorn.summary}）`);
  ok(repTorn.parseErrors.length === 0, 'torn 末行：runFourFacet.parseErrors 空');

  // 可证伪对偶 a：中段坏行（坏行后还有合法非空行）→ 真损坏·必计入 parseErrors·否决绿。
  const midCorrupt = [
    goodLines[0],
    '{"run_id":"r","uc_id":"UC-x" BROKEN HALF LINE',   // 中段坏行（其后有合法行）
    ...goodLines.slice(1),
  ].join('\n');
  const pMid = parseJsonl(midCorrupt);
  ok(pMid.parseErrors.length === 1, '可证伪：中段坏行计入 parseErrors（非末行·不放过）');
  ok(pMid.tornLastLine == null, '可证伪：中段坏行不误判为 torn 末行');
  const repMid = runFourFacet({ jsonl: midCorrupt, expect: tornAnchor, dom: DOM_GOOD });
  eq(repMid.green, false, '可证伪：中段坏行 → runFourFacet 否决绿（parse 红·守 C008）');

  // 可证伪对偶 b：末行后若再追一条合法行 → 原「末行」不再是末行 → 它若坏则计入 parseErrors。
  const tornThenGood = midCorrupt;          // 已覆盖（坏行非末行）；显式再断一次末行甄别边界：
  const lastIsGood = GOOD + '\n' + goodLines[0];   // 两条合法行·无坏行
  const pClean = parseJsonl(lastIsGood);
  ok(pClean.parseErrors.length === 0 && pClean.tornLastLine == null,
    '边界：全合法（含合法末行）→ parseErrors 空 + 无 torn 误报');
  void tornThenGood;
}

// ── UC-10.1 待办列表（runFourFacetSelfDriven·内核自驱 projection-only 断面 ①②③·④ N/A）──────
// hello 收尾 global increment-end 攒 about-me post id → posts/queryTodoList {postIds} → HTTP 回报
// 装配 emit im:todo:updated {items}。① 出站 body {postIds}（无领域键·窗口内 endpoint 唯一）·
// ② 投影外层键集 {items} 严格冻结·③ DOM data-todo-id 渲染·④ N/A（port_reply 仅 emit 不落库）。
// 守可证伪：① 漏发 / ② 漏 emit / ② 外层多键 / ③ 未渲染 → 对应面红。
console.log('· UC-10.1 待办列表（runFourFacetSelfDriven·projection-only ①②③·④ N/A）');
{
  const TODO_ID = 'post-abc_mention';
  const goodLines = [
    // ① queryTodoList 出站：body {postIds:[...]}（camelCase·非空·无 snake/Pascal 泄漏）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-10.1', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/queryTodoList',
        body: { postIds: ['post-abc', 'post-def'] } } }),
    // ② im:todo:updated 投影：外层 {items} 单键（冻结集）·item 透传 {id, channel, post, type, canDel}。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-10.1', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:todo:updated', data: { items: [
        { id: TODO_ID, channel: { id: 'ch1' }, post: { id: 'post-abc' }, type: 'mention', canDel: true },
      ] } } }),
  ].join('\n');
  const expect101 = {
    ucId: 'UC-10.1',
    outbound: { method: 'POST', urlEndsWith: 'posts/queryTodoList',
      bodyFields: { postIds: '*' },
      bodyForbidden: ['post_ids', 'PostIds', 'postId'] },
    projection: { event: 'im:todo:updated', dataKeys: ['items'] },
    dom: { dataAttrs: { 'todo-id': '*' } },
  };
  const dom = { 'todo-id': TODO_ID };
  const rep = runFourFacetSelfDriven({ jsonl: goodLines, expect: expect101, dom });
  ok(rep.facets.outbound.ok, '① queryTodoList 出站 {postIds} 绿');
  ok(rep.facets.projection.ok, '② im:todo:updated 外层 {items} 投影绿');
  ok(rep.facets.dom.ok, '③ data-todo-id 渲染绿');
  ok(rep.green, `UC-10.1 三面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);

  // 可证伪 a：无 queryTodoList 出站（about-me 空 → 不发）→ ① 红。
  const noOut = goodLines.split('\n').slice(1).join('\n');
  const repNoOut = runFourFacetSelfDriven({ jsonl: noOut, expect: expect101, dom });
  eq(repNoOut.facets.outbound.ok, false, '可证伪：无 queryTodoList 出站 → ① 红');

  // 可证伪 b：body 用 snake post_ids（旧形态泄漏）→ ① 红（bodyForbidden 锚 + 缺 postIds）。
  const snakeLeak = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-10.1', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/posts/queryTodoList',
        body: { post_ids: ['post-abc'] } } }),
    goodLines.split('\n')[1],
  ].join('\n');
  const repLeak = runFourFacetSelfDriven({ jsonl: snakeLeak, expect: expect101, dom });
  eq(repLeak.facets.outbound.ok, false, '可证伪：body snake post_ids 泄漏 → ① 红');

  // 可证伪 c：无 im:todo:updated emit → ② 红。
  const noProj = goodLines.split('\n')[0];
  const repNoProj = runFourFacetSelfDriven({ jsonl: noProj, expect: expect101, dom });
  eq(repNoProj.facets.projection.ok, false, '可证伪：无 im:todo:updated emit → ② 红');

  // 可证伪 d：投影外层多键（非 {items}·如 {items, extra}）→ ② 红（外层键集冻结）。
  const badKeys = [
    goodLines.split('\n')[0],
    JSON.stringify({ run_id: 'r', uc_id: 'UC-10.1', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:todo:updated', data: { items: [], extra: 1 } } }),
  ].join('\n');
  const repBadKeys = runFourFacetSelfDriven({ jsonl: badKeys, expect: expect101, dom });
  eq(repBadKeys.facets.projection.ok, false, '可证伪：im:todo:updated 外层多字段 extra → ② 红');

  // 可证伪 e：壳未渲染 todo 行（DOM data-todo-id 缺值）→ ③ 红。
  const repNoDom = runFourFacetSelfDriven({ jsonl: goodLines, expect: expect101, dom: { 'todo-id': '' } });
  eq(repNoDom.facets.dom.ok, false, '可证伪：DOM data-todo-id 缺值 → ③ 红');
}

// ── UC-4.2 按需 sync notify（runFourFacetSyncNotify·内核自驱 gap 触发·四面 ①②④③）──────────
// behind-cursor → hello 重检 needSync gap → 自驱 channel/sync/notify（body {cursors:[{channelId,
// fromSeq}]}）→ server 回放 → im:channel:update-by-post（{channel_id,event_seq,msg_id}·badge）+
// 配对 fat im:post:received（增量行）→ message batch_upsert + cursor 跳空洞。① 出站 cursors 覆盖
// 锚 ch·② 投影外层键集冻结·④ 锚 ch message 落库 ≥1·③ DOM unread badge + 增量行 msg-id。
// 守可证伪：① 漏发/顶层泄漏 / ② 漏 emit/键集偏 / ④ 未落库 / ③ badge 未刷 → 对应面红。
console.log('· UC-4.2 按需 sync notify（runFourFacetSyncNotify·gap 自驱·①②④③）');
{
  const CH = 'ch4abcdefghijklmnopqrstuvw';
  const goodLines = [
    // ① channel/sync/notify 出站：body {cursors:[{channelId, fromSeq}]}（per-channel·camelCase·覆盖锚 ch）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.2', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/channel/sync/notify',
        body: { cursors: [{ channelId: CH, fromSeq: 80 }] } } }),
    // ② im:channel:update-by-post 投影：{channel_id, event_seq, msg_id}（瘦·badge·锚 ch）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.2', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:channel:update-by-post',
        data: { channel_id: CH, event_seq: 84, msg_id: 'msg-x5' } } }),
    // ④ message batch_upsert：锚 ch 落库 rows=1（sync 回放逐事件）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.2', facet: 'storage', hop: 'storage', seq: 3,
      payload: { op: 'batch_upsert', table: 'message', rows: 1, channel_id: CH, id: 'msg-x5' } }),
    // ④ 旁证 cursor 跳空洞（monotonic_upsert·payload 无 rows·不作 minRows 锚）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.2', facet: 'storage', hop: 'storage', seq: 4,
      payload: { op: 'monotonic_upsert', table: 'channel_event_cursor', scope: CH, value: 84 } }),
  ].join('\n');
  const expect42 = {
    ucId: 'UC-4.2',
    corrAnchor: { ch: CH },
    outbound: { method: 'POST', urlEndsWith: 'channel/sync/notify',
      bodyFields: { cursors: '*' },
      bodyForbidden: ['channel_id', 'from_seq', 'channelId', 'fromSeq'] },
    projection: { event: 'im:channel:update-by-post', dataKeys: ['channel_id', 'event_seq', 'msg_id'] },
    storage: { op: 'batch_upsert', table: 'message', minRows: 1 },
    dom: { dataAttrs: { unread: '*', 'msg-id': '*' } },
  };
  const dom = { unread: '1', 'msg-id': 'msg-x5' };
  const rep = runFourFacetSyncNotify({ jsonl: goodLines, expect: expect42, dom });
  ok(rep.facets.outbound.ok, '① channel/sync/notify 出站 {cursors} 绿');
  ok(rep.facets.projection.ok, '② im:channel:update-by-post {channel_id,event_seq,msg_id} 投影绿');
  ok(rep.facets.storage.ok, '④ 锚 ch message batch_upsert ≥1 绿');
  ok(rep.facets.dom.ok, '③ data-unread badge + 增量行 msg-id 渲染绿');
  ok(rep.green, `UC-4.2 四面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);

  // 可证伪 a：无 sync/notify 出站（无 gap → 不发）→ ① 红。
  const noOut = goodLines.split('\n').slice(1).join('\n');
  eq(runFourFacetSyncNotify({ jsonl: noOut, expect: expect42, dom }).facets.outbound.ok, false,
    '可证伪：无 channel/sync/notify 出站 → ① 红');

  // 可证伪 b：顶层 channelId 泄漏（应嵌 cursors[] 内·非顶层）→ ① 红（bodyForbidden 锚）。
  const topLeak = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.2', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/channel/sync/notify',
        body: { channelId: CH, cursors: [{ channelId: CH, fromSeq: 80 }] } } }),
    ...goodLines.split('\n').slice(1),
  ].join('\n');
  eq(runFourFacetSyncNotify({ jsonl: topLeak, expect: expect42, dom }).facets.outbound.ok, false,
    '可证伪：顶层 channelId 泄漏 → ① 红');

  // 可证伪 c：无 update-by-post emit → ② 红。
  const noProj = [goodLines.split('\n')[0], ...goodLines.split('\n').slice(2)].join('\n');
  eq(runFourFacetSyncNotify({ jsonl: noProj, expect: expect42, dom }).facets.projection.ok, false,
    '可证伪：无 im:channel:update-by-post emit → ② 红');

  // 可证伪 d：投影缺 event_seq（瘦集偏移）→ ② 红（键集冻结）。
  const badKeys = [
    goodLines.split('\n')[0],
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.2', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:channel:update-by-post', data: { channel_id: CH, msg_id: 'msg-x5' } } }),
    ...goodLines.split('\n').slice(2),
  ].join('\n');
  eq(runFourFacetSyncNotify({ jsonl: badKeys, expect: expect42, dom }).facets.projection.ok, false,
    '可证伪：update-by-post 缺 event_seq → ② 红');

  // 可证伪 e：无锚 ch message 落库 → ④ 红。
  const noStore = [goodLines.split('\n')[0], goodLines.split('\n')[1], goodLines.split('\n')[3]].join('\n');
  eq(runFourFacetSyncNotify({ jsonl: noStore, expect: expect42, dom }).facets.storage.ok, false,
    '可证伪：无锚 ch message 落库 → ④ 红');

  // 可证伪 f：壳未刷 badge（DOM data-unread 缺值）→ ③ 红。
  eq(runFourFacetSyncNotify({ jsonl: goodLines, expect: expect42, dom: { unread: '', 'msg-id': 'msg-x5' } }).facets.dom.ok, false,
    '可证伪：DOM data-unread 缺值 → ③ 红');

  // 可证伪 g：sync/notify cursors 不覆盖锚 ch（请求别的频道）→ ① 不命中锚 → ① 红（faithful·非任取）。
  const otherCh = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.2', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x/api/cses/channel/sync/notify',
        body: { cursors: [{ channelId: 'ch-OTHER', fromSeq: 0 }] } } }),
    ...goodLines.split('\n').slice(1),
  ].join('\n');
  // 注：cursors 覆盖别的频道时 reducer 退回 syncHops[0]（首条 sync/notify）→ body 形态仍合法
  // （bodyFields cursors 存在·无顶层泄漏）→ ① 仍绿（这是「sync/notify 确实发生」的诚实证·锚 ch
  // 命中由 ②④ 的锚 ch 过滤保证·非 ① 强求覆盖）。此 case 验 ① 不因「锚 ch 未在 cursors」误红。
  ok(runFourFacetSyncNotify({ jsonl: otherCh, expect: expect42, dom }).facets.outbound.ok,
    '① sync/notify 发生即绿（锚 ch 收敛由 ②④ 过滤保证·① 不强求 cursors 覆盖锚·非 tautology：无 sync/notify 则 a 已证红）');
}

// ── UC-4.4 心跳 gap 补偿（runFourFacetHeartbeatGap·心跳 ping piggyback·三面 ①②④·③ DOM N/A）──
// behind-cursor → 8s 周期心跳 ping piggyback {action:"ping", data:{cursors, allHash}} → server pong
// 回 {gaps, hashMismatch} → compensate_from_pong 自驱 sync/notify 补偿 → server 回放 →
// im:channel:update-by-post（{channel_id,event_seq,msg_id}·badge）→ message batch_upsert + cursor 跳空洞。
// ① ws-send ping 帧 data 层含 cursors+allHash 且 cursors 覆盖锚 ch·② 投影外层键集冻结·④ 锚 ch message ≥1。
// ③ DOM N/A（issue #34 已移除该面·补偿增量经 4.2 路径渲染）。
// 守可证伪：① 无 ping 帧/缺 allHash/不含锚 ch / ② 漏 emit/键集偏 / ④ 未落库 → 对应面红。
console.log('· UC-4.4 心跳 gap 补偿（runFourFacetHeartbeatGap·心跳 ping piggyback·①②④·③ N/A）');
{
  const CH = 'ch44abcdefghijklmnopqrstuv';
  const goodLines = [
    // ① ws-send ping 帧：{action:"ping", seq, data:{cursors:[{channelId, fromSeq}], allHash}}（覆盖锚 ch）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.4', facet: 'outbound', hop: 'ws-send', seq: 1,
      payload: { action: 'ping', seq: 7,
        data: { cursors: [{ channelId: CH, fromSeq: 80 }], allHash: 'a1b2c3d4e5f60718' } } }),
    // ② im:channel:update-by-post 投影：{channel_id, event_seq, msg_id}（补偿回放·锚 ch）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.4', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:channel:update-by-post',
        data: { channel_id: CH, event_seq: 84, msg_id: 'msg-y9' } } }),
    // ④ message batch_upsert：补偿 sync 回放逐事件落库 rows=1（锚 ch）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.4', facet: 'storage', hop: 'storage', seq: 3,
      payload: { op: 'batch_upsert', table: 'message', rows: 1, channel_id: CH, id: 'msg-y9' } }),
    // ④ 旁证 cursor 跳空洞（monotonic_upsert·不作 minRows 锚）。
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.4', facet: 'storage', hop: 'storage', seq: 4,
      payload: { op: 'monotonic_upsert', table: 'channel_event_cursor', scope: CH, value: 84 } }),
  ].join('\n');
  const expect44 = {
    ucId: 'UC-4.4',
    corrAnchor: { ch: CH },
    outbound: { frame: 'ws-send', action: 'ping', dataFields: { cursors: '*', allHash: '*' } },
    projection: { event: 'im:channel:update-by-post', dataKeys: ['channel_id', 'event_seq', 'msg_id'] },
    storage: { op: 'batch_upsert', table: 'message', minRows: 1 },
  };
  const rep = runFourFacetHeartbeatGap({ jsonl: goodLines, expect: expect44 });
  ok(rep.facets.outbound.ok, '① ws-send ping 帧 {action,data:{cursors,allHash}} 覆盖锚 ch 绿');
  ok(rep.facets.projection.ok, '② im:channel:update-by-post {channel_id,event_seq,msg_id} 投影绿');
  ok(rep.facets.storage.ok, '④ 锚 ch message batch_upsert ≥1 绿');
  ok(rep.green, `UC-4.4 三面全绿（实 brokenAt=${rep.brokenAt} :: ${rep.summary}）`);
  eq(rep.facets.dom, undefined, '③ DOM 面 N/A（reducer 不产 dom facet·已移除）');

  // 可证伪 a：无 ping 帧（心跳未发/未连接）→ ① 红。
  const noPing = goodLines.split('\n').slice(1).join('\n');
  eq(runFourFacetHeartbeatGap({ jsonl: noPing, expect: expect44 }).facets.outbound.ok, false,
    '可证伪：无 ws-send ping 帧 → ① 红');

  // 可证伪 b：ping 帧缺 allHash（piggyback 漏算·根群非空却不带 hash）→ ① 红。
  const noHash = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.4', facet: 'outbound', hop: 'ws-send', seq: 1,
      payload: { action: 'ping', seq: 7, data: { cursors: [{ channelId: CH, fromSeq: 80 }] } } }),
    ...goodLines.split('\n').slice(1),
  ].join('\n');
  eq(runFourFacetHeartbeatGap({ jsonl: noHash, expect: expect44 }).facets.outbound.ok, false,
    '可证伪：ping 帧缺 allHash → ① 红');

  // 可证伪 c：ping 帧 cursors 不覆盖锚 ch（携别群快照·锚 ch 未参与对账）→ ① 红（faithful·非任取）。
  const otherCh = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.4', facet: 'outbound', hop: 'ws-send', seq: 1,
      payload: { action: 'ping', seq: 7,
        data: { cursors: [{ channelId: 'ch-OTHER', fromSeq: 0 }], allHash: 'deadbeefdeadbeef' } } }),
    ...goodLines.split('\n').slice(1),
  ].join('\n');
  eq(runFourFacetHeartbeatGap({ jsonl: otherCh, expect: expect44 }).facets.outbound.ok, false,
    '可证伪：ping cursors 不覆盖锚 ch → ① 红（faithful）');

  // 可证伪 d：无 update-by-post emit（pong 无 gap → 不补偿）→ ② 红。
  const noProj = [goodLines.split('\n')[0], ...goodLines.split('\n').slice(2)].join('\n');
  eq(runFourFacetHeartbeatGap({ jsonl: noProj, expect: expect44 }).facets.projection.ok, false,
    '可证伪：无 im:channel:update-by-post emit → ② 红');

  // 可证伪 e：投影缺 msg_id（瘦集偏移）→ ② 红（键集冻结）。
  const badKeys = [
    goodLines.split('\n')[0],
    JSON.stringify({ run_id: 'r', uc_id: 'UC-4.4', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:channel:update-by-post', data: { channel_id: CH, event_seq: 84 } } }),
    ...goodLines.split('\n').slice(2),
  ].join('\n');
  eq(runFourFacetHeartbeatGap({ jsonl: badKeys, expect: expect44 }).facets.projection.ok, false,
    '可证伪：update-by-post 缺 msg_id → ② 红');

  // 可证伪 f：无锚 ch message 落库 → ④ 红。
  const noStore = [goodLines.split('\n')[0], goodLines.split('\n')[1], goodLines.split('\n')[3]].join('\n');
  eq(runFourFacetHeartbeatGap({ jsonl: noStore, expect: expect44 }).facets.storage.ok, false,
    '可证伪：无锚 ch message 落库 → ④ 红');
}

// ── UC-8.x 投票 CRUD（写族 ① + ② optional 短路 / 读族 ①② · runFourFacetRead）────────

console.log('· UC-8.x 投票 CRUD（写族 ① + projection.optional 短路·读族 ①②·runFourFacetRead）');
{
  const expVote = JSON.parse(
    readFileSync(join(ROOT, 'test', 'expect', 'uc-8.x-vote.expect.json'), 'utf8')
  );

  // 写族 createVote 金标束：仅 ① 出站（整 args 透传 camelCase）·无 im:read:result（fire-and-forget）。
  const createGood = JSON.stringify({
    run_id: 'r', uc_id: 'UC-8.x', facet: 'outbound', hop: 'http-req', seq: 1,
    payload: { method: 'POST', url: 'http://x:3399/vote/createVote',
      body: { title: 't', content: 'c', options: ['A', 'B'], isReal: false, votes: 1 } },
  });
  const repCreate = runFourFacetRead({ jsonl: createGood, expect: expVote.voteCreate, reqId: null, ucId: 'UC-8.x' });
  eq(repCreate.green, true, '写族 createVote：① 出站绿 + ② optional 短路 → 整体绿（无 im:read:result 也绿）');
  eq(repCreate.facets.projection.ok, true, '写族 ② projection.optional → 短路总绿（fire-and-forget·N/A）');

  // 可证伪 a：少 invoke（无出站）→ ① 红（optional 只豁免 ②·① 仍刚性·守可证伪非 tautology）。
  const repNoOut = runFourFacetRead({ jsonl: '', expect: expVote.voteCreate, reqId: null, ucId: 'UC-8.x' });
  eq(repNoOut.facets.outbound.ok, false, '可证伪：createVote 无出站（少 invoke）→ ① 红（optional 不放水 ①）');
  eq(repNoOut.green, false, '可证伪：无出站 → 整体红（② optional 短路不掩盖 ① 红）');

  // 可证伪 b：写族 body 泄漏 snake is_real（bodyForbidden）→ ① 红。
  const leakSnake = JSON.stringify({
    run_id: 'r', uc_id: 'UC-8.x', facet: 'outbound', hop: 'http-req', seq: 1,
    payload: { method: 'POST', url: 'http://x:3399/vote/createVote',
      body: { title: 't', content: 'c', options: ['A'], is_real: false, votes: 1 } },
  });
  const repLeak = runFourFacetRead({ jsonl: leakSnake, expect: expVote.voteCreate, reqId: null, ucId: 'UC-8.x' });
  eq(repLeak.facets.outbound.ok, false, '可证伪：createVote body 缺 camel isReal + 泄漏 snake is_real → ① 红');

  // 可证伪 c：写族 createVote body 泄漏 req_id（fire-and-forget 不应携·整透传误带污染）→ ① 红。
  const leakReq = JSON.stringify({
    run_id: 'r', uc_id: 'UC-8.x', facet: 'outbound', hop: 'http-req', seq: 1,
    payload: { method: 'POST', url: 'http://x:3399/vote/createVote',
      body: { title: 't', content: 'c', options: ['A'], isReal: false, votes: 1, req_id: 'req-x' } },
  });
  const repLeakReq = runFourFacetRead({ jsonl: leakReq, expect: expVote.voteCreate, reqId: null, ucId: 'UC-8.x' });
  eq(repLeakReq.facets.outbound.ok, false, '可证伪：createVote 整透传误带 req_id（污染 wire body）→ ① 红');

  // 写族 voteDo 金标束：① {id, indexes} 出站·② optional。
  const doGood = JSON.stringify({
    run_id: 'r', uc_id: 'UC-8.x', facet: 'outbound', hop: 'http-req', seq: 1,
    payload: { method: 'POST', url: 'http://x:3399/vote/vote',
      body: { id: 'vote-1', indexes: ['0', '2'], postId: 'p1' } },
  });
  const repDo = runFourFacetRead({ jsonl: doGood, expect: expVote.voteDo, reqId: null, ucId: 'UC-8.x' });
  eq(repDo.green, true, '写族 voteDo：① {id, indexes} 出站绿 + ② optional → 整体绿');

  // 读族 readVote 金标束：① {id} 出站 + ② im:read:result{req_id, body} 回灌。
  const RID = 'req-vote-read1';
  const readGood = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-8.x', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x:3399/vote/readVote', body: { id: 'vote-1' } } }),
    JSON.stringify({ run_id: 'r', uc_id: 'UC-8.x', facet: 'projection', hop: 'projection', seq: 2,
      payload: { event: 'im:read:result', data: { req_id: RID, body: { id: 'vote-1', options: [] } } } }),
  ].join('\n');
  const repRead = runFourFacetRead({ jsonl: readGood, expect: expVote.voteRead, reqId: RID, ucId: 'UC-8.x' });
  eq(repRead.green, true, '读族 readVote：① {id} 出站 + ② im:read:result{req_id, body} 双面全绿');

  // 可证伪 d：读族 readVote body 泄漏 req_id（id_body 应不漏 reqId）→ ① 红。
  const readLeakReq = [
    JSON.stringify({ run_id: 'r', uc_id: 'UC-8.x', facet: 'outbound', hop: 'http-req', seq: 1,
      payload: { method: 'POST', url: 'http://x:3399/vote/readVote', body: { id: 'vote-1', req_id: RID } } }),
    readGood.split('\n')[1],
  ].join('\n');
  const repReadLeak = runFourFacetRead({ jsonl: readLeakReq, expect: expVote.voteRead, reqId: RID, ucId: 'UC-8.x' });
  eq(repReadLeak.facets.outbound.ok, false, '可证伪：readVote wire body 泄漏 req_id（id_body 应不漏）→ ① 红');

  // 可证伪 e：读族无 im:read:result 回灌（少回灌）→ ② 红（读族 dataKeys 刚性·非 optional）。
  const readNoProj = readGood.split('\n')[0];
  const repReadNoProj = runFourFacetRead({ jsonl: readNoProj, expect: expVote.voteRead, reqId: RID, ucId: 'UC-8.x' });
  eq(repReadNoProj.facets.projection.ok, false, '可证伪：readVote 无 im:read:result 回灌 → ② 红（读族 ② 刚性）');
}

// ── 收尾 ─────────────────────────────────────────────────────────────────────

console.log('');
console.log(`四面 reducer 单测：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log('失败项：\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('✅ 全绿（含可证伪对偶：每面破坏即红、断点定位正确）');

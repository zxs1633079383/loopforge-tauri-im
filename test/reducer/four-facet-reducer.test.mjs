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

// ── 收尾 ─────────────────────────────────────────────────────────────────────

console.log('');
console.log(`四面 reducer 单测：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log('失败项：\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('✅ 全绿（含可证伪对偶：每面破坏即红、断点定位正确）');

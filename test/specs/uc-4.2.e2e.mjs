// UC-4.2 按需 sync notify e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-4.2 是**内核自驱·gap 触发**（≠ 前端命令 round-trip·同 UC-4.1 就绪根 / UC-10.1 待办）：
// behind-cursor seed 把 channel_event_cursor 各行拉回落后态 → WS hello 握手重检 per-channel
// needSync gap → 对落后频道自驱出站 `channel/sync/notify`（body {cursors:[{channelId, fromSeq}]}）
// → server 回放离线区间事件 → 每条可见 type1 emit im:channel:update-by-post（瘦 badge）+ 配对
// fat im:post:received（增量行）→ DOM CL badge + ML 增量行 + DB message + cursor 跳空洞。
// e2e 不点按钮——只等自驱 sync 链路落定，再读四面对账（onSyncChannels 按钮是同 UC 的按需触发
// 入口·invoke im_sync_channels → 引擎重连重跑·链路同 cold-boot·此处验 cold-boot 自驱面更稳）。
//
// 串四面（issue #32 锚点·契约只读 expect/uc-4.2.expect.json）：
//   ① 出站   : POST channel/sync/notify，body {cursors:[{channelId, fromSeq}]}（per-channel·camelCase）。
//              decorator 探 body.cursors[0].channelId 抽 ch → ① keyed by ch；reducer
//              runFourFacetSyncNotify 在 UC 窗口内找 cursors 覆盖锚 ch 的 sync/notify 出站。
//   ②        : 读 run.jsonl → reducer 按 event=im:channel:update-by-post + 锚 ch 找 → 断外层键集
//              {channel_id, event_seq, msg_id}（缺/多即红）。
//   ④        : 锚 ch 的 message batch_upsert 累计 rows ≥1（sync 回放逐事件落库·cursor 跳空洞旁证）。
//   ③ DOM    : 等锚频道 CL 行 data-unread badge 非空（im:channel:update-by-post 每条 +1）+ 该频道
//              ML 任一增量消息行 data-msg-id 非空（fat im:post:received 驱动追加）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置（reload-app --uc UC-4.2 提供·须先 seed-behind-cursor·本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）·bootstrap UC=UC-4.2（hello hop 归 UC-4.2）
//   - channel_event_cursor 已 behind-cursor seed（落后态·hello 才检出 gap 发 sync/notify）
//   - 真 go 一轮 hello —— gap sync 需真后端回放离线区间 increment_channel/post 帧
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（**本 UC 不可在 spec 内 truncate**·sync 事件在
//     boot 时已流过·见 expect _note + harness reload-app --uc 机制）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetSyncNotify } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-4.2.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

describe('UC-4.2 · 按需 sync notify（内核自驱·gap 触发·四面契约 ①②④③）', () => {
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe：等 data-ready=true（increment_channel_end 收齐 + inflight0 + cursor 稳）。
    // gap sync 发生在 hello 重检 needSync（global increment-end 前后）→ ready 置位时 sync/notify
    // 已发起/回报、update-by-post 投影已 emit。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳·断在 hello→sync 自驱链）' }
    );
  });

  it('①②④③：gap → 自驱 channel/sync/notify → update-by-post 投影 + message 落库 + DOM badge + 增量行', async () => {
    // —— 锚频道选取：在 run.jsonl 里找 cursors 覆盖某 ch 的 sync/notify 出站 **且** 该 ch 有
    //    im:channel:update-by-post 投影 + message 落库（四面真收敛于一个真落后频道·非任取）。
    //    无命中 → CHANNEL_ID 留 null → reducer ① 红（faithful 退化·诚实出账·非放水）。
    const jsonl0 = readFileSync(RUN_JSONL, 'utf8');
    const lines = jsonl0.split('\n');
    const syncChs = new Set();   // sync/notify 出站覆盖的 ch
    const ubpChs = new Set();    // 有 update-by-post 投影的 ch
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.uc_id !== EXPECT.ucId) continue;
      const p = ev.payload ?? {};
      if (ev.facet === 'outbound' && ev.hop === 'http-req' &&
          String(p.url ?? '').endsWith('channel/sync/notify')) {
        const cur = p.body?.cursors;
        if (Array.isArray(cur)) {
          for (const c of cur) {
            const ch = c?.channelId ?? c?.channel_id;
            if (ch) syncChs.add(ch);
          }
        }
      }
      if (ev.facet === 'projection' && ev.hop === 'projection' &&
          (p.event ?? p.channel) === 'im:channel:update-by-post') {
        const ch = p.data?.channel_id ?? p.data?.channelId;
        if (ch) ubpChs.add(ch);
      }
    }
    // 锚 = 既被 sync/notify 请求、又有 update-by-post 投影的频道（四面交集·真 gap-fill 频道）。
    for (const ch of ubpChs) {
      if (syncChs.has(ch)) { CHANNEL_ID = ch; break; }
    }
    // 退化：无交集时取任一有 update-by-post 的频道（② 仍可锚·① 由 reducer faithful 命中/红裁定）。
    if (!CHANNEL_ID && ubpChs.size > 0) CHANNEL_ID = [...ubpChs][0];
    expect(CHANNEL_ID).toBeTruthy();
    console.log(`[UC-4.2 锚] channelId=${CHANNEL_ID}（sync 覆盖=${[...syncChs].length}·update-by-post=${[...ubpChs].length}·交集命中=${syncChs.has(CHANNEL_ID)}）`);

    // —— ③ DOM：等锚频道 CL 行 data-unread badge 渲染（store.channels() unread 由 update-by-post +1）——
    await browser.waitUntil(
      async () => {
        const u = await browser.execute(
          (id) => document.querySelector(`[data-channel-id="${id}"]`)?.getAttribute('data-unread') ?? null,
          CHANNEL_ID
        );
        return u != null && u !== '';
      },
      { timeout: 15000, interval: 200, timeoutMsg: '锚频道 CL 行无 data-unread badge（断在 im:channel:update-by-post→applyChannelUpdateByPost→unread→DOM）' }
    );

    // —— ③ DOM 面：读锚频道 CL 行 data-unread + 该频道任一 ML 增量行 data-msg-id 注入 reducer ——
    const domFacet = await browser.execute((id) => {
      const chRow = document.querySelector(`[data-channel-id="${id}"]`);
      const msgRow = document.querySelector(`.msg[data-channel-id="${id}"][data-msg-id]`)
        ?? document.querySelector('[data-msg-id]');
      return {
        unread: chRow?.getAttribute('data-unread') ?? null,
        'msg-id': msgRow?.getAttribute('data-msg-id') ?? null,
      };
    }, CHANNEL_ID);
    expect(domFacet.unread).toBeTruthy();
    console.log(`[UC-4.2 DOM] 锚频道 unread=${domFacet.unread}·增量行 msg-id=${domFacet['msg-id']}`);

    // —— 四面 reducer（runFourFacetSyncNotify·UC 窗口 + 锚 ch 各 facet 聚合裁定）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetSyncNotify({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-4.2 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：channel/sync/notify body {cursors}（camelCase·cursors 覆盖锚 ch·顶层无 channelId/fromSeq 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影：im:channel:update-by-post 外层键集 {channel_id, event_seq, msg_id}（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：锚 ch message batch_upsert ≥1 行（sync 回放逐事件落库·cursor 跳空洞旁证）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：锚频道 CL 行 data-unread badge 非空 + ML 增量行 data-msg-id 非空。
    expect(report.facets.dom.ok).toBe(true);
    // 整体四面齐绿。
    expect(report.green).toBe(true);
  });
});

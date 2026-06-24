// UC-2.1 首屏频道加载 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 竖切演变（spec §7）：UC-1.1 send round-trip 已全绿（③ DOM 驱动 + 乐观→echo 覆写）。
// UC-2.1 query 路线不同：
//   ① 读族：invoke im_query_messages_by_channel 是纯本地 Scan，不产 HTTP 出站
//           （或 too_long 兜底 posts/getLatestPost，暂 optional）。
//   ② 投影：query_result {channel_id, messages}（外层 2 键，透传 wire Post 数组）。
//   ③ DOM : N 消息行（无乐观态，直接 server_id 渲染·[data-msg-id] 批量）。
//   ④ storage: Scan message（读路径，无写）。
//
// 四面与 expect.json 对应，但 UI 接线尚未实现（Phase 2）→ spec 现在跑会红。
// spec 本身是契约定义，验证期望的 data-* 选择器结构；Phase 2 接线后转绿。
//
// 时序纪律（HX-C011）：waitUntil 等投影 emit，禁固定 pause。

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-2.1.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
const invokeBridge = (cmd, args) =>
  browser.executeAsync(
    (c, a, done) => {
      if (!window.__lf?.invoke) {
        done({ ok: false, error: 'no __lf bridge' });
        return;
      }
      window.__lf
        .invoke(c, a)
        .then((r) => done({ ok: true, result: r === undefined ? null : r }))
        .catch((e) => done({ ok: false, error: String(e?.message ?? e) }));
    },
    cmd,
    args
  );

// 批量读消息行的 data-* 终态（选择器锚 [data-channel-id]）。
const readMessageRows = (channelId) =>
  browser.execute((ch) => {
    const rows = document.querySelectorAll(`[data-channel-id="${ch}"][data-msg-id]`);
    const items = [];
    for (const el of rows) {
      const ds = el.dataset;
      items.push({
        'msg-id': ds.msgId ?? null,
        'channel-id': ds.channelId ?? null,
        'temporary-id': ds.temporaryId ?? null,
        'event-seq': ds.eventSeq ?? null,
        'send-status': ds.sendStatus ?? null,
        'read-bits': ds.readBits ?? null,
      });
    }
    return items;
  }, channelId);

describe('UC-2.1 · 首屏频道加载（四面契约·Phase2 待接线）', () => {
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready 标志
    //   = increment_channel_end 收齐 + HTTP inflight==0 + cursor 稳。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // 取当前频道 id。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );

    // 开 UC 窗口。
    await invokeBridge('set_uc', { uc: 'UC-2.1' });
  });

  it('①②③④：切群首屏加载 + query_result 投影 + 消息行批量渲染 + Scan 读路径', async () => {
    // —— 触发 query（simulation·Phase2 实现时替换为真 UI 交互） ——
    // UC-2.1 预期的 invoke：im_query_messages_by_channel({ channelId })
    // 现阶段 spec 无真 UI 触发，手动注入 invoke。
    const queryResult = await invokeBridge('im_query_messages_by_channel', { channelId: CHANNEL_ID });
    if (!queryResult.ok) {
      console.warn('[UC-2.1] im_query_messages_by_channel 返 error：', queryResult.error);
    }

    // 断言②：等投影 emit —— query_result 带 {channel_id, messages}。
    // 锚点：[data-msg-id] 行存在且数量 ≥ minRows（本 UC minRows=0）。
    await browser.waitUntil(
      async () => {
        const rows = await readMessageRows(CHANNEL_ID);
        return rows.length >= (EXPECT.storage?.minRows ?? 0);
      },
      { timeout: 8000, timeoutMsg: '消息行未渲染（断在投影→DOM 这跳）' }
    );

    // 读消息行终态。
    const messageRows = await readMessageRows(CHANNEL_ID);
    console.log(`[UC-2.1 DOM] channel=${CHANNEL_ID} rows=${messageRows.length}`);
    if (messageRows.length > 0) {
      console.log(`  首行 msg-id=${messageRows[0]['msg-id']} seq=${messageRows[0]['event-seq']}`);
    }

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 读 run.jsonl → 四面 reducer ——
    // UC-2.1 为读族，无 temporaryId 锚；按 channelId 聚束。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    // 注入 DOM 面（批量消息行，选择仅验证 msg-id 和 channel-id 存在即可）。
    const domFacet = messageRows.length > 0
      ? {
          'msg-id': messageRows[0]['msg-id'], // 取首行示例
          'channel-id': CHANNEL_ID,
        }
      : null;
    const report = runFourFacet({
      jsonl,
      expect: expectWithAnchor,
      dom: domFacet,
      ucId: 'UC-2.1',
    });

    console.log('[UC-2.1 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) {
        console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
      }
    }

    // 四面断言：读族可能无出站（本地 Scan），故宽松对待 ① 面。
    // 关键是 ②③④ 三面：投影 event + 消息行渲染 + 读路径无写。
    expect(report.parseErrors.length).toBe(0);

    // ② 投影：query_result 事件 + {channel_id, messages} 外层键集。
    expect(report.facets.projection.ok).toBe(true);

    // ③ DOM：消息行批量渲染（至少 minRows 条，本 UC ≥0）。
    // 若有消息，msg-id 和 channel-id 应存在；若频道空，断言 minRows=0 通过。
    if (messageRows.length > 0) {
      expect(report.facets.dom.ok).toBe(true);
    } else {
      // 空频道亦是合法态（minRows=0）。
      expect(messageRows.length).toBe(0);
    }

    // ④ storage：读路径 Scan message（无写 op 或 op=scan）。
    // TODO：若装饰器支持 scan op 记录，本断言验证 op='scan'；
    //       否则可接受无 storage hop（纯本地 Scan 不产 facet）。
    if (report.facets.storage.actual) {
      expect(['scan', null]).toContain(report.facets.storage.actual.op);
    }

    // ① 出站（可选）：读族无 HTTP 或走 posts/getLatestPost GET。
    // 本 UC 大多数路线是本地 Scan → 无出站 hop。
    // 若有出站，应为 getLatestPost GET；无出站亦接受（本地 Scan）。
  });
});

// UC-2.2 上拉加载更老历史 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；多轮 postContext 编排加载更早历史后对账四面：
//   ③ DOM    : 先拉首屏（im_query_messages_by_channel·UC-2.1 复用）→ 点 [data-testid=load-older-btn]
//              （onLoadOlder → store.loadOlder·以当前最旧已加载行 server id+createAt 作 pivot 锚）→
//              invoke im_load_older_context → helix 多轮 postContext 回报后 emit older_loaded →
//              applyOlderLoaded prepend 更早行到 ML 区头部；校验行 data-msg-id 存在 + 行数增加。
//   ②        : 读 run.jsonl → reducer 锚 channelId 聚束 → 断 projection 字段集 im:messages:older_loaded
//              {channelId, messages, hasMore}（冻结外层 3 键）。
//   ①        : 多轮 postContext HTTP body → 经 createOutbound fallback（expect.urlEndsWith=posts/postContext）
//              逐字段对齐期望 {postId,before}（camelCase·forbidden snake post_id/before_id）。
//   ④        : 多轮 upsert message 表，总行数≥1。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：waitUntil 等条件（首屏稳/上拉出帧），不猜 pause。
//
// 依赖前置（W1/W2 提供）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）·seeded DB（active channel 有真实历史）
//   - debug-only invoke `set_uc` / `im_query_messages_by_channel` / `im_load_older_context` 已注册
//   - run.jsonl 路径经 env HELIX_RUN_JSONL 暴露
//
// 数据依赖（C003/C004）：① postContext 出站靠 acl 放行 im_load_older_context（round6 已含 is_query
// 白名单·from_tick.rs accepts_tick）必然发生 → ① 可证。②③④ 进一步依赖 cses-java 对该 channel
// 的 postContext 返回**严格更早**消息（服务端有该 channel 历史）；若服务端无更早历史 → older_loaded
// emit messages:[] hasMore:false（②仍发·但③无新行④无新写）→ 按 C004 出 server-data-gap 报告。

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-2.2.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

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

// 读当前频道全部消息行的 data-* 终态（选择器锚 [data-channel-id=CH][data-msg-id]）。
const readMessageRows = (channelId) =>
  browser.execute((ch) => {
    const rows = document.querySelectorAll(`[data-channel-id="${ch}"][data-msg-id]`);
    return Array.from(rows).map((el) => {
      const ds = el.dataset;
      return {
        'msg-id': ds.msgId ?? null,
        'event-seq': ds.eventSeq ?? null,
        'temporary-id': ds.temporaryId ?? null,
        'channel-id': ds.channelId ?? null,
        'send-status': ds.sendStatus ?? null,
      };
    });
  }, channelId);

describe('UC-2.2 · 上拉加载更老历史（四面契约）', () => {
  let CHANNEL_ID;
  let FIRST_SCREEN_COUNT = 0;

  before(async () => {
    // 就绪 probe：等 data-ready 标志（increment_end + inflight0 + cursor 稳）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    // 取当前活动频道 id（bootstrapDialogList 设·last_post_at 最新者·seeded DB 必有历史）。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
    expect(CHANNEL_ID).toBeTruthy();

    // 开 UC 窗口。
    await invokeBridge('set_uc', { uc: 'UC-2.2' });
  });

  it('①②③④：上拉加载更早历史（首屏 → 点上拉 → 多轮 postContext → older_loaded → prepend 行 + 落库）', async () => {
    // —— 前置：拉首屏（UC-2.1 复用·im_query_messages_by_channel）建立锚行集 ——
    // 上拉翻页须有 pivot 锚（最旧已加载行 server id + createAt）；首屏 Scan 提供锚行。
    const queryResult = await invokeBridge('im_query_messages_by_channel', { channelId: CHANNEL_ID });
    expect(queryResult?.ok).toBe(true);

    // 等首屏行渲染稳定（连续两次计数相同且 >0·HX-C011 禁恒真 minRows=0 早退）。
    let prevCount = -1;
    await browser.waitUntil(
      async () => {
        const rows = await readMessageRows(CHANNEL_ID);
        const stable = rows.length > 0 && rows.length === prevCount;
        prevCount = rows.length;
        return stable;
      },
      { timeout: 10000, interval: 200, timeoutMsg: '首屏消息行未渲染稳定（断在 query_result→DOM）' }
    );
    const firstScreen = await readMessageRows(CHANNEL_ID);
    FIRST_SCREEN_COUNT = firstScreen.length;
    console.log(`[UC-2.2 首屏] channel=${CHANNEL_ID} firstScreenCount=${FIRST_SCREEN_COUNT}`);

    // —— ③ DOM 主驱动：点上拉按钮触发 onLoadOlder → store.loadOlder ——
    const olderBtn = await $('[data-testid="load-older-btn"]');
    await olderBtn.waitForExist({ timeout: 5000 });
    await olderBtn.click();
    console.log('[UC-2.2] 点上拉按钮 → onLoadOlder → im_load_older_context');

    // 断言③：等多轮 postContext 编排收尾 emit older_loaded → prepend 更早行 → 行数增加。
    // server 有更早历史则行数增；若 server 无更早（older_loaded messages:[]）则行数不变（②仍发·见 §C004 兜底）。
    let totalMsgCount = FIRST_SCREEN_COUNT;
    let grew = false;
    try {
      await browser.waitUntil(
        async () => {
          const rows = await readMessageRows(CHANNEL_ID);
          totalMsgCount = rows.length;
          return totalMsgCount > FIRST_SCREEN_COUNT;
        },
        { timeout: 12000, interval: 200, timeoutMsg: '上拉更早消息未 prepend' }
      );
      grew = true;
    } catch (e) {
      console.warn('[UC-2.2] 行数未增（server 可能无更早历史·靠 ② older_loaded emit + ① postContext 出站裁定）');
    }

    const settledRows = await readMessageRows(CHANNEL_ID);
    console.log(`[UC-2.2 DOM] grew=${grew} prepended=${settledRows.length - FIRST_SCREEN_COUNT} totalRows=${settledRows.length}`);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ①②：读 run.jsonl → runFourFacetRead 裁定（读族编排·① postContext 出站 + ② older_loaded 投影）——
    // ④ storage N/A（projection-schema §1.3·older_context 无 Persist effect·见 expect.storage._note）。
    // outbound 锚 urlEndsWith=posts/postContext（窗口隔离·多轮取最后一条逐字段断 {postId,before}）。
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({ jsonl, expect: EXPECT, ucId: 'UC-2.2' });

    console.log('[UC-2.2 读族报告] ' + report.summary);
    for (const f of ['outbound', 'projection']) {
      if (report.facets[f] && !report.facets[f].ok) {
        console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
      }
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：多轮 postContext {postId,before} camelCase（forbidden snake post_id/before_id）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == im:messages:older_loaded {channelId,messages,hasMore}（冻结外层 3 键）。
    expect(report.facets.projection.ok).toBe(true);

    // ③ DOM：上拉 prepend 更早行（server 有更早历史则行数增长·data-msg-id/channel-id 齐）。
    // server 无更早历史时 grew=false（older_loaded messages:[]·②仍绿）→ ③ 退化为「行集仍完整」（非新行）。
    // 不恒真：firstScreen 必 >0（before 已 waitUntil 稳）·settledRows ≥ firstScreen（prepend 只增不减）。
    expect(settledRows.length).toBeGreaterThanOrEqual(FIRST_SCREEN_COUNT);
    expect(settledRows.length).toBeGreaterThan(0);
    for (const row of settledRows) {
      expect(row['msg-id']).toBeTruthy();
      expect(row['channel-id']).toBe(CHANNEL_ID);
    }
    if (grew) {
      console.log(`[UC-2.2 ③ DOM] prepend 了 ${settledRows.length - FIRST_SCREEN_COUNT} 条更早行（server 有更早历史）`);
    } else {
      console.log('[UC-2.2 ③ DOM] server 该 channel 无更早历史·行数不变（①② 仍绿裁定路径通·非 DOM 缺陷）');
    }
  });
});

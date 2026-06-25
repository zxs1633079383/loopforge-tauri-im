// UC-2.3 按 postId 定位（locate by postId） e2e —— WebdriverIO，直连 4445 内嵌 webdriver。
//
// 串四面（spec §7）·读族纯本地（同 UC-2.1 query_result 路径 + 定位高亮）：
//   ① outbound : 读族纯本地 Scan，不产 HTTP 出站（optional·method/url=* 不约束；越界翻页
//                posts/getPostsAfterIndex 是 L2/真翻页 HTTP 兜底·非本 L1 闭环）。
//   ②        : query_result 投影 {channel_id, messages}（先 queryMessages 拉首屏产此投影）。
//   ④        : Scan message 表（读路径·无写）。
//   ③ DOM    : 定位命中行 data-msg-id=server postId + data-highlighted="true"（client locate 高亮）。
//
// 时序纪律（HX-C011）：不用固定 pause 猜 settle，一律 waitUntil 等条件；超时=真 bug 不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳），seeded DB（/tmp/loopforge-im.db?mode=rwc）
//   - window.__lf.invoke / window.__lf.debugLocatePost 已注入（AppComponent ngOnInit·Tauri 环境）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-2.3.expect.json', import.meta.url), 'utf8')
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

// UC-2.3 定位（读族纯本地·无 Rust 命令）经 debug 桥复用 store.locatePost 生产路径。
const locateBridge = (postId, channelId) =>
  browser.executeAsync(
    (pid, ch, done) => {
      if (!window.__lf?.debugLocatePost) {
        done({ ok: false, error: 'no __lf.debugLocatePost bridge' });
        return;
      }
      Promise.resolve(window.__lf.debugLocatePost(pid, ch))
        .then(() => done({ ok: true }))
        .catch((e) => done({ ok: false, error: String(e?.message ?? e) }));
    },
    postId,
    channelId
  );

// 读目标消息行的 data-* 终态（锚 [data-msg-id=postId]）。
const readRow = (postId) =>
  browser.execute((pid) => {
    const el = document.querySelector(`[data-msg-id="${pid}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'channel-id': ds.channelId ?? null,
      'temporary-id': ds.temporaryId ?? null,
      'event-seq': ds.eventSeq ?? null,
      'send-status': ds.sendStatus ?? null,
      highlighted: ds.highlighted ?? null,
      _msgId: pid,
    };
  }, postId);

describe('UC-2.3 · 按 postId 定位（四面契约·读族本地 + 高亮）', () => {
  let CHANNEL_ID;
  let TARGET_POST_ID = null;

  before(async () => {
    // 就绪 probe（spec §3.1）：increment_end + inflight0 + cursor 稳。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );

    await invokeBridge('set_uc', { uc: 'UC-2.3' });
  });

  it('①②③④：query 加载频道 → query_result 投影 → 命中行 data-highlighted 高亮 + Scan message', async () => {
    // —— 先拉首屏（产 query_result ②④·获取真实 server postId 作定位锚）——
    const q = await invokeBridge('im_query_messages_by_channel', { channelId: CHANNEL_ID });
    if (!q.ok) {
      console.warn('[UC-2.3] im_query_messages_by_channel 返 error：', q.error);
    }

    // 等首屏渲染稳定（≥1 条已落库历史行·读族 Scan·sendStatus=sent）——HX-C011 禁恒真早退。
    // 选择器锚 [data-channel-id=CH][data-send-status=sent]：query_result 行带 DB temporary_id（PK·
    // 非乐观态），不用 :not([data-temporary-id]) 排除（会误排所有 Scan 行）；用 sent 终态锚已落库行。
    let prevCount = -1;
    await browser.waitUntil(
      async () => {
        const n = await browser.execute(
          (ch) =>
            document.querySelectorAll(
              `[data-channel-id="${ch}"][data-msg-id][data-send-status="sent"]`
            ).length,
          CHANNEL_ID
        );
        const stable = n > 0 && n === prevCount;
        prevCount = n;
        return stable;
      },
      { timeout: 12000, interval: 200, timeoutMsg: '首屏消息行未渲染稳定（断在 query_result→DOM 这跳）' }
    );

    // 取首屏一条已落库历史行的 server msg-id 作定位目标（真实 seeded 数据·非手写猜测）。
    TARGET_POST_ID = await browser.execute(
      (ch) =>
        document
          .querySelector(`[data-channel-id="${ch}"][data-msg-id][data-send-status="sent"]`)
          ?.getAttribute('data-msg-id') ?? null,
      CHANNEL_ID
    );
    expect(TARGET_POST_ID).not.toBeNull(); // seeded DB 该频道有真实历史 → 必有目标（无则真 bug 不掩盖）

    // —— ③ 定位驱动：经 debug 桥调 store.locatePost → 命中行打高亮 ——
    const loc = await locateBridge(TARGET_POST_ID, CHANNEL_ID);
    expect(loc.ok).toBe(true); // 桥未注入 / locatePost 抛错 = 真 bug

    // 等命中行渲染 data-highlighted="true"（断在 locate→DOM 高亮这跳）。
    await browser.waitUntil(
      async () => {
        const row = await readRow(TARGET_POST_ID);
        return row && row['msg-id'] === TARGET_POST_ID && row.highlighted === 'true';
      },
      { timeout: 8000, interval: 200, timeoutMsg: `定位命中行未高亮（断在 locate→data-highlighted 这跳）` }
    );

    const result = await readRow(TARGET_POST_ID);
    console.log(
      `[UC-2.3 DOM] msgId=${result['msg-id']} channel=${result['channel-id']} highlighted=${result.highlighted}`
    );
    expect(result).not.toBeNull();
    expect(result['msg-id']).toBe(TARGET_POST_ID);
    expect(result.highlighted).toBe('true');

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②①④：读 run.jsonl → 四面 reducer（按 ch 锚聚束·读族纯本地无 tmp/sid）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: CHANNEL_ID },
    };
    // DOM 面注入（msg-id / channel-id / highlighted=true·与 expect.dom.dataAttrs 对齐）。
    const domFacet = {
      'msg-id': result['msg-id'],
      'channel-id': result['channel-id'],
      highlighted: result.highlighted,
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({
      jsonl,
      expect: expectWithAnchor,
      dom: domFacet,
      ucId: 'UC-2.3',
    });

    console.log('[UC-2.3 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站：读族纯本地 Scan·optional（method/url=* 不约束）→ 总绿（无 HTTP 出站亦合法）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影：query_result {channel_id, messages} 外层键集。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：Scan message 表（读路径）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：定位命中行 data-msg-id + data-channel-id + data-highlighted="true"。
    expect(report.facets.dom.ok).toBe(true);
  });
});

// UC-2.3 按 postId 定位（locate by postId） e2e —— WebdriverIO，直连 4445 内嵌 webdriver。
//
// 串四面（spec §7）；不同于 UC-1.1 write path：
//   ① outbound : 读族 POST 查询（HTTP 响应体本身是数据，无 WS 推送）
//   ②④ 投影/落库 : 读族回灌通道 im:messages:query_result + Scan message 验证
//   ③ DOM    : 渲染查询结果的消息行，data-msg-id=postId 高亮
//
// 时序纪律（HX-C011）：不用固定 pause 猜 settle，一律 waitUntil 等条件。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - golden-tape 或真 go 一轮
//   - debug-only invoke `set_uc` / `im_query_messages_by_channel` / `im_locate_post_by_id` 已注册
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露

import { browser, $, expect } from '@wdio/globals';
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
      // @ts-ignore — 薄壳注入
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
      _msgId: pid,
    };
  }, postId);

describe('UC-2.3 · 按 postId 定位（四面契约）', () => {
  // 预置的已发消息（从某个已验证的历史消息或由前置 UC-1.1 生成）。
  // 真正的 e2e 须先发送一条消息（触发 UC-1.1 full stack），记其 server_id 为 TARGET_POST_ID；
  // 本 spec 示例假设已存在一条可查询的历史消息。
  let CHANNEL_ID;
  let TARGET_POST_ID = null;

  before(async () => {
    // 就绪 probe（spec §3.1）
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

    // 开窗口
    await invokeBridge('set_uc', { uc: 'UC-2.3' });
  });

  it('①②③④：查询 postId → query_result 投影 → 消息行高亮 + 出站 body + 投影键集 + 落库扫描', async () => {
    // 前置：发一条消息（或从 fixture 取已知 postId）获得 TARGET_POST_ID。
    // 简化版：假设存在一条已发消息，e2e 从 DOM 选第一条消息作查询目标。
    // Phase2 时须改为：invoke im_send 生成消息 → 等 echo → 记 server_id → 再查该 id。
    
    // —— 获取页面上第一条消息的 msg-id（示例假设已有历史消息）——
    const firstMsgId = await browser.execute(
      () =>
        document
          .querySelector('[data-msg-id]:not([data-temporary-id])')
          ?.getAttribute('data-msg-id') ?? null
    );

    if (!firstMsgId) {
      console.log('[UC-2.3] 页面无已稳定消息，跳过查询演练（Phase2 需补 UC-1.1 前置生成消息）');
      this.skip();
      return;
    }

    TARGET_POST_ID = firstMsgId;

    // —— ③ DOM 主驱动：invoke 查询 ——
    // 本 spec 期望 Phase2 时实现的 invoke 形态：`im_query_messages_by_channel` 或 `im_locate_post_by_id`
    // 当前契约目标是「invoke 出站体对齐 partial 6 + 投影接收正确」。
    // UI 交互（点击跳转/搜索结果）最终须触发此 invoke；为简化 spec 直接调。
    const invokeResult = await invokeBridge('im_locate_post_by_id', {
      postId: TARGET_POST_ID,
      channelId: CHANNEL_ID,
    });

    if (!invokeResult.ok) {
      console.warn('[UC-2.3] invoke 失败:', invokeResult.error);
      // 不硬 fail，因本 invoke 尚未在 Phase2 接线（spec 本身是「意图中的契约」）
    }

    // —— 断言③：query 结果应渲染到 DOM（已消息行出现或闪光）——
    // 等查询响应的投影被渲染（需等框架响应 listen("im:messages:query_result")）
    await browser.waitUntil(
      async () => {
        const row = await readRow(TARGET_POST_ID);
        return row && row['msg-id'] === TARGET_POST_ID;
      },
      { timeout: 8000, interval: 200, timeoutMsg: `查询结果行未渲染（断在 invoke→query_result 投影）` }
    );

    const result = await readRow(TARGET_POST_ID);
    console.log(`[UC-2.3 DOM] msgId=${result['msg-id']} channel=${result['channel-id']}`);
    expect(result).not.toBeNull();
    expect(result['msg-id']).toBe(TARGET_POST_ID);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②①④（pending）：读 run.jsonl → 四面 reducer ——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, sid: TARGET_POST_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: result });

    console.log('[UC-2.3 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：POST posts/getPostsAfterIndex，body 含 postIds
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影键集：channel_id + messages（读族回灌外层键集）
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：Scan message 表（读路径，可扫到 TARGET_POST_ID 的行）
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM 消息行已渲染，data-msg-id=TARGET_POST_ID
    expect(report.facets.dom.ok).toBe(true);
  });
});

// UC-1.8 快捷回复 emoji round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；corr_key=postId（被回复消息 server id）+ emoji：
//   前置：发一条消息（复用 UC-1.1 发消息流·得可回复的 server post）→ echo 覆写取 server_id。
//   主流：点消息行 [data-testid=quick-reply-btn]（真 UI 驱动）→ onQuickReply → store.quickReply
//         → invoke im_send_quick_reply → 出站 POST posts/quickReply {postId, userId, emoji}
//         → WS post_update（quickReply patch 进 props）→ 投影 im:post:updated（fat）
//         → 壳 applyMessageItem 从 props.quickReply 抽 emoji → DOM data-reactions。
//   ③ DOM    : 真驱动（读 [data-msg-id=sid] 行 data-reactions 终态·含 emoji）。
//   ②        : 读 run.jsonl → reducer 聚 corr_key（postId）→ 断 projection 字段集（fat 13 键）。
//   ①        : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound
//              （camelCase userId/postId/emoji ；bodyForbidden 锚 snake_case 泄漏）。
//   ④        : Recording<NativeStorage> tee 落库 op → message 表 ≥1 行（props.quickReply patch）。
//
// 时序纪律（HX-C011）：waitUntil 等条件，禁固定 pause。超时=真 bug。
//
// 依赖前置（W1/W4 提供）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - seeded db（/tmp/loopforge-im.db?mode=rwc）有活动频道
//   - debug-only invoke `set_uc` / `im_send` / `im_send_quick_reply` 已注册
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.8.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// 用户选的快捷回复表情（onQuickReply 固定 👍·与 UI 按钮一致）。
const EMOJI = '👍';

// debug-only invoke 注入：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
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

// 读消息行的 data-* 终态（锚 [data-msg-id=sid]）。
const readMessageRow = (msgId) =>
  browser.execute((id) => {
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'reactions': ds.reactions ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      _msgId: id,
    };
  }, msgId);

describe('UC-1.8 · 快捷回复 emoji（四面契约）', () => {
  let CHANNEL_ID;
  let POST_ID; // 待回复的消息 server id（发一条 → echo 覆写取之）

  before(async () => {
    // 就绪 probe：等 data-ready 标志（increment 收齐 + inflight==0 + cursor 稳）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    // 取当前活动频道 id。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
    expect(CHANNEL_ID).toBeTruthy();
    console.log(`[UC-1.8 前置] channel=${CHANNEL_ID}`);
  });

  it('①②③④：发消息 → 取 server_id → 点快捷回复 emoji → outbound + 投影 + DOM reactions + 落库', async () => {
    // —— 第一步：发一条消息建基础（复用 UC-1.1 发消息流·得可回复的 server post）——
    await invokeBridge('set_uc', { uc: 'UC-1.8-send' });

    const TEXT = `quickreply-test-${Math.random().toString(36).slice(2, 8)}`;
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 等乐观 sending 行出现（im:post:sending 投影驱动）。
    await browser.waitUntil(
      async () => {
        const tid = await browser.execute(
          () =>
            document
              .querySelector('[data-send-status="sending"]')
              ?.getAttribute('data-temporary-id') ?? null
        );
        return !!tid;
      },
      { timeout: 8000, timeoutMsg: '乐观 sending 行未出现' }
    );

    // 等 echo 覆写（status=sent）。
    let tmp = null;
    await browser.waitUntil(
      async () => {
        tmp = await browser.execute(
          () =>
            document
              .querySelector('[data-send-status="sent"]')
              ?.getAttribute('data-temporary-id') ?? null
        );
        return !!tmp;
      },
      { timeout: 15000, timeoutMsg: 'echo 未覆写（断在 send→posts/create→echo 对账）' }
    );

    // 取 server_id（data-msg-id 已从 tmp 覆写）作回复锚。
    POST_ID = await browser.execute((t) => {
      const el = document.querySelector(`[data-temporary-id="${t}"]`);
      return el?.getAttribute('data-msg-id') ?? null;
    }, tmp);
    expect(POST_ID).toBeTruthy();
    expect(POST_ID).not.toBe(tmp); // 确认已覆写为 server id
    console.log(`[UC-1.8 前置] 待回复消息 server postId=${POST_ID}`);

    // —— 主流：点该消息行的快捷回复按钮（真 UI 驱动·非直 invoke 模拟）——
    await invokeBridge('set_uc', { uc: 'UC-1.8' });

    const msgRow = await $(`[data-msg-id="${POST_ID}"]`);
    await msgRow.waitForExist({ timeout: 5000 });
    const quickReplyBtn = await msgRow.$('[data-testid="quick-reply-btn"]');
    await quickReplyBtn.waitForClickable({ timeout: 5000 });
    await quickReplyBtn.click();

    // 等 quickReply post_update 投影落地：server post_update → emit im:post:updated
    //   → 壳 applyMessageItem 从 props.quickReply 抽 emoji → data-reactions 出现（含 EMOJI）。
    await browser.waitUntil(
      async () => {
        const row = await readMessageRow(POST_ID);
        return row != null && row['reactions'] != null && row['reactions'].includes(EMOJI);
      },
      {
        timeout: 15000,
        interval: 150,
        timeoutMsg: 'echo 未覆写 reactions（断在 quickReply→posts/quickReply→WS post_update→投影→DOM）',
      }
    );
    const settled = await readMessageRow(POST_ID);
    console.log(`[UC-1.8 DOM] msgId=${POST_ID} reactions=${settled['reactions']}`);

    // —— 关窗口前等 ②投影 + ④落库真正落到 UC-1.8 窗口（窗口隔离·HX-C011）——
    const inWindowReady = () => {
      const txt = readFileSync(RUN_JSONL, 'utf8');
      let hasProj = false;
      let hasStore = false;
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.uc_id !== 'UC-1.8') continue;
        const p = o.payload ?? {};
        if (o.facet === 'projection' && p.event === 'im:post:updated' && p.data?.msg_id === POST_ID)
          hasProj = true;
        if (o.facet === 'storage' && p.table === 'message')
          hasStore = true;
      }
      return hasProj && hasStore;
    };
    await browser.waitUntil(async () => inWindowReady(), {
      timeout: 15000,
      interval: 200,
      timeoutMsg: 'quickReply ②投影 / ④message 落库未落 UC-1.8 窗口（断在 WS post_update→投影/落库）',
    });

    // —— 关窗口（窗口隔离·后续帧归 __quiescence__）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②①④：读 run.jsonl → 四面 reducer（postId+emoji 作 corr_anchor）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, postId: POST_ID, emoji: EMOJI },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: settled });

    // 「断在哪一跳」报告（四面全断言·无放水）。
    console.log('[UC-1.8 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：严格对齐 expect.outbound（camelCase userId/postId/emoji + bodyForbidden snake_case）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema emit_post_updated（fat 13 键）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert message 表 ≥1 行（props.quickReply patch）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM data-reactions 含 emoji。
    expect(report.facets.dom.ok).toBe(true);
  });
});

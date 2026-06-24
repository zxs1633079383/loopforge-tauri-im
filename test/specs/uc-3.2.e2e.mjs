// UC-3.2 单条消息已读 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；Phase 1 意图契约（UI 接线待 Phase 2）。
// 流程：已存在消息 → 点消息标记已读 → HTTP post/read → WS post_read echo →
//       readBits 覆盖 → 投影 im:post:read emit → DOM data-read-bits 更新。
//
// 注意：本 UC 的最简 UI 触发件**尚不存在**（Phase 2 才接线）。现阶段 spec
// 针对**意图中的 data-* 契约**编写（选择器/属性按设计的契约）。跑时会红（UI 无此交互），
// Phase 2 接线后转绿——这是正常的，spec 本身是契约的一部分。
//
// 时序纪律（HX-C011）：一律 waitUntil 等条件，不用固定 pause 猜 settle。
// 超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape，或真 go 一轮
//   - debug-only invoke `set_uc` / `im_mark_read` 已注册（待 Phase 2）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-3.2.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

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

// 读目标消息行的 data-* 终态（锚 [data-msg-id=msgId]）。
const readMessageRow = (msgId) =>
  browser.execute((mid) => {
    const el = document.querySelector(`[data-msg-id="${mid}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'read-bits': ds.readBits ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      _msgId: mid,
    };
  }, msgId);

describe('UC-3.2 · 单条消息已读（四面契约）', () => {
  let CHANNEL_ID;
  let MSG_ID; // 将要标记已读的消息 ID

  before(async () => {
    // 就绪 probe（spec §3.1 / four-facet-oracle §2）：等 data-ready 标志
    //   = increment_channel_end 收齐 + HTTP inflight==0 + cursor 稳。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    // 取当前频道 id 和一条已存在的消息 id（假设首屏已有消息）。
    const env = await browser.execute(() => ({
      channelId: document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel'),
      firstMsgId: document.querySelector('[data-msg-id]')?.getAttribute('data-msg-id'),
    }));
    CHANNEL_ID = env.channelId;
    MSG_ID = env.firstMsgId;

    expect(MSG_ID).toBeTruthy();
    console.log(`[UC-3.2 就绪] channelId=${CHANNEL_ID}, targetMsgId=${MSG_ID}`);

    // 开 UC 窗口（debug-only set_uc 注入）→ 窗口内帧/投影归 UC-3.2。
    await invokeBridge('set_uc', { uc: 'UC-3.2' });
  });

  it('①②③④：点消息标记已读 + post/read 出站 + 投影字段集 + 落库 + DOM 更新', async () => {
    // —— ③ DOM 主驱动：模拟点击消息（Phase 2 才有真实 UI 交互）——
    // 现阶段：假设存在 [data-msg-id=MSG_ID] 行的"已读"按钮或右键菜单触发
    // 调用 window.__lf.invoke('im_mark_read', {postId, channelId})（待 Phase 2 接线）。
    //
    // 临时方案（Phase 1 意图）：直接注入 invoke 调用（绕过 UI）。
    const markReadResult = await invokeBridge('im_mark_read', {
      postId: MSG_ID,
      channelId: CHANNEL_ID,
    });
    expect(markReadResult.ok).toBe(true);
    console.log(`[UC-3.2 invoke] im_mark_read called for postId=${MSG_ID}`);

    // 断言③：等消息行的 data-read-bits 被更新（表示已读标记生效）。
    // 期望值可能是 "1" 或 readBits bitmap（由后端定义具体格式）。
    await browser.waitUntil(
      async () => {
        const row = await readMessageRow(MSG_ID);
        return row && row['read-bits'] != null;
      },
      { timeout: 10000, interval: 150, timeoutMsg: 'DOM data-read-bits 未更新（断在 WS post_read→投影→DOM）' }
    );
    const readRow = await readMessageRow(MSG_ID);
    console.log(
      `[UC-3.2 DOM] msgId=${MSG_ID} readBits=${readRow['read-bits']} eventSeq=${readRow['event-seq']}`
    );

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer ——
    // 锚定本次 post_read 的 postId。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, postId: MSG_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: readRow });

    // 「断在哪一跳」报告。
    console.log('[UC-3.2 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：严格对齐 expect.outbound。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema emit_post_read (fat 13 键)。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert message 表 ≥1 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM data-read-bits 有值。
    expect(report.facets.dom.ok).toBe(true);
  });
});

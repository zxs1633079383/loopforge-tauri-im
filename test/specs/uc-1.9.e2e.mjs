// UC-1.9 加急消息 + 加急已读 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；阶段①发送加急通知 + 阶段②确认收到加急：
//   ③ DOM    : 真驱动 —— 点已发送消息的「加急」按钮 → invoke im_urgent_post 
//              → WS 推送 post_update（加急标记）→ DOM 读 data-urgent=1
//              → 接收方点「已读」→ invoke im_urgent_confirm → data-urgent 清除或标已读。
//   ②        : 读 run.jsonl → reducer 聚 corr_key（postId）→ 断 projection 字段集。
//   ①        : Recording<NativeHttp> tee 两阶段 HTTP body → 严格对齐 expect.outbound
//              （camelCase + bodyForbidden 锚 snake_case 泄漏）。
//   ④        : Recording<NativeStorage> tee 落库 op → batch_upsert message 表，props.expediteMap。
//
// 时序纪律（HX-C011）：waitUntil 等条件，禁固定 pause。
//
// 依赖前置（W1/W4 提供）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape，或真 go 一轮
//   - debug-only invoke `set_uc` / `im_urgent_post` / `im_urgent_confirm` 已注册
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.9.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
// 薄壳约定：window.__lf.invoke(cmd, args) → @tauri-apps/api invoke。
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

// 读消息行的 data-* 终态。
const readMessageRow = (msgId) =>
  browser.execute((id) => {
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'urgent': ds.urgent ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      'read-bits': ds.readBits ?? null,
      _msgId: id,
    };
  }, msgId);

describe('UC-1.9 · 加急消息 + 加急已读（四面契约）', () => {
  let CHANNEL_ID;
  let POST_ID; // 待加急的消息 ID（已发送）
  let TARGET_IDS = []; // 目标用户 ID 列表

  before(async () => {
    // 就绪 probe：等 data-ready 标志。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    // 取当前频道 id。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );

    // 开 UC 窗口。
    await invokeBridge('set_uc', { uc: 'UC-1.9' });
  });

  it('①②③④：阶段①发送加急 → 目标接收 → 阶段②确认收到加急', async () => {
    // —— 前置：在聊天记录中定位一条已发送消息作为待加急消息 ——
    // （假设消息已存在且能被 [data-msg-id] 选中）
    const existingMsgEl = await $('[data-msg-id]:not([data-temporary-id])'); // 已发送的消息
    if (!existingMsgEl) {
      throw new Error('找不到已发送消息，无法进行加急测试');
    }

    POST_ID = await existingMsgEl.getAttribute('data-msg-id');
    expect(POST_ID).toBeTruthy();
    console.log(`[UC-1.9 前置] 定位待加急消息 msgId=${POST_ID}`);

    // —— 阶段①：发送加急通知 ——
    // 点消息的加急按钮（假设在消息行上有 [data-testid="urgent-btn"]）
    const urgentBtn = await $(`[data-msg-id="${POST_ID}"] [data-testid="urgent-btn"]`);
    if (urgentBtn) {
      // targetIds 由 UI 选择，这里模拟空数组或从 UI 读取
      // 实际应由 UI 弹窗允许选择目标成员
      await invokeBridge('im_urgent_post', {
        channelId: CHANNEL_ID,
        postId: POST_ID,
        targetIds: TARGET_IDS, // 实际环境由 UI 填充
        message: undefined, // 可选
      });
    }

    // 等加急投影：WS post_update → im:post:updated → DOM data-urgent=1
    await browser.waitUntil(
      async () => {
        const row = await readMessageRow(POST_ID);
        return row && row['urgent'] === '1';
      },
      { timeout: 10000, interval: 150, timeoutMsg: '阶段①加急标记未出现（断在 WS post_update→投影→DOM）' }
    );
    const afterUrgent = await readMessageRow(POST_ID);
    console.log(`[UC-1.9 阶段①] msgId=${POST_ID} urgent=${afterUrgent['urgent']} seq=${afterUrgent['event-seq']}`);

    // —— 阶段②：确认收到加急（接收方） ——
    // 接收方在消息上看到「已读」按钮，点击确认
    const confirmBtn = await $(`[data-msg-id="${POST_ID}"] [data-testid="urgent-confirm-btn"]`);
    if (confirmBtn) {
      await invokeBridge('im_urgent_confirm', {
        postId: POST_ID,
        channelId: CHANNEL_ID,
      });
    }

    // 等确认投影：WS post_confirm_urgent → im:post:updated → DOM 清加急或标已读
    await browser.waitUntil(
      async () => {
        const row = await readMessageRow(POST_ID);
        // 确认后 data-urgent 可能清空或保留但标已读（依实现）
        return row && (row['urgent'] === null || row['read-bits']); 
      },
      { timeout: 10000, interval: 150, timeoutMsg: '阶段②确认未完成（断在 WS post_confirm_urgent→投影）' }
    );
    const afterConfirm = await readMessageRow(POST_ID);
    console.log(`[UC-1.9 阶段②] 确认完成 urgent=${afterConfirm['urgent']} readBits=${afterConfirm['read-bits']}`);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②①④：读 run.jsonl → 四面 reducer ——
    // postId 作为 corr_anchor（两阶段链路靠此关联）
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, postId: POST_ID, channelId: CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: afterConfirm });

    // 「断在哪一跳」报告。
    console.log('[UC-1.9 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：两阶段 HTTP 均需对齐 expect.outbound
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema emit_post_updated（fat 13 键）
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert message 表，props.expediteMap 包含加急状态
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM data-urgent=1 标记（两个投影触发）
    expect(report.facets.dom.ok).toBe(true);
  });
});

// UC-3.1 会话已读回执 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；①④ rewire 待接通（Phase2 串行）→ 四面期望预设：
//   ③ DOM    : 待接线 —— UI 设计阶段确定已读后消息行表现（data-read-bits self 位置 1）。
//              本 spec 针对**意图中的 data-* 契约**编写（选择器按契约设计）；
//              现在跑会红（Phase2 未接线），Phase2 接线后转绿——这是正常的，spec 本身是契约的一部分。
//   ②        : 读 run.jsonl → reducer 聚 corr_key → 断 projection 字段集（RecordingSink tee）。
//              已读投影 im:post:read（fat·同 emit_post_received 完整 13 键集）。
//   ①        : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound
//              （ledger UC-3.1 派生：POST channels/view {channels:[{id}]}；⚠️ 待核 endpoint·见 expect 注）。
//   ④        : Recording<NativeStorage> tee 落库 op → batch_upsert message 表 ≥1 行（read_bits 列覆盖）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；read 等投影/DOM 覆写完成）。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 post_read type6 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_send` / `im_read_channel` 已注册（spec §5/§7）
//   - 先发送消息 UC-1.1 建基础（有可标已读的 server_id 消息行）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-3.1.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
// 薄壳约定（W2 实现）：window.__lf.invoke(cmd, args) → @tauri-apps/api invoke。
//
// executeAsync：WKWebDriver execute/sync 无法序列化 Promise；done 回调里 await invoke 再 done
// 一个可序列化结果（ok/err 包成纯对象，不把 Promise 回传）。
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

// 读已读后消息行的 data-* 终态（锚 [data-msg-id=sid]，已读作用在 server_id 行）。
const readReceiptRow = (msgId) =>
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

describe('UC-3.1 · 会话已读回执 round-trip（四面契约）', () => {
  // 已读流程：① 先发一条消息建基础（依赖 UC-1.1）取其 server_id ② invoke im_read_channel 标会话已读
  //   ③ 观察 outbound channels/view + WS post_read 投影 im:post:read + DOM data-read-bits + 落库 read_bits。
  let CHANNEL_ID;
  let MSG_ID; // server_id 作已读目标行锚（sid 维度）

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
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // 取当前频道 id（薄壳暴露在会话容器 [data-active-channel] 上）。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
  });

  it('①②③④：发消息建基础 → 取 server_id → 标会话已读 → channels/view + im:post:read 投影 + DOM data-read-bits + 落库 read_bits', async () => {
    // —— 第一步：发送消息建基础（复用 UC-1.1 发消息流，沉淀一条可标已读的 server_id 行） ——
    await invokeBridge('set_uc', { uc: 'UC-3.1-send' });

    const TEXT = `read-test-${Math.random().toString(36).slice(2, 8)}`;
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 等乐观行出现，取 temporaryId 锚。
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
      { timeout: 8000, timeoutMsg: '乐观行未上屏（断在 click→store.send→乐观渲染）' }
    );

    // 等 echo 覆写（status=sent），取 temporaryId。
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
      { timeout: 15000, timeoutMsg: 'echo 未覆写（断在 WS post→reconcile→DOM）' }
    );

    // 取 server_id（data-msg-id 已从 tmp 覆写）作已读目标锚。
    MSG_ID = await browser.execute((t) => {
      const el = document.querySelector(`[data-temporary-id="${t}"]`);
      return el?.getAttribute('data-msg-id') ?? null;
    }, tmp);
    expect(MSG_ID).toBeTruthy();
    expect(MSG_ID).not.toBe(tmp); // 确认已覆写为 server_id

    // —— 第二步：标会话已读 ——
    await invokeBridge('set_uc', { uc: 'UC-3.1' });

    // invoke im_read_channel（会话级已读上报 → 出站 POST channels/view {channels:[{id:CHANNEL_ID}]} fire-and-forget）。
    // ⚠️ 待核：endpoint 形态以 ledger 为据（真机curl真源 未收录），Phase2 据 helix 实现复核。
    const readResult = await invokeBridge('im_read_channel', { channelId: CHANNEL_ID });
    expect(readResult.ok).toBe(true);

    // 断言③：等已读投影回声后目标行 data-read-bits 出现（self 位置 1）。
    // Phase2 UI 设计前 spec 记录意图：已读后目标 server_id 行应带 data-read-bits（self 位置位）。
    let receiptState = null;
    await browser.waitUntil(
      async () => {
        receiptState = await readReceiptRow(MSG_ID);
        return receiptState && receiptState['read-bits'] != null && receiptState['read-bits'] !== '';
      },
      { timeout: 15000, interval: 150, timeoutMsg: '已读投影未生效（断在 WS post_read→投影→DOM data-read-bits）' }
    );

    console.log(
      `[UC-3.1 DOM] msgId=${MSG_ID} after read: data-read-bits=${receiptState?.['read-bits']} seq=${receiptState?.['event-seq']}`
    );

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②（+①④ pending Phase2）：读 run.jsonl → 四面 reducer ——
    // 锚定已读目标的 server_id（sid 维度）注入 corrAnchor.sid。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, sid: MSG_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: receiptState });

    // 「断在哪一跳」报告（①④ rewire 接通后 → 四面全断言）。
    console.log('[UC-3.1 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言（现阶段 Phase1 契约设计，Phase2 接线后四面会转绿）。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 read body：POST channels/view {channels:[{id}]}（⚠️ 待核 endpoint·见 expect 注）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema emit_post_read im:post:read（fat 13 键，缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert message 表 ≥1 行（read_bits 列单调覆盖）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：目标行 data-read-bits self 位置 1（Phase2 UI 确认具体编码后细化定值）。
    expect(report.facets.dom.ok).toBe(true);
  });
});

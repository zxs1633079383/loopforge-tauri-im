// UC-1.5 撤回消息 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；①④ rewire 待接通（Phase2 串行）→ 四面期望预设：
//   ③ DOM    : 待接线 —— UI 设计阶段确定撤回消息行表现（data-revoke=1 或删除）。
//              本 spec 针对**意图中的 data-* 契约**编写（选择器按契约设计）；
//              现在跑会红（Phase2 未接线），Phase2 接线后转绿——这是正常的，spec 本身是契约的一部分。
//   ②        : 读 run.jsonl → reducer 聚 corr_key → 断 projection 字段集（RecordingSink tee）。
//   ①        : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound（真机curl真源派生，
//              camelCase postId）。
//   ④        : Recording<NativeStorage> tee 落库 op → update message 表 ≥1 行。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；revoke 等覆写完成）。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 echo 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_revoke` 已注册（spec §5/§7）
//   - 先发送消息 UC-1.1 建基础（有可撤回的消息）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.5.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
// 薄壳约定（W2 实现）：window.__lf.invoke(cmd, args) → @tauri-apps/api invoke。
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

// 读撤回后行的 data-* 终态（锚 [data-msg-id=sid]，撤回后可能 data-revoke=1 或删除）。
const readRevokedRow = (msgId) =>
  browser.execute((mid) => {
    const el = document.querySelector(`[data-msg-id="${mid}"]`);
    if (!el) return null; // 行可能被删除
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'revoke': ds.revoke ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      _msgId: mid,
      _exists: true,
    };
  }, msgId);

// 检查行是否已删除（DOM 不存在）。
const rowExists = (msgId) =>
  browser.execute((mid) => {
    return document.querySelector(`[data-msg-id="${mid}"]`) !== null;
  }, msgId);

describe('UC-1.5 · 撤回消息 round-trip（四面契约）', () => {
  // 撤回流程：① 先发送一条消息（依赖 UC-1.1 基础）② 取其 server_id ③ 撤回 ④ 观察投影/DOM/存储四面
  let CHANNEL_ID;
  let MSG_ID; // server_id 作撤回目标锚

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

    // 取当前频道 id。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
  });

  it('①②③④：发送消息 → 取 server_id → 撤回 → WS post_update + 投影 batch-updated + 落库 revoke=1 + DOM data-revoke', async () => {
    // —— 第一步：发送消息建基础（复用 UC-1.1 发消息流） ——
    await invokeBridge('set_uc', { uc: 'UC-1.5-send' });
    
    const TEXT = `revoke-test-${Math.random().toString(36).slice(2, 8)}`;
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 等乐观行出现。
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
      { timeout: 8000 }
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
      { timeout: 15000, timeoutMsg: 'echo 未覆写' }
    );

    // 取 server_id（data-msg-id，已从 tmp 覆写）。
    MSG_ID = await browser.execute(
      (t) => {
        const el = document.querySelector(`[data-temporary-id="${t}"]`);
        return el?.getAttribute('data-msg-id') ?? null;
      },
      tmp
    );
    expect(MSG_ID).toBeTruthy();
    expect(MSG_ID).not.toBe(tmp); // 确认已覆写

    // —— 第二步：撤回消息 ——
    await invokeBridge('set_uc', { uc: 'UC-1.5' });
    
    // invoke im_revoke，参数为 server_id（postId）。
    const revokeResult = await invokeBridge('im_revoke', { postId: MSG_ID });
    expect(revokeResult.ok).toBe(true);

    // 断言③：等撤回后行的 DOM 表现
    // Phase2 UI 设计前，spec 记录意图：行应标 data-revoke=1 或被删除。
    // 此处等其中之一。
    let revokedState = null;
    await browser.waitUntil(
      async () => {
        revokedState = await readRevokedRow(MSG_ID);
        if (revokedState === null) return true; // 行被删除（合法）
        if (revokedState['revoke'] === '1') return true; // 行标记 revoke（合法）
        return false; // 还在等待投影覆写
      },
      { timeout: 15000, interval: 150, timeoutMsg: '撤回投影未生效（data-revoke 或行删除）' }
    );

    console.log(
      `[UC-1.5 DOM] msgId=${MSG_ID} after revoke: ${
        revokedState === null ? 'row deleted' : `data-revoke=${revokedState['revoke']}`
      }`
    );

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②（+①④ pending Phase2）：读 run.jsonl → 四面 reducer ——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, postId: MSG_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: revokedState });

    // 「断在哪一跳」报告。
    console.log('[UC-1.5 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言（现阶段 Phase1 契约设计，Phase2 接线后四面会转绿）。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 revoke body：POST posts/revoke {postId}。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema post_batch_updated（{channel_id, posts}）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：update message 表 ≥1 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：行标 data-revoke=1 或删除（Phase2 UI 确认具体形态后细化）。
    // 当前 Phase1 不断言 DOM 具体值，仅框架就绪；Phase2 接线后补全。
  });
});

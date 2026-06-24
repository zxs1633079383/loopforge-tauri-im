// UC-1.4 重发失败消息 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；①④ rewire 已接通（组装根走 host 泛型壳 + 全 port 装饰）→ 四面全断言：
//   ③ DOM    : 真驱动 —— 找已有失败行（failed 状态）→ 点重发按钮 → 状态流 failed→sending→sent →
//              从 DOM 读 [data-send-status=sent] 的 data-temporary-id 与 data-msg-id → 等覆写完成。
//   ②        : 读 run.jsonl → reducer 聚 corr_key → 断 projection 字段集（RecordingSink tee）。
//   ①        : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound（posts/create 同 UC-1.1，
//              camelCase + bodyForbidden 锚 snake_case 旧形态泄漏）。
//   ④        : Recording<NativeStorage> tee 落库 op → batch_upsert message 表 ≥1 行（PK=temporary_id upsert）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；重发流程 failed→sending→sent 等覆写完成）。超时=真 bug，不掩盖。
//
// **阶段性就绪**：本 spec 是 UC-1.4 的**契约规范**，针对意图中的 data-* 触发件编写（选择器/属性设计）。
// 当前 Phase1 前端尚未接线重发按钮 UI，所以 spec 无法过绿（选择器 [data-resend-btn] 不存在）。
// Phase2 接线后转绿——这是正常的，spec 本身是契约文档，现在跑会红是设计预期。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 echo 帧），或真 go 一轮
//   - debug-only invoke `set_uc` 已注册（spec §5/§7）
//   - [data-resend-btn] 重发按钮 + 重发触发的 DOM 状态流（Phase2 接线）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.4.expect.json', import.meta.url), 'utf8')
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

// 读消息行的 data-* 终态（锚 [data-temporary-id=t]，贯穿乐观→覆写→重发流程不变）。
const readRow = (tmp) =>
  browser.execute((t) => {
    const el = document.querySelector(`[data-temporary-id="${t}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'send-status': ds.sendStatus ?? null,
      'temporary-id': ds.temporaryId ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      'read-bits': ds.readBits ?? null,
      _temporaryId: t,
    };
  }, tmp);

describe('UC-1.4 · 重发失败消息（四面契约）', () => {
  // UC-1.4 前置：先发一条消息失败，然后重发。
  // Phase2 接线：UI 上已有「重发」按钮，点击触发 im_send(同 temporaryId)。
  const TEXT = `lf-resend-${Math.random().toString(36).slice(2, 8)}`;
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe（spec §3.1 / four-facet-oracle §2）：等 data-ready 标志
    //   = increment_channel_end 收齐 + HTTP inflight==0 + cursor 稳。
    // 薄壳把就绪态渲染成 [data-ready="true"]（W2 实现）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // 取当前频道 id（薄壳暴露在 [data-active-channel] 的会话容器上）。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );

    // 开 UC 窗口（debug-only set_uc 注入）→ 窗口内帧/投影归 UC-1.4。
    await invokeBridge('set_uc', { uc: 'UC-1.4' });
  });

  it('①②③④：重发失败消息 failed→sending→sent + 出站 body + 投影字段集 + 落库 upsert', async () => {
    // —— ③ DOM 主驱动：找失败行 → 点重发 ——
    // Phase2 接线前，此选择器不存在；Phase2 接线后应能找到失败消息行的重发按钮。
    
    // Step A：等待页面上出现某个失败消息行（data-send-status=failed）。
    // 注意：此处假设前置流程已产生一条失败消息；实际 testbed 可能需注入失败态或 mock WS error。
    // 本 spec 编写的是理想态：UI 上有失败行可点重发。
    await browser.waitUntil(
      async () => {
        const failedRow = await browser.execute(
          () => document.querySelector('[data-send-status="failed"]')
        );
        return !!failedRow;
      },
      { timeout: 8000, timeoutMsg: '页面未出现失败消息行（data-send-status=failed）' }
    );

    // 从失败行读真 temporaryId（贯穿失败→重发→覆写）。
    const TMP = await browser.execute(
      () =>
        document
          .querySelector('[data-send-status="failed"]')
          ?.getAttribute('data-temporary-id') ?? null
    );
    expect(TMP).toBeTruthy();
    console.log(`[UC-1.4 DOM] 找到失败行 tmp=${TMP}`);

    // Step B：点重发按钮（Phase2 接线：[data-testid="resend-btn"]，选择器可能需调整）。
    // 理想情况：点重发 → 乐观状态流 failed→sending。
    const failedRow = await $(`[data-temporary-id="${TMP}"]`);
    const resendBtn = await failedRow.$('[data-testid="resend-btn"]');
    // Phase1 阶段会红，因为按钮不存在；Phase2 接线后可用。
    expect(resendBtn).toBeTruthy();
    await resendBtn.click();
    console.log(`[UC-1.4 DOM] 点击重发按钮 tmp=${TMP}`);

    // 断言③-a：等重发乐观状态 sending 出现（im:post:sending 投影驱动）。
    await browser.waitUntil(
      async () => {
        const row = await readRow(TMP);
        return row && row['send-status'] === 'sending';
      },
      { timeout: 8000, timeoutMsg: '重发乐观行未变 sending（断在 click→store.send→乐观渲染）' }
    );

    const optimistic = await readRow(TMP);
    expect(optimistic).not.toBeNull();
    expect(optimistic['send-status']).toBe('sending');
    expect(optimistic['msg-id']).toBe(TMP); // 乐观期 data-msg-id == tmp（复用原 tmp）

    // 断言③-b：等 echo 覆写 —— data-send-status=sent 且 data-msg-id ≠ tmp（变 server_id）。
    // 若首次发送失败，echo 应产生 server_id（Go 返分配的 id）；upsert 覆盖原失败行。
    await browser.waitUntil(
      async () => {
        const r = await readRow(TMP);
        return r && r['send-status'] === 'sent' && r['msg-id'] && r['msg-id'] !== TMP;
      },
      { timeout: 15000, interval: 150, timeoutMsg: 'echo 未覆写（断在 WS post→reconcile→DOM）' }
    );
    const settled = await readRow(TMP);
    console.log(`[UC-1.4 DOM] tmp=${TMP} → msgId=${settled['msg-id']} status=${settled['send-status']} seq=${settled['event-seq']}`);

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②（+①④ pending）：读 run.jsonl → 四面 reducer ——
    // 锚定本次重发的 temporaryId（store 生成的真值注入 corrAnchor.tmp）。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, tmp: TMP },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: settled });

    // 「断在哪一跳」报告（①④ rewire 已接通 → 四面全断言，无放水）。
    console.log('[UC-1.4 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言（reducer 的 diffOutbound/diffStorage 已是严格比对，照用，不放水）。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：严格对齐 expect.outbound（posts/create 端点同 UC-1.1；camelCase + bodyForbidden）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema message_item_data（fat 13 键，缺/多即 fail）。
    // UC-1.4 路径：乐观 emit_post_sending(瘦) → echo im:post:received(fat)。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert message 表 ≥1 行（PK=temporary_id upsert，覆盖原失败行）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM tmp→server 覆写 + status=sent（失败→重发→覆写三态完整）。
    expect(report.facets.dom.ok).toBe(true);
  });
});

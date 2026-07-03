// UC-1.4 重发失败消息 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；UC-1.4 的失败态必须来自真实 HTTP failpoint → helix 失败投影/落库：
//   ③ DOM    : 真驱动 —— 填字 + 点 [data-testid=send-btn] → failpoint 让首次 posts/create 失败 →
//              等真实 failed 行 → 点行内 [data-testid=resend-btn] → 同 temporaryId failed→sending→sent。
//   ②        : 读 run.jsonl → 断 im:post:send-failed 与最终 im:post:received 都在 UC 窗口。
//   ①        : Recording<NativeHttp> tee 出站 body → 断两次 posts/create 复用同 temporaryId。
//   ④        : Recording<NativeStorage> tee 落库 op → 断失败写与最终 sent upsert 都绑定同 temporaryId。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件。
// 超时=真 bug，不用 sleeps 造假。

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { parseJsonl, runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.4.expect.json', import.meta.url), 'utf8')
);

const UC_ID = 'UC-1.4';

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
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

// 读消息行的 data-* 与可见正文（锚 [data-temporary-id=t]，贯穿 failed→sending→sent 不变）。
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
      text: el.querySelector('.msg__text')?.textContent?.trim() ?? '',
      _temporaryId: t,
    };
  }, tmp);

const findFailedRowByText = (text) =>
  browser.execute((expectedText) => {
    const rows = [...document.querySelectorAll('[data-send-status="failed"][data-temporary-id]')];
    const row = rows.find(
      (el) => el.querySelector('.msg__text')?.textContent?.trim() === expectedText
    );
    if (!row) return null;
    const ds = row.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'send-status': ds.sendStatus ?? null,
      'temporary-id': ds.temporaryId ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      'read-bits': ds.readBits ?? null,
      text: row.querySelector('.msg__text')?.textContent?.trim() ?? '',
      _temporaryId: ds.temporaryId ?? null,
    };
  }, text);

const eventTmp = (ev) =>
  ev.payload?.temporaryId ??
  ev.payload?.temporary_id ??
  ev.payload?.body?.temporaryId ??
  ev.payload?.body?.temporary_id ??
  ev.payload?.data?.temporaryId ??
  ev.payload?.data?.temporary_id ??
  null;

const rowCount = (payload) => Number(payload?.rows ?? payload?.keys ?? 0);

function assertUc14JsonlEvidence(jsonl, tmp, text, channelId) {
  const parsed = parseJsonl(jsonl);
  expect(parsed.parseErrors.length).toBe(0);
  const events = parsed.events.filter((ev) => ev.uc_id === UC_ID);

  const attempts = events.filter(
    (ev) =>
      ev.facet === 'outbound' &&
      ev.hop === 'http-req' &&
      String(ev.payload?.url ?? '').endsWith('posts/create') &&
      ev.payload?.body?.temporaryId === tmp
  );
  expect(attempts.length).toBe(2);
  expect(new Set(attempts.map((ev) => ev.payload?.body?.temporaryId)).size).toBe(1);
  expect(attempts.every((ev) => ev.payload?.body?.message === text)).toBe(true);

  const failedProjection = events.find(
    (ev) =>
      ev.facet === 'projection' &&
      ev.hop === 'projection' &&
      ev.payload?.event === 'im:post:send-failed' &&
      ev.payload?.data?.temporaryId === tmp
  );
  expect(failedProjection).toBeTruthy();
  expect(failedProjection.payload.data.sendStatus).toBe('failed');
  expect(failedProjection.payload.data.channelId).toBe(channelId);

  const sentProjection = events.find(
    (ev) =>
      ev.facet === 'projection' &&
      ev.hop === 'projection' &&
      ev.payload?.event === EXPECT.projection.event &&
      ev.payload?.data?.temporaryId === tmp
  );
  expect(sentProjection).toBeTruthy();
  expect(sentProjection.payload.data.sendStatus).toBe('sent');
  expect(sentProjection.payload.data.msg_id).toBeTruthy();
  expect(sentProjection.payload.data.msg_id).not.toBe(tmp);

  const messageWrites = events.filter(
    (ev) =>
      ev.facet === 'storage' &&
      ev.hop === 'storage' &&
      ev.payload?.table === EXPECT.storage.table &&
      eventTmp(ev) === tmp &&
      rowCount(ev.payload) >= 1
  );
  const failedWrite = messageWrites.find(
    (ev) =>
      ev.seq <= failedProjection.seq &&
      ['batch_update', 'batch_upsert'].includes(ev.payload?.op)
  );
  const sentWrite = messageWrites.find(
    (ev) =>
      ev.seq > attempts[1].seq &&
      ev.payload?.op === EXPECT.storage.op
  );
  expect(failedWrite).toBeTruthy();
  expect(sentWrite).toBeTruthy();
}

describe('UC-1.4 · 重发失败消息（四面契约）', () => {
  const TEXT = `lf-resend-${Date.now()}`;
  let CHANNEL_ID;

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

    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
    expect(CHANNEL_ID).toBeTruthy();

    // 开 UC 窗口（debug-only set_uc 注入）→ 首次发送失败、重发、最终 echo 都归 UC-1.4。
    await invokeBridge('set_uc', { uc: UC_ID });
  });

  it('①②③④：真实失败行 → 重发同 temporaryId → sent 覆写', async () => {
    // —— ③ DOM 主驱动：主动发送一条新消息，Task 2 failpoint 让首次 posts/create 真实失败 ——
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 断言③-a：等 helix 失败投影驱动出的 failed 行。必须是本次文本，且带 channelId/tmp。
    await browser.waitUntil(
      async () => {
        const row = await findFailedRowByText(TEXT);
        return !!row?.['temporary-id'] && !!row?.['channel-id'];
      },
      {
        timeout: 10000,
        interval: 150,
        timeoutMsg:
          '未出现真实 failed 行（断在 failpoint→helix im:post:send-failed→DOM；若 helix 未 pin 到 a285f23 属 Task 7 前置）',
      }
    );
    const failed = await findFailedRowByText(TEXT);
    expect(failed).not.toBeNull();
    expect(failed.text).toBe(TEXT);
    expect(failed['send-status']).toBe('failed');
    expect(failed['channel-id']).toBeTruthy();
    expect(failed['channel-id']).toBe(CHANNEL_ID);
    const TMP = failed['temporary-id'];
    expect(TMP).toBeTruthy();
    console.log(`[UC-1.4 DOM] 首次真实失败 tmp=${TMP} channel=${failed['channel-id']}`);

    // —— ③ DOM 主驱动：点击 failed 行内真实重发按钮 ——
    const failedRow = await $(`[data-temporary-id="${TMP}"][data-send-status="failed"]`);
    const resendBtn = await failedRow.$('[data-testid="resend-btn"]');
    expect(await resendBtn.isExisting()).toBe(true);
    await resendBtn.click();
    console.log(`[UC-1.4 DOM] 点击重发按钮 tmp=${TMP}`);

    // 断言③-b：同一 temporaryId 从 failed 拨回 sending。
    await browser.waitUntil(
      async () => {
        const row = await readRow(TMP);
        return row && row['send-status'] === 'sending';
      },
      { timeout: 8000, interval: 100, timeoutMsg: '重发后同 tmp 行未进入 sending（断在 resendClick→store.resend）' }
    );
    const resending = await readRow(TMP);
    expect(resending).not.toBeNull();
    expect(resending.text).toBe(TEXT);
    expect(resending['send-status']).toBe('sending');
    expect(resending['channel-id']).toBe(CHANNEL_ID);

    // 断言③-c：同一 temporaryId 最终 sent，且 data-msg-id 从 tmp 覆写为 server id。
    await browser.waitUntil(
      async () => {
        const row = await readRow(TMP);
        return row && row['send-status'] === 'sent' && row['msg-id'] && row['msg-id'] !== TMP;
      },
      { timeout: 15000, interval: 150, timeoutMsg: '重发 echo 未覆写（断在 posts/create→WS post→DOM）' }
    );
    const settled = await readRow(TMP);
    expect(settled).not.toBeNull();
    expect(settled.text).toBe(TEXT);
    expect(settled['channel-id']).toBe(CHANNEL_ID);
    console.log(`[UC-1.4 DOM] tmp=${TMP} → msgId=${settled['msg-id']} status=${settled['send-status']} seq=${settled['event-seq']}`);

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ①②④：读 run.jsonl → UC-1.4 专属多阶段断言 + 通用四面 reducer 终态断言 ——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, tmp: TMP },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    assertUc14JsonlEvidence(jsonl, TMP, TEXT, CHANNEL_ID);

    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: settled });
    console.log('[UC-1.4 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    expect(report.facets.outbound.ok).toBe(true);
    expect(report.facets.projection.ok).toBe(true);
    expect(report.facets.storage.ok).toBe(true);
    expect(report.facets.dom.ok).toBe(true);
  });
});

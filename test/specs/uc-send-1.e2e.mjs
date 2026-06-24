// UC-send-1 发消息 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）：
//   ③ DOM    : 真驱动 —— 填字点发 → 乐观行 [data-temporary-id=t] data-send-status=sending
//              → 等 echo → data-msg-id 从 tmp 变 server、status=sent（WebdriverIO 直读）。
//   ①②④    : 读 run.jsonl → 四面 reducer 聚 corr_key → 断 outbound body / projection 字段集 / storage 落行。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；echo 等覆写完成）。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 echo 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_send` 已注册（spec §5/§7）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-send-1.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
// 薄壳约定（W2 实现）：window.__lf.invoke(cmd, args) → @tauri-apps/api invoke。
const invokeBridge = (cmd, args) =>
  browser.execute(
    async (c, a) => {
      // @ts-ignore — 薄壳注入
      return window.__lf?.invoke ? window.__lf.invoke(c, a) : Promise.reject('no __lf bridge');
    },
    cmd,
    args
  );

// 读乐观/覆写行的 data-* 终态（锚 [data-temporary-id=t]，贯穿乐观→覆写不变）。
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

describe('UC-send-1 · 发消息 round-trip（四面契约）', () => {
  // 薄壳生成 temporaryId；这里固定一个测试值（e2e 控制，便于 corr_key 锚定）。
  const TMP = `t-e2e-${Date.now()}`;
  const TEXT = `lf-${Math.random().toString(36).slice(2, 8)}`;
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

    // 取当前频道 id（薄壳暴露在 [data-channel-id] 的会话容器上）。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );

    // 开 UC 窗口（debug-only set_uc 注入）→ 窗口内帧/投影归 UC-send-1。
    await invokeBridge('set_uc', { uc: 'UC-send-1' });
  });

  it('乐观上屏 → echo tmp→server 覆写 + 四面全绿', async () => {
    // —— ③ DOM 主驱动：填字 + 点发 ——
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    // 薄壳约定：发送走 im_send({channelId,text,temporaryId})；e2e 注入固定 TMP 便于锚定。
    await invokeBridge('im_send', { channelId: CHANNEL_ID, text: TEXT, temporaryId: TMP });

    // 断言③-a：立刻出现乐观行，data-send-status=sending、data-msg-id=tmp。
    await browser.waitUntil(async () => (await readRow(TMP)) != null, {
      timeout: 8000,
      timeoutMsg: '乐观行未上屏（断在 invoke→乐观渲染）',
    });
    const optimistic = await readRow(TMP);
    expect(optimistic['send-status']).toBe('sending');
    expect(optimistic['msg-id']).toBe(TMP);

    // 断言③-b：等 echo 覆写 —— data-send-status=sent 且 data-msg-id ≠ tmp（变 server_id）。
    await browser.waitUntil(
      async () => {
        const r = await readRow(TMP);
        return r && r['send-status'] === 'sent' && r['msg-id'] && r['msg-id'] !== TMP;
      },
      { timeout: 15000, interval: 150, timeoutMsg: 'echo 未覆写（断在 WS post→reconcile→DOM）' }
    );
    const settled = await readRow(TMP);
    console.log(`[UC-send-1 DOM] tmp=${TMP} → msgId=${settled['msg-id']} status=${settled['send-status']} seq=${settled['event-seq']}`);

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ①②④：读 run.jsonl → 四面 reducer ——
    // 锚定本次 send 的 temporaryId（corrAnchor.tmp 注入 e2e 真值）。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, tmp: TMP },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: settled });

    // 「断在哪一跳」报告（绿=四面齐）。
    console.log('[UC-send-1 四面报告] ' + report.summary);
    if (!report.green) {
      for (const f of ['outbound', 'projection', 'storage', 'dom']) {
        if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
      }
    }

    // 四面全绿断言（任一面偏离即 fail；reducer 已定位断点）。
    expect(report.parseErrors.length).toBe(0);
    expect(report.facets.outbound.ok).toBe(true); // ① body 对齐真机curl真源 send
    expect(report.facets.projection.ok).toBe(true); // ② 投影字段集 == projection-schema message_item_data
    expect(report.facets.storage.ok).toBe(true); // ④ message 落行
    expect(report.facets.dom.ok).toBe(true); // ③ tmp→server 覆写
    expect(report.brokenAt).toBe(null);
    expect(report.green).toBe(true);
  });
});

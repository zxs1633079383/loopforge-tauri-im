// UC-4.1 hello 全量增量 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-4.1 是 rollout 的「就绪根」：WS hello 握手后引擎自驱 channels/load/increment 全量增量，
// 无前端命令触发（≠ 发送 round-trip）。e2e 不点按钮——只等自驱链路落定，再读四面对账。
//
// 串四面（issue #7 锚点 · 契约只读 expect/uc-4.1.expect.json）：
//   ③ DOM    : 等 data-ready=true（store.ready() probe im_ready：increment_channel_end 收齐 +
//              inflight0 + cursor 稳）+ 至少一行 data-channel-id（store.channels() 由
//              im:channel:increment 投影填）。读 [data-ready] + 目标 [data-channel-id] 行注入 reducer。
//   ②        : 读 run.jsonl → reducer 按 ch 聚 → 断 im:channel:increment 投影字段集 {channel_id, increment}。
//   ④        : 落库 batch_upsert channel ≥1 行（cursor monotonic_upsert channel_event_cursor 旁证）。
//   ①        : POST channels/load/increment，body {timestamp, cursors:[{channelId, fromSeq}]}（camelCase）。
//              ⚠️ 见 expect.outbound._note AMBIGUITY：batch 出站无单 channel corr_key，
//              current reducer（per-corr_key 束）抽不到 ch → outbound 落 unkeyed 束、不进目标束 →
//              ① 面在 reducer 下预期红（非 wire 缺陷·待人审决策 reducer batch 面 / 装饰器 cursors 探针）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - 真 go 一轮（或金标 tape 回放）—— hello 自驱增量需真后端推 increment_channel 帧
//   - debug-only invoke set_uc 已注册
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-4.1.expect.json', import.meta.url), 'utf8')
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

// 读某 channel 行的 data-* + 容器 data-ready（③ 注入 reducer 的 DOM 面）。
const readChannelDom = (channelId) =>
  browser.execute((id) => {
    const ready =
      document.querySelector('[data-ready]')?.getAttribute('data-ready') ?? null;
    const row = document.querySelector(`[data-channel-id="${id}"]`);
    return {
      ready,
      'channel-id': row?.getAttribute('data-channel-id') ?? null,
    };
  }, channelId);

describe('UC-4.1 · hello 全量增量（四面契约·就绪根）', () => {
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe：等 data-ready=true（increment_channel_end 收齐 + inflight0 + cursor 稳）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳·断在 hello→increment 自驱链）' }
    );

    // 开 UC 窗口（窗口内帧/投影归 UC-4.1）。注：增量帧多在就绪前已流过——故本 UC 的对账靠
    // 整 run.jsonl（reducer 按 uc_id 过滤；hello 自驱帧若早于 set_uc 则 uc_id 非 UC-4.1，
    // 这是 UC-4.1 与发送族的本质差异，记于 expect._note 与 ledger，留人审是否需 set_uc 前置到引擎启动）。
    await invokeBridge('set_uc', { uc: 'UC-4.1' });
  });

  it('①②③④：hello 自驱增量 → 投影 + 落库 + DOM channel 行 + 出站 increment', async () => {
    // —— ③ DOM：等至少一行 data-channel-id 渲染（store.channels() 由 im:channel:increment 填）——
    await browser.waitUntil(
      async () => {
        const id = await browser.execute(
          () =>
            document.querySelector('[data-channel-id]')?.getAttribute('data-channel-id') ?? null
        );
        return !!id;
      },
      { timeout: 15000, interval: 200, timeoutMsg: 'CL 区无 channel 行（断在 im:channel:increment→store.channels→DOM）' }
    );
    CHANNEL_ID = await browser.execute(
      () =>
        document.querySelector('[data-channel-id]')?.getAttribute('data-channel-id') ?? null
    );
    expect(CHANNEL_ID).toBeTruthy();
    console.log(`[UC-4.1 DOM] 目标 channelId=${CHANNEL_ID}`);

    const domFacet = await readChannelDom(CHANNEL_ID);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（ch 作锚）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-4.1 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ② 投影字段集 == emit_channel_increment {channel_id, increment}（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert channel ≥1 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：data-ready=true + channel 行 data-channel-id 非空。
    expect(report.facets.dom.ok).toBe(true);
    // ① 出站：channels/load/increment body 形态（camelCase·cursors）。
    //    ⚠️ batch-outbound 无单 channel corr_key → 当前 reducer 抽不到 ch、不进目标束 → 预期红
    //    （见 expect.outbound._note）。断言保留以诚实暴露结构 gap（C011 出账·非 tautology 放水）；
    //    人审落地 reducer batch 面 / 装饰器 cursors 探针后转绿。
    expect(report.facets.outbound.ok).toBe(true);
  });
});

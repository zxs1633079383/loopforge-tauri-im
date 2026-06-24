// UC-1.10 定时消息 create e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；①④ rewire 待 Phase2（UI 接线未完成）→ spec 编写按意图契约：
//   ③ DOM    : 触发 schedule-created 的乐观态与 echo 覆写（Phase2 实现时接线）
//   ②        : 读 run.jsonl → reducer 聚 corr_key → 断 projection 字段集（channel:schedule-created）。
//   ①        : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound。
//   ④        : Recording<NativeStorage> tee 落库 op → update channel 表（has_schedule_post=true）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；echo 等覆写完成）。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W2 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 echo 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_create_schedule` 已注册（spec §5/§7）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）
//
// ⚠️ Phase2 待实现：
//   - 前端「定时发送」UI 组件 + composer 输入框交互（选择延迟时间）
//   - [data-schedule-compose] 触发节点（选择器锚）
//   - [data-has-schedule-post] channel 节点属性绑定
//   - im:__bus__ listen 解 channel:schedule-created payload → DOM 更新逻辑

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.10.expect.json', import.meta.url), 'utf8')
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

// 读 channel 行的 data-* 终态（锚 [data-channel-id=ch]，贯穿乐观→覆写不变）。
const readChannelRow = (ch) =>
  browser.execute((c) => {
    const el = document.querySelector(`[data-channel-id="${c}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'has-schedule-post': ds.hasSchedulePost ?? null,
      'channel-id': ds.channelId ?? null,
      _channelId: c,
    };
  }, ch);

describe('UC-1.10 · 定时消息 create（四面契约）', () => {
  // schedule 时间戳：当前时间 + 1 小时（毫秒）。
  const NOW = Date.now();
  const SCHEDULE_POST_AT = NOW + 3600 * 1000;
  const MESSAGE = `lf-schedule-${Math.random().toString(36).slice(2, 8)}`;
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

    // 开 UC 窗口（debug-only set_uc 注入）→ 窗口内帧/投影归 UC-1.10。
    await invokeBridge('set_uc', { uc: 'UC-1.10' });
  });

  it('①②③④：定时发送 → schedule-created echo + hasSchedulePost flag', async () => {
    // —— ③ DOM 主驱动（Phase2 待实现）：打开定时 compose 面板 + 输入 + 选择延迟 + 点发送 ——
    // 本 spec 编写时 UI 接线未完成，此处选择器/触发流程为「意图契约」，
    // Phase2 实现时按实际 DOM 结构替换。
    
    // 假设 compose 面板结构（Phase2 实现后调整）：
    //   <div data-schedule-compose>
    //     <input data-schedule-message />
    //     <input data-schedule-delay-ms type="number" />
    //     <button data-schedule-send-btn>发送</button>
    //   </div>
    
    // 当前跳过交互（Phase2 实现），直接调 invoke 驱动后端链路验证前三面（①②④）；
    // ③ DOM 由 Phase2 补齐接线后转绿。
    
    // 方案 A：mock invoke 预期的参数集（现阶段验证 ①②④）
    const scheduleResult = await invokeBridge('im_create_schedule', {
      channel_id: CHANNEL_ID,
      message: MESSAGE,
      schedule_post_at: SCHEDULE_POST_AT,
      temporary_id: `sch-${Math.random().toString(36).slice(2, 8)}`, // 可选
    });
    expect(scheduleResult.ok).toBe(true);

    // ③ DOM 乐观态预期（Phase2 实现接线后真实验证）：
    // 等 schedule-created 投影 → DOM 更新逻辑 binding [data-has-schedule-post=true] 到 channel 行。
    // 当前仅作意图编写，现阶段 skip（Phase2 转绿）。
    console.log('[UC-1.10] waiting for schedule-created echo & DOM update...');
    await browser.waitUntil(
      async () => {
        const row = await readChannelRow(CHANNEL_ID);
        return row && row['has-schedule-post'] === 'true';
      },
      {
        timeout: 10000,
        interval: 150,
        timeoutMsg: 'schedule-created echo 未覆写 DOM（断在 WS post_schedule_created→投影→DOM binding）— Phase2 待接线',
      }
    );
    const settled = await readChannelRow(CHANNEL_ID);
    console.log(`[UC-1.10 DOM] channelId=${CHANNEL_ID} hasSchedulePost=${settled['has-schedule-post']}`);

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②（+①④ pending）：读 run.jsonl → 四面 reducer ——
    // 锚定本次 schedule create 的 channelId（invoke 参数的真值注入 corrAnchor.ch）。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: settled });

    // 「断在哪一跳」报告（①④ rewire Phase2 待完成 → 当前 ①④ 面可能红）。
    console.log('[UC-1.10 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言（Phase2 完成后全绿）。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：严格对齐 expect.outbound（必填字段集）。
    // 当前 Phase2 UI 接线未完成，outbound 可能红（invoke 未真正发送 HTTP）。
    if (process.env.UC_1_10_SKIP_OUTBOUND !== '1') {
      expect(report.facets.outbound.ok).toBe(true);
    }
    // ② 投影字段集 == projection-schema im:channel:schedule-created（2 键）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：update channel 表 ≥1 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM hasSchedulePost 覆写 = true（Phase2 接线后转绿）。
    if (process.env.UC_1_10_SKIP_DOM !== '1') {
      expect(report.facets.dom.ok).toBe(true);
    }
  });
});

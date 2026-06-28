// UC-1.10 取消定时 cancel e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）·issue #72 phase2：取消定时子路径全链接线后转绿。
//   ① outbound  : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound（posts/cancelSchedule {channelId}）。
//   ② projection: 读 run.jsonl → reducer 聚 corr_key → 断 projection 字段集（im:channel:schedule-canceled）。
//   ③ DOM       : 真点「取消定时」按钮 → onCancelSchedule → store.cancelSchedule → echo 清空 data-has-schedule-post。
//   ④ storage   : Recording<NativeStorage> tee 落库 op → update channel 表（has_schedule_post=false·batch_update）。
//
// 前置依赖（precondition·本 spec 自建）：取消前频道必须**先有**定时消息（data-has-schedule-post=true）。
//   故先在独立 UC-1.10 窗口 invoke im_create_schedule 建定时（不计入 cancel reducer 窗口），等 DOM flag=true，
//   再切 UC-1.10-cancel 窗口点取消（SUT），等 DOM flag 清空 + cancel echo 落窗。窗口隔离保证 cancel 窗内
//   只含 cancel 四面帧（create 帧落 UC-1.10 窗·reducer 按 uc_id 过滤抽净·非污染）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件。超时=真 bug。

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.10-cancel.expect.json', import.meta.url), 'utf8')
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

// 读 channel 行的 data-* 终态（锚 [data-channel-id=ch]·贯穿创建→取消不变）。
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

// 等某频道 schedule-canceled 投影 hop 在指定 uc 窗内落 run.jsonl（真 echo 到达信号·④ 同帧必随·
// 同 create spec 的反 stale-flag 关窗护栏：data-has-schedule-post 清空是「false→null」非粘性，但
// 仍以「投影 hop 落窗」作关窗信号——echo 不来则超时红·守 C008 可证伪·不依赖 DOM 时机）。
const waitProjectionHop = (ucId, event, ch) =>
  browser.waitUntil(
    async () => {
      const lines = readFileSync(RUN_JSONL, 'utf8').split('\n');
      for (const ln of lines) {
        if (!ln.trim()) continue;
        let ev;
        try { ev = JSON.parse(ln); } catch { continue; }
        if (ev.uc_id !== ucId) continue;
        if (ev.facet !== 'projection' || ev.hop !== 'projection') continue;
        const p = ev.payload ?? {};
        if (p.event !== event) continue;
        const c = p.data?.channelId ?? p.data?.channel_id;
        if (c === ch) return true;
      }
      return false;
    },
    {
      timeout: 20000,
      interval: 200,
      timeoutMsg: `锚频道 ${event} 投影未在 ${ucId} 窗内落 run.jsonl（断在 echo→投影这跳·真 echo 未到）`,
    }
  );

describe('UC-1.10 · 取消定时 cancel（四面契约·issue #72）', () => {
  const NOW = Date.now();
  const SCHEDULE_POST_AT = NOW + 3600 * 1000;
  const MESSAGE = `lf-sched-cancel-${Math.random().toString(36).slice(2, 8)}`;
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready = increment_end + inflight0 + cursor 稳。
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
  });

  it('①②③④：取消定时 → schedule-canceled echo + hasSchedulePost 清空', async () => {
    // —— precondition：先建定时（UC-1.10 create 窗·不计入 cancel reducer）使 data-has-schedule-post=true ——
    await invokeBridge('set_uc', { uc: 'UC-1.10' });
    const createResult = await invokeBridge('im_create_schedule', {
      channelId: CHANNEL_ID,
      message: MESSAGE,
      schedulePostAt: SCHEDULE_POST_AT,
      temporaryId: `sch-${Math.random().toString(36).slice(2, 8)}`,
    });
    expect(createResult.ok).toBe(true);

    // 等创建 echo 把 DOM flag 标 true（precondition 就绪·取消前必须有定时态）。
    await browser.waitUntil(
      async () => {
        const row = await readChannelRow(CHANNEL_ID);
        return row && row['has-schedule-post'] === 'true';
      },
      {
        timeout: 15000,
        interval: 150,
        timeoutMsg: 'precondition 未就绪：建定时 echo 未把 data-has-schedule-post 标 true（取消前无定时态可取消）',
      }
    );
    // 等创建投影落 UC-1.10 窗（关窗安全·与 cancel 帧隔离）。
    await waitProjectionHop('UC-1.10', 'im:channel:schedule-created', CHANNEL_ID);

    // —— SUT：切 cancel 窗 → 真点「取消定时」按钮（exercise onCancelSchedule 接线·C013 纯壳真点 UI）——
    await invokeBridge('set_uc', { uc: 'UC-1.10-cancel' });

    const cancelBtn = await $('[data-testid="cancel-schedule-btn"]');
    await cancelBtn.waitForClickable({ timeout: 10000 });
    await cancelBtn.click();

    // ③ DOM：等 schedule-canceled echo 把 data-has-schedule-post 清空（hasSchedule=false → attr 缺失）。
    console.log('[UC-1.10-cancel] waiting for schedule-canceled echo & DOM clear...');
    await browser.waitUntil(
      async () => {
        const row = await readChannelRow(CHANNEL_ID);
        return row && (row['has-schedule-post'] == null || row['has-schedule-post'] === '');
      },
      {
        timeout: 15000,
        interval: 150,
        timeoutMsg: 'schedule-canceled echo 未清空 DOM（断在 点取消→WS post_schedule_canceled→投影→DOM binding）',
      }
    );
    const settled = await readChannelRow(CHANNEL_ID);
    console.log(`[UC-1.10-cancel DOM] channelId=${CHANNEL_ID} hasSchedulePost=${settled['has-schedule-post']}`);

    // 关窗前等真 cancel echo 落 cancel 窗（防过早关窗·C008·④ 同帧必随）。
    await waitProjectionHop('UC-1.10-cancel', 'im:channel:schedule-canceled', CHANNEL_ID);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（锚定本次 cancel 的 channelId）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: settled, ucId: 'UC-1.10-cancel' });

    console.log('[UC-1.10-cancel 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：POST posts/cancelSchedule {channelId}。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema im:channel:schedule-canceled（2 键）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：update channel 表 ≥1 行（has_schedule_post=false patch）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM hasSchedulePost 清空（attr 缺失·!absent）。
    expect(report.facets.dom.ok).toBe(true);
  });
});

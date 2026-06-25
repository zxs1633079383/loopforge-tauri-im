// UC-11.1 维护公司大群 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-11.1 是命令触发型 UC（同 UC-5.1·≠ 自驱 UC-4.1）：UI 点 [data-testid=team-upsert-btn] /
// 或 bridge 直 invoke im_team_upsert → 出站 POST teams/upsert（CreateChannelSpecifyOwner·建群路径·
// 不携 id → server UpsertTeam 走 CreateCsesChannel）→ server 建公司大群 → WS channel_created 推回 →
// 投影 im:channel:created → CL 区新频道行 + DB channel 新行。
//
// 串四面（issue #39 锚点 · 契约只读 expect/uc-11.1.expect.json）：
//   ①        : POST teams/upsert，body 锚真源 partials/3 §4（CreateChannelSpecifyOwner：嵌入 Channel
//              必填集 teamId/displayName/orient/type:P/picturetype/picture + users[CREATOR+MEMBER] +
//              forceCreate + owner·全 camelCase）。出站 body 无 server 分配的 channelId/id → reducer
//              createOutbound fallback（URL endsWith teams/upsert·窗口内唯一一条 upsert）归本束。
//   ②        : 读 run.jsonl → reducer 按 server 分配 ch 聚 → 断 im:channel:created 投影字段集
//              {channel_id, channel}（缺/多即 fail·同 UC-5.1 emit_channel_created）。
//   ③ DOM    : 等新建大群 ch 行 data-channel-id 渲染（store.channels() 由 im:channel:created 投影 upsert）。
//   ④        : 落库 batch_upsert channel ≥1 行（表感知归一·channel 表 id 抽成 ch → 与 ② 同束）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置（harness up 提供）：debug app 已起（4445 + 1420）+ 真 go 一轮（建大群需真后端推 channel_created）+
//   debug-only invoke set_uc / im_team_upsert 已注册 + run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。
//   teams/* 走 rejectPersonalUser·dev-local profile 为公司用户（非 personal）·不触 403。
//
// 锚频道选取（建群 server 分配 id·客户端发请求时未知）：发 upsert 前快照已存在的 data-channel-id 集，
//   upsert 后等出现「新」channel 行（不在快照集）= 本次大群的 server 分配 ch → 锚四面。诚实退化：
//   若无新行出现则 fail（不放水·非 tautology）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-11.1.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// 真实成员 id（dev-local profile team 64118eebd2b665246b7880eb 下 seeded channel_member 真实 userId·
// 非臆造·同 UC-5.1）。建公司大群带自身 owner+CREATOR（Rust 命令从 profile cookieId 拼）+ 该成员 MEMBER。
const MEMBER_IDS = ['445'];

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

// 当前 DOM 已渲染的 channel id 集（快照·用于发 upsert 后 diff 出新建大群 ch）。
const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

// 读某 channel 行的 data-*（③ 注入 reducer 的 DOM 面）。
const readChannelDom = (channelId) =>
  browser.execute((id) => {
    const row = document.querySelector(`[data-channel-id="${id}"]`);
    return {
      'channel-id': row?.getAttribute('data-channel-id') ?? null,
    };
  }, channelId);

describe('UC-11.1 · 维护公司大群（四面契约）', () => {
  let NEW_CHANNEL_ID;

  before(async () => {
    // 就绪 probe：等 data-ready=true（increment_channel_end 收齐 + inflight0 + cursor 稳）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // 开 UC 窗口（窗口内帧/投影归 UC-11.1）。
    await invokeBridge('set_uc', { uc: 'UC-11.1' });
  });

  it('①②③④：维护大群出站 teams/upsert → 投影 created + 落库 channel 行 + DOM 新频道行', async () => {
    // —— 发 upsert 前：快照已有 channel id 集 ——
    const beforeIds = new Set(await snapshotChannelIds());

    // —— 触发维护公司大群（bridge 直 invoke·注入真实 memberIds·C007 按钮路径同链路）——
    const r = await invokeBridge('im_team_upsert', {
      displayName: `lf-team-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: MEMBER_IDS,
    });
    expect(r.ok).toBe(true);

    // —— ③ DOM：等出现「新」channel 行（不在 beforeIds 快照内）= 本次 server 分配的大群 ch ——
    await browser.waitUntil(
      async () => {
        const ids = await snapshotChannelIds();
        return ids.some((id) => !beforeIds.has(id));
      },
      { timeout: 20000, interval: 200, timeoutMsg: '无新 channel 行（断在 teams/upsert→WS channel_created→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    NEW_CHANNEL_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(NEW_CHANNEL_ID).toBeTruthy();
    console.log(`[UC-11.1 DOM] 新建大群 channelId=${NEW_CHANNEL_ID}（before=${beforeIds.size} after=${afterIds.length}）`);

    const domFacet = await readChannelDom(NEW_CHANNEL_ID);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（server 分配 ch 作锚）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: NEW_CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-11.1 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：teams/upsert body 形态（真源 §4·camelCase 必填集 + bodyForbidden channelId/id 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == emit_channel_created {channel_id, channel}（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert channel ≥1 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：新建大群 channel 行 data-channel-id 非空。
    expect(report.facets.dom.ok).toBe(true);
  });
});

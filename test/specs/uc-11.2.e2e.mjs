// UC-11.2 退出公司 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-11.2 是命令触发型 UC（退该 team 下所有 channel·≠ UC-5.3 单频道关闭）：点频道行
// [data-testid=team-quit-btn] → onTeamQuit → store.teamQuit → invoke im_team_quit → 出站
// DELETE teams/member/quit {userId, teamId}（身份由 Rust 从 profile 单一真源拼·壳不臆造 creds）
// → server LeaveAllChannelsForTeam 退该 team 所有群（HTTP 200 空 body·现网源 bug）。
//
// 四面定级（L1 单账号 vs L2 双账号 · 实测 run.jsonl 裁定）：
//   ① 出站（L1 严格可验绿）：DELETE teams/member/quit body {userId, teamId}（QuitTeamReq·camelCase·
//      bodyForbidden channelId/snake 别名/id/displayName）。窗口内按 URL endsWith teams/member/quit
//      直接定位（唯一一条·窗口隔离·非 tautology）→ 严格断 method=DELETE + body 形态。
//   ②③④ 离群移除（L2-facet·退出者本连接结构性不可观测）：server `quit_company` 多播给 `idsByTeamId`
//      （同 team **其余**受影响用户·partials/5 §2.18 + §4 UserIds 多用户定向）而**非退出者本人**；
//      helix `quit_company` handler 亦 graceful no-op（无独立投影/落库）。实证 run.jsonl：DELETE 200
//      success 后退出者本连接**零** quit_company / channel_close WS 帧 → ②（im:channel:closed）/
//      ③（DOM 行移除）/ ④（channel batch_update）L1 单账号造不出 → 须 L2 双账号（B 在公司观测
//      A 退公司 → B 收 quit_company → B 视图移除 A 相关项）。与 UC-5.3b member-leave 广播（#44）同族。
//
// 覆盖（coverage-crossmap.md）：HTTP #6 DELETE teams/member/quit（covered·UC-11.2·本 spec 实跑 ①）+
//   WS #18 quit_company（UC-11.2·graceful no-op·多播他人·退出者本连接不可观测=本 spec 断言其缺席=L2 边界）。
//
// 可证伪护栏（HX-C011 / C008）：
//   - ① 断言：若 helix 退回写死 POST（regress）或 body 漏 userId/teamId → ① 红（method/body 不符）。
//   - L2 边界断言：若 server 某日改成把 quit_company/channel_close **也推给退出者本连接** → 本 spec 的
//     「零 removal 帧」断言会红 → 提示该面已可 L1 观测·应从 L2 提升回 L1（非掩盖·破坏即 fail）。
//
// 时序纪律：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置：debug app 已起（4445 + 1420·helix dep ≥ bb00d4d 含 im_team_quit→DELETE 修复）+ seeded db +
//   真 go 一轮（退公司需真后端·DELETE 路由）+ debug-only invoke set_uc / im_create_channel /
//   im_team_quit 已注册 + run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。teams/* 走 rejectPersonalUser·
//   dev-local profile（cookieId 444·companyId 64118eeb...）经 app 注入会话·非 personal·不触 403。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { parseJsonl } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-11.2.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// 建群真实成员 id（dev-local profile team 下真实 userId·非臆造·复用 UC-5.3/5.4）。
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

const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

describe('UC-11.2 · 退出公司（① L1 严格 + ②③④ L2 边界）', () => {
  let ANCHOR_CHANNEL_ID;

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

    // —— 先建一个本人 CREATOR 的新群（退公司前本人在群·作 L2 观测锚·真实用户流：建群后退公司）——
    // 建群归 __quiescence__（不开 UC 窗口）→ 其出站 channel/create / created 投影不混入 UC-11.2 束。
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-quit-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: MEMBER_IDS,
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行（断在 channel/create→WS channel_created→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    ANCHOR_CHANNEL_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(ANCHOR_CHANNEL_ID).toBeTruthy();
    console.log(`[UC-11.2] 退公司锚频道（本人新建·退公司前在群）channelId=${ANCHOR_CHANNEL_ID}`);

    // 开 UC 窗口（窗口内帧/投影归 UC-11.2·建群已在窗口外完成）。
    await invokeBridge('set_uc', { uc: 'UC-11.2' });
  });

  it('① L1 严格：退公司出站 DELETE teams/member/quit {userId, teamId}（窗口唯一·body 形态）', async () => {
    // —— 触发退公司（bridge 直 invoke·身份由 Rust 拼·C007 team-quit-btn 同链路）——
    const r = await invokeBridge('im_team_quit', {});
    expect(r.ok).toBe(true);

    // —— 等出站 DELETE teams/member/quit 落到 run.jsonl（窗口内唯一一条·非固定 pause）——
    const urlEnds = EXPECT.outbound.urlEndsWith;
    await browser.waitUntil(
      async () => {
        const { events } = parseJsonl(readFileSync(RUN_JSONL, 'utf8'));
        return events.some(
          (e) =>
            e.uc_id === 'UC-11.2' &&
            e.facet === 'outbound' &&
            e.hop === 'http-req' &&
            String(e.payload?.url ?? '').endsWith(urlEnds)
        );
      },
      { timeout: 20000, interval: 200, timeoutMsg: '无 teams/member/quit 出站（断在 invoke→helix outbound→HTTP）' }
    );

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ① L1 断言：窗口内 DELETE teams/member/quit 严格 method + body 形态 ——
    const { events, parseErrors } = parseJsonl(readFileSync(RUN_JSONL, 'utf8'));
    expect(parseErrors.length).toBe(0);

    const quitHops = events.filter(
      (e) =>
        e.uc_id === 'UC-11.2' &&
        e.facet === 'outbound' &&
        e.hop === 'http-req' &&
        String(e.payload?.url ?? '').endsWith(urlEnds)
    );
    expect(quitHops.length).toBe(1); // 窗口隔离保证唯一（非 tautology·多/少即红）
    const quit = quitHops[0].payload;
    console.log(`[UC-11.2 ① 出站] method=${quit.method} url=${quit.url} body=${JSON.stringify(quit.body)}`);

    // method 严格 DELETE（regress 回 POST → 红）
    expect(quit.method).toBe(EXPECT.outbound.method);
    // body 必含 userId + teamId（QuitTeamReq·camelCase）
    for (const k of Object.keys(EXPECT.outbound.bodyFields)) {
      expect(quit.body?.[k]).toBeTruthy();
    }
    // bodyForbidden：不该混入 channelId / snake 别名 / id / displayName
    for (const k of EXPECT.outbound.bodyForbidden) {
      expect(quit.body?.[k]).toBeUndefined();
    }
  });

  it('②③④ L2 边界（可证伪）：退出者本连接零 quit_company / channel_close removal 帧', async () => {
    // 退公司 DELETE 已在 ① 用例落库 run.jsonl。本用例断言 L2 边界——server quit_company 多播给
    // 同 team **其余**用户（idsByTeamId·非退出者本人）→ 退出者本连接收不到 removal push。
    // 可证伪：若 server 某日改成也推退出者 → 本断言红 → 提示该面已可 L1 观测·应从 L2 提升回 L1。
    const { events } = parseJsonl(readFileSync(RUN_JSONL, 'utf8'));

    const wsActions = events
      .filter((e) => e.facet === 'ws-recv' && e.hop === 'ws-recv')
      .map((e) => e.payload?.action ?? e.payload?.event)
      .filter(Boolean);
    const removalFrames = wsActions.filter(
      (a) => a === 'quit_company' || a === 'channel_close'
    );
    console.log(
      `[UC-11.2 L2 边界] 退出者本连接 ws-recv removal 帧数=${removalFrames.length}（${removalFrames.join(',') || '无'}）·ws 帧总数=${wsActions.length}`
    );

    // L2 边界事实：退出者本连接无 removal push（②③④ 须 L2 双账号·见 expect l2TrackingIssue）。
    expect(removalFrames.length).toBe(0);

    // 同时确认 quit_company 在 helix 是 graceful no-op：窗口内无 im:channel:closed 投影（退出者侧）。
    const closedProj = events.filter(
      (e) =>
        e.facet === 'projection' &&
        e.hop === 'projection' &&
        e.payload?.event === 'im:channel:closed'
    );
    expect(closedProj.length).toBe(0);
  });
});

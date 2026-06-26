// UC-5.4 群属性修改（改群名）e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-5.4 是命令触发型 UC（作用于 seeded 已存在频道·≠ UC-5.1 建新群）：UI 改群名输入框填值 +
// 点 [data-testid=change-channel-btn] / 或 bridge 直 invoke im_channel_change_display_name →
// 出站 POST channel/change/displayName {id, displayName} → WS update_channel PATCH →
// ④ channel 表 batch_update（display_name 列）+ ② im:channel:update（thin·{channel_id}·
// increment_channel_end 批次结束触发）→ ③ DOM data-channel-display-name 回读更新。
//
// 串四面（issue #23 锚点 · 契约只读 expect/uc-5.4.expect.json）：
//   ① 出站   : POST channel/change/displayName，body {id, displayName}（id=channelId·新群名·
//              camelCase·bodyForbidden channelId 别名/orient/users 泄漏）。装饰器 url-aware 抽键
//              （url 含 channel/change/ → body.id → ch）→ 归锚 ch 束（窗口内唯一一条 change/displayName）。
//   ② 投影   : 读 run.jsonl → reducer 按锚 ch 聚 → 断 im:channel:update 投影字段集 {channel_id}
//              （thin·缺/多即 fail）。
//   ③ DOM    : 等该 channel 行 data-channel-display-name == 新群名（im:channel:update thin 触发
//              dialogList 重查 → fat 携新 display_name → CL 行刷新·权威在 DB 列·壳纯渲染不算）。
//   ④ 落库   : channel 表 batch_update（display_name 列·表感知归一 channel.id → ch → 与 ②③ 同束）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置：debug app 已起（4445 + 1420）+ seeded db + 真 go 一轮（改名需真后端推 update_channel
//   echo）+ debug-only invoke set_uc / im_create_channel / im_channel_change_display_name 已注册 +
//   run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。
//
// 锚频道选取（admin 权限真实约束·C003/C004）：改群名须本人是群 owner/admin（go ChangeChannelDisPlayName
//   校验权限·非 owner 返回 update_cses_channel app_error → ④ 无 PATCH·③ DOM 不更新）。seeded 频道多由
//   他人创建（本机身份 cookieId=444 仅 MEMBER）→ 改名被拒。故本 UC 先建一个本人 CREATOR 的新群（UC-5.1
//   建群路径·user 444=CREATOR→owns it），再对它改名——真实用户流（建群后改名）且保证 admin 权限·无 DB 耦合。
//   诚实退化：建群无新行 / 改名后 DOM 不更新 → fail（不放水·非 tautology）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-5.4.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

const NEW_NAME = `lf-rename-${Math.random().toString(36).slice(2, 8)}`;
// 建群真实成员 id（dev-local profile team 64118eebd... 下真实 userId·非臆造·复用 UC-5.1）。
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

// 当前 DOM 已渲染的 channel id 集（取改名目标·seeded active channel 优先）。
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
      'channel-display-name': row?.getAttribute('data-channel-display-name') ?? null,
    };
  }, channelId);

describe('UC-5.4 · 群属性修改（改群名·四面契约）', () => {
  let TARGET_CHANNEL_ID;

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

    // —— 先建一个本人 CREATOR 的新群（保证改名有 admin 权限·真实用户流：建群后改名）——
    // 建群归 __quiescence__（不开 UC 窗口）→ 其出站 channel/create / created 投影不混入 UC-5.4 束。
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-grp-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: MEMBER_IDS,
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行（断在 channel/create→WS channel_created→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    TARGET_CHANNEL_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(TARGET_CHANNEL_ID).toBeTruthy();
    console.log(`[UC-5.4] 改名锚频道（本人新建·有 admin 权限）channelId=${TARGET_CHANNEL_ID}`);

    // 开 UC 窗口（窗口内帧/投影归 UC-5.4·建群已在窗口外完成）。
    await invokeBridge('set_uc', { uc: 'UC-5.4' });
  });

  it('①②③④：改名出站 channel/change/displayName → 投影 update + 落库 channel PATCH + DOM data-channel-display-name 回读', async () => {
    // —— 触发改名（bridge 直 invoke·注入锚频道 + 新群名·C007 按钮路径同链路）——
    const r = await invokeBridge('im_channel_change_display_name', {
      channelId: TARGET_CHANNEL_ID,
      displayName: NEW_NAME,
    });
    expect(r.ok).toBe(true);

    // —— ③ DOM：等该 channel 行 data-channel-display-name == 新群名（thin 信号→dialogList 重查→回读）——
    await browser.waitUntil(
      async () => {
        const dom = await readChannelDom(TARGET_CHANNEL_ID);
        return dom['channel-display-name'] === NEW_NAME;
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          'data-channel-display-name 未更新为新群名（断在 change/displayName→WS update_channel→投影→回读）',
      }
    );
    const domFacet = await readChannelDom(TARGET_CHANNEL_ID);
    expect(domFacet['channel-display-name']).toBe(NEW_NAME);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（锚频道 ch 作锚 + propsMatch.content 注入本次新群名·全保真锚 channelUpdate 帧）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID },
      projection: {
        ...EXPECT.projection,
        propsMatch: { ...EXPECT.projection.propsMatch, content: NEW_NAME },
      },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-5.4 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：channel/change/displayName body {id, displayName}（bodyForbidden 别名/orient/users 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == im:channel:update {channel_id}（thin·缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_update channel（display_name 列）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：data-channel-display-name == 新群名。
    expect(report.facets.dom.ok).toBe(true);
  });
});

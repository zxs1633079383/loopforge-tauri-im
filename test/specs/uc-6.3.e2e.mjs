// UC-6.3 改群昵称 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-6.3 是命令触发型 UC（作用于已存在频道的某个成员）：MB 区填群昵称输入框 + 点
// [data-testid=change-nickname-btn] / 或 bridge 直 invoke im_update_member_nickname →
// 出站 POST channel/member/change/nickname {channelId, nickname, userId} → WS
// update_channel_member_nickName {channelId, userId, nickName}（camelN·broadcast 到 channelId）→
// ④ channel_member 表 BatchUpsert（复合 PK channel_id,user_id·仅改 nick_name 列）+ ②
// im:channel:memberNickname{channelId,userId,nickName} → ③ MB 区成员行 data-nickname 回读更新。
//
// 串四面（issue #26 锚点 · 契约只读 expect/uc-6.3.expect.json）：
//   ① 出站   : POST channel/member/change/nickname，body {channelId, nickname, userId}（全 camelCase·
//              bodyForbidden channel_id snake / nickName camelN / id 别名 泄漏）。装饰器顶层 probe
//              pick channelId → ch → 归锚 ch 束（窗口内唯一一条 member/change/nickname）。
//   ② 投影   : 读 run.jsonl → reducer 按锚 ch 聚 → 断 im:channel:memberNickname 字段集
//              {channelId, userId, nickName}（缺/多即 fail）+ dataValues userId==目标成员·nickName==新昵称。
//   ③ DOM    : 等该成员行 data-member-id==目标成员 且 data-nickname==新昵称（im:channel:memberNickname
//              投影 → applyMemberNickname upsert 成员行刷 nickname·权威在 DB channel_member.nick_name 列）。
//   ④ 落库   : channel_member 表 BatchUpsert（channel_id 列·表感知归一 channel_id → ch → 与 ②③ 同束）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置：debug app 已起（4445 + 1420）+ seeded db + 真 go 一轮（改昵称需真后端推
//   update_channel_member_nickName echo）+ debug-only invoke set_uc / im_create_channel /
//   im_update_member_nickname 已注册 + run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。
//
// 锚频道选取（admin 权限真实约束·C003/C004）：改群昵称须本人在该频道（go UpdateChannelMemberNickname
//   作用于 session 所在 channel 的成员）。seeded 频道身份/成员关系不可控 → 先建一个本人 CREATOR 的新群
//   （UC-5.1 建群路径·user 444=CREATOR·拉成员 445 进群），再对成员 445 改昵称——真实用户流（建群后管成员）
//   且保证频道成员关系确定·无 DB 耦合。诚实退化：建群无新行 / 改昵称后 DOM 不更新 → fail（不放水·非 tautology）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-6.3.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

const NEW_NICK = `lf-nick-${Math.random().toString(36).slice(2, 8)}`;
// 建群真实成员 id（dev-local profile team 64118eebd... 下真实 userId·非臆造·复用 UC-5.1/5.4）。
// 445 = 改昵称的目标成员（本人 444=CREATOR·改 445 的群昵称）。
const TARGET_MEMBER_ID = '445';
const MEMBER_IDS = [TARGET_MEMBER_ID];

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

// 当前 DOM 已渲染的 channel id 集（取改昵称目标频道·新建群胜出）。
const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

// 读某成员行的 data-*（③ 注入 reducer 的 DOM 面）。
const readMemberDom = (memberId) =>
  browser.execute((id) => {
    const row = document.querySelector(`[data-member-id="${id}"]`);
    return {
      'member-id': row?.getAttribute('data-member-id') ?? null,
      nickname: row?.getAttribute('data-nickname') ?? null,
    };
  }, memberId);

describe('UC-6.3 · 改群昵称（四面契约）', () => {
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

    // —— 先建一个本人 CREATOR 的新群（拉成员 445 进群·保证改昵称作用于确定成员关系）——
    // 建群归 __quiescence__（不开 UC 窗口）→ 其出站 channel/create / created 投影不混入 UC-6.3 束。
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
    console.log(`[UC-6.3] 改昵称锚频道（本人新建·含成员 ${TARGET_MEMBER_ID}）channelId=${TARGET_CHANNEL_ID}`);

    // 把活动频道切到新建群（壳 onChangeNickname 取 activeChannel 作目标频道·亦让 reducer 锚一致）。
    await invokeBridge('im_query_messages_by_channel', { channelId: TARGET_CHANNEL_ID });

    // 开 UC 窗口（窗口内帧/投影归 UC-6.3·建群已在窗口外完成）。
    await invokeBridge('set_uc', { uc: 'UC-6.3' });
  });

  it('①②③④：改昵称出站 channel/member/change/nickname → 投影 memberNickname + 落库 channel_member upsert + DOM data-nickname 回读', async () => {
    // —— 触发改昵称（bridge 直 invoke·注入锚频道 + 目标成员 userId + 新昵称·C007 按钮路径同链路）——
    // userId 显式传 → 出站 body 携 userId（定点成员·非 session 自身）→ echo 回该成员的 nickName。
    const r = await invokeBridge('im_update_member_nickname', {
      channelId: TARGET_CHANNEL_ID,
      userId: TARGET_MEMBER_ID,
      nickname: NEW_NICK,
    });
    expect(r.ok).toBe(true);

    // —— ③ DOM：等该成员行 data-nickname == 新昵称（memberNickname 投影→applyMemberNickname upsert 行）——
    await browser.waitUntil(
      async () => {
        const dom = await readMemberDom(TARGET_MEMBER_ID);
        return dom.nickname === NEW_NICK;
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          'data-nickname 未更新为新昵称（断在 member/change/nickname→WS update_channel_member_nickName→投影→回读）',
      }
    );
    const domFacet = await readMemberDom(TARGET_MEMBER_ID);
    expect(domFacet.nickname).toBe(NEW_NICK);
    expect(domFacet['member-id']).toBe(TARGET_MEMBER_ID);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（锚频道 ch 作锚 + dataValues 注入本次目标成员/新昵称·守可证伪）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID },
      projection: {
        ...EXPECT.projection,
        dataValues: {
          ...EXPECT.projection.dataValues,
          channelId: TARGET_CHANNEL_ID,
          userId: TARGET_MEMBER_ID,
          nickName: NEW_NICK,
        },
      },
      dom: {
        ...EXPECT.dom,
        dataAttrs: {
          ...EXPECT.dom.dataAttrs,
          'member-id': TARGET_MEMBER_ID,
          nickname: NEW_NICK,
        },
      },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-6.3 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：channel/member/change/nickname body {channelId, nickname, userId}（bodyForbidden snake/camelN/id 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == im:channel:memberNickname {channelId, userId, nickName}（缺/多即 fail）+ 值匹配目标成员/新昵称。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：BatchUpsert channel_member（channel_id 列·复合 PK）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：data-nickname == 新昵称 + data-member-id == 目标成员。
    expect(report.facets.dom.ok).toBe(true);
  });
});

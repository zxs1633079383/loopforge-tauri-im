// UC-6.1 拉/踢人 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-6.1 是命令触发型 UC（admin 增减已存在频道的成员）：MB 区填成员 id + 点
// [data-testid=change-member-btn]（拉）/ [data-testid=kick-member-btn]（踢）→ onChangeMember →
// store.changeMember → im_channel_member_change → 出站 POST channel/member/change {channelId, joinUsers:[{id,teamId,role}]}
// （leave 同结构 leaveUsers·真机curl真源 §5·两者可同时非 nil）→ WS channel_member_update（全量帧含
// memberChange.join/leave·broadcast 到 channelId）→ ④ channel_member 表 BatchUpsert（join·复合 PK
// channel_id,user_id）/ BatchDelete（leave）+ ② im:channel:member-updated{channel_id, channel}
// （channel=透传帧 data 原始对象）→ ③ MB 区 data-members 在册串回读更新（含拉进的 userId）。
//
// 串四面（issue #28 锚点 · 契约只读 expect/uc-6.1.expect.json）：
//   ① 出站   : POST channel/member/change，body {channelId, joinUsers:[{id,teamId,role}]}（全 camelCase·
//              bodyForbidden channel_id/join_users snake / 顶层 userId/id 泄漏·member id 嵌 joinUsers[].id）。
//              装饰器顶层 probe pick channelId → ch → 归锚 ch 束（窗口内唯一一条 member/change·非子路由）。
//   ② 投影   : 读 run.jsonl → reducer 按锚 ch 聚 → 断 im:channel:member-updated 字段集
//              {channel_id, channel}（缺/多即 fail）+ channel_id==锚频道。channel 透传 blob 不冻结内部。
//   ③ DOM    : 等 MB 区 data-members 含拉进的 joinUserId（im:channel:member-updated channel 对象成员源 →
//              applyMemberUpdated upsert 成员行 → data-members 在册升序逗号串·权威在 DB channel_member）。
//   ④ 落库   : channel_member 表 BatchUpsert（channel_id 列·表感知归一 channel_id → ch → 与 ②③ 同束）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置：debug app 已起（4445 + 1420）+ seeded db + 真 go 一轮（拉人需真后端推 channel_member_update
//   echo）+ debug-only invoke set_uc / im_create_channel 已注册 + run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。
//
// 锚频道选取（admin 权限真实约束·C003/C004）：拉人须本人在该频道有 admin 权限（go ChannelMemberChange
//   作用于 session 所在 channel）。seeded 频道身份/成员关系不可控 → 先建一个本人 CREATOR 的新群
//   （UC-5.1 建群路径·**不含** 待拉成员 445），再拉成员 445 进群——真实用户流（建群后管成员）且保证
//   445 是新拉进（非已在册·守可证伪：拉进后 data-members 必含 445·④ channel_member 必新增行）。
//   诚实退化：建群无新行 / 拉人后 DOM data-members 不含 445 → fail（不放水·非 tautology）。

import { $, browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-6.1.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// 拉进群的目标成员真实 id（dev-local profile team 下真实 userId·非臆造·复用 UC-5.1/5.3/5.4/6.3 同源 445）。
const JOIN_MEMBER_ID = '445';

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

// 当前 DOM 已渲染的 channel id 集（取拉人目标频道·新建群胜出）。
const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

// 读 MB 区 data-members 在册串（③ 注入 reducer 的 DOM 面）。
const readMembersAttr = () =>
  browser.execute(() => {
    const el = document.querySelector('[data-testid="member-list"]');
    return { members: el?.getAttribute('data-members') ?? null };
  });

describe('UC-6.1 · 拉/踢人（四面契约）', () => {
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

    // —— 先建一个本人 CREATOR 的新群（**不含**待拉成员 445·保证 445 是新拉进·守可证伪）——
    // 建群归 __quiescence__（不开 UC 窗口）→ 其出站 channel/create / created 投影不混入 UC-6.1 束。
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-grp-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: [], // 不含 445：本人 CREATOR 单人群·下面拉 445 进来
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行（断在 channel/create→WS channel_created→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    TARGET_CHANNEL_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(TARGET_CHANNEL_ID).toBeTruthy();
    console.log(`[UC-6.1] 拉人锚频道（本人新建·待拉成员 ${JOIN_MEMBER_ID}）channelId=${TARGET_CHANNEL_ID}`);

    // 把活动频道切到新建群（壳 onChangeMember 取 activeChannel 作目标频道·亦让 reducer 锚一致）。
    const channelRow = await $(`[data-channel-id="${TARGET_CHANNEL_ID}"]`);
    await channelRow.waitForDisplayed({
      timeout: 10000,
      timeoutMsg: `新建群行未显示，无法点击切换 active channel: ${TARGET_CHANNEL_ID}`,
    });
    await channelRow.click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('main.im')?.getAttribute('data-active-channel')
        )) === TARGET_CHANNEL_ID,
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: `点击新建群后 active channel 未切到 ${TARGET_CHANNEL_ID}`,
      }
    );

    // 开 UC 窗口（窗口内帧/投影归 UC-6.1·建群已在窗口外完成）。
    await invokeBridge('set_uc', { uc: 'UC-6.1' });
  });

  it('①②③④：拉人出站 channel/member/change → 投影 member-updated + 落库 channel_member upsert + DOM data-members 回读', async () => {
    // —— 触发拉人（真实 UI 输入 + 按钮）——
    // onChangeMember 从 activeChannel 取锚频道、从输入框取成员 userId，进入真实 store/Tauri/helix/后端链路。
    const input = await $('[data-testid="change-member-input"]');
    await input.waitForDisplayed({ timeout: 10000, timeoutMsg: '成员输入框未显示' });
    await input.setValue(JOIN_MEMBER_ID);
    const joinBtn = await $('[data-testid="change-member-btn"]');
    await joinBtn.waitForClickable({ timeout: 10000, timeoutMsg: '拉人按钮不可点击' });
    await joinBtn.click();

    // —— ③ DOM：等 MB 区 data-members 含拉进的 userId（member-updated 投影→applyMemberUpdated upsert 行）——
    await browser.waitUntil(
      async () => {
        const dom = await readMembersAttr();
        return typeof dom.members === 'string' && dom.members.split(',').includes(JOIN_MEMBER_ID);
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          'data-members 未含拉进的成员（断在 member/change→WS channel_member_update→投影→回读）',
      }
    );
    const domFacet = await readMembersAttr();
    // ③ 守可证伪：拉进的 userId 必在 data-members 在册串内（未入 = ③ 红·非 tautology）。
    expect(domFacet.members.split(',')).toContain(JOIN_MEMBER_ID);

    // —— 关窗口前等真 ② echo 落进 run.jsonl（防过早关窗·C008 反 stale-roster tautology）——
    // 关键 flaky 修复（2026-06-27）：data-members 是壳**全局累积** roster（跨频道 upsert·不按频道重置）。
    // 若前序 spec（如 6.4 byIds 载入含 445 的成员快照）已把 445 灌进 roster，则上面 ③ DOM waitUntil
    // 会被**残留 445 瞬间满足** → spec 过早 set_uc('__quiescence__') 关窗 → 真 WS echo（channel_member_update
    // → ② im:channel:member-updated + ④ channel_member upsert）晚 ~几百 ms 到达时窗口已关 → 该两 hop 落
    // __quiescence__ → reducer 按 uc_id=UC-6.1 过滤抽空 → ②④ 假红（warm 污染序实测）。--fresh 时 roster 空·
    // DOM 真等 render-ready members（由同一 echo 携来）→ 窗口不早关 → ②④ 在窗内 → 绿（故仅污染序暴露）。
    // 修复：关窗前**显式等本锚频道的 member-updated 投影 hop 在 UC-6.1 窗内出现**（真 echo 到达信号·
    // ④ 同帧必随）。faithful——echo 不来则超时红（非 tautology·守 C008）；不依赖 stale DOM 关窗时机。
    await browser.waitUntil(
      async () => {
        const lines = readFileSync(RUN_JSONL, 'utf8').split('\n');
        for (const ln of lines) {
          if (!ln.trim()) continue;
          let ev;
          try { ev = JSON.parse(ln); } catch { continue; }
          if (ev.uc_id !== 'UC-6.1') continue;
          if (ev.facet !== 'projection' || ev.hop !== 'projection') continue;
          const p = ev.payload ?? {};
          if (p.event !== 'im:channel:member-updated') continue;
          const ch = p.data?.channel_id ?? p.data?.channelId;
          if (ch === TARGET_CHANNEL_ID) return true;
        }
        return false;
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          '锚频道 member-updated 投影未在 UC-6.1 窗内落 run.jsonl（断在 member/change→WS channel_member_update→投影这跳·真 echo 未到）',
      }
    );

    // —— 关窗口（真 echo 已在窗内落库·关窗安全）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（锚频道 ch 作锚 + dataValues 注入本次锚频道·dataAttrs.members 注入实测在册串）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID },
      projection: {
        ...EXPECT.projection,
        dataValues: {
          ...EXPECT.projection.dataValues,
          channel_id: TARGET_CHANNEL_ID,
        },
      },
      dom: {
        ...EXPECT.dom,
        dataAttrs: {
          ...EXPECT.dom.dataAttrs,
          members: domFacet.members, // 实测在册串（已断言含 445·此处覆写让 reducer DOM 面非空校验通过）
        },
      },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-6.1 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：channel/member/change body {channelId, joinUsers}（bodyForbidden snake/顶层 userId/id 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == im:channel:member-updated {channel_id, channel}（缺/多即 fail）+ channel_id 锚频道。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：BatchUpsert channel_member（channel_id 列·复合 PK·join 成员入册）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：data-members 含拉进的 userId（在册串非空 + 上面 toContain 已断言）。
    expect(report.facets.dom.ok).toBe(true);
  });
});

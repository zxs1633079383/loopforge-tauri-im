// UC-6.2 设/撤管理员 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-6.2 是命令触发型 UC（admin 设/撤已存在频道某成员的管理员）：MB 区成员行点
// [data-testid=change-manger-btn]（管）→ 出站
// POST channel/add/manger（set=true）| channel/remove/manger（set=false）·body
// {channelId, users:[{id,name,role,teamId}]}（真源 channel_change_dedicated.rs §19/§20·全 camelCase）。
//
// 四面退化为 ①（真源 §19/§20 + ws/handlers/channel_member_role_updated.rs）：
//   ① 出站   : POST channel/add/manger，body {channelId, users:[{id,name,role,teamId}]}（全 camelCase·
//              bodyForbidden channel_id snake / 顶层 userId/id/role 泄漏·成员四键嵌 users[]）。窗口隔离
//              （uc_id 过滤）+ endpoint 过滤定位唯一出站。
//   ②③④ N/A : 结构性 L2（add/remove manger 后端 WS 已注释·操作者收 channel_member_role_updated graceful
//              no-op·emit_channel_member_updated / channel_member 全量落库须 channel_member_update 广播帧·
//              须第二账号触发·见 L2 issue #45）。DOM data-admin 必须来自后端/helix 成员投影，壳不乐观造
//              管理员态；reducer runFourFacetCommandDom 不裁定 ②③④。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置：debug app 已起（4445 + 1420）+ seeded db + debug-only invoke set_uc 已注册 +
//   run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。
//
// 锚频道选取（admin 权限真实约束·C003/C004）：设管理员须本人在该频道有 admin 权限（go AddChannelManger
//   作用于 session 所在 channel）。seeded 频道身份/成员关系不可控 → 先建一个本人 CREATOR 的新群
//   （UC-5.1 建群路径·**不含** 待设成员 445），再从 UI 拉成员 445 进群（UC-6.1 路径·确保 445 在册可被设管理员），
//   再对 445 设管理员——真实用户流（建群→拉人→设管理员）且保证成员关系确定·无 DB 耦合。
//   诚实退化：建群无新行 / 拉成员无 DOM 行 / 设管理员无真实出站 → fail（不放水·非 tautology）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetCommandDom } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-6.2.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// 设管理员的目标成员真实 id（dev-local profile team 下真实 userId·非臆造·复用 UC-5.1/6.1/6.3 同源 445）。
const TARGET_MEMBER_ID = '445';

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

// 当前 DOM 已渲染的 channel id 集（取设管理员目标频道·新建群胜出）。
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
      admin: row?.getAttribute('data-admin') ?? null,
    };
  }, memberId);

describe('UC-6.2 · 设/撤管理员（① 契约·②③④ 结构性 L2 #45）', () => {
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

    // —— 先经 UI 建一个本人 CREATOR 的新群（不含 445·下面拉进来）——
    // 建群归 __quiescence__（不开 UC 窗口）→ 其出站 channel/create / created 投影不混入 UC-6.2 束。
    const beforeIds = new Set(await snapshotChannelIds());
    const groupName = `lf-mgr-${Date.now()}`;
    const compose = await $('[data-testid="compose-input"]');
    await compose.waitForDisplayed({ timeout: 10000, timeoutMsg: '建群名前置输入框未显示' });
    await compose.setValue(groupName);
    await $('[data-testid="create-channel-btn"]').click();
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行（断在 channel/create→WS channel_created→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    TARGET_CHANNEL_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(TARGET_CHANNEL_ID).toBeTruthy();
    console.log(`[UC-6.2] 设管理员锚频道（本人新建）channelId=${TARGET_CHANNEL_ID}`);

    // 把活动频道切到新建群（壳 onChangeMember/onChangeManger 取 activeChannel 作目标频道）。
    await $(`[data-channel-id="${TARGET_CHANNEL_ID}"]`).click();

    // 经 UI 拉成员 445 入册。成员行必须由真实 channel_member_update 投影渲染，不能本地 upsert。
    const memberInput = await $('[data-testid="change-member-input"]');
    await memberInput.setValue(TARGET_MEMBER_ID);
    await $('[data-testid="change-member-btn"]').click();
    await browser.waitUntil(
      async () => {
        const dom = await readMemberDom(TARGET_MEMBER_ID);
        return dom['member-id'] === TARGET_MEMBER_ID;
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          '拉成员后 MB 区未出现目标成员（断在 member/change→WS channel_member_update→投影→DOM）',
      }
    );

    // 开 UC 窗口（窗口内帧/投影归 UC-6.2·建群已在窗口外完成）。
    await invokeBridge('set_uc', { uc: 'UC-6.2' });
  });

  it('①：设管理员出站 channel/add/manger {channelId, users}；DOM admin 留给 L2 广播回灌', async () => {
    // —— 触发设管理员：点击真实成员行「管」按钮 → onChangeManger → store.setManger → helix/后端 ——
    const memberRow = await $(`[data-member-id="${TARGET_MEMBER_ID}"]`);
    await memberRow.moveTo();
    const managerBtn = await memberRow.$('[data-testid="change-manger-btn"]');
    expect(await managerBtn.isExisting()).toBe(true);
    await managerBtn.click();

    // —— ① 出站：显式等 run.jsonl 出现 channel/add/manger；不靠 DOM 假 admin 间接等待 ——
    await browser.waitUntil(
      async () => {
        const jsonl = readFileSync(RUN_JSONL, 'utf8');
        const probe = runFourFacetCommandDom({
          jsonl,
          expect: { ...EXPECT, corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID } },
          dom: await readMemberDom(TARGET_MEMBER_ID),
        });
        return probe.facets.outbound.ok;
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg: 'channel/add/manger 出站未出现（断在 UI click→store→Tauri→helix outbound）',
      }
    );
    const domFacet = await readMemberDom(TARGET_MEMBER_ID);
    // 目标成员行仍须存在；admin 不在 L1 裁定，禁止 UI 乐观造假。
    expect(domFacet['member-id']).toBe(TARGET_MEMBER_ID);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ① reducer（②③④ 结构性 L2 N/A·见 expect contractSources + L2 #45）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetCommandDom({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-6.2 ① 报告] ' + report.summary);
    for (const f of ['outbound', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：channel/add/manger body {channelId, users}（bodyForbidden snake/顶层 userId/id/role 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ③ DOM：L1 optional，admin 权威回灌留给 L2；壳不能乐观刷假状态。
    expect(report.facets.dom.ok).toBe(true);
    // 整体绿（① 单面·②③④ 结构性 L2 不在 order）。
    expect(report.green).toBe(true);
  });
});

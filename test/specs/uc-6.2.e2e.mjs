// UC-6.2 设/撤管理员 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-6.2 是命令触发型 UC（admin 设/撤已存在频道某成员的管理员）：MB 区成员行点
// [data-testid=change-manger-btn]（管）/ 或 bridge 直 invoke im_channel_set_manger → 出站
// POST channel/add/manger（set=true）| channel/remove/manger（set=false）·body
// {channelId, users:[{id,name,role,teamId}]}（真源 channel_change_dedicated.rs §19/§20·全 camelCase）。
//
// 四面退化为 ①③（真源 §19/§20 + ws/handlers/channel_member_role_updated.rs）：
//   ① 出站   : POST channel/add/manger，body {channelId, users:[{id,name,role,teamId}]}（全 camelCase·
//              bodyForbidden channel_id snake / 顶层 userId/id/role 泄漏·成员四键嵌 users[]）。窗口隔离
//              （uc_id 过滤）+ endpoint 过滤定位唯一出站。
//   ③ DOM    : 等目标成员行 data-admin==1（壳 setManger 出站后乐观刷成员行 admin 标·L1 唯一可观测的
//              用户操作反馈面·权威态由 L2 #45 广播帧对账·壳 doc 声明）。
//   ②④ N/A  : 结构性 L2（add/remove manger 后端 WS 已注释·操作者收 channel_member_role_updated graceful
//              no-op·emit_channel_member_updated / channel_member 全量落库须 channel_member_update 广播帧·
//              须第二账号触发·见 L2 issue #45）。reducer runFourFacetCommandDom 不裁定 ②④。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置：debug app 已起（4445 + 1420）+ seeded db + debug-only invoke set_uc / im_create_channel /
//   im_channel_member_change / im_channel_set_manger 已注册 + run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。
//
// 锚频道选取（admin 权限真实约束·C003/C004）：设管理员须本人在该频道有 admin 权限（go AddChannelManger
//   作用于 session 所在 channel）。seeded 频道身份/成员关系不可控 → 先建一个本人 CREATOR 的新群
//   （UC-5.1 建群路径·**不含** 待设成员 445），再拉成员 445 进群（UC-6.1 路径·确保 445 在册可被设管理员），
//   再对 445 设管理员——真实用户流（建群→拉人→设管理员）且保证成员关系确定·无 DB 耦合。
//   诚实退化：建群无新行 / 设管理员后 DOM data-admin 不为 1 → fail（不放水·非 tautology）。

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

describe('UC-6.2 · 设/撤管理员（①③ 契约·②④ 结构性 L2 #45）', () => {
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

    // —— 先建一个本人 CREATOR 的新群（不含 445·下面拉进来）——
    // 建群归 __quiescence__（不开 UC 窗口）→ 其出站 channel/create / created 投影不混入 UC-6.2 束。
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-grp-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: [],
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行（断在 channel/create→WS channel_created→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    TARGET_CHANNEL_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(TARGET_CHANNEL_ID).toBeTruthy();
    console.log(`[UC-6.2] 设管理员锚频道（本人新建）channelId=${TARGET_CHANNEL_ID}`);

    // 把活动频道切到新建群（壳 onChangeManger 取 activeChannel 作目标频道）。
    await invokeBridge('im_query_messages_by_channel', { channelId: TARGET_CHANNEL_ID });

    // 注：不预拉成员 445 入册——UC-6.2 ① 出站只需向 bridge 显式传 userId（body users[].id=445），
    // ③ DOM data-admin 由壳 setManger **乐观刷**（成员行缺则 upsert·见 store.setManger doc），不依赖
    // channel_member_update 广播帧（该广播帧本就结构性 L2·见 #45）。预拉成员会引入对该广播的无谓依赖
    // （UC-6.1 同款 broadcast-dep·会假红本 UC ①③ 主路径），故省去。

    // 开 UC 窗口（窗口内帧/投影归 UC-6.2·建群已在窗口外完成）。
    await invokeBridge('set_uc', { uc: 'UC-6.2' });
  });

  it('①③：设管理员出站 channel/add/manger {channelId, users} + DOM data-admin 乐观回读（②④ 结构性 L2 #45 N/A）', async () => {
    // —— 触发设管理员（debug 桥复用 store.setManger 生产路径·与 UI『管』按钮同链路·非绕过）——
    // set=true → store.setManger → ① 出站 channel/add/manger·users:[{id:445,name:'',role:ADMIN,teamId}]
    // （经 im_channel_set_manger Rust 命令）+ ③ 乐观刷该成员行 admin 标（成员行缺则 upsert）。
    const r = await browser.executeAsync(
      (ch, uid, done) => {
        // @ts-ignore — 薄壳注入
        if (!window.__lf?.debugSetManger) {
          done({ ok: false, error: 'no __lf.debugSetManger bridge' });
          return;
        }
        // @ts-ignore
        window.__lf
          .debugSetManger(ch, uid, true)
          .then(() => done({ ok: true }))
          .catch((e) => done({ ok: false, error: String(e?.message ?? e) }));
      },
      TARGET_CHANNEL_ID,
      TARGET_MEMBER_ID
    );
    expect(r.ok).toBe(true);

    // —— ③ DOM：等目标成员行 data-admin == 1（壳 setManger 乐观刷 admin 标）——
    await browser.waitUntil(
      async () => {
        const dom = await readMemberDom(TARGET_MEMBER_ID);
        return dom.admin === '1';
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          'data-admin 未刷为 1（断在 invoke im_channel_set_manger→壳 setManger 乐观刷 admin 标）',
      }
    );
    const domFacet = await readMemberDom(TARGET_MEMBER_ID);
    // ③ 守可证伪：目标成员行 data-admin 必为 1（未刷 = ③ 红·非 tautology）。
    expect(domFacet.admin).toBe('1');
    expect(domFacet['member-id']).toBe(TARGET_MEMBER_ID);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ①③ reducer（②④ 结构性 L2 N/A·见 expect contractSources + L2 #45）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID },
      dom: {
        ...EXPECT.dom,
        dataAttrs: {
          ...EXPECT.dom.dataAttrs,
          'member-id': TARGET_MEMBER_ID,
          admin: '1',
        },
      },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetCommandDom({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-6.2 ①③ 报告] ' + report.summary);
    for (const f of ['outbound', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：channel/add/manger body {channelId, users}（bodyForbidden snake/顶层 userId/id/role 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ③ DOM：data-admin == 1 + data-member-id == 目标成员（上面 waitUntil + toBe 已断言）。
    expect(report.facets.dom.ok).toBe(true);
    // 整体绿（①③ 双面·②④ 结构性 L2 不在 order）。
    expect(report.green).toBe(true);
  });
});

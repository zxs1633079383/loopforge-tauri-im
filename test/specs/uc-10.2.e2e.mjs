// UC-10.2 系统通知 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-10.2 = **系统通知消息**：server 动作（改群名）派生的系统 NOTICE post 帧 → helix emit_post_received
// （fat 投影·type=NOTICE·userId=SYS·props.type=channelUpdate 透传）→ 壳 applyMessageItem 经
// isSystemNotice(type)（NOTICE_TYPES 命中）置 systemNotice → DOM data-system-notice='1' → message 落库。
// ① 出站 N/A（系统 post 由 server 动作派生·WS 帧触发；改名 channel/change 出站是触发机制·非本 UC 断面）。
//
// 真源（contract·C004 纠偏 issue #37）：
//   - UC-5.4 真机 wire 实证（run.jsonl seq19/514·ledger §UC-5.4）：改群名 server echo = channelUpdate
//     系统 NOTICE post（im:post:received·type=NOTICE·userId=SYS·props{type:channelUpdate,field:displayName,
//     content:新名}）。这是确定性可复现的系统通知源（≠ 建群尾随 post·后者本机未稳定到达）。
//   - full-map partials/7 §3：现网前端按 NOTICE_TYPES.includes(type) 走 <message-system> 系统行渲染；
//     NOTICE ∈ NOTICE_TYPES。本壳等价标 data-system-notice='1'（applyChannelUpdatePost 刷群头属性·
//     **不早退**·再 applyMessageItem 渲染系统消息行·两行为共存·现网同款）。
//   - issue/ledger 草拟锚「type=SYSTEM/SYSTEN」是 Phase1 简化 → 实际系统通知 wire type=NOTICE·已按
//     NOTICE_TYPES 纠偏 isSystemNotice。
//
// 串四面（issue #37 锚点·契约只读 expect/uc-10.2.expect.json）：
//   ① outbound : N/A（系统 post 帧触发·method=* url=* 空 body·isOutboundOptional 放行·不裁定）。
//   ② projection: 读 run.jsonl → reducer 按锚 ch 聚（chPerPostTarget·im:post:received + propsMatch）→
//                断 fat 13 键集 + data.type=NOTICE + userId=SYS + props{type:channelUpdate,field:displayName,
//                content:新名}（守可证伪·非系统 echo / 错 props 锚不上则 ② 红）。
//   ③ DOM    : 等本 channel 系统行 data-system-notice='1'（type=NOTICE→isSystemNotice→systemNotice）。
//   ④ storage: batch_upsert message 表 ≥1 行（系统 post echo 落库·复用 echo 落库链）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置（reload-app / harness up 提供）：debug app 已起（4445 + 1420）+ seeded db + 真 go 一轮
//   + debug-only invoke set_uc / im_create_channel / im_channel_change_display_name 已注册 +
//   run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。改名需本人 owner（建群即 CREATOR·保证 admin 权限·同 UC-5.4）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-10.2.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

const NEW_NAME = `lf-sysnotice-${Math.random().toString(36).slice(2, 8)}`;
// 建群真实成员 id（dev-local profile team 下真实 userId·复用 UC-5.1/5.4·非臆造）。
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

// 读某 channel 内系统通知消息行的 data-*（③ 注入 reducer 的 DOM 面）。
const readSystemRow = (channelId) =>
  browser.execute((ch) => {
    const el = document.querySelector(
      `.msg[data-channel-id="${ch}"][data-system-notice="1"]`
    );
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'system-notice': ds.systemNotice ?? null,
      'channel-id': ds.channelId ?? null,
      'type': ds.type ?? null,
    };
  }, channelId);

describe('UC-10.2 · 系统通知（系统 NOTICE post·② 投影 ③ DOM ④ 落库·① N/A）', () => {
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

    // —— 先建一个本人 CREATOR 的新群（保证改名有 admin 权限·真实用户流·同 UC-5.4）——
    //   建群归 __quiescence__（不开 UC 窗口）→ 其出站/投影不混入 UC-10.2 束。
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
    TARGET_CHANNEL_ID = (await snapshotChannelIds()).find((id) => !beforeIds.has(id));
    expect(TARGET_CHANNEL_ID).toBeTruthy();
    console.log(`[UC-10.2] 系统通知锚频道（本人新建·admin 权限）channelId=${TARGET_CHANNEL_ID}`);
  });

  it('②③④：改群名派生 channelUpdate 系统 NOTICE post → im:post:received(type=NOTICE) + DOM data-system-notice + message 落库（① N/A）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-10.2' });

    // —— 触发：改群名（channel/change/displayName → server 回 channelUpdate 系统 NOTICE post）——
    const r = await invokeBridge('im_channel_change_display_name', {
      channelId: TARGET_CHANNEL_ID,
      displayName: NEW_NAME,
    });
    expect(r.ok).toBe(true);

    // —— ③ DOM：等本群系统通知消息行出现（data-system-notice='1'·type=NOTICE→isSystemNotice）——
    let domFacet = null;
    await browser.waitUntil(
      async () => {
        domFacet = await readSystemRow(TARGET_CHANNEL_ID);
        return domFacet && domFacet['system-notice'] === '1';
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          '系统通知行未出现（断在 change/displayName→WS post(channelUpdate NOTICE)→im:post:received→isSystemNotice→data-system-notice）',
      }
    );
    expect(domFacet['system-notice']).toBe('1');
    expect(domFacet['msg-id']).toBeTruthy();
    console.log(
      `[UC-10.2 DOM] ch=${TARGET_CHANNEL_ID} msgId=${domFacet['msg-id']} type=${domFacet['type']} systemNotice=${domFacet['system-notice']}`
    );

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（ch 锚·chPerPostTarget 挑含 im:post:received + propsMatch.content 的束·① N/A·②③④ 裁定）——
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

    console.log('[UC-10.2 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站 N/A（系统 post 帧触发·optional·总绿不裁定）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影：im:post:received fat 13 键 + data.type=NOTICE + userId=SYS + props{channelUpdate,displayName,新名}。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert message ≥1 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：行标 data-system-notice='1'。
    expect(report.facets.dom.ok).toBe(true);
    // 整体绿。
    expect(report.green).toBe(true);
  });
});

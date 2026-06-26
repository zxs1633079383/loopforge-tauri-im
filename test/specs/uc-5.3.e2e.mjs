// UC-5.3 关闭/退出群 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-5.3 是命令触发型 UC（作用于已存在频道·≠ UC-5.1 建新群）：点频道行 [data-testid=close-channel-btn]
// → onCloseChannel → store.closeChannel → invoke im_channel_close → 出站 POST channel/close {channelId}
// → WS channel_close（broadcast 到 channelId·自己也收）→ ④ channel 表 batch_update（delete_at +
// is_active=0）+ ② im:channel:closed{channelId, deleteAt} → ③ DOM channel 行移除（data-channel-id 消失）。
//
// 覆盖（coverage-crossmap.md）：HTTP #27 POST channel/close（covered·UC-5.3）+ WS #13 channel_close
// （UC-5.3·emit_channel_closed）。
//
// 串四面（issue #25 锚点 · 契约只读 expect/uc-5.3.expect.json）：
//   ① 出站   : POST channel/close，body {channelId}（channelId=目标频道·camelCase·bodyForbidden
//              id/channel_id 别名/top/displayName/notice/deleteAt 泄漏）。装饰器标准 body.channelId
//              探针（ch 别名）→ 归锚 ch 束（窗口内唯一一条 channel/close）。
//   ② 投影   : 读 run.jsonl → reducer 按锚 ch 聚 → 断 im:channel:closed 投影字段集 {channelId, deleteAt}
//              （独立 broadcast 推送·缺/多即 fail）。
//   ③ DOM    : 等该 channel 行 data-channel-id 消失（im:channel:closed → applyChannelClosed filter 删行）。
//   ④ 落库   : channel 表 batch_update（delete_at + is_active=0·表感知归一 channel.id → ch → 与 ②③ 同束）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置：debug app 已起（4445 + 1420）+ seeded db + 真 go 一轮（关闭需真后端推 channel_close
//   echo）+ debug-only invoke set_uc / im_create_channel / im_channel_close 已注册 + run.jsonl 落点
//   经 env HELIX_RUN_JSONL 暴露。
//
// 锚频道选取（admin 权限真实约束·C003/C004）：关闭群须本人是群 owner/admin（go close 校验权限）。
//   seeded 频道多由他人创建（本机身份仅 MEMBER）→ 关闭被拒。故本 UC 先建一个本人 CREATOR 的新群
//   （UC-5.1 建群路径·user 444=CREATOR→owns it），再关闭它——真实用户流（建群后关闭）且保证 admin
//   权限·无 DB 耦合。诚实退化：建群无新行 / 关闭后 DOM 行仍在 → fail（不放水·非 tautology）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-5.3.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// 建群真实成员 id（dev-local profile team 下真实 userId·非臆造·复用 UC-5.4）。
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

// 当前 DOM 已渲染的 channel id 集（取关闭目标·建群新行）。
const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

// 读某 channel 行的 data-channel-id（③ 注入 reducer 的 DOM 面·行移除后应缺值 null）。
const readChannelDom = (channelId) =>
  browser.execute((id) => {
    const row = document.querySelector(`[data-channel-id="${id}"]`);
    return { 'channel-id': row?.getAttribute('data-channel-id') ?? null };
  }, channelId);

describe('UC-5.3 · 关闭/退出群（四面契约）', () => {
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

    // —— 先建一个本人 CREATOR 的新群（保证关闭有 admin 权限·真实用户流：建群后关闭）——
    // 建群归 __quiescence__（不开 UC 窗口）→ 其出站 channel/create / created 投影不混入 UC-5.3 束。
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
    console.log(`[UC-5.3] 关闭锚频道（本人新建·有 admin 权限）channelId=${TARGET_CHANNEL_ID}`);

    // —— settle 前置（C014·intra-spec 竞态根治·跑序无关）——
    // 建群 server 会异步推一条 type:join 系统 post（操作者 444 入群）。若该 im:post:received 在
    // close 投影**之后**才到，post-received 会把已关频道重新加回列表 → DOM 行复现 → 关闭行移除
    // 断言超时假红（与跑序无关·纯 create→close intra-spec 时序竞态·reload 隔离修不到）。
    // 故关闭前先等 join 回声在 run.jsonl 落定（仍归 __quiescence__ 窗口·set_uc 之前·不混入
    // UC-5.3 束），令 close 成为该频道**终态事件**——其后无更多 post 可复现行。
    await browser.waitUntil(
      () => {
        let jsonl;
        try { jsonl = readFileSync(RUN_JSONL, 'utf8'); } catch { return false; }
        return jsonl.split('\n').some((ln) => {
          if (!ln.includes(TARGET_CHANNEL_ID)) return false;
          let o; try { o = JSON.parse(ln); } catch { return false; }
          const p = o?.payload;
          return p?.event === 'im:post:received' && p?.data?.channelId === TARGET_CHANNEL_ID;
        });
      },
      { timeout: 15000, interval: 200, timeoutMsg: '建群 join 系统 post 回声未落定（settle 前置·C014·确保 close 为终态事件）' }
    );
    console.log(`[UC-5.3] 建群 join 回声已落定 → close 将为终态事件（settle·C014）`);

    // 开 UC 窗口（窗口内帧/投影归 UC-5.3·建群已在窗口外完成）。
    await invokeBridge('set_uc', { uc: 'UC-5.3' });
  });

  it('①②③④：关闭出站 channel/close → 投影 im:channel:closed + 落库 channel batch_update + DOM 行移除', async () => {
    // —— 触发关闭（bridge 直 invoke·注入锚频道·C007 close-channel-btn 同链路）——
    const r = await invokeBridge('im_channel_close', { channelId: TARGET_CHANNEL_ID });
    expect(r.ok).toBe(true);

    // —— ③ DOM：等该 channel 行 data-channel-id 消失（im:channel:closed→applyChannelClosed filter 删行）——
    await browser.waitUntil(
      async () => {
        const dom = await readChannelDom(TARGET_CHANNEL_ID);
        return dom['channel-id'] == null;
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          'channel 行未移除（断在 channel/close→WS channel_close→im:channel:closed→applyChannelClosed 删行）',
      }
    );
    const domFacet = await readChannelDom(TARGET_CHANNEL_ID);
    expect(domFacet['channel-id']).toBe(null);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（锚频道 ch 作锚）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-5.3 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：channel/close body {channelId}（bodyForbidden id/channel_id 别名/top/displayName/notice/deleteAt）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == im:channel:closed {channelId, deleteAt}（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_update channel（delete_at + is_active=0）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：channel 行移除（data-channel-id !absent）。
    expect(report.facets.dom.ok).toBe(true);
  });
});

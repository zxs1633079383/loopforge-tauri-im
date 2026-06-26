// UC-6.4 成员快照/全量 e2e —— WebdriverIO，读族 request-response 传输。
//
// 读族特性（projection-schema §1.2 / four-facet read-family · 同 UC-2.4）：
//   - **无 WS 回声**（write 特有）；HTTP 200 响应体本身即数据 → helix read_relay::emit_read_result
//     透传回灌 `im:read:result{req_id, body}`。
//   - **四面退化为 ①②**：① 出站 wire body 逐字检（urlEndsWith + bodyFields camelCase + bodyForbidden
//     禁 snake/单数泄漏）；② 投影 envelope（im:read:result 外层 {req_id, body} 键集 + req_id 锚本次 invoke）。
//     ③ DOM / ④ storage = N/A（读路径无 write 驱动 DOM·成员自愈落库由 helix 内部兑现·装饰器不暴露）
//     → reducer runFourFacetRead 不裁定。
//   - **req_id 锚**（非四维 corr_key）：e2e 经 bridge invoke 时注入 reqId → helix module::read_req_id
//     抠出注册 OutboundReadReply{req_id} → 回灌 im:read:result{req_id} → reducer 按 reqId 锁本束。
//
// 两 endpoint（partial 2 §5/§6）：
//   A. channels/member/byIds  body {channelIds:[活动频道]}（成员全量自愈·len 1..200）
//   B. channel/member/snapshot body {channelId, startTime, endTime}（时间窗成员快照·int64 毫秒）
//
// 驱动方式（最简 + 确定性）：e2e 经 window.__lf.invoke 直 invoke 读族命令（im_members_by_ids /
//   im_member_snapshot）注入真实 channelId（活动频道·seeded DB 真频道）+ reqId → waitUntil 等
//   run.jsonl 出现本次 reqId 的 im:read:result projection hop → 跑 runFourFacetRead 裁定 ①②。
//   （DOM 触发路径见 app.component load-members-btn → onLoadMembers·此处走 bridge 直 invoke 求确定性·
//    与 onLoadMembers 同命令同 body·非旁路。）
//
// 时序纪律（HX-C011）：waitUntil 等 projection 回灌落进 run.jsonl，无固定 pause。破坏即红（少 invoke →
//   ① 红·少回灌 → ② 红·见 reducer runFourFacetRead 可证伪对偶）。
//
// 依赖前置（run.sh / harness up 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db 含真频道+成员）+ HELIX_RUN_JSONL 暴露 hop 落点。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-6.4.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（与 onLoadMembers 同命令·求确定性）。 */
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

/** 取当前活动频道（store 锚定·bootstrap dialogList 设）。 */
const getActiveChannel = () =>
  browser.execute(() =>
    document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
  );

/** 等 run.jsonl 出现本次 reqId 的 im:read:result projection hop（读族回灌落点）。 */
async function waitReadResult(reqId, endpoint) {
  await browser.waitUntil(
    () => {
      let jsonl = '';
      try {
        jsonl = readFileSync(RUN_JSONL, 'utf8');
      } catch {
        return false;
      }
      for (const line of jsonl.split('\n')) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          ev.facet === 'projection' &&
          ev.hop === 'projection' &&
          ev.payload?.event === 'im:read:result' &&
          (ev.payload?.data?.req_id ?? ev.payload?.data?.reqId) === reqId
        ) {
          return true;
        }
      }
      return false;
    },
    { timeout: 15000, interval: 150, timeoutMsg: `${endpoint} im:read:result(req_id=${reqId}) 未回灌` }
  );
}

describe('UC-6.4 · 成员快照/全量（读族 request-response·断面 ①②）', () => {
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready 标志。
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('[data-ready]')?.getAttribute('data-ready')
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    CHANNEL_ID = await getActiveChannel();
    expect(CHANNEL_ID).toBeTruthy();
  });

  it('①②：channels/member/byIds 成员全量自愈 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-6.4' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // 读族 invoke：channelIds=[活动频道] + reqId（前端 bridge 生成·回灌关联）。
    const r = await invokeBridge('im_members_by_ids', {
      channelIds: [CHANNEL_ID],
      reqId,
    });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'membersByIds');

    // 关窗口（窗口隔离·后续帧归 __quiescence__·不串味本 UC 束）。
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.membersByIds,
      reqId,
      ucId: 'UC-6.4',
    });

    console.log('[UC-6.4 membersByIds 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('①②：channel/member/snapshot 时间窗成员快照 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-6.4' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // 时间窗：开天辟地到现在（覆盖 seeded 全部成员变更·startTime/endTime int64 毫秒）。
    const startTime = 0;
    const endTime = Date.now();
    const r = await invokeBridge('im_member_snapshot', {
      channelId: CHANNEL_ID,
      startTime,
      endTime,
      reqId,
    });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'memberSnapshot');

    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.memberSnapshot,
      reqId,
      ucId: 'UC-6.4',
    });

    console.log('[UC-6.4 memberSnapshot 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });
});

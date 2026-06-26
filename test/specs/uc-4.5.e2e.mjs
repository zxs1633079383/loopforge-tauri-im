// UC-4.5 陌生 channel 兜底 e2e —— WebdriverIO，读族 request-response 传输。
//
// UC-4.5 是**前端 invoke 触发·读族**（进入未加载过的陌生频道触发单频道增量同步）：
//   invoke im_ensure_channel_loaded → 出站 `POST channel/load/incrementByChannelId {channelId}`
//   （channel_read.rs LoadIncrementByChannelIdCommand·is_read=true·HTTP 直返单条 *IncrementChannel·
//   不推送）→ helix read_relay::emit_read_result 透传回灌 `im:read:result{req_id, body}`。
//
// 读族特性（projection-schema §1.2 / four-facet read-family）：
//   - **无 WS 回声**（write 特有）；HTTP 200 响应体本身即数据 → read_relay 透传回灌。
//   - **四面退化为 ①②**：① 出站 wire body 逐字检（urlEndsWith=channel/load/incrementByChannelId +
//     bodyFields {channelId} camelCase + bodyForbidden 禁 snake/cursor 泄漏）；② 投影 envelope
//     （im:read:result 外层 {req_id, body} 键集 + req_id 锚本次 invoke）。
//     ③ DOM / ④ storage = N/A（读路径无 write 驱动 DOM·不落新行·cursor 不推进）→ reducer
//     runFourFacetRead 不裁定。〔issue #33 草拟锚『② emit_channel_increment / ④ channel+cursor』与
//     冻结真源 channel_read.rs is_read=true + read_relay.rs 读族透传冲突·按 C004 校正为读族 ①② 两面·
//     见 expect _note。〕
//   - **req_id 锚**（非四维 corr_key）：e2e 经 bridge invoke 时注入 reqId → helix module::read_req_id
//     抠出注册 OutboundReadReply{req_id} → 回灌 im:read:result{req_id} → reducer 按 reqId 锁本束。
//
// 驱动方式（最简 + 确定性）：e2e 经 window.__lf.invoke 直 invoke 读族命令（im_ensure_channel_loaded）
//   注入真实 channelId（seeded DB 真频道 server id·当前活动频道·进入即陌生兜底）+ reqId → waitUntil
//   等 run.jsonl 出现本次 reqId 的 im:read:result projection hop → 跑 runFourFacetRead 裁定 ①②。
//   （DOM 触发路径见 app.component ensure-channel-loaded-btn → onEnsureChannelLoaded·此处走 bridge 直
//    invoke 求确定性·与 onEnsureChannelLoaded 同命令同 body·非旁路。）
//
// 时序纪律（HX-C011）：waitUntil 等 projection 回灌落进 run.jsonl，无固定 pause。破坏即红（少 invoke →
//   ① 红·少回灌 → ② 红·见 reducer runFourFacetRead 可证伪对偶）。
//
// 依赖前置（run.sh / harness.sh 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db 含真频道）+ HELIX_RUN_JSONL 暴露 hop 落点。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-4.5.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（与 onEnsureChannelLoaded 同命令·求确定性）。 */
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

/** 取当前活动频道（store 锚定·bootstrap dialogList 设·进入即陌生兜底锚频道）。 */
const getActiveChannel = () =>
  browser.execute(() =>
    document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
  );

/** 取任一渲染出的频道行 id（活动频道为空时兜底·CL 区 data-channel-id）。 */
const getAnyChannel = () =>
  browser.execute(
    () => document.querySelector('[data-channel-id]')?.getAttribute('data-channel-id') ?? null
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

describe('UC-4.5 · 陌生 channel 兜底（读族 request-response·断面 ①②）', () => {
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready=true（increment_channel_end 收齐 + inflight0 + cursor 稳）。
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('[data-ready]')?.getAttribute('data-ready')
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    // 锚频道：当前活动频道（进入即陌生兜底）；无活动 → 取任一渲染频道行 id（CL 区·真频道 server id）。
    CHANNEL_ID = (await getActiveChannel()) || (await getAnyChannel());
    expect(CHANNEL_ID).toBeTruthy();
  });

  it('①②：ensure_channel_loaded → channel/load/incrementByChannelId {channelId} + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-4.5' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // 读族 invoke：channelId=陌生兜底锚频道 server id + reqId（前端 bridge 生成·回灌关联）。
    const r = await invokeBridge('im_ensure_channel_loaded', {
      channelId: CHANNEL_ID,
      reqId,
    });
    expect(r.ok).toBe(true);

    // 等回灌落进 run.jsonl（读族无 WS 回声·HTTP 200 → emit_read_result）。
    await waitReadResult(reqId, 'incrementByChannelId');

    // 关窗口（窗口隔离·后续帧归 __quiescence__·不串味本 UC 束）。
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT,
      reqId,
      ucId: 'UC-4.5',
    });

    console.log('[UC-4.5 读族报告] ' + report.summary);
    for (const f of ['outbound', 'projection']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：channel/load/incrementByChannelId wire body {channelId} 全 camelCase·禁 snake/cursor 泄漏。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影：im:read:result {req_id, body} 外层键集 + req_id 锚本次 invoke。
    expect(report.facets.projection.ok).toBe(true);
    expect(report.green).toBe(true);
  });
});

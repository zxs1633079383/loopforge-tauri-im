// UC-12.1 健康探针 e2e —— WebdriverIO，读族 request-response（同 UC-5.8 / UC-6.4 / UC-4.5）。
//
// 读族连通性特性（issue #41·本 UC 仅 ① 面）：
//   - 出站 `GET /api/cses/health`·**无请求体**·不走业务信封（health.go healthCheck → 裸
//     `{"status":"OK"}`·partials/3 §15）。is_read=true → HTTP 200 响应体经 helix
//     `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body:{status:"OK"}}`。
//   - **四面退化为 ①**：① 出站 GET health（urlEndsWith /api/cses/health·method GET·空 body·
//     bodyForbidden 锚无业务字段泄漏）。② 投影 N/A（expect 缺 projection 节 → reducer
//     isProjectionOptional → 不裁定·读族回灌为副产·非冻结业务面）。③ DOM data-health（可选·非冻结
//     面·本 UC 不裁定）④ storage N/A（健康端点无 DB 表）。本 UC 验收 = 连通性（GET health + 200）。
//   - **req_id 锚**：e2e 经 bridge invoke 时注入 reqId → helix module::read_req_id 抠出注册
//     OutboundReadReply{req_id} → 回灌 im:read:result{req_id}·spec 据此 waitUntil 等回灌落 run.jsonl
//     （证 HTTP 200 真达·连通性成立·非 tautology：服务端不通 → 无 200 回灌 → 超时红）。
//
// 驱动方式（最简 + 确定性）：e2e 经 window.__lf.invoke 直 invoke im_health 注入确定性 reqId →
//   waitUntil 等本次 reqId 的 im:read:result projection hop 落 run.jsonl（证连通性 200）→ 跑
//   runFourFacetRead 裁定 ①（projection optional·② 不裁定）。
//   （DOM 触发路径见 app.component health-btn → onHealth → store.checkHealth·此处走 bridge 直
//    invoke 求确定性·与 onHealth 同命令同 body·非旁路。）
//
// 时序纪律（HX-C011）：waitUntil 等 im:read:result 回灌落进 run.jsonl，无固定 pause。破坏即红
//   （少 invoke → ① 红·服务端不通 → 无 200 回灌 → 超时红·见 reducer runFourFacetRead 可证伪对偶）。
//
// 依赖前置（run.sh / harness up 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db）+ HELIX_RUN_JSONL 暴露 hop 落点 + go 服务端健康（curl ping 200）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-12.1.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（与 onHealth 同命令·求确定性）。 */
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

/** 等 run.jsonl 出现本次 reqId 的 im:read:result projection hop（健康回灌落点·证 200 连通性）。 */
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
    { timeout: 15000, interval: 150, timeoutMsg: `${endpoint} im:read:result(req_id=${reqId}) 未回灌（连通性 200 未达）` }
  );
}

describe('UC-12.1 · 健康探针（读族 request-response·断面 ①·连通性+200）', () => {
  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready 标志。
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('[data-ready]')?.getAttribute('data-ready')
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );
  });

  it('①：GET /api/cses/health 无请求体出站 + 200 连通性回灌（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-12.1' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    const r = await invokeBridge('im_health', { reqId });
    expect(r.ok).toBe(true);

    // 等 200 回灌（证服务端真连通·非 tautology：不通则无回灌 → 超时红）。
    await waitReadResult(reqId, 'health');

    // 关窗口（窗口隔离·后续帧归 __quiescence__·不串味本 UC 束）。
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.channelHealth,
      reqId,
      ucId: 'UC-12.1',
    });

    console.log('[UC-12.1 health 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });
});

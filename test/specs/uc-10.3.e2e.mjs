// UC-10.3 获取全部功能模块 e2e —— WebdriverIO，读族 request-response 传输（同 UC-5.8 / UC-6.4 / UC-4.5）。
//
// 读族特性（projection-schema §1.2 / four-facet read-family）：
//   - **无 WS 回声**（write 特有）；HTTP 200 响应体本身即数据 → helix read_relay::emit_read_result
//     透传回灌 `im:read:result{req_id, body}`。
//   - **四面退化为 ①②**：① 出站 wire body 逐字检（urlEndsWith modules/getAll + method POST；handler
//     **不解析 body** → 出站为空 {}·bodyForbidden 锚 snake/别名旧形态泄漏）；② 投影 envelope
//     （im:read:result {req_id, body} 外层键集 + req_id 锚本次 invoke）。③ DOM / ④ storage = N/A
//     （读路径无 write 驱动 DOM·模块列表由前端从透传 body 抽渲染·非冻结契约面）→ reducer 不裁定。
//   - **req_id 锚**（非四维 corr_key）：e2e 经 bridge invoke 时注入 reqId → helix module::read_req_id
//     抠出注册 OutboundReadReply{req_id} → 回灌 im:read:result{req_id} → reducer 按 reqId 锁本束。
//
// endpoint（partial 3 §8）：POST /api/cses/modules/getAll·handler getAllModules 无请求结构（不解析 body）
//   → data = []*ent.Modules（dto.CommonRes 信封·裸 ent·id/name/label/url）。
//   迁移状态（partial 11 §8）：已迁移（含修笔误·SetData 不 SetMessage）·go-served HTTP 读可真跑 ①②。
//
// 驱动方式（最简 + 确定性）：e2e 经 window.__lf.invoke 直 invoke 读族命令 im_modules_get_all（无 body·
//   仅注入 reqId）→ waitUntil 等 run.jsonl 出现本次 reqId 的 im:read:result projection hop → 跑
//   runFourFacetRead 裁定 ①②。
//
// 时序纪律（HX-C011 / C008）：waitUntil 等 projection 回灌落进 run.jsonl，无固定 pause。破坏即红
//   （少 invoke → ① 红·少回灌 → ② 红·见 reducer runFourFacetRead 可证伪对偶）。
//
// 依赖前置（run.sh / harness up 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db）+ HELIX_RUN_JSONL 暴露 hop 落点。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-10.3.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（求确定性）。 */
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

describe('UC-10.3 · 获取全部功能模块（读族 request-response·断面 ①②）', () => {
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

  it('①②：modules/getAll 拉全部模块 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-10.3' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // modules/getAll 无 body（handler 不解析请求体）→ 仅注入 reqId 驱动读族回灌锚。
    const r = await invokeBridge('im_modules_get_all', { reqId });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'modulesGetAll');

    // 关窗口（窗口隔离·后续帧归 __quiescence__·不串味本 UC 束）。
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.modulesGetAll,
      reqId,
      ucId: 'UC-10.3',
    });

    console.log('[UC-10.3 modulesGetAll 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });
});

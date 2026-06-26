// UC-2.4 一级/二级回复列表查询 e2e —— WebdriverIO，读族 request-response 传输。
//
// 读族特性（projection-schema §1.2 / four-facet read-family）：
//   - **无 WS 回声**（write 特有）；HTTP 200 响应体本身即数据 → helix read_relay::emit_read_result
//     透传回灌 `im:read:result{req_id, body}`。
//   - **四面退化为 ①②**：① 出站 wire body 逐字检（urlEndsWith + bodyFields camelCase + bodyForbidden
//     禁 snake/offset 泄漏）；② 投影 envelope（im:read:result 外层 {req_id, body} 键集 + req_id 锚本次 invoke）。
//     ③ DOM / ④ storage = N/A（读路径无 write 驱动 DOM·不落新行）→ reducer runFourFacetRead 不裁定。
//   - **req_id 锚**（非四维 corr_key）：e2e 经 bridge invoke 时注入 reqId → helix module::read_req_id
//     抠出注册 OutboundReadReply{req_id} → 回灌 im:read:result{req_id} → reducer 按 reqId 锁本束。
//
// 驱动方式（最简 + 确定性）：e2e 经 window.__lf.invoke 直 invoke 读族命令（im_get_replies /
//   im_get_reply_branch）注入真实 replyId（seeded DB 真消息 server id）+ reqId → waitUntil 等
//   run.jsonl 出现本次 reqId 的 im:read:result projection hop → 跑 runFourFacetRead 裁定 ①②。
//   （DOM 触发路径见 app.component reply-drawer-btn/reply-branch-btn·此处走 bridge 直 invoke 求确定性·
//    与 onLoadReplies/onLoadReplyBranch 同命令同 body·非旁路。）
//
// 时序纪律（HX-C011）：waitUntil 等 projection 回灌落进 run.jsonl，无固定 pause。破坏即红（少 invoke →
//   ① 红·少回灌 → ② 红·见 reducer runFourFacetRead 可证伪对偶）。
//
// 依赖前置（run.sh 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db 含真消息）+ HELIX_RUN_JSONL 暴露 hop 落点。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-2.4.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（与 onLoadReplies/onLoadReplyBranch 同命令·求确定性）。 */
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

/** seeded DB 路径（engine.rs：sqlite:<HELIX_DB>?mode=rwc·默认 /tmp/loopforge-im.db）。 */
const SEED_DB = `${process.env.HELIX_DB ?? '/tmp/loopforge-im.db'}?mode=rwc`;

/**
 * 从 seeded DB 取一个真实 server postId 作回复链根（replyId）。
 *
 * 为什么读 DB 而非 DOM：冷启动 current-cursor 增量为空（已知 #7 server-data-gap），消息列表
 * 不渲染行（无 im:post:received echo / 无 hello 增量）→ DOM 取不到已对账消息 server id。读族
 * getReplies 只需一个**真实存在**的 server postId（查它的回复·response 可空·四面只验 ① wire body
 * + ② 投影 envelope）。故从 seeded DB（739 真消息·真 server id）直取——决定性、不依赖渲染态。
 * 优先取消息最多频道的一条 post（回复链根最可能有真分支·但即便空回复也满足读族断面）。
 */
const seedReplyRootId = () => {
  const out = execFileSync(
    'sqlite3',
    [
      SEED_DB,
      "SELECT id FROM message WHERE channel_id=(SELECT channel_id FROM message GROUP BY channel_id ORDER BY count(*) DESC LIMIT 1) LIMIT 1;",
    ],
    { encoding: 'utf8' }
  );
  return out.trim();
};

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

describe('UC-2.4 · 一级/二级回复列表（读族 request-response·断面 ①②）', () => {
  let CHANNEL_ID;
  let REPLY_ID;

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
    // 取一条真实 server postId 作回复链根（seeded DB·决定性·不依赖渲染态·见 seedReplyRootId 注）。
    REPLY_ID = seedReplyRootId();
    expect(REPLY_ID).toBeTruthy();
  });

  it('①②：getReplies 一级回复列表 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-2.4' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // 读族 invoke：replyId=已对账消息 server id + reqId（前端 bridge 生成·回灌关联）。
    const r = await invokeBridge('im_get_replies', { replyId: REPLY_ID, reqId });
    expect(r.ok).toBe(true);

    // 等回灌落进 run.jsonl（读族无 WS 回声·HTTP 200 → emit_read_result）。
    await waitReadResult(reqId, 'getReplies');

    // 关窗口（窗口隔离·后续帧归 __quiescence__·不串味本 UC 束）。
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.getReplies,
      reqId,
      ucId: 'UC-2.4',
    });

    console.log('[UC-2.4 getReplies 读族报告] ' + report.summary);
    for (const f of ['outbound', 'projection']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：posts/getReplies wire body {replyId, pageNumber, pageSize} 全 camelCase·禁 snake/offset 泄漏。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影：im:read:result {req_id, body} 外层键集 + req_id 锚本次 invoke。
    expect(report.facets.projection.ok).toBe(true);
    expect(report.green).toBe(true);
  });

  it('①②：getReplyBranch 二级回复分支 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-2.4' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // 二级分支：replyFirstLevelId=一级回复 server id（无真分支链时复用同一已对账消息 id 作分支锚·
    // 读族断面只验 ①出站 wire body + ②投影 envelope·body 可空·分支锚 id 真实即可）。
    const r = await invokeBridge('im_get_reply_branch', {
      replyFirstLevelId: REPLY_ID,
      reqId,
    });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'getReplyBranch');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.getReplyBranch,
      reqId,
      ucId: 'UC-2.4',
    });

    console.log('[UC-2.4 getReplyBranch 读族报告] ' + report.summary);
    for (const f of ['outbound', 'projection']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：posts/getReplyBranch wire body {replyFirstLevelId, pageNumber, pageSize}·禁 offset/snake 泄漏。
    expect(report.facets.outbound.ok).toBe(true);
    expect(report.facets.projection.ok).toBe(true);
    expect(report.green).toBe(true);
  });
});

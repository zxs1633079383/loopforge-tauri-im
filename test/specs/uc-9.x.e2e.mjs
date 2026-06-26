// UC-9.x 书签 e2e —— WebdriverIO，读族 request-response 传输（create/delete/load 三命令）。
//
// 读族特性（projection-schema §1.2 / four-facet read-family · 同 UC-6.4 成员快照）：
//   - **无 WS 回声**（write 特有）；书签三命令 helix 注册 is_read=true·HTTP 200 响应体即数据 →
//     helix query::emit_read_result 透传回灌 `im:read:result{req_id, body}`。
//   - **四面退化为 ①②**：① 出站 wire body 逐字检（urlEndsWith + bodyFields camelCase + bodyForbidden
//     禁 snake/复数泄漏）；② 投影 envelope（im:read:result 外层 {req_id, body} 键集 + req_id 锚本次 invoke）。
//     ③ DOM data-bookmark / ④ 书签落库 = N/A（前端从透传 body 抽收藏列表渲染·书签落库 helix 内部兑现·
//     装饰器不暴露）→ reducer runFourFacetRead 不裁定。
//   - **req_id 锚**（非四维 corr_key）：e2e 经 bridge invoke 时注入 reqId → helix module::read_req_id
//     抠出注册 OutboundReadReply{req_id} → 回灌 im:read:result{req_id} → reducer 按 reqId 锁本束。
//
// 三 endpoint（partial 1 §33/§34/§35）：
//   A. post/bookmark/create  body {channelId, userId, postIds:[postId]}（收藏消息·userId 取壳后端身份）
//   B. post/bookmark/load    body {channelId, userId} + 扁平 PageOpts（加载收藏列表·分页）
//   C. post/bookmark/delete  body {userId, postId}（取消收藏）
//
// 真实 postId 来源（须 server_id 才能收藏·复用 UC-1.1 发消息流·同 UC-3.2 套路）：
//   先 bridge invoke im_send → 等 echo 覆写 data-msg-id（tmp → server id）→ 取 server_id 作 postId。
//
// 驱动方式（最简 + 确定性）：e2e 经 window.__lf.invoke 直 invoke 读族命令（im_bookmark_create /
//   im_bookmark_load / im_bookmark_delete）注入真实 channelId/postId/reqId → waitUntil 等 run.jsonl
//   出现本次 reqId 的 im:read:result projection hop → 跑 runFourFacetRead 裁定 ①②。
//   （DOM 触发路径见 app.component bookmark-create-btn → onCreateBookmark / bookmark-btn → onBookmark·
//    此处走 bridge 直 invoke 求确定性·与 onCreateBookmark 等同命令同 body·非旁路。）
//
// 时序纪律（HX-C011）：waitUntil 等 projection 回灌落进 run.jsonl，无固定 pause。破坏即红（少 invoke →
//   ① 红·少回灌 → ② 红·见 reducer runFourFacetRead 可证伪对偶）。
//
// 依赖前置（run.sh / harness up 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db 含真频道）+ HELIX_RUN_JSONL 暴露 hop 落点。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-9.x.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 生成 26 位 z-base-32 临时 id（与薄壳 genTempId 同字符集·会话内唯一作发送锚）。 */
function genTempId() {
  const charset = 'ybndrfg8ejkmcpqxot1uwisza345h769';
  let s = '';
  for (let i = 0; i < 26; i++) s += charset[Math.floor(Math.random() * 32)];
  return s;
}

/** 经薄壳 __lf 桥直 invoke Tauri 命令（与 onCreateBookmark 等同命令·求确定性）。 */
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

describe('UC-9.x · 书签（读族 request-response·断面 ①②·create/load/delete）', () => {
  let CHANNEL_ID;
  let POST_ID; // 被收藏消息 server_id（先发一条消息取真实 server id）

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

    // —— 取真实 postId：发一条消息 → 等 echo 覆写 data-msg-id（tmp → server id）——
    await invokeBridge('set_uc', { uc: 'UC-9.x-send' });
    const TEXT = `bookmark-test-${Math.random().toString(36).slice(2, 8)}`;
    const tmp = genTempId();
    const sendResult = await invokeBridge('im_send', {
      channelId: CHANNEL_ID,
      text: TEXT,
      temporaryId: tmp,
    });
    expect(sendResult.ok).toBe(true);

    await browser.waitUntil(
      async () => {
        const sid = await browser.execute((t) => {
          const el = document.querySelector(`[data-temporary-id="${t}"]`);
          const mid = el?.getAttribute('data-msg-id') ?? null;
          return mid && mid !== t ? mid : null;
        }, tmp);
        return !!sid;
      },
      { timeout: 15000, interval: 150, timeoutMsg: 'echo 未覆写（send 未对账·无真实 server_id 可收藏）' }
    );

    POST_ID = await browser.execute((t) => {
      const el = document.querySelector(`[data-temporary-id="${t}"]`);
      return el?.getAttribute('data-msg-id') ?? null;
    }, tmp);
    expect(POST_ID).toBeTruthy();
    expect(POST_ID).not.toBe(tmp);
    console.log(`[UC-9.x setup] 基础消息 server_id(postId)=${POST_ID}`);

    // 关窗口（send 帧归 __quiescence__·不串味本 UC 束）。
    await invokeBridge('set_uc', { uc: '__quiescence__' });
  });

  it('①②：post/bookmark/create 收藏消息 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-9.x' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // 读族 invoke：channelId=活动频道 + postIds=[真实 server_id] + reqId（userId 壳后端补·身份单一真源）。
    const r = await invokeBridge('im_bookmark_create', {
      channelId: CHANNEL_ID,
      postIds: [POST_ID],
      reqId,
    });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'bookmarkCreate');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.bookmarkCreate,
      reqId,
      ucId: 'UC-9.x',
    });

    console.log('[UC-9.x bookmarkCreate 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('①②：post/bookmark/load 加载收藏列表 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-9.x' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // 分页：pageSize=50 / pageNumber=1（PageOpts 扁平·缺 pageSize → SQL LIMIT 失真·真源 §35 注释）。
    const r = await invokeBridge('im_bookmark_load', {
      channelId: CHANNEL_ID,
      pageSize: 50,
      pageNumber: 1,
      reqId,
    });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'bookmarkLoad');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.bookmarkLoad,
      reqId,
      ucId: 'UC-9.x',
    });

    console.log('[UC-9.x bookmarkLoad 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('①②：post/bookmark/delete 取消收藏 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-9.x' });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    // 取消收藏前面 create 的同一条消息（userId 壳后端补·身份单一真源）。
    const r = await invokeBridge('im_bookmark_delete', {
      postId: POST_ID,
      reqId,
    });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'bookmarkDelete');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.bookmarkDelete,
      reqId,
      ucId: 'UC-9.x',
    });

    console.log('[UC-9.x bookmarkDelete 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });
});

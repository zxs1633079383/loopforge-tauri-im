// UC-5.6r 公告读族 acceptList/list/detail e2e —— WebdriverIO，读族 request-response 传输（同 UC-5.8 / 6.4 / 4.5）。
//
// 读族特性（projection-schema §1.2 / four-facet read-family）：
//   - 三端点（partial 1 §28 acceptList / §30 list / §31 detail）均**纯读 announcement 表**（WS 事件列 '—'·
//     无 post_update 回声）；HTTP 200 响应体本身即数据 → helix read_relay::emit_read_result 透传回灌
//     `im:read:result{req_id, body}`。
//   - **四面退化为 ①②**：① 各端点出站 wire body 逐字检（urlEndsWith /post 单数前缀 + bodyFields 恒在
//     字段 camelCase + bodyForbidden 禁 snake/复数前缀泄漏）；② 投影 envelope（im:read:result {req_id,
//     body} 外层键集 + req_id 锚本次 invoke）。③ DOM / ④ storage = N/A（读路径无 write 驱动 DOM·查询结果
//     由前端从透传 body 抽公告渲染·非冻结契约面）→ reducer runFourFacetRead 不裁定。
//   - **req_id 锚**（非四维 corr_key）：e2e 经 bridge invoke 时注入 reqId → helix module::read_req_id
//     抠出注册 → 回灌 im:read:result{req_id} → reducer 按 reqId 锁本束。三端点各注入独立 reqId 独立成束。
//
// endpoint / wire body（partial 1 §28/§30/§31 · helix posts_read_ext.rs #14/#15/#16）：
//   - acceptList: POST post/announcement/acceptList  body {postId}
//   - list:       POST post/announcement/list        body {channelId}(+可选 postId)
//   - detail:     POST post/announcement/detail       body {postIds:[]}
//
// 驱动方式（最简 + 确定性）：e2e 经 window.__lf.invoke 直 invoke 三读族命令（im_announcement_accept_list /
//   im_announcement_list / im_announcement_detail），condition 取自已渲染真实 DOM（active channel id +
//   首条消息 server_id·保证命中真实流）+ 各自 reqId → waitUntil 等 run.jsonl 出现本次 reqId 的
//   im:read:result projection hop → 跑 runFourFacetRead 逐端点裁定 ①②。
//
// 时序纪律（HX-C011 / C008）：waitUntil 等 projection 回灌落进 run.jsonl，无固定 pause。破坏即红（少 invoke →
//   ① 红·少回灌 → ② 红·见 reducer runFourFacetRead 可证伪对偶）。
//
// 依赖前置（run.sh / harness up 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db 含真频道 + 真消息）+ HELIX_RUN_JSONL 暴露 hop 落点。go-served HTTP 读链通
//   （announcement 读三件套现网可真跑 ①②）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-5.6r.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（求确定性·与对应 onXxx 同命令同 body·非旁路）。 */
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

/** 取当前活动频道 id（list 端点的 channelId 来源·真实已渲染频道）。 */
const getActiveChannel = () =>
  browser.execute(() =>
    document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
  );

/** 取首条已渲染消息 server_id（acceptList/detail 的 postId 来源·真实已渲染消息·锚 [data-msg-id]）。 */
const getFirstMsgId = () =>
  browser.execute(() =>
    document.querySelector('[data-msg-id]')?.getAttribute('data-msg-id')
  );

/** 当前 DOM 里有 lastMessage 的真实频道候选（排除全新空群导致的 postId=null）。 */
const getMessageChannelCandidates = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id][data-last-message]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

async function activateChannel(channelId) {
  await browser.execute((ch) => {
    document.querySelector(`[data-channel-id="${ch}"]`)?.click();
  }, channelId);
  await browser.waitUntil(
    async () => (await getActiveChannel()) === channelId,
    { timeout: 10000, interval: 150, timeoutMsg: `active channel 未切到 ${channelId}` }
  );
}

async function pickRenderedMessageAnchor() {
  const candidates = await getMessageChannelCandidates();
  for (const channelId of candidates) {
    await activateChannel(channelId);
    await invokeBridge('im_query_messages_by_channel', { channelId });
    await browser.waitUntil(
      async () => {
        const msgId = await getFirstMsgId();
        return !!msgId;
      },
      { timeout: 3000, interval: 150, timeoutMsg: `频道 ${channelId} 未渲染消息` }
    ).catch(() => false);
    const msgId = await getFirstMsgId();
    if (msgId) return { channelId, msgId };
  }
  return { channelId: await getActiveChannel(), msgId: await getFirstMsgId() };
}

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

function readReadResultBody(reqId) {
  let body;
  const jsonl = readFileSync(RUN_JSONL, 'utf8');
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
      body = ev.payload?.data?.body;
    }
  }
  return body;
}

function bodyItems(body, { singleObjectGuard } = {}) {
  let value = body;
  for (let i = 0; i < 2; i++) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
      value = value.data;
    }
  }
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['items', 'list', 'rows', 'postList', 'posts', 'announcements', 'records']) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (singleObjectGuard?.(value)) return [value];
  return [];
}

function pickString(row, keys) {
  if (!row || typeof row !== 'object') return '';
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function isAnnouncementItem(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  if (pickString(row, ['announcementId', 'postId'])) return true;
  if (!pickString(row, ['id'])) return false;
  return [
    'message',
    'text',
    'content',
    'channelId',
    'type',
    'createAt',
    'createdAt',
    'updateAt',
    'updatedAt',
  ].some((key) => key in row);
}

async function expectAttrRowsFromBody(reqId, attr, keys, options = {}) {
  const ids = bodyItems(readReadResultBody(reqId), options)
    .map((row) => pickString(row, keys))
    .filter(Boolean);
  if (ids.length === 0) {
    const count = await browser.execute((a) => document.querySelectorAll(`[${a}]`).length, attr);
    expect(count).toBe(0);
    return;
  }
  await browser.waitUntil(
    () =>
      browser.execute(
        (a, id) =>
          Array.from(document.querySelectorAll(`[${a}]`)).some(
            (el) => el.getAttribute(a) === id
          ),
        attr,
        ids[0]
      ),
    { timeout: 10000, interval: 150, timeoutMsg: `${attr}=${ids[0]} 未渲染` }
  );
}

/** 新鲜 reqId（会话内唯一·锚本次 invoke）。 */
const freshReqId = (prefix = 'req') => `${prefix}-${Math.random().toString(36).slice(2, 12)}`;

describe('UC-5.6r · 公告读族 acceptList/list/detail（读族 request-response·断面 ①②）', () => {
  let CHANNEL_ID;
  let MSG_ID;

  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready 标志。
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('[data-ready]')?.getAttribute('data-ready')
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    const picked = await pickRenderedMessageAnchor();
    CHANNEL_ID = picked.channelId;
    MSG_ID = picked.msgId;
    expect(CHANNEL_ID).toBeTruthy(); // seeded DB 须有 active channel（C003）
    expect(MSG_ID).toBeTruthy(); // seeded DB 须有真消息（acceptList/detail 的 postId 来源）
  });

  it('① acceptList：post/announcement/acceptList {postId} + 投影 im:read:result {req_id, body}', async () => {
    await invokeBridge('set_uc', { uc: 'UC-5.6r-acceptList' });

    const reqId = freshReqId('announcement-accept-list');
    const r = await invokeBridge('im_announcement_accept_list', { postId: MSG_ID, reqId });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'acceptList');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.acceptList,
      reqId,
      ucId: 'UC-5.6r-acceptList',
    });
    console.log('[UC-5.6r acceptList 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('① list：post/announcement/list {channelId} + 投影 im:read:result {req_id, body}', async () => {
    await invokeBridge('set_uc', { uc: 'UC-5.6r-list' });

    const reqId = freshReqId('announcement-list');
    const r = await invokeBridge('im_announcement_list', { channelId: CHANNEL_ID, reqId });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'list');
    await expectAttrRowsFromBody(reqId, 'data-announcement-id', ['announcementId', 'id', 'postId']);
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.list,
      reqId,
      ucId: 'UC-5.6r-list',
    });
    console.log('[UC-5.6r list 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('① detail：post/announcement/detail {postIds:[]} + 投影 im:read:result {req_id, body}', async () => {
    await invokeBridge('set_uc', { uc: 'UC-5.6r-detail' });

    const reqId = freshReqId('announcement-list');
    const r = await invokeBridge('im_announcement_detail', { postIds: [MSG_ID], reqId });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'detail');
    await expectAttrRowsFromBody(
      reqId,
      'data-announcement-id',
      ['announcementId', 'id', 'postId'],
      { singleObjectGuard: isAnnouncementItem }
    );
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.detail,
      reqId,
      ucId: 'UC-5.6r-detail',
    });
    console.log('[UC-5.6r detail 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });
});

// UC-5.7 频道成员在线状态 e2e —— WebdriverIO，读族 request-response 传输（同 UC-5.8 / UC-6.4 / UC-4.5）。
//
// 读族特性（projection-schema §1.2 / four-facet read-family）：
//   - **无 WS 回声**（partial 2 §28 明示「触发 WS 事件: 无」）；HTTP 200 响应体本身即数据
//     （dto.CommonRes.data = []ChannelOnlineStatusGroup）→ helix read_relay::emit_read_result 透传
//     回灌 `im:read:result{req_id, body}`。
//   - **四面退化为 ①②**：① 出站 wire body 逐字检（urlEndsWith channel/onlineStatus + bodyFields
//     channelIds 数组 camelCase + bodyForbidden 禁 snake/单数误形泄漏）；② 投影 envelope
//     （im:read:result {req_id, body} 外层键集 + req_id 锚本次 invoke）。③ DOM / ④ storage = N/A
//     （读路径无 write 驱动 DOM·在线状态由前端从透传 body 抽渲染·非冻结契约面）→ reducer
//     runFourFacetRead 不裁定。
//   - **req_id 锚**（非四维 corr_key）：e2e 经 bridge invoke 时注入 reqId → helix module::read_req_id
//     抠出注册 OutboundReadReply{req_id} → 回灌 im:read:result{req_id} → reducer 按 reqId 锁本束。
//
// endpoint（partial 2 §28）：channel/onlineStatus body = 内联匿名 struct 仅一字段
//   {channelIds:[]string}（camelCase）。helix ChannelOnlineStatusCommand 实证。
//
// 驱动方式（最简 + 确定性）：e2e 经 window.__lf.invoke 直 invoke 读族命令 im_channel_online_status
//   注入确定性 channelIds（取已渲染真频道 id·保证命中真实「批量查在线」流）+ reqId → waitUntil 等
//   run.jsonl 出现本次 reqId 的 im:read:result projection hop → 跑 runFourFacetRead 裁定 ①②。
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
  readFileSync(new URL('../expect/uc-5.7.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（与 onChannelOnlineStatus 同命令·求确定性）。 */
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

/** 取当前已渲染的频道 id（批量查在线状态的真实条件来源·无则 null）。 */
const getFirstChannelId = () =>
  browser.execute(
    () =>
      document.querySelector('[data-channel-id]')?.getAttribute('data-channel-id') ??
      document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel') ??
      null
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

function bodyItems(body) {
  let value = body;
  for (let i = 0; i < 2; i++) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
      value = value.data;
    }
  }
  return Array.isArray(value) ? value : [];
}

function onlineCount(group) {
  if (!group || typeof group !== 'object') return 0;
  if (typeof group.onlineCount === 'number') return group.onlineCount;
  const members = Array.isArray(group.members) ? group.members : [];
  return members.filter((m) => m?.online === true || m?.status === 'online').length;
}

function onlineMemberIds(body) {
  return bodyItems(body).flatMap((group) => {
    const channelId = typeof group?.channelId === 'string' ? group.channelId : '';
    const members = Array.isArray(group?.members) ? group.members : [];
    return members
      .filter((m) => m?.online === true || m?.status === 'online')
      .map((m) => ({ channelId, memberId: typeof m.userId === 'string' ? m.userId : '' }))
      .filter((m) => m.channelId && m.memberId);
  });
}

async function expectOnlineDomFromBody(reqId) {
  const body = readReadResultBody(reqId);
  const rows = bodyItems(body)
    .map((group) => ({
      channelId: typeof group?.channelId === 'string' ? group.channelId : '',
      count: onlineCount(group),
    }))
    .filter((row) => row.channelId);
  if (rows.length === 0) {
    const count = await browser.execute(() => document.querySelectorAll('[data-online-count]').length);
    expect(count).toBe(0);
    return;
  }
  await browser.waitUntil(
    () =>
      browser.execute(
        (channelId, count) =>
          Array.from(document.querySelectorAll('[data-online-count]')).some(
            (el) =>
              el.getAttribute('data-channel-id') === channelId &&
              el.getAttribute('data-online-count') === String(count)
          ),
        rows[0].channelId,
        rows[0].count
      ),
    {
      timeout: 10000,
      interval: 150,
      timeoutMsg: `onlineStatus channel=${rows[0].channelId} count=${rows[0].count} 未渲染`,
    }
  );

  const onlineMembers = onlineMemberIds(body);
  if (onlineMembers.length > 0) {
    await browser.waitUntil(
      () =>
        browser.execute(
          (channelId, memberId) =>
            Array.from(document.querySelectorAll('[data-member-online="1"]')).some(
              (el) =>
                el.getAttribute('data-channel-id') === channelId &&
                el.getAttribute('data-member-id') === memberId
            ),
          onlineMembers[0].channelId,
          onlineMembers[0].memberId
        ),
      {
        timeout: 10000,
        interval: 150,
        timeoutMsg: `data-member-online=${onlineMembers[0].memberId} 未渲染`,
      }
    );
  }
}

describe('UC-5.7 · 频道成员在线状态（读族 request-response·断面 ①②）', () => {
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

  it('①②：channel/onlineStatus 批量查在线状态 + 投影透传（im:read:result {req_id, body}）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-5.7' });

    const reqId = `online-status-${Math.random().toString(36).slice(2, 12)}`;
    // channelIds 来源：取已渲染真频道 id（保证命中·真实「批量查在线」流·≥1 元素满足 bodyFields 校验）。
    const channelId = await getFirstChannelId();
    expect(channelId).toBeTruthy();
    const r = await invokeBridge('im_channel_online_status', {
      channelIds: [channelId],
      reqId,
    });
    expect(r.ok).toBe(true);

    await waitReadResult(reqId, 'onlineStatus');
    await expectOnlineDomFromBody(reqId);

    // 关窗口（窗口隔离·后续帧归 __quiescence__·不串味本 UC 束）。
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetRead({
      jsonl,
      expect: EXPECT.onlineStatus,
      reqId,
      ucId: 'UC-5.7',
    });

    console.log('[UC-5.7 onlineStatus 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });
});

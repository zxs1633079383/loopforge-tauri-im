// US-17 L2 · 他人发消息收推送·双账号 e2e（issue #42）—— WebdriverIO，直连 4445。
//
// 命题（issue #42·US-17·L2 的全部意义）：
//   跨账号 post 推送只有第二真账号才造得出——B=678 在 A=444 与 678 的共享频道发消息 →
//   go 把该 post broadcast 给频道成员 A=444 → A 的 WS 收 `post` 帧 → helix emit_post_received（fat）
//   → 壳渲成 ML 区新消息行 [data-msg-id] + message 落库。单账号 L1 无「他人」可发故结构上造不出。
//
// L2 双账号编排（received 的观测端是收消息方 A·与拉人 #28 同为「对端动作→本端收」）：
//   A=444（暖栈 app 4445·本 spec 驱动 + 观测）= 被推送端：收 B 的 post → ②③④。
//   B=678（scripts/l2-act.sh·本 spec spawn）= 动作端：以自身身份 POST posts/create 在共享频道发消息。
//
// 四面裁定（A run.jsonl·锚 server msg_id=MSG_ID·sid）：
//   ① 出站   : **在 B 侧**（678 POST posts/create·HTTP 200 SUCCESS·本 spec 直断 l2-act 返回）——A 不发
//              posts/create 出站故 A run.jsonl 无该出站（L2 read-side ① 天然在动作端 B·expect.outbound
//              标 optional·isOutboundOptional）。
//   ②        : A run.jsonl → im:post:received 投影 fat 字段集（17 键·projection-schema emit_post_received）·
//              data.userId==678（跨账号铁证：作者是 B 非 A 自发回声）。
//   ③ DOM    : [data-msg-id=MSG_ID] 新行经 im:post:received 渲染（received 无 temporary-id·非本端发）。
//   ④        : A run.jsonl → message 表 batch_upsert 落库（id=MSG_ID·channel_id=共享频道）。
//
// 时序纪律（HX-C011 / C008）：B 真发后 waitUntil 轮询 A run.jsonl 等 im:post:received（message==本轮唯一
//   TEXT && userId==678）取 MSG_ID·超时=真 bug（go 没 broadcast / 路由错 / A WS 没连上 / 678 不在频道），
//   不固定 pause 猜 settle。守可证伪：A 未收 678 的 received post（无命中）→ MSG_ID 落空 → ②③④ 红（非 tautology）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-us17.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

const L2_ACT = new URL('../../scripts/l2-act.sh', import.meta.url).pathname;

// 共享频道由 A=444 当场新建并把 B=678 拉为成员（保证 server 侧真共享成员·跨账号 fanout 才成立）。
// 不用硬编码频道：实证（本会话 raw-WS）硬编码 15gcgoyf… 并非 444+678 共有 → server 不 fanout → A 收不到推送。
// 新建携 678 → server users:[{444 CREATOR},{678 MEMBER}]（真机curl真源 §4 channel/create 形态）→ 678 发消息
// server 按 broadcast.channelId fanout 到频道成员 444 的 WS 连接 → A 实时收 post 帧（已 raw-WS 实证）。
const SENDER = '678';

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

// 读 A run.jsonl 找 im:post:received（message==TEXT && userId==678）的 server msg_id（received 锚·sid）。
const findReceivedMsgId = (text) => {
  const lines = readFileSync(RUN_JSONL, 'utf8').split('\n');
  for (const ln of lines) {
    if (!ln) continue;
    let o;
    try {
      o = JSON.parse(ln);
    } catch {
      continue;
    }
    if (
      o?.facet === 'projection' &&
      o?.payload?.event === 'im:post:received' &&
      o?.payload?.data?.message === text &&
      String(o?.payload?.data?.userId) === SENDER
    ) {
      return o.payload.data.msg_id ?? null;
    }
  }
  return null;
};

// 快照当前 CL 区频道 id 集（建群后比对取新建 ch·server 分配 id 客户端发请求时未知）。
const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

// 读 A 的 received 消息行 data-*（锚 server msg_id）。
const readMessageRow = (msgId) =>
  browser.execute((mid) => {
    const el = document.querySelector(`[data-msg-id="${mid}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      _msgId: mid,
    };
  }, msgId);

// 以 B=678 身份 POST posts/create 在共享频道发消息（child_process 跑 l2-act.sh·cookieId 桥）。
function sendAsB(channelId, text) {
  const out = execFileSync('bash', [L2_ACT, 'send', channelId, text], {
    env: { ...process.env, L2_USER: SENDER },
    encoding: 'utf8',
    timeout: 20000,
  });
  return out;
}

describe('US-17 L2 · 他人发消息收推送双账号（#42）', () => {
  let CHANNEL_ID;
  let MSG_ID;

  before(async () => {
    // 就绪 probe（increment_end + inflight0 + cursor 稳）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: 'A=444 就绪 probe 未通过' }
    );
    // —— A=444 新建频道并把 678 拉为成员（server 侧真共享成员·跨账号 fanout 前提·守可证伪：
    //    678 非成员则 server 不 fanout → A 收不到推送 → ②③④ 红）——
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-us17-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: [SENDER],
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行（断在 channel/create→WS→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    CHANNEL_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(CHANNEL_ID).toBeTruthy();
    // 选中新频道·让其消息渲染到 ML 区（received 行须落 DOM 才有 ③ 落点）。
    await invokeBridge('im_query_messages_by_channel', { channelId: CHANNEL_ID });
    console.log(`[US-17-L2 就绪] A=444 新建共享频道 channelId=${CHANNEL_ID}（拉 678 为成员）`);
  });

  it('②③④：B=678 在共享频道发消息 → A=444 收推送 → im:post:received(fat,userId=678) + message 落库 + DOM 新行', async () => {
    // —— 开 UC 窗口 → B=678 以自身身份在共享频道发消息（本轮唯一 TEXT 作束选择锚）——
    await invokeBridge('set_uc', { uc: 'US-17' });
    const TEXT = `us17-from-678-${Math.random().toString(36).slice(2, 10)}`;
    const sendResp = sendAsB(CHANNEL_ID, TEXT);
    console.log(`[US-17-L2 B-send] 678 posts/create → ${sendResp.trim()}`);
    // ① 在 B 侧：posts/create HTTP 成功（CommonRes status=SUCCESS）。守可证伪：B 发失败 → 无推送 → ②③④ 红。
    expect(sendResp).toContain('SUCCESS');

    // —— ②：等 A run.jsonl 出 im:post:received（message==TEXT && userId==678）→ 取 server MSG_ID ——
    await browser.waitUntil(
      async () => findReceivedMsgId(TEXT) !== null,
      {
        timeout: 25000,
        interval: 250,
        timeoutMsg:
          'A=444 未收 678 的 im:post:received（断在 go broadcast post→频道成员 444→A WS→helix emit_post_received）',
      }
    );
    MSG_ID = findReceivedMsgId(TEXT);
    expect(MSG_ID).toBeTruthy();
    console.log(`[US-17-L2 echo] A=444 收到 678 的 received post·server msg_id=${MSG_ID}`);

    // —— ③ DOM：等 received 新行渲染（[data-msg-id=MSG_ID]）→ 读 data-* ——
    await browser.waitUntil(
      async () => {
        const row = await readMessageRow(MSG_ID);
        return row && row['msg-id'] === MSG_ID;
      },
      {
        timeout: 15000,
        interval: 200,
        timeoutMsg: 'A=444 received 行未渲染（断在 im:post:received→壳 applyPostReceived→ML 区新行）',
      }
    );
    const readRow = await readMessageRow(MSG_ID);
    console.log(
      `[US-17-L2 DOM] A=444 新行 msgId=${readRow?.['msg-id']} channelId=${readRow?.['channel-id']} eventSeq=${readRow?.['event-seq']}`
    );

    // —— 关 UC 窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（锚 server msg_id=MSG_ID·sid·② 投影 + ④ 落库聚同束·① 出站 N/A optional）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, sid: MSG_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: readRow });

    console.log('[US-17-L2 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      const ok = report.facets[f].ok;
      console.log(`  ${ok ? '✓' : '✖'} ${f}${ok ? '' : ': ' + report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);

    // ① 出站 N/A（optional·B 侧已断 SUCCESS）→ reducer 自动绿（isOutboundOptional）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② im:post:received 投影 fat 字段集（17 键）+ userId==678（跨账号铁证）。**L2 双账号真绿**。
    expect(report.facets.projection.ok).toBe(true);
    // ④ message batch_upsert 落库（id=server_id）。**L2 双账号真绿**。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM 新消息行 data-msg-id（跨账号推送到达 DOM·L2 核心证据）。
    expect(report.facets.dom.ok).toBe(true);
  });
});

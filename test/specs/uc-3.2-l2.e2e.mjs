// UC-3.2 L2 · 单条消息已读·双账号 e2e（issue #14 / tracker #47）—— WebdriverIO，直连 4445。
//
// 命题（uc-3.2.expect.json projection._note 精确机制 + 本会话 raw-WS 实证）：
//   `post_read`(type6) 是**已读回执**——告知*消息发送者* 其消息被对端读了。go publishRead 把
//   post_read WS 帧 broadcast 到 **post 作者 userId**（非读者本人连接）。∴ 单账号 L1（A 自读自己
//   的消息）结构上收不到 echo——②`im:post:read` 投影 / ④ message.read_bits 落库无源。
//   只有第二真账号 B=678 读 A=444 的消息时，A 才收到 post_read echo → ②④ 才有产出。
//
// L2 双账号编排（read-receipt 的观测端是**发送者 A**·与拉人 #28 观测端是被拉成员相反）：
//   A=444（暖栈 app 4445·本 spec 驱动）= 发送端 + 观测端：发消息 → 收 post_read echo → ②③④。
//   B=678（scripts/l2-act.sh·本 spec spawn）= 动作端：以自身身份 POST post/read 标 A 的消息已读。
//
// 四面裁定（A run.jsonl·锚 server postId=MSG_ID）：
//   ① 出站   : **在 B 侧**（678 POST post/read·HTTP 200 SUCCESS·本 spec 直断 l2-act 返回）——A 不发
//              read 出站故 A run.jsonl 无 post/read（L2 read-receipt ① 天然在动作端 B·非 A）。
//   ②        : A run.jsonl → im:post:read 投影 fat 字段集（projection-schema emit_post_read·含 readBits）。
//   ③ DOM    : [data-msg-id=MSG_ID] 行 data-read-bits 经 im:post:read echo 更新。
//   ④        : A run.jsonl → message 表 read_bits 单调覆盖落库（helix channel.rs apply_read_op）。
//
// 时序纪律（HX-C011 / C008）：post/read 由 B 真发后 waitUntil 轮询 A run.jsonl 等 im:post:read 投影·
//   超时=真 bug（go 没推 post_read / 路由错 / A WS 没连上），不固定 pause 猜 settle。守可证伪：
//   A 未收 im:post:read（msg_id==MSG_ID）→ ②④ 红（非 tautology）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-3.2.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

const L2_ACT = new URL('../../scripts/l2-act.sh', import.meta.url).pathname;

// 共享频道（A=444 + B=678 均为成员·本会话 raw-WS 实证 678 post/read → 444 收 post_read type6）。
const SHARED_CHANNEL = '15gcgoyf1jfcur614qydhs69ha';
const READER = '678';

// 生成 26 位 z-base-32 临时 id（与薄壳 genTempId 同字符集）。
function genTempId() {
  const charset = 'ybndrfg8ejkmcpqxot1uwisza345h769';
  let s = '';
  for (let i = 0; i < 26; i++) s += charset[Math.floor(Math.random() * 32)];
  return s;
}

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

const readMessageRow = (msgId) =>
  browser.execute((mid) => {
    const el = document.querySelector(`[data-msg-id="${mid}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'read-bits': ds.readBits ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      _msgId: mid,
    };
  }, msgId);

// 以 B=678 身份 POST post/read 标 A 的单条消息已读（child_process 跑 l2-act.sh·cookieId 桥）。
function readAsB(channelId, postId) {
  const out = execFileSync('bash', [L2_ACT, 'read-post', channelId, postId], {
    env: { ...process.env, L2_USER: READER },
    encoding: 'utf8',
    timeout: 20000,
  });
  return out;
}

describe('UC-3.2 L2 · 单条消息已读双账号（#14 / #47）', () => {
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
    CHANNEL_ID = SHARED_CHANNEL;
    // 选中共享频道·让其消息渲染到 ML 区（A 发的消息须在本地 DB + DOM 才有 ③④ 落点）。
    await invokeBridge('im_query_messages_by_channel', { channelId: CHANNEL_ID });
    console.log(`[UC-3.2-L2 就绪] 共享频道 channelId=${CHANNEL_ID}（A=444 + B=678 成员）`);
  });

  it('②④③：A 发消息 → B=678 标已读 → A 收 post_read echo → im:post:read 投影 + read_bits 落库 + DOM', async () => {
    // —— 第一步：A=444 发消息（须真实 server_id 才能让 B 标已读） ——
    await invokeBridge('set_uc', { uc: 'UC-3.2-L2-send' });
    const TEXT = `l2-read-${Math.random().toString(36).slice(2, 8)}`;
    const tmp = genTempId();
    const sendResult = await invokeBridge('im_send', {
      channelId: CHANNEL_ID,
      text: TEXT,
      temporaryId: tmp,
    });
    expect(sendResult.ok).toBe(true);

    // 等 echo 覆写（data-msg-id 从 tmp 覆写为 server id）。
    await browser.waitUntil(
      async () => {
        const sid = await browser.execute((t) => {
          const el = document.querySelector(`[data-temporary-id="${t}"]`);
          const mid = el?.getAttribute('data-msg-id') ?? null;
          return mid && mid !== t ? mid : null;
        }, tmp);
        return !!sid;
      },
      { timeout: 15000, interval: 150, timeoutMsg: 'A send echo 未覆写（断在 send round-trip）' }
    );
    MSG_ID = await browser.execute((t) => {
      const el = document.querySelector(`[data-temporary-id="${t}"]`);
      return el?.getAttribute('data-msg-id') ?? null;
    }, tmp);
    expect(MSG_ID).toBeTruthy();
    expect(MSG_ID).not.toBe(tmp);
    console.log(`[UC-3.2-L2 send] A=444 消息 server_id=${MSG_ID}`);

    // —— 第二步：开 UC 窗口 → B=678 以自身身份标 A 的消息已读 ——
    await invokeBridge('set_uc', { uc: 'UC-3.2' });
    const readResp = readAsB(CHANNEL_ID, MSG_ID);
    console.log(`[UC-3.2-L2 B-read] 678 post/read → ${readResp.trim()}`);
    // ① 在 B 侧：post/read HTTP 成功（CommonRes status=SUCCESS）。守可证伪：B read 失败 → 无 echo → ②④ 红。
    expect(readResp).toContain('SUCCESS');

    // —— ②：等 A run.jsonl 出 im:post:read 投影（msg_id==MSG_ID·post_read echo 到达 A）——
    await browser.waitUntil(
      async () => {
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
            o?.payload?.event === 'im:post:read' &&
            (o.payload?.data?.msg_id === MSG_ID)
          )
            return true;
        }
        return false;
      },
      {
        timeout: 25000,
        interval: 250,
        timeoutMsg:
          'A=444 未收 im:post:read echo（断在 go publishRead→post_read 帧 broadcast userId=444→A WS→helix emit_post_read）',
      }
    );
    console.log('[UC-3.2-L2 echo] A=444 收到 im:post:read（post_read echo·msg_id 命中）');

    // —— ③ DOM：读目标行 data-read-bits 终态 ——
    const readRow = await readMessageRow(MSG_ID);
    console.log(
      `[UC-3.2-L2 DOM] msgId=${MSG_ID} readBits=${readRow?.['read-bits']} eventSeq=${readRow?.['event-seq']}`
    );

    // —— 关 UC 窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（锚 server postId=MSG_ID·② 投影 + ④ 落库聚同 sid 束）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, postId: MSG_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: readRow });

    console.log('[UC-3.2-L2 四面报告] ' + report.summary);
    for (const f of ['projection', 'storage', 'dom']) {
      const ok = report.facets[f].ok;
      console.log(`  ${ok ? '✓' : '✖'} ${f}${ok ? '' : ': ' + report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);

    // ② im:post:read 投影 fat 字段集（projection-schema emit_post_read·含 readBits）。**L2 双账号真绿**。
    expect(report.facets.projection.ok).toBe(true);
    // ④ message read_bits 落库（单调覆盖·helix channel.rs apply_read_op）。**L2 双账号真绿**。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM data-read-bits 有值（壳渲染 readMap→readBits）。
    expect(report.facets.dom.ok).toBe(true);
  });
});

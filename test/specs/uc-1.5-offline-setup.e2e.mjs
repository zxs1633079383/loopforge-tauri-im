// UC-1.5-offline SETUP —— 撤回离线分支的「制造可重放撤回事件」前置阶段（WebdriverIO·直连 4445）。
//
// 离线 gap-replay 撤回（im:post:deleted）无法在单个 --warm spec 内驱动：重放靠冷启动 increment，
// 而 in-memory cursor 须 reload 才回退（seed-behind-cursor + cold boot·UC-4.1 同范式）。故拆两阶段：
//   ① 本 setup spec（app 暖栈）：建本人 CREATOR 群 C → 发消息 M（捕获 server_id S）→ 撤回 M
//      （服务端记 PostRevoke channel_event·在线 echo 走 im:post:batch-updated·≠ 本 UC 的 im:post:deleted）。
//      把锚 {C,S} 写 /tmp/uc-offrev-anchor.json 供阶段②。
//   ② 驱动脚本 scripts/run-uc-1.5-offline.sh：回退 C 的 cursor 到撤回前 → reload-app --uc UC-1.5-offline
//      （冷启动 increment 重放 PostUpsert(M)→im:post:received 载行 + PostRevoke(M)→im:post:deleted 标行）
//      → spec uc-1.5-offline --keep 读重放 run.jsonl 裁 ②③。
//
// 本 spec 只做阶段①（制造状态 + 捕获锚）·不裁四面。

import { browser, expect } from '@wdio/globals';
import { writeFileSync } from 'node:fs';

const ANCHOR_FILE = process.env.UC_OFFREV_ANCHOR ?? '/tmp/uc-offrev-anchor.json';

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

// 当前 CL 区已渲染 channel id 集（scope channel-list·排除 ML 消息行同 channelId 干扰）。
const snapChannels = () =>
  browser.execute(() =>
    Array.from(
      document.querySelectorAll('[data-testid="channel-list"] [data-channel-id]'),
    )
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

describe('UC-1.5-offline · SETUP（制造可重放撤回事件 + 捕获锚）', () => {
  it('建群 → 发消息（捕获 server_id）→ 撤回 → 写锚文件', async () => {
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready'),
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' },
    );

    // —— 建本人 CREATOR 群（保证发/撤回权限·真实用户流）——
    const before = new Set(await snapChannels());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-offrev-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: ['445'],
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapChannels()).some((id) => !before.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行' },
    );
    const C = (await snapChannels()).find((id) => !before.has(id));
    expect(C).toBeTruthy();

    // —— 发消息 M 到 C（im_send 显式 channelId·新建群暖栈下自动 active·消息行落 ML 区）——
    const tempId = `off-${Math.random().toString(36).slice(2, 10)}`;
    const send = await invokeBridge('im_send', {
      channelId: C,
      text: `offrev-${Date.now()}`,
      temporaryId: tempId,
    });
    expect(send.ok).toBe(true);

    // —— 等乐观行 echo 覆写出 server_id S（data-msg-id ≠ temporary-id）——
    let S = null;
    await browser.waitUntil(
      async () => {
        S = await browser.execute((cid) => {
          const rows = Array.from(
            document.querySelectorAll(`[data-testid="msg-list"] [data-channel-id="${cid}"]`),
          );
          for (const r of rows) {
            const mid = r.getAttribute('data-msg-id');
            const tid = r.getAttribute('data-temporary-id');
            if (mid && mid !== tid) return mid;
          }
          return null;
        }, C);
        return !!S;
      },
      { timeout: 20000, interval: 200, timeoutMsg: '消息未取得 server_id（echo 未覆写）' },
    );
    expect(S).toBeTruthy();

    // —— 撤回 M（服务端记 PostRevoke channel_event；在线 echo 走 im:post:batch-updated·非本 UC 目标）——
    const rv = await invokeBridge('im_revoke', { postId: S });
    expect(rv.ok).toBe(true);
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          (id) => document.querySelector(`[data-msg-id="${id}"]`)?.getAttribute('data-revoke'),
          S,
        )) === '1',
      { timeout: 15000, interval: 200, timeoutMsg: '在线撤回 echo 未落定（服务端未记 revoke）' },
    );

    writeFileSync(ANCHOR_FILE, JSON.stringify({ C, S }));
    console.log(`[UC-1.5-offline SETUP] 锚已写 ${ANCHOR_FILE}：C=${C} S=${S}（撤回事件已落服务端·待阶段② cursor 回退 + 冷启动重放）`);
  });
});

// UC-11.2b L2 · 退公司离群移除广播·双账号 e2e（issue #40 / tracker #48）—— WebdriverIO，直连 4445。
//
// 命题（issue #48·后端 round-2 quit_company 广播·2026-06-28 raw-WS 实证）：
//   退出者 quit team → server 对**同 team 其余成员**多播 `quit_company`（payload channels[]·
//   partials/5 §2.18 UserIds 多用户定向）。退出者本连接结构上观测不到（已离群）→ 观测端须是
//   **留存成员**。单账号 L1 无留存第二连接 → ②③④ 造不出（issue #40 实证退出者本连接零 removal 帧）。
//
// L2 双账号编排（隔离·不动暖栈 444 的 team 归属·C014）：
//   退出者 = 777（l2-act quit·独立账号·非 444）；观测端 = 888（observe·留存成员·raw WS）。
//   A=444（暖栈 app）只做 setup：建频道含 777+888（forceCreate 把两者纳入 team）·不退自己。
//
// 裁定（观测侧·B=888 raw WS）：
//   ① 出站   : 在退出者 777 侧（teams/member/quit DELETE·本 spec 直断 l2-act 返回 SUCCESS）。
//   ②④源    : B=888 observe jsonl → quit_company 帧（留存成员收·退公司离群广播到达）= ②(emit)/④(移除)
//              在留存成员侧结构性源。守可证伪：888 未收 quit_company → 红（广播未到达留存成员）。
//   ③ DOM    : B=888 视图移除·A 驱动 spec N/A（B 侧观测·raw 帧即源）。
//
// 注（C014 暖栈隔离）：退出者用 777（非 444）→ 不破坏暖栈 444 的 team 归属·后续 UC 不受影响。

import { browser, expect } from '@wdio/globals';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';

const L2_ACT = new URL('../../scripts/l2-act.sh', import.meta.url).pathname;
const QUITTER_ID = '777'; // 退出者（独立账号·非暖栈 444）
const OBSERVER_ID = '888'; // 留存成员·观测端
const OBSERVE_SCRIPT = new URL('../../scripts/l2-observe-678.mjs', import.meta.url).pathname;
const OBSERVE_OUT = '/tmp/loopforge/l2-888-uc11.2.jsonl';

const invokeBridge = (cmd, args) =>
  browser.executeAsync(
    (c, a, done) => {
      // @ts-ignore — 薄壳注入
      if (!window.__lf?.invoke) { done({ ok: false, error: 'no __lf bridge' }); return; }
      window.__lf.invoke(c, a)
        .then((r) => done({ ok: true, result: r === undefined ? null : r }))
        .catch((e) => done({ ok: false, error: String(e?.message ?? e) }));
    }, cmd, args
  );

const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id')).filter((id) => !!id)
  );

const readObserveFrames = () => {
  if (!existsSync(OBSERVE_OUT)) return [];
  const frames = [];
  for (const line of readFileSync(OBSERVE_OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { frames.push(JSON.parse(line)); } catch { /* torn 末行·跳过 */ }
  }
  return frames;
};

// 退出者 777 退 team（l2-act quit·cookieId 桥·DELETE teams/member/quit）。
function quitAsQuitter() {
  return execFileSync('bash', [L2_ACT, 'quit'], {
    env: { ...process.env, L2_USER: QUITTER_ID }, encoding: 'utf8', timeout: 20000,
  });
}

describe('UC-11.2b · L2 退公司离群移除广播（双账号·issue #40 / #48）', () => {
  let observeProc;

  before(async () => {
    try { if (existsSync(OBSERVE_OUT)) rmSync(OBSERVE_OUT); } catch { /* ignore */ }

    // —— spawn B=888 留存成员 observe（raw WS·forever）——
    observeProc = spawn(process.execPath, [OBSERVE_SCRIPT], {
      env: { ...process.env, L2_USER: OBSERVER_ID, L2_OBSERVE_OUT: OBSERVE_OUT, L2_OBSERVE_MS: '0' },
      stdio: 'ignore', detached: false,
    });
    await browser.waitUntil(
      async () => readObserveFrames().some((f) => f.action === 'hello' && f?.broadcast?.userId === OBSERVER_ID),
      { timeout: 15000, interval: 200, timeoutMsg: `observe-${OBSERVER_ID} 未连上 go WS（无 hello 帧）` }
    );

    // —— A=444 就绪 probe ——
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelector('[data-ready]')?.getAttribute('data-ready'))) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: 'A=444 就绪 probe 未通过' }
    );

    // —— A=444 建频道含 777+888（forceCreate 把两者纳入 team·建立 quit 前置 membership）——
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-l2quit-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: [QUITTER_ID, OBSERVER_ID],
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行' }
    );
    console.log(`[UC-11.2b] setup 完成（777+888 纳入 team·888 observe 连上）`);
  });

  after(async () => {
    if (observeProc && !observeProc.killed) { try { observeProc.kill('SIGTERM'); } catch { /* ignore */ } }
  });

  it('① 退出者 777 quit team + ②④源 留存成员 B=888 收 quit_company 广播', async () => {
    // —— 基线快照（守可证伪·暖栈 team 池含历史 quit_company 噪声/connect 重放）：记录 quit 前
    //    已落盘的 quit_company 帧数·本次断言须 quit 后**新增** ≥1（新增=本次 777 quit 触发·非 stale）——
    const baseline = readObserveFrames().filter((f) => f.action === 'quit_company').length;
    console.log(`[UC-11.2b baseline] quit 前 quit_company 帧数=${baseline}`);

    // —— ① 退出者 777 退 team（独立账号·不动暖栈 444）——
    const quitResp = quitAsQuitter();
    console.log(`[UC-11.2b quit] 777 teams/member/quit → ${quitResp.trim()}`);
    // ① 在退出者侧：quit HTTP 成功。守可证伪：quit 失败 → 无广播 → ②④ 红。
    expect(quitResp).toContain('SUCCESS');

    // —— ②④源：等 B=888 observe jsonl quit_company 帧数**新增**（留存成员收本次离群广播·非 stale 重放）——
    await browser.waitUntil(
      async () => readObserveFrames().filter((f) => f.action === 'quit_company').length > baseline,
      { timeout: 25000, interval: 250,
        timeoutMsg: 'B=888 quit 后无新增 quit_company（断在 go quitTeam→idsByTeamId 多播→留存成员 888 连接）' }
    );

    const total = readObserveFrames().filter((f) => f.action === 'quit_company').length;
    console.log(`[UC-11.2b L2] B=888 留存成员 quit 后新增 quit_company：${baseline}→${total}（退公司离群广播到达留存成员）`);
    // 守可证伪：quit 后新增 ≥1（本次 777 quit 真触发广播到留存成员 888·非 stale·非空）。
    expect(total).toBeGreaterThan(baseline);
  });
});

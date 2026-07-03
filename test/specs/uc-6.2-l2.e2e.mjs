// UC-6.2b L2 · 设管理员广播·双账号 e2e（issue #29 / tracker #45）—— WebdriverIO，直连 4445。
//
// 命题（issue #29·后端 round-2 changeManagerRole 补齐·2026-06-28 raw-WS 实证）：
//   A=444 设 678 为管理员 → server `changeManagerRole` 广播 `channel_member_role_updated`
//   {channelId, userIds:[678], role:MANAGER} → 推频道成员（含 678）。单账号 L1（操作者收
//   role_updated helix graceful no-op·无独立投影）结构上证不到 ②④——须第二真账号 678 有真连接
//   时，role_updated 广播帧才有观测点（与 #28 拉人广播同范式）。
//
// L2 双账号编排：
//   A=444（暖栈 app 4445·本 spec 驱动）= 动作端：建本人 CREATOR 新群（含 678）→ 设 678 admin。
//   B=678（observe-678.mjs raw WS·本 spec spawn）= 观测端：收 channel_member_role_updated 广播帧。
//
// 四面裁定（A run.jsonl ∪ B observe·锚频道 ch）：
//   ① 出站   : A run.jsonl → channel/add/manger（body {channelId, users:[{id:678,role:ADMIN}]}）reducer 绿。
//   ②④源    : B observe jsonl → channel_member_role_updated 帧·raw 含锚频道 + role=MANAGER + userIds 含 678
//              = ②(emit_channel_member_updated 的角色态源)/④(channel_member role 落库源) 在 B 侧结构性源。
//   ③ DOM    : data-admin 为 678 视图·A 驱动 spec N/A（B 侧观测·raw 帧即源）。
//
// 时序纪律（HX-C011）：observe 先连上再设 admin；设后 waitUntil 轮询 jsonl 等 role_updated 帧·
//   超时=真 bug（后端没广播 / 路由错 / 678 没连上）·守可证伪：B 未收 channel_member_role_updated → 红。

import { browser, expect } from '@wdio/globals';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { captureObserverEvidence } from '../helpers/l2-evidence.mjs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-6.2.expect.json', import.meta.url), 'utf8')
);
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

const ADMIN_MEMBER_ID = '678';
const OBSERVE_OUT = '/tmp/loopforge/l2-678-uc6.2.jsonl';
const WS_OBSERVER_JS = String.raw`
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
function loadWebSocket() {
  const repoRoot = process.env.L2_REPO_ROOT || process.cwd();
  try {
    return createRequire(path.join(repoRoot, 'package.json'))('ws');
  } catch {}
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  const candidates = fs.existsSync(pnpmDir)
    ? fs.readdirSync(pnpmDir)
        .filter((name) => name.startsWith('ws@'))
        .map((name) => path.join(pnpmDir, name, 'node_modules', 'ws'))
        .filter((dir) => fs.existsSync(dir))
        .sort()
    : [];
  if (!candidates.length) throw new Error('Unable to resolve ws from repo node_modules');
  return require(candidates[candidates.length - 1]);
}
const WebSocket = loadWebSocket();
const user = process.env.L2_USER ?? '678';
const wsUrl = process.env.L2_WS ?? 'ws://localhost:8066/api/v4/websocket';
const team = process.env.L2_TEAM ?? '64118eebd2b665246b7880eb';
const out = process.env.L2_OBSERVE_OUT ?? '/tmp/loopforge/l2-observe.jsonl';
fs.mkdirSync(require('path').dirname(out), { recursive: true });
const sink = fs.createWriteStream(out, { flags: 'w' });
const ws = new WebSocket(wsUrl, { headers: { cookieId: user, companyId: team, appType: 'bct', device: 'IOS', language: 'zh' } });
let frameCount = 0;
ws.on('message', (data) => {
  const raw = String(data);
  let action = '?';
  let broadcast = null;
  let dataKeys = [];
  try {
    const obj = JSON.parse(raw);
    action = obj.action ?? '?';
    broadcast = obj.broadcast ?? null;
    dataKeys = obj.data && typeof obj.data === 'object' ? Object.keys(obj.data) : [];
  } catch {}
  frameCount += 1;
  sink.write(JSON.stringify({ ts: Date.now(), user, action, broadcast, data_keys: dataKeys, raw: raw.slice(0, 2048) }) + '\n');
});
const shutdown = () => { try { ws.close(); } catch {} setTimeout(() => process.exit(0), 100); };
ws.on('close', () => { sink.end(); process.exit(0); });
ws.on('error', (err) => { console.error(err?.message ?? err); process.exit(1); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`;

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

describe('UC-6.2b · L2 设管理员广播（双账号·issue #29 / #45）', () => {
  let TARGET_CHANNEL_ID;
  let observeProc;

  before(async () => {
    try { if (existsSync(OBSERVE_OUT)) rmSync(OBSERVE_OUT); } catch { /* ignore */ }

    // —— spawn B=678 observe（raw WS·forever·SIGTERM 收）——
    observeProc = spawn(process.execPath, ['-e', WS_OBSERVER_JS], {
      env: {
        ...process.env,
        L2_REPO_ROOT: process.cwd(),
        L2_USER: '678',
        L2_OBSERVE_OUT: OBSERVE_OUT,
        L2_OBSERVE_MS: '0',
      },
      stdio: 'ignore', detached: false,
    });
    await browser.waitUntil(
      async () => readObserveFrames().some((f) => f.action === 'hello' && f?.broadcast?.userId === '678'),
      { timeout: 15000, interval: 200, timeoutMsg: 'observe-678 未连上 go WS（无 hello 帧）' }
    );

    // —— A=444 就绪 probe ——
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelector('[data-ready]')?.getAttribute('data-ready'))) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: 'A=444 就绪 probe 未通过' }
    );

    // —— A=444 建本人 CREATOR 新群（含 678 为成员·待设其 admin）——
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-l2admin-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: [ADMIN_MEMBER_ID],
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行' }
    );
    TARGET_CHANNEL_ID = (await snapshotChannelIds()).find((id) => !beforeIds.has(id));
    expect(TARGET_CHANNEL_ID).toBeTruthy();
    await invokeBridge('im_query_messages_by_channel', { channelId: TARGET_CHANNEL_ID });
    await invokeBridge('set_uc', { uc: 'UC-6.2' });
    console.log(`[UC-6.2b] A=444 锚频道（含 678·待设 admin）channelId=${TARGET_CHANNEL_ID}`);
  });

  after(async () => {
    if (observeProc && !observeProc.killed) { try { observeProc.kill('SIGTERM'); } catch { /* ignore */ } }
  });

  it('① A 出站 channel/add/manger + ②④源 B=678 收 channel_member_role_updated 广播', async () => {
    // —— A=444 设 678 为管理员（set=true）——
    const r = await invokeBridge('im_channel_set_manger', {
      channelId: TARGET_CHANNEL_ID, userId: ADMIN_MEMBER_ID, set: true,
    });
    expect(r.ok).toBe(true);

    // —— ②④源：等 B=678 observe jsonl 出 channel_member_role_updated 广播帧（含锚频道）——
    await browser.waitUntil(
      async () => readObserveFrames().some(
        (f) => f.action === 'channel_member_role_updated' &&
          typeof f.raw === 'string' && f.raw.includes(TARGET_CHANNEL_ID)
      ),
      { timeout: 25000, interval: 250,
        timeoutMsg: 'B=678 未收 channel_member_role_updated（断在 go changeManagerRole→broadcast→678 连接）' }
    );

    const frames = readObserveFrames();
    const roleFrames = frames.filter((f) => f.action === 'channel_member_role_updated');
    console.log(`[UC-6.2b L2] B=678 收到 channel_member_role_updated ×${roleFrames.length}·锚频道=${TARGET_CHANNEL_ID}`);
    const hit = roleFrames.find((f) => f.raw && f.raw.includes(TARGET_CHANNEL_ID));
    expect(hit).toBeTruthy();

    // —— L2 守可证伪：帧 raw 含 role MANAGER + userIds 含 678（角色态真到达·非空帧）——
    const raw = JSON.parse(hit.raw);
    const data = raw.data ?? {};
    expect(String(data.role ?? '')).toBe('MANAGER');
    expect((data.userIds ?? []).map(String)).toContain(ADMIN_MEMBER_ID);
    expect(String(data.channelId ?? '')).toBe(TARGET_CHANNEL_ID);
    captureObserverEvidence('uc-6.2-l2-admin-observer', {
      observerKind: 'raw-ws',
      observerUserId: ADMIN_MEMBER_ID,
      actorUserId: '444',
      channelId: TARGET_CHANNEL_ID,
      action: 'channel_member_role_updated',
      assertions: {
        role: 'MANAGER',
        userIdsContains: ADMIN_MEMBER_ID,
        rawContainsChannelId: hit.raw.includes(TARGET_CHANNEL_ID),
      },
      frame: hit,
      parsedData: data,
    });

    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ① A 出站面 reducer 裁定（锚频道 ch·只断 outbound·②④③ 结构在 B 侧）——
    const expectWithAnchor = { ...EXPECT, corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID } };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: { admin: null } });
    console.log('[UC-6.2b ① 出站] ' + (report.facets.outbound.ok ? '✓' : '✖ ' + report.facets.outbound.issues.join('; ')));
    expect(report.parseErrors.length).toBe(0);
    // ① A 出站：channel/add/manger body {channelId, users:[{id:678,role:ADMIN}]}。
    expect(report.facets.outbound.ok).toBe(true);
  });
});

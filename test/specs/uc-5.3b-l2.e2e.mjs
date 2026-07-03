// UC-5.3b L2 · member-leave 广播·双账号 e2e（issue #44）—— WebdriverIO，直连 4445。
//
// 命题（issue #44·后端 round-2 handleMemberLeave→broadcastMemberLeaveIncrement 补齐·2026-06-28 实证）：
//   A=444 移除 678 → server 对**留存成员**单播 `channel_member_update{memberChange.leave:[678]}`。
//   被移除者 678 已离群收不到（结构性）→ 观测端须是**留存成员** B=999。单账号 L1 无留存第二连接
//   结构上证不到 ②④。
//
// L2 双账号编排（观测端是留存成员·非被移除者）：
//   A=444（暖栈 app 4445·本 spec 驱动）= 动作端：建本人 CREATOR 新群（含 678 + 999）→ 移除 678。
//   B=999（observe-678.mjs raw WS·L2_USER=999·本 spec spawn）= 留存观测端：收 channel_member_update{leave}。
//
// 四面裁定（A run.jsonl ∪ B=999 observe·锚频道 ch）：
//   ① 出站   : A run.jsonl → channel/member/change（body {channelId, leaveUsers:[{id:678}]}）reducer 绿。
//   ②④源    : B=999 observe jsonl → channel_member_update 帧·memberChange.leave 含 678 + raw 含锚频道
//              = ②(emit_channel_member_updated)/④(channel_member BatchDelete) 在留存成员侧结构性源。
//   ③ DOM    : data-members（999 视图移除 678）·A 驱动 spec N/A（B 侧观测）。
//
// 时序纪律（HX-C011）：observe 先连上再移除；移除后 waitUntil 轮询 jsonl 等 channel_member_update{leave}·
//   超时=真 bug·守可证伪：B=999 未收 leave 广播 / memberChange.leave 不含 678 → 红。

import { browser, expect } from '@wdio/globals';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { captureDomEvidence } from '../helpers/dom-evidence.mjs';
import { captureObserverEvidence } from '../helpers/l2-evidence.mjs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-5.3b-l2.expect.json', import.meta.url), 'utf8')
);
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

const LEAVE_MEMBER_ID = '678'; // 被移除者
const OBSERVER_ID = '999'; // 留存成员·观测端
const OBSERVE_OUT = '/tmp/loopforge/l2-999-uc5.3b.jsonl';
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

const readDomEvidence = (file) => {
  expect(existsSync(file)).toBe(true);
  return JSON.parse(readFileSync(file, 'utf8'));
};

const expectDomRows = (evidence, selector) => {
  const rows = evidence?.selectors?.[selector] ?? [];
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
  return rows;
};

const domRows = (evidence, selector) => {
  const rows = evidence?.selectors?.[selector] ?? [];
  expect(Array.isArray(rows)).toBe(true);
  return rows;
};

const expectDomAttr = (evidence, selector, attr, expected) => {
  const rows = expectDomRows(evidence, selector);
  expect(rows.some((row) => String(row?.attrs?.[attr] ?? '') === String(expected))).toBe(true);
  return rows;
};

const memberTokens = (value) =>
  String(value ?? '')
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

const expectMemberAbsentFromDomEvidence = (evidence, memberId, remainingMemberId) => {
  const memberListRows = domRows(evidence, '[data-testid="member-list"][data-members]');

  if (memberListRows.length === 0) {
    throw new Error(
      `NEED_UI UC-5.3b: DOM evidence has no scoped member-list data-members after leave ${memberId}`
    );
  }

  expect(
    memberListRows.some((row) => memberTokens(row?.attrs?.['data-members']).includes(String(remainingMemberId)))
  ).toBe(true);
  expect(
    memberListRows.some((row) => memberTokens(row?.attrs?.['data-members']).includes(String(memberId)))
  ).toBe(false);
};

describe('UC-5.3b · L2 member-leave 广播（双账号·issue #44）', () => {
  let TARGET_CHANNEL_ID;
  let observeProc;

  before(async () => {
    try { if (existsSync(OBSERVE_OUT)) rmSync(OBSERVE_OUT); } catch { /* ignore */ }

    // —— spawn B=999 留存成员 observe（raw WS·forever·SIGTERM 收）——
    observeProc = spawn(process.execPath, ['-e', WS_OBSERVER_JS], {
      env: {
        ...process.env,
        L2_REPO_ROOT: process.cwd(),
        L2_USER: OBSERVER_ID,
        L2_OBSERVE_OUT: OBSERVE_OUT,
        L2_OBSERVE_MS: '0',
      },
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

    // —— A=444 建本人 CREATOR 新群（含 678 + 999·待移除 678·999 留存观测）——
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-l2leave-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: [LEAVE_MEMBER_ID, OBSERVER_ID],
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行' }
    );
    TARGET_CHANNEL_ID = (await snapshotChannelIds()).find((id) => !beforeIds.has(id));
    expect(TARGET_CHANNEL_ID).toBeTruthy();
    await invokeBridge('im_query_messages_by_channel', { channelId: TARGET_CHANNEL_ID });
    await invokeBridge('set_uc', { uc: 'UC-5.3b' });
    console.log(`[UC-5.3b] A=444 锚频道（含 678+999·待移除 678）channelId=${TARGET_CHANNEL_ID}`);
  });

  after(async () => {
    if (observeProc && !observeProc.killed) { try { observeProc.kill('SIGTERM'); } catch { /* ignore */ } }
  });

  it('① A 出站 channel/member/change(leaveUsers:678) + ②④源 B=999 收 channel_member_update{memberChange.leave}', async () => {
    // —— A=444 移除 678（leaveUserIds:[678]）——
    const r = await invokeBridge('im_channel_member_change', {
      channelId: TARGET_CHANNEL_ID, leaveUserIds: [LEAVE_MEMBER_ID],
    });
    expect(r.ok).toBe(true);

    // —— ②④源：等 B=999 observe jsonl 出 channel_member_update 帧·memberChange.leave 含 678（含锚频道）——
    await browser.waitUntil(
      async () => readObserveFrames().some((f) => {
        if (f.action !== 'channel_member_update' || typeof f.raw !== 'string' || !f.raw.includes(TARGET_CHANNEL_ID)) return false;
        try {
          const leave = (JSON.parse(f.raw).data?.memberChange?.leave ?? []).map((u) => String(u.id));
          return leave.includes(LEAVE_MEMBER_ID);
        } catch { return false; }
      }),
      { timeout: 25000, interval: 250,
        timeoutMsg: 'B=999 未收 channel_member_update{leave:678}（断在 go handleMemberLeave→broadcastMemberLeaveIncrement→留存成员 999）' }
    );

    const frames = readObserveFrames();
    const hit = frames.find((f) => {
      if (f.action !== 'channel_member_update' || !f.raw?.includes(TARGET_CHANNEL_ID)) return false;
      try { return (JSON.parse(f.raw).data?.memberChange?.leave ?? []).some((u) => String(u.id) === LEAVE_MEMBER_ID); }
      catch { return false; }
    });
    expect(hit).toBeTruthy();
    const data = JSON.parse(hit.raw).data ?? {};
    console.log(`[UC-5.3b L2] B=999 收到 channel_member_update{leave}·锚频道=${TARGET_CHANNEL_ID}·leave=${JSON.stringify(data.memberChange?.leave?.map((u) => u.id))}`);
    // 守可证伪：memberChange.leave 含被移除者 678（真离场态到达留存成员·非空帧）。
    expect((data.memberChange?.leave ?? []).map((u) => String(u.id))).toContain(LEAVE_MEMBER_ID);
    captureObserverEvidence('uc-5.3b-l2-leave-observer', {
      observerKind: 'raw-ws',
      observerUserId: OBSERVER_ID,
      actorUserId: '444',
      channelId: TARGET_CHANNEL_ID,
      action: 'channel_member_update',
      assertions: {
        leaveContains: LEAVE_MEMBER_ID,
        rawContainsChannelId: hit.raw.includes(TARGET_CHANNEL_ID),
      },
      frame: hit,
      parsedData: data,
    });
    const domEvidenceFile = await captureDomEvidence(browser, 'uc-5.3b-l2-leave-actor-dom', [
      '[data-testid="status-bar"]',
      '[data-testid="channel-list"] [data-channel-id]',
      `[data-testid="channel-list"] [data-channel-id="${TARGET_CHANNEL_ID}"]`,
      '[data-member-id]',
      `[data-member-id="${LEAVE_MEMBER_ID}"]`,
      '[data-members]',
      '[data-testid="member-list"][data-members]',
      '[data-testid="member-list"] .mem[data-member-id]',
      `[data-testid="member-list"] .mem[data-member-id="${LEAVE_MEMBER_ID}"]`,
      `[data-testid="member-list"] .mem[data-member-id="${OBSERVER_ID}"]`,
      '[data-unread]',
    ]);
    const domEvidence = readDomEvidence(domEvidenceFile);
    expectDomRows(domEvidence, '[data-testid="channel-list"] [data-channel-id]');
    expectDomAttr(
      domEvidence,
      `[data-testid="channel-list"] [data-channel-id="${TARGET_CHANNEL_ID}"]`,
      'data-channel-id',
      TARGET_CHANNEL_ID
    );
    expectMemberAbsentFromDomEvidence(domEvidence, LEAVE_MEMBER_ID, OBSERVER_ID);

    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ① A 出站面 reducer 裁定（锚频道 ch·只断 outbound·②④③ 结构在 B=999 侧）——
    const expectWithAnchor = { ...EXPECT, corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID } };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: { members: null } });
    console.log('[UC-5.3b ① 出站] ' + (report.facets.outbound.ok ? '✓' : '✖ ' + report.facets.outbound.issues.join('; ')));
    expect(report.parseErrors.length).toBe(0);
    // ① A 出站：channel/member/change body {channelId, leaveUsers:[{id:678}]}（bodyForbidden snake/顶层 userId/id）。
    expect(report.facets.outbound.ok).toBe(true);
  });
});

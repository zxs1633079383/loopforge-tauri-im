// UC-6.1b L2 拉人广播·双账号 e2e（issue #28 / tracker #43）—— WebdriverIO，直连 4445。
//
// 命题（issue #28 reopen comment 精确机制·go cses_channel.go 源码定位）：
//   拉人 server echo `channel_member_update` 经 `NewWebSocketEvent(action,"","",key,nil,"")`，
//   key=**被拉成员 userId** 落第 4 个 userId 参数位 → echo **只推被拉成员的连接·不回声操作者**。
//   ∴ 单账号 L1（操作者 444 拉无连接的 445）结构上观测不到 ②③④——只有第二真账号 678 被拉、
//   且有真连接（observe-678 raw WS）时，channel_member_update 广播才有观测点。
//
// L2 双账号编排：
//   A=444（暖栈 app 4445·本 spec 驱动）= 动作端：建本人 CREATOR 新群（不含 678）→ 拉 678 进群。
//   B=678（observe-678.mjs raw WS·本 spec spawn）= 观测端：收 channel_member_update 广播帧。
//
// 四面裁定（A run.jsonl ∪ B l2-678.jsonl·按锚频道 ch 聚）：
//   ① 出站   : A run.jsonl → reducer outbound facet OK（POST channel/member/change·body
//              {channelId, joinUsers:[{id:678,teamId,role}]}·全 camelCase·bodyForbidden snake/顶层
//              userId/id·真机curl真源 §5）。【L1 已稳·此处复证不回退】
//   ②③④源 : B l2-678.jsonl → 出现 channel_member_update 广播帧·broadcast.userId==678（key 路由位）
//              + 帧 raw 含锚频道 channelId——这是 ②(emit_channel_member_updated 的输入帧)/③(被拉成员
//              入册)/④(channel_member BatchUpsert 的输入帧) 三面在 B 侧的**结构性源**。raw 观测端不跑
//              helix 引擎·捕获的是广播帧本体（②④ 的 reduce 源）·守可证伪：B 未收 channel_member_update
//              或帧不含 678/锚频道 → L2 红（非 tautology）。
//
// 时序纪律（HX-C011）：observe 先连上（等 hello 落盘）再拉人；拉后 waitUntil 轮询 jsonl 等广播帧·
//   超时=真 bug（go 没推 / 路由错 / 678 没连上），不固定 pause 猜 settle。

import { browser, expect } from '@wdio/globals';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { captureDomEvidence } from '../helpers/dom-evidence.mjs';
import { captureObserverEvidence } from '../helpers/l2-evidence.mjs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-6.1.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// 第二真账号（副账号·同 team·有真连接）——L2 的全部意义：拉 678（有连接）而非 445（无连接）。
const JOIN_MEMBER_ID = '678';
const OBSERVE_OUT = '/tmp/loopforge/l2-678-uc6.1.jsonl';
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

const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

// 读 B=678 observe jsonl → 解析帧（torn 末行容忍·只取可解析行）。
const readObserveFrames = () => {
  if (!existsSync(OBSERVE_OUT)) return [];
  const text = readFileSync(OBSERVE_OUT, 'utf8');
  const frames = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      frames.push(JSON.parse(line));
    } catch {
      /* torn 末行（并发 append）·跳过 */
    }
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

const expectDomAttr = (evidence, selector, attr, expected) => {
  const rows = expectDomRows(evidence, selector);
  expect(rows.some((row) => String(row?.attrs?.[attr] ?? '') === String(expected))).toBe(true);
  return rows;
};

describe('UC-6.1b · L2 拉人广播（双账号·issue #28 / #43）', () => {
  let TARGET_CHANNEL_ID;
  let observeProc;

  before(async () => {
    // —— 清旧 observe 产物（防跨轮串味·守可证伪：本轮帧必本轮产）——
    try {
      if (existsSync(OBSERVE_OUT)) rmSync(OBSERVE_OUT);
    } catch {
      /* ignore */
    }

    // —— spawn B=678 observe（raw WS·forever·SIGTERM 收）——
    observeProc = spawn(process.execPath, ['-e', WS_OBSERVER_JS], {
      env: {
        ...process.env,
        L2_REPO_ROOT: process.cwd(),
        L2_USER: '678',
        L2_OBSERVE_OUT: OBSERVE_OUT,
        L2_OBSERVE_MS: '0',
      },
      stdio: 'ignore',
      detached: false,
    });

    // —— 等 678 真连上（jsonl 出 hello 帧·broadcast.userId==678）——
    await browser.waitUntil(
      async () => readObserveFrames().some((f) => f.action === 'hello' && f?.broadcast?.userId === '678'),
      { timeout: 15000, interval: 200, timeoutMsg: 'observe-678 未连上 go WS（无 hello 帧·678 鉴权/握手失败）' }
    );
    console.log('[UC-6.1b] B=678 observe WS 已连上（hello 落盘）');

    // —— A=444 就绪 probe（increment_end + inflight0 + cursor 稳）——
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: 'A=444 就绪 probe 未通过' }
    );

    // —— A=444 建本人 CREATOR 新群（**不含** 678·保证 678 是新拉进·守可证伪）——
    const beforeIds = new Set(await snapshotChannelIds());
    const cr = await invokeBridge('im_create_channel', {
      displayName: `lf-l2-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: [],
    });
    expect(cr.ok).toBe(true);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: '建群无新行（断在 channel/create→WS→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    TARGET_CHANNEL_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(TARGET_CHANNEL_ID).toBeTruthy();
    console.log(`[UC-6.1b] A=444 锚频道（本人新建·待拉 ${JOIN_MEMBER_ID}）channelId=${TARGET_CHANNEL_ID}`);

    await invokeBridge('im_query_messages_by_channel', { channelId: TARGET_CHANNEL_ID });
    await invokeBridge('set_uc', { uc: 'UC-6.1' });
  });

  after(async () => {
    if (observeProc && !observeProc.killed) {
      try {
        observeProc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  });

  it('① A 出站 channel/member/change（joinUsers:678）+ ②④源 B=678 收 channel_member_update 广播', async () => {
    // —— A=444 拉 678 进锚频道（bridge 直 invoke·注入 joinUserIds:[678]）——
    const r = await invokeBridge('im_channel_member_change', {
      channelId: TARGET_CHANNEL_ID,
      joinUserIds: [JOIN_MEMBER_ID],
    });
    expect(r.ok).toBe(true);

    // —— ②④源：等 B=678 observe jsonl 出 channel_member_update 广播帧（含锚频道）——
    await browser.waitUntil(
      async () => {
        const frames = readObserveFrames();
        return frames.some(
          (f) =>
            f.action === 'channel_member_update' &&
            typeof f.raw === 'string' &&
            f.raw.includes(TARGET_CHANNEL_ID)
        );
      },
      {
        timeout: 25000,
        interval: 250,
        timeoutMsg:
          'B=678 未收 channel_member_update 广播（断在 go ChannelMemberChange→key=678 路由 echo→678 连接）',
      }
    );

    const frames = readObserveFrames();
    const cmuFrames = frames.filter((f) => f.action === 'channel_member_update');
    console.log(
      `[UC-6.1b L2] B=678 收到 channel_member_update ×${cmuFrames.length}·锚频道=${TARGET_CHANNEL_ID}`
    );

    // —— L2 守可证伪：B 收到的 channel_member_update 帧 broadcast.userId==678（key 路由位）+ raw 含锚频道 ——
    const hit = cmuFrames.find((f) => f.raw && f.raw.includes(TARGET_CHANNEL_ID));
    expect(hit).toBeTruthy();
    // broadcast.userId == 678：echo key（被拉成员 userId）落 userId 路由位（issue #28 机制实证·非多设备 echo）。
    expect(hit.broadcast?.userId).toBe(JOIN_MEMBER_ID);
    captureObserverEvidence('uc-6.1-l2-member-observer', {
      observerKind: 'raw-ws',
      observerUserId: JOIN_MEMBER_ID,
      actorUserId: '444',
      channelId: TARGET_CHANNEL_ID,
      action: 'channel_member_update',
      assertions: {
        broadcastUserId: JOIN_MEMBER_ID,
        rawContainsChannelId: hit.raw.includes(TARGET_CHANNEL_ID),
      },
      frame: hit,
    });
    const domEvidenceFile = await captureDomEvidence(browser, 'uc-6.1-l2-member-actor-dom', [
      '[data-testid="status-bar"]',
      '[data-testid="member-list"]',
      '[data-member-id]',
      `[data-member-id="${JOIN_MEMBER_ID}"]`,
      '[data-members]',
      `[data-channel-id="${TARGET_CHANNEL_ID}"]`,
    ]);
    const domEvidence = readDomEvidence(domEvidenceFile);
    expectDomRows(domEvidence, '[data-member-id]');
    expectDomAttr(domEvidence, `[data-member-id="${JOIN_MEMBER_ID}"]`, 'data-member-id', JOIN_MEMBER_ID);
    expectDomAttr(domEvidence, `[data-channel-id="${TARGET_CHANNEL_ID}"]`, 'data-channel-id', TARGET_CHANNEL_ID);

    // —— 关 UC 窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ① A 出站面 reducer 裁定（锚频道 ch·只断 outbound·②③④ 结构在 B 侧）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: TARGET_CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: { members: null } });

    console.log('[UC-6.1b 四面报告] ' + report.summary);
    if (!report.facets.outbound.ok)
      console.log('  ✖ outbound: ' + report.facets.outbound.issues.join('; '));

    expect(report.parseErrors.length).toBe(0);
    // ① A 出站：channel/member/change body {channelId, joinUsers:[{id:678}]}（bodyForbidden snake/顶层 userId/id）。
    expect(report.facets.outbound.ok).toBe(true);
  });
});

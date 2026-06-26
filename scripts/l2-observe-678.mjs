// scripts/l2-observe-678.mjs —— L2 双账号「observe-<B>」轻量 WS 观测原语。
//
// 命题：L2 某些面（拉/踢人广播 #43、admin 广播 #45、退公司广播 #48）的观测端是**第二账号 B**
// ——A=444 做动作（暖栈 app / l2-act.sh），B=678 收广播。本脚本以 B 身份连 go-mattermost WS，
// 捕获所有推送帧落 JSONL，供 reducer / 人审读「B 到底收没收到广播」。
//
// 鉴权（探明·2026-06-26·memory cookieid_equals_userid）：go 在 WS upgrade 阶段按 `cookieId`
// header 建 session（cookieId=userId·无独立 token）。故握手带 `cookieId: <B>` 头即可，go 回 hello。
// 用 Node 22 内建全局 WebSocket（undici·支持 { headers } options bag·无需 npm ws 依赖）。
//
// 用法：
//   node scripts/l2-observe-678.mjs                  # 连 678·帧落 /tmp/loopforge/l2-678.jsonl·forever
//   L2_USER=678 L2_OBSERVE_MS=20000 node scripts/...  # 限时 20s 自退（CI/spec 用）
//
// env：
//   L2_USER         观测账号 cookieId（默认 678）
//   L2_WS           ws url（默认 ws://localhost:8065/api/v4/websocket）
//   L2_TEAM         companyId（默认 64118eebd2b665246b7880eb）
//   L2_OBSERVE_OUT  帧 JSONL 落点（默认 /tmp/loopforge/l2-<user>.jsonl）
//   L2_OBSERVE_MS   运行毫秒数（默认 0 = forever·SIGTERM 收）
//
// 输出 JSONL 每行：{ ts, user, action, broadcast?, data_keys, raw }
//   action      = 帧 action（hello / post / post_read / channel_member_update / update_channel …）
//   broadcast   = 帧 broadcast 路由块（userId/channelId/omitUsers·判帧是否该归 B）
//   raw         = 原始帧文本（≤2KB·深挖用）
import { mkdirSync, createWriteStream } from 'node:fs';
import { dirname } from 'node:path';

const USER = process.env.L2_USER ?? '678';
const WS_URL = process.env.L2_WS ?? 'ws://localhost:8065/api/v4/websocket';
const TEAM = process.env.L2_TEAM ?? '64118eebd2b665246b7880eb';
const OUT = process.env.L2_OBSERVE_OUT ?? `/tmp/loopforge/l2-${USER}.jsonl`;
const RUN_MS = Number(process.env.L2_OBSERVE_MS ?? 0);

mkdirSync(dirname(OUT), { recursive: true });
const sink = createWriteStream(OUT, { flags: 'w' });

const headers = {
  cookieId: USER,
  companyId: TEAM,
  appType: 'bct',
  device: 'IOS',
  language: 'zh',
};

// Node 22 内建 WebSocket（undici）支持第二参 options bag 带 headers——go WS upgrade 鉴权靠它。
const ws = new WebSocket(WS_URL, { headers });

let frameCount = 0;
ws.addEventListener('open', () => console.error(`[observe ${USER}] OPEN ${WS_URL} → ${OUT}`));
ws.addEventListener('error', (ev) =>
  console.error(`[observe ${USER}] ERROR ${ev?.message ?? ev?.error ?? ev}`)
);
ws.addEventListener('close', (ev) => {
  console.error(`[observe ${USER}] CLOSE code=${ev.code} frames=${frameCount}`);
  sink.end();
});
ws.addEventListener('message', (ev) => {
  const raw = String(ev.data);
  let action = '?';
  let broadcast = null;
  let dataKeys = [];
  try {
    const obj = JSON.parse(raw);
    action = obj.action ?? '?';
    broadcast = obj.broadcast ?? null;
    dataKeys = obj.data && typeof obj.data === 'object' ? Object.keys(obj.data) : [];
  } catch {
    // 非 JSON 帧（ping/pong 等）——action 留 '?'，raw 仍记。
  }
  frameCount += 1;
  sink.write(
    JSON.stringify({
      ts: Date.now(),
      user: USER,
      action,
      broadcast,
      data_keys: dataKeys,
      raw: raw.slice(0, 2048),
    }) + '\n'
  );
  console.error(`[observe ${USER}] frame#${frameCount} action=${action}`);
});

const shutdown = () => {
  try {
    ws.close();
  } catch {
    /* already closed */
  }
  setTimeout(() => process.exit(0), 200);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
if (RUN_MS > 0) setTimeout(shutdown, RUN_MS);

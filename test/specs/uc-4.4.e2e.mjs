// UC-4.4 心跳 gap 补偿 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-4.4 是**内核自驱·心跳 ping piggyback 触发**（≠ 前端命令 round-trip；与 UC-4.1 就绪根 / UC-4.2
// gap sync 同族·均内核自驱无前端命令）：
//   behind-cursor seed 把 channel_event_cursor 各行拉回落后态 → 8s 周期心跳 ping piggyback
//   `{action:"ping", seq, data:{cursors:[{channelId, fromSeq}], allHash}}`（全量根群确定性升序快照
//   + FNV-1a allHash）的 allHash 与 server 权威水位不符 → server pong 回 `{gaps[].channelId,
//   hashMismatch}` → helix pong_compensate::compensate_from_pong 对落后 ch 自驱 sync/notify 补偿
//   （走 4.2 sync 路径·blocked by #32）→ server 回放离线区间事件 → 每条可见 type1 emit
//   im:channel:update-by-post（瘦 badge）→ message batch_upsert 逐事件落库 + cursor 跳空洞。
//   e2e 不点按钮——只等心跳 ping → pong 补偿链路落定，再读三面对账。
//
// 串三面（issue #34 锚点·契约只读 expect/uc-4.4.expect.json·③ DOM 面已移除·N/A）：
//   ① 出站   : ws-send ping 帧 {action:"ping", data:{cursors, allHash}}（piggyback·覆盖锚 ch）。
//              Transport::send decorator tee facet① hop=ws-send；reducer runFourFacetHeartbeatGap
//              在 UC 窗口内找 action==ping 且 data.cursors 含锚 ch 的 ws-send 帧。
//   ②        : 读 run.jsonl → reducer 按 event=im:channel:update-by-post + 锚 ch 找 → 断外层键集
//              {channel_id, event_seq, msg_id}（缺/多即红）。
//   ④        : 锚 ch 的 message batch_upsert 累计 rows ≥1（补偿 sync 回放逐事件落库·cursor 跳空洞旁证）。
//   ③ DOM    : N/A（issue #34 已移除该面·补偿增量经 4.2 路径渲染·DOM 断言归 UC-4.2·本 UC 不独立断 DOM）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置（reload-app --uc4.1 提供·须先 seed-behind-cursor·本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）·bootstrap UC=UC-4.4（心跳/pong hop 归 UC-4.4）
//   - channel_event_cursor 已 behind-cursor seed（落后态·ping allHash 才与 server 水位不符 → pong gap）
//   - 真 go 一轮心跳 ping/pong —— pong gap 补偿需真后端回放离线区间 increment_channel/post 帧
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（**本 UC 不可在 spec 内 truncate**·心跳/补偿事件在
//     boot 后 ping_interval(8s) 窗口流过·见 expect _note + harness spec --keep 机制）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetHeartbeatGap } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-4.4.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

describe('UC-4.4 · 心跳 gap 补偿（内核自驱·心跳 ping piggyback→pong gap→补偿·三面契约 ①②④·③ N/A）', () => {
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe：等 data-ready=true（increment_channel_end 收齐 + inflight0 + cursor 稳）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳·断在 hello→ready 链）' }
    );

    // 心跳 ping piggyback 由 8s 周期 timer 自驱（ping_interval_ms=8000）→ pong gap 补偿。ready 置位
    // 时首轮心跳可能尚未触发 → 等 run.jsonl 出现 action==ping 的 ws-send 帧 **且** 至少一条补偿回放的
    // im:channel:update-by-post 投影（补偿真发生·非空帧）。最长等 2 个 ping 周期 + 补偿往返 buffer。
    await browser.waitUntil(
      async () => {
        let sawPing = false, sawUbp = false;
        for (const line of readFileSync(RUN_JSONL, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.uc_id !== EXPECT.ucId) continue;
          const p = ev.payload ?? {};
          if (ev.facet === 'outbound' && ev.hop === 'ws-send' && p.action === 'ping') sawPing = true;
          if (ev.facet === 'projection' && ev.hop === 'projection' &&
              (p.event ?? p.channel) === 'im:channel:update-by-post') sawUbp = true;
        }
        return sawPing && sawUbp;
      },
      { timeout: 40000, interval: 500, timeoutMsg: '未观测到 心跳 ping 帧 + 补偿 update-by-post（断在心跳 ping→pong gap→compensate_from_pong→sync 回放链·或 behind-cursor seed 未生效→无 gap）' }
    );
  });

  it('①②④：心跳 ping piggyback → pong gap → 补偿 sync → update-by-post 投影 + message 落库 + cursor 跳空洞', async () => {
    // —— 锚根群选取：在 run.jsonl 里找 ping 帧 cursors 覆盖某 ch **且** 该 ch 有 im:channel:update-by-post
    //    投影 + message 落库（三面真收敛于一个真落后根群·非任取）。无命中 → CHANNEL_ID 留 null →
    //    reducer ① 红（faithful 退化·诚实出账·非放水）。
    const jsonl0 = readFileSync(RUN_JSONL, 'utf8');
    const lines = jsonl0.split('\n');
    const pingChs = new Set();   // 心跳 ping 帧 cursors 覆盖的 ch
    const ubpChs = new Set();    // 有 update-by-post 投影的 ch（补偿回放）
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.uc_id !== EXPECT.ucId) continue;
      const p = ev.payload ?? {};
      if (ev.facet === 'outbound' && ev.hop === 'ws-send' && p.action === 'ping') {
        const cur = p.data?.cursors;
        if (Array.isArray(cur)) {
          for (const c of cur) {
            const ch = c?.channelId ?? c?.channel_id;
            if (ch) pingChs.add(ch);
          }
        }
      }
      if (ev.facet === 'projection' && ev.hop === 'projection' &&
          (p.event ?? p.channel) === 'im:channel:update-by-post') {
        const ch = p.data?.channel_id ?? p.data?.channelId;
        if (ch) ubpChs.add(ch);
      }
    }
    // 锚 = 既被心跳 ping 携带、又有补偿 update-by-post 投影的根群（三面交集·真 gap-fill 根群）。
    for (const ch of ubpChs) {
      if (pingChs.has(ch)) { CHANNEL_ID = ch; break; }
    }
    // 退化：无交集时取任一有 update-by-post 的频道（② 仍可锚·① 由 reducer faithful 命中/红裁定）。
    if (!CHANNEL_ID && ubpChs.size > 0) CHANNEL_ID = [...ubpChs][0];
    expect(CHANNEL_ID).toBeTruthy();
    console.log(`[UC-4.4 锚] channelId=${CHANNEL_ID}（ping 覆盖=${[...pingChs].length}·update-by-post=${[...ubpChs].length}·交集命中=${pingChs.has(CHANNEL_ID)}）`);

    // —— 三面 reducer（runFourFacetHeartbeatGap·UC 窗口 + 锚 ch 各 facet 聚合裁定·无 DOM 面）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetHeartbeatGap({ jsonl, expect: expectWithAnchor });

    console.log('[UC-4.4 三面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：ws-send ping 帧 {action:"ping", data:{cursors, allHash}}（piggyback·cursors 覆盖锚 ch·allHash 非空）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影：im:channel:update-by-post 外层键集 {channel_id, event_seq, msg_id}（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：锚 ch message batch_upsert ≥1 行（补偿 sync 回放逐事件落库·cursor 跳空洞旁证）。
    expect(report.facets.storage.ok).toBe(true);
    // 整体三面齐绿（③ DOM N/A·已移除）。
    expect(report.green).toBe(true);
  });
});

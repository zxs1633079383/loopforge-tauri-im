// UC-1.7 转发/合并转发消息 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 扩展 UC-send-1 的四面契约到多频道场景（forward to N channels）：
//   ① 单出站 HTTP：POST posts/createPosts 含 posts:[转发内容] + channelIds:[ch1, ch2]
//   ② N 投影：各目标 channel 独立 im:post:received（fat 13 键·channel_id/msg_id/event_seq 各异）
//   ③ DOM  ：N 条转发消息行，各自 channel-id（区分目标频道）、各自 server msg-id
//   ④ 落库  ：N 行 message 表（每行 unique channel_id + server_id）
//
// 驱动链路（真实 invoke，非占位）：
//   1. before：就绪 probe + 取活动频道 + 从 seeded channel 列表取 N 个非源目标频道。
//   2. 发一条消息（复用 UC-1.1 发送流）→ echo 覆写取 server postId（待转发的源消息）。
//   3. set_uc('UC-1.7') → 经 onForward 真实 invoke im_relay_messages（posts:[源消息], channelIds:[ch1,ch2]）。
//   4. 等 N 条转发行上屏（im:post:received 投影驱动·各目标频道各一行·各自 channel-id）。
//   5. 关窗口前轮询 run.jsonl 确认 ②投影 + ④落库 都落 UC-1.7 窗口（in-window·非固定 pause）。
//   6. 读 run.jsonl → 多频道四面 reducer → 「断在哪一跳」。
//
// 时序纪律（HX-C011）：waitUntil 等条件，禁固定 pause。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - seeded db（/tmp/loopforge-im.db?mode=rwc）有 ≥3 个 channel（1 源 + 2 目标）
//   - debug-only invoke `set_uc` / `im_send` / `im_relay_messages` 已注册
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runFourFacetMultiChannel } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.7.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// seeded DB 字面名文件（engine.rs 把 ?mode=rwc 拼进文件名）。
const SEED_DB = '/tmp/loopforge-im.db?mode=rwc';

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

// 从 seeded channel 表取 N 个非源频道 id 作转发目标（真源·壳不臆造）。
const seededTargetChannels = (exclude, n) => {
  const sql = `SELECT id FROM channel WHERE id != '${exclude}' LIMIT ${n};`;
  const out = execFileSync('sqlite3', [SEED_DB, sql], { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
};

// 读所有消息行的 data-* 终态（全列表·转发行各自 channel-id 异）。
const readAllRows = () =>
  browser.execute(() => {
    const rows = [];
    document.querySelectorAll('[data-channel-id]').forEach((el) => {
      if (!el.hasAttribute('data-msg-id')) return; // 只取消息行（非频道列表行）
      const ds = el.dataset;
      rows.push({
        'msg-id': ds.msgId ?? null,
        'send-status': ds.sendStatus ?? null,
        'temporary-id': ds.temporaryId ?? null,
        'channel-id': ds.channelId ?? null,
        'event-seq': ds.eventSeq ?? null,
        'read-bits': ds.readBits ?? null,
        text: el.querySelector('.msg__text')?.textContent ?? null,
      });
    });
    return rows;
  });

describe('UC-1.7 · 转发消息到多频道（四面契约 ×N）', () => {
  let SOURCE_CHANNEL; // 源频道（发原消息）
  let SOURCE_POST_ID; // 待转发消息 server id
  let RELAY_TEXT;
  let TARGET_CHANNELS = []; // [ch1, ch2] 转发目标

  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready = increment_end + inflight0 + cursor 稳。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // 取当前活动频道作转发源（发原消息处）。
    SOURCE_CHANNEL = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
    expect(SOURCE_CHANNEL).toBeTruthy();

    // 目标频道：从 seeded channel 表取 2 个非源频道（真源·壳不臆造）。
    TARGET_CHANNELS = seededTargetChannels(SOURCE_CHANNEL, 2);
    expect(TARGET_CHANNELS.length).toBeGreaterThanOrEqual(2);
    console.log(
      `[UC-1.7 前置] source=${SOURCE_CHANNEL} targets=${JSON.stringify(TARGET_CHANNELS)}`
    );
  });

  it('①②③④：发源消息 → 转发 N 频道 → N 投影 + 单出站 body + N 落库 + N DOM 行', async () => {
    // —— 第一步：发一条源消息（复用 UC-1.1 发送流·得可转发的 server post）——
    await invokeBridge('set_uc', { uc: 'UC-1.7-send' });

    RELAY_TEXT = `relay-${Math.random().toString(36).slice(2, 8)}`;
    const input = await $('[data-role="composer-input"]');
    await input.setValue(RELAY_TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 等乐观 sending 行（im:post:sending 投影驱动）。
    await browser.waitUntil(
      async () => {
        const tid = await browser.execute(
          () =>
            document
              .querySelector('[data-send-status="sending"]')
              ?.getAttribute('data-temporary-id') ?? null
        );
        return !!tid;
      },
      { timeout: 8000, timeoutMsg: '源消息乐观 sending 行未出现' }
    );

    // 等 echo 覆写（status=sent）取 server postId。
    let srcTmp = null;
    await browser.waitUntil(
      async () => {
        srcTmp = await browser.execute(
          () =>
            document
              .querySelector('[data-send-status="sent"]')
              ?.getAttribute('data-temporary-id') ?? null
        );
        return !!srcTmp;
      },
      { timeout: 15000, timeoutMsg: '源消息 echo 未覆写（断在 send→posts/create→echo 对账）' }
    );
    SOURCE_POST_ID = await browser.execute((t) => {
      const el = document.querySelector(`[data-temporary-id="${t}"]`);
      return el?.getAttribute('data-msg-id') ?? null;
    }, srcTmp);
    expect(SOURCE_POST_ID).toBeTruthy();
    expect(SOURCE_POST_ID).not.toBe(srcTmp); // 已覆写为 server id
    console.log(`[UC-1.7 前置] 待转发源消息 server postId=${SOURCE_POST_ID}`);

    // —— 第二步：转发到 N 目标频道 ——
    await invokeBridge('set_uc', { uc: 'UC-1.7' });

    // 直 invoke im_relay_messages（onForward 同形态·posts 元素 = 源消息 Post 对象·channelIds 真源目标）。
    // posts[0]：源消息 server id + 正文 + 新 temporaryId（让转发 echo 可对账）。
    const FORWARD_TMP = await browser.execute(() => {
      const charset = 'ybndrfg8ejkmcpqxot1uwisza345h769';
      let s = '';
      for (let i = 0; i < 26; i++) s += charset[Math.floor(Math.random() * 32)];
      return s;
    });
    // Post 对象只携内容（message/temporaryId/type），**不带源 id**——server PreSave 仅在 id=""
    // 时生成新 id（entity/post.go:188），带源 id 会让各目标频道副本复用同一 id → 落库去重 →
    // 目标频道无新行（实测 createPosts 返 SUCCESS 但无投影/无新行）。转发=建新消息，故不携源 id。
    const relayResult = await invokeBridge('im_relay_messages', {
      posts: [{ message: RELAY_TEXT, temporaryId: FORWARD_TMP, type: 'TEXT' }],
      channelIds: TARGET_CHANNELS,
    });
    expect(relayResult.ok).toBe(true);

    // —— 第三步：等 N 条转发行上屏（im:post:received 投影驱动·各目标频道各一行）——
    // 转发行特征：channel-id ∈ TARGET_CHANNELS（非源频道）、text == RELAY_TEXT、status=sent。
    await browser.waitUntil(
      async () => {
        const rows = await readAllRows();
        const fwd = rows.filter(
          (r) => TARGET_CHANNELS.includes(r['channel-id']) && r['send-status'] === 'sent'
        );
        const chs = new Set(fwd.map((r) => r['channel-id']));
        return chs.size >= TARGET_CHANNELS.length; // 每个目标频道都有转发行
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg: '转发行未覆全目标频道（断在 createPosts→WS post×N→投影×N→DOM×N）',
      }
    );

    const allRows = await readAllRows();
    const forwardRows = allRows.filter((r) => TARGET_CHANNELS.includes(r['channel-id']));
    console.log(
      `[UC-1.7 DOM] 转发行 ${forwardRows.length} 条 → channels=${forwardRows
        .map((r) => r['channel-id'])
        .join(',')} msgIds=${forwardRows.map((r) => r['msg-id']).join(',')}`
    );

    // —— 关窗口前轮询 run.jsonl 确认 N 投影 + N 落库都落 UC-1.7 窗口（in-window·非固定 pause）——
    const inWindowReady = () => {
      const txt = readFileSync(RUN_JSONL, 'utf8');
      const projCh = new Set();
      const storeCh = new Set();
      let hasOutbound = false;
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.uc_id !== 'UC-1.7') continue;
        const p = o.payload ?? {};
        if (
          o.facet === 'outbound' &&
          o.hop === 'http-req' &&
          String(p.url ?? '').endsWith('posts/createPosts')
        ) {
          hasOutbound = true;
        }
        if (o.facet === 'projection' && p.event === 'im:post:received') {
          const ch = p.data?.channelId ?? p.data?.channel_id;
          if (TARGET_CHANNELS.includes(ch)) projCh.add(ch);
        }
        if (o.facet === 'storage' && p.table === 'message') {
          // storage payload 不带行内容（隐私）→ 靠投影计数 + DB 直查；此处仅确认 message 写发生。
          storeCh.add(p.op ?? 'write');
        }
      }
      return hasOutbound && projCh.size >= TARGET_CHANNELS.length && storeCh.size > 0;
    };
    await browser.waitUntil(async () => inWindowReady(), {
      timeout: 20000,
      interval: 250,
      timeoutMsg: '转发 ①出站 / N②投影 / ④落库 未全落 UC-1.7 窗口（断在 createPosts→WS post×N→投影/落库）',
    });

    // —— 关窗口（窗口隔离）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②①④③：读 run.jsonl → 多频道四面 reducer（按 TARGET_CHANNELS 聚 N 束）——
    const expectWithAnchors = {
      ...EXPECT,
      corrAnchor: {
        ...EXPECT.corrAnchor,
        targetChannels: TARGET_CHANNELS,
        relayText: RELAY_TEXT,
      },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetMultiChannel({
      jsonl,
      expect: expectWithAnchors,
      domRows: forwardRows,
      targetChannels: TARGET_CHANNELS,
    });

    // 「断在哪一跳」报告。
    console.log('[UC-1.7 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言。
    expect(report.parseErrors.length).toBe(0);
    // ① 单出站 body：POST posts/createPosts，camelCase {posts, channelIds}（≥2 目标·无 PascalCase 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② N 投影：各目标频道 im:post:received fat 13 键（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ N 行落库：message 表 ≥2 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ N DOM 行：各自 channel-id（目标频道）、msg-id != tmp、status=sent。
    expect(report.facets.dom.ok).toBe(true);
  });
});

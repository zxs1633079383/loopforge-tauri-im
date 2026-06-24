// UC-1.7 转发/合并转发消息 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 扩展 UC-send-1 的四面契约到多频道场景：
//   ① 单出站 HTTP：POST /posts/createPosts 含 posts:[转发内容] + channelIds:[ch1, ch2, ...]
//   ② N 投影：各目标 channel 独立 im:post:received（fat，共享 temporaryId 但 channel_id 各异）
//   ③ DOM  ：N 消息行，each with unique channel-id, shared temporary-id, server msg-id 各异
//   ④ 落库  ：N 行 message 表（每行 unique channel_id + server_id）
//
// 时序纪律（HX-C011）：waitUntil N 行覆写，不猜固定 pause。
//
// 当前状态（Phase2 前）：UI 选择消息 + 目标频道的交互链路**尚未接线**。
// 本 spec 针对**意图中的 data-* 契约**编写（选择器/属性由契约推导）。
// 现在跑会红（UI 逻辑缺），Phase2 接线后转绿——spec 本身是契约的一部分。

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.7.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
// 薄壳约定：window.__lf.invoke(cmd, args) → @tauri-apps/api invoke。
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

// 读行的 data-* 终态（按 [data-temporary-id] + [data-channel-id] 选择器）。
const readRows = () =>
  browser.execute(() => {
    const rows = [];
    document.querySelectorAll('[data-temporary-id]').forEach((el) => {
      const ds = el.dataset;
      rows.push({
        'msg-id': ds.msgId ?? null,
        'send-status': ds.sendStatus ?? null,
        'temporary-id': ds.temporaryId ?? null,
        'channel-id': ds.channelId ?? null,
        'event-seq': ds.eventSeq ?? null,
        'read-bits': ds.readBits ?? null,
      });
    });
    return rows;
  });

describe('UC-1.7 · 转发消息到多频道（四面契约 ×N）', () => {
  // 转发来源消息内容（用于识别 DOM 行）；此 spec 是 Phase2 前的**意图契约**。
  const RELAY_TEXT = `relay-${Math.random().toString(36).slice(2, 8)}`;
  let SOURCE_MSG_ID;
  let TARGET_CHANNELS; // [ch1, ch2, ...] 用于后续断言

  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready 标志 = increment_channel_end + HTTP inflight==0 + cursor 稳。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // Phase2 接线后：前端会提供消息选择 + 目标频道选择 UI。
    // 当前契约占位：从 DOM 读当前会话 id（作为转发源频道参考）。
    const currentCh = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
    if (!currentCh) {
      throw new Error('无当前活跃频道 [data-active-channel]');
    }

    // 开 UC 窗口。
    await invokeBridge('set_uc', { uc: 'UC-1.7' });
  });

  it('①②③④：转发 → N 频道乐观行 → echo N 覆写 + 单出站 body + N 投影 + N 落库', async () => {
    // 此 spec 是 Phase2 前的**意图编写**。以下步骤描述业务逻辑，具体 selector/invoke 待接线。

    // —— ③ DOM 主驱动（Phase2 接线点）——
    // Phase2 时前端需实现：
    // 1. 消息选择器（如长按/右键菜单选"转发"）→ 打开转发对话框
    // 2. 转发对话框：从频道列表选多个目标频道 [ch1, ch2, ...]
    // 3. 点"确认转发" → invoke im_relay_messages({posts:[msg], channelIds:[ch1, ch2, ...]})

    // 当前契约规定的调用形式（UI 待接线）：
    // const relayResult = await invokeBridge('im_relay_messages', {
    //   posts: [{ id: SOURCE_MSG_ID, message: RELAY_TEXT, ... }],
    //   channelIds: TARGET_CHANNELS
    // });
    // expect(relayResult.ok).toBe(true);

    // Phase2 前的 workaround：由于尚无 UI，用 set_uc + manual wait 模拟时序。
    // 实际跑时会 timeout（预期的），Phase2 接线后改用上述 invoke 形式。

    // 等乐观行出现（预期 N 行，各自 channel-id 异，共享 temporary-id）。
    // selector 锚 [data-send-status="sending"][data-temporary-id] —— 可匹配 N 行。
    await browser.waitUntil(
      async () => {
        const count = await browser.execute(
          () => document.querySelectorAll('[data-send-status="sending"][data-temporary-id]').length
        );
        return count >= 2; // 至少 2 个目标频道
      },
      { timeout: 8000, timeoutMsg: '乐观行未上屏（断在 click→invoke→乐观渲染，Phase2 前预期红）' }
    );

    // 读乐观期的 temporary-id（所有行共享）。
    const optimisticRows = await readRows();
    expect(optimisticRows.length).toBeGreaterThanOrEqual(2);
    const TMP = optimisticRows[0]['temporary-id'];
    expect(TMP).toBeTruthy();

    // 验证各行 channel-id 各异（多频道特征）。
    const channelIds = new Set(optimisticRows.map((r) => r['channel-id']));
    expect(channelIds.size).toBe(optimisticRows.length);

    // 验证乐观期状态。
    for (const row of optimisticRows) {
      expect(row['send-status']).toBe('sending');
      expect(row['msg-id']).toBe(TMP); // 乐观期 data-msg-id == tmp
    }

    // 等 echo 覆写 —— N 行 data-send-status=sent 且 data-msg-id ≠ tmp（变 server_id）。
    await browser.waitUntil(
      async () => {
        const rows = await readRows();
        if (rows.length < optimisticRows.length) return false;
        return rows.every(
          (r) =>
            r['send-status'] === 'sent' &&
            r['msg-id'] &&
            r['msg-id'] !== TMP &&
            r['event-seq']
        );
      },
      {
        timeout: 15000,
        interval: 150,
        timeoutMsg: 'echo 未覆写 N 行（断在 WS post×N→reconcile→DOM×N，Phase2 前预期红）',
      }
    );

    const settledRows = await readRows();
    console.log(
      `[UC-1.7 DOM] tmp=${TMP} → settled=${settledRows.length} rows, msg-ids=${settledRows.map((r) => r['msg-id']).join(',')}`
    );

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②（+①④ pending）：读 run.jsonl → 四面 reducer ——
    // 锚定本次转发：tmp（来自 posts[0] 或乐观生成）+ 多个 ch（各目标频道）。
    // 策略：reducer 需识别「单个 outbound HTTP + N 个 projection + N 个 storage 行」的关联。
    // 当前 corr-key 规则（corr-key.mjs）按 (ch, tmp, sid, seq) 四元组聚束 —— 可正确分离 N 束。

    const settledChannelIds = new Set(settledRows.map((r) => r['channel-id']));
    const settledMsgIds = new Map(settledRows.map((r) => [r['channel-id'], r['msg-id']]));

    const expectWithAnchors = {
      ...EXPECT,
      corrAnchor: {
        ...EXPECT.corrAnchor,
        tmp: TMP,
        ch1: Array.from(settledChannelIds)[0],
        ch2: Array.from(settledChannelIds)[1],
      },
    };

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    // 注：Phase2 前，reducer 尚需扩展支持「multiChannel」和「multiRow」模式。
    // 当前 reducer 是 UC-send-1（单渠道）的实现；本 spec 的 expect.json 为多渠道定义。
    // Phase2 时升级 reducer 支持按 corrAnchor.ch1/ch2 聚 N 束 + diff 各束的投影/存储。
    const report = runFourFacet({
      jsonl,
      expect: expectWithAnchors,
      dom: settledRows,
      multiChannel: true, // 告诉 reducer：多频道模式，需聚 N 束
    });

    // 「断在哪一跳」报告。
    console.log('[UC-1.7 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言（Phase2 前预期部分红）。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：单 HTTP POST /posts/createPosts，camelCase {posts, channelIds}。
    expect(report.facets.outbound.ok).toBe(true);
    // ② N 投影：各频道 im:post:received fat 13-key。
    expect(report.facets.projection.ok).toBe(true);
    // ④ N 行存储：message 表 ≥2 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM N 行：msg-id != tmp、status=sent、各自 channel-id。
    expect(report.facets.dom.ok).toBe(true);
  });
});

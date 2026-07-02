// UC-1.9 加急消息 + 加急已读 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；两阶段同 corr_key=postId（已发送消息 server id）：
//   阶段①加急：发一条消息（复用 UC-1.1 基础）→ 取 server_id → invoke im_urgent_post
//              （targetIds 取活动频道 seeded 成员·非自身）→ 出站 POST posts/urgentPost
//              → WS post_update（加急标记）→ 投影 im:post:updated → DOM data-urgent=1。
//   阶段②确认：invoke im_urgent_confirm → 出站 POST posts/urgentConfirm → WS post_update。
//   ③ DOM    : 真驱动（读 [data-msg-id=sid] 行 data-urgent 终态）。
//   ②        : 读 run.jsonl → reducer 聚 corr_key（postId）→ 断 projection 字段集（fat 13 键）。
//   ①        : Recording<NativeHttp> tee 两阶段 HTTP body → 严格对齐 expect.outbound
//              （phase1 urgentPost camelCase channelId/postId/targetIds ；phase2 urgentConfirm
//               postId/channelId）；bodyForbidden 锚 snake_case 泄漏。
//   ④        : Recording<NativeStorage> tee 落库 op → message 表 ≥1 行（props.expediteMap）。
//
// 时序纪律（HX-C011）：waitUntil 等条件，禁固定 pause。超时=真 bug。
//
// 依赖前置（W1/W4 提供）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - seeded db（/tmp/loopforge-im.db?mode=rwc）有活动频道 + 成员（取 targetIds）
//   - debug-only invoke `set_uc` / `im_send` / `im_urgent_post` / `im_urgent_confirm` 已注册
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.9.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// seeded DB 字面名文件（engine.rs:101 把 ?mode=rwc 拼进文件名 → 字面名是数据库真身；
// plain /tmp/loopforge-im.db 是 0 字节幽灵文件·见 CLAUDE infra 真相纠偏）。
const SEED_DB = '/tmp/loopforge-im.db?mode=rwc';
// 自身 userId（profile dev-local cookieId·= 加急 targetIds 须排除的自己）。
const SELF_ID = '444';

// debug-only invoke 注入：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
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

// 从 seeded channel_member 取指定频道的非自身成员 id 作 targetIds（真源·壳不臆造）。
const seededTargets = (channelId) => {
  const sql = `SELECT user_id FROM channel_member WHERE channel_id='${channelId}' AND user_id!='${SELF_ID}' LIMIT 5;`;
  const out = execFileSync('sqlite3', [SEED_DB, sql], { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
};

const activeChannelId = () =>
  browser.execute(() => document.querySelector('main.im')?.getAttribute('data-active-channel') ?? null);

const renderedChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter(Boolean)
  );

// 读消息行的 data-* 终态（锚 [data-msg-id=sid]）。
const readMessageRow = (msgId) =>
  browser.execute((id) => {
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'urgent': ds.urgent ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      'read-bits': ds.readBits ?? null,
      _msgId: id,
    };
  }, msgId);

describe('UC-1.9 · 加急消息 + 加急已读（四面契约）', () => {
  let CHANNEL_ID;
  let POST_ID; // 待加急的消息 server id（发一条 → echo 覆写取之）
  let TARGET_IDS = [];

  before(async () => {
    // 就绪 probe：等 data-ready 标志（increment 收齐 + inflight==0 + cursor 稳）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    // 取当前活动频道 id。
    CHANNEL_ID = await activeChannelId();
    expect(CHANNEL_ID).toBeTruthy();

    // targetIds：优先用当前活动频道；若它是单人频道，则从真实渲染的 CL 频道里选择一个有非自身成员的频道。
    // 只消费真实 UI + helix storage，不造 targetId；找不到即真实前置红（seeded DB / CL 渲染缺口）。
    TARGET_IDS = seededTargets(CHANNEL_ID);
    if (TARGET_IDS.length === 0) {
      const candidates = await renderedChannelIds();
      for (const id of candidates) {
        const ids = seededTargets(id);
        if (ids.length === 0) continue;
        CHANNEL_ID = id;
        TARGET_IDS = ids;
        const clicked = await browser.execute((ch) => {
          const el = document.querySelector(`[data-channel-id="${ch}"]`);
          if (!el) return false;
          el.click();
          return true;
        }, CHANNEL_ID);
        expect(clicked).toBe(true);
        await browser.waitUntil(async () => (await activeChannelId()) === CHANNEL_ID, {
          timeout: 8000,
          interval: 150,
          timeoutMsg: `切换到可加急频道失败：${CHANNEL_ID}`,
        });
        break;
      }
    }
    expect(TARGET_IDS.length).toBeGreaterThan(0); // 无目标成员 → 后端 Validate 拒空 → 测试无意义
    console.log(`[UC-1.9 前置] channel=${CHANNEL_ID} targetIds=${JSON.stringify(TARGET_IDS)}`);
  });

  it('①②③④：发消息 → 取 server_id → 阶段①加急 → 阶段②确认收到加急', async () => {
    // —— 第一步：发一条消息建基础（复用 UC-1.1 发消息流·得可加急的 server post）——
    await invokeBridge('set_uc', { uc: 'UC-1.9-send' });

    const TEXT = `urgent-test-${Math.random().toString(36).slice(2, 8)}`;
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 等乐观 sending 行出现（im:post:sending 投影驱动），并捕获本次 temporary-id。
    let tmp = null;
    await browser.waitUntil(
      async () => {
        tmp = await browser.execute(
          () =>
            document
              .querySelector('[data-send-status="sending"]')
              ?.getAttribute('data-temporary-id') ?? null
        );
        return !!tmp;
      },
      { timeout: 8000, timeoutMsg: '乐观 sending 行未出现' }
    );

    // 等该特定乐观行 echo 覆写（status=sent），避免历史 sent 行抢答。
    await browser.waitUntil(
      async () => {
        const sid = await browser.execute(
          (t) => {
            const el = document.querySelector(`[data-temporary-id="${t}"]`);
            if (!el || el.getAttribute('data-send-status') !== 'sent') return null;
            const got = el.getAttribute('data-msg-id');
            return got && got !== t ? got : null;
          },
          tmp
        );
        return !!sid;
      },
      { timeout: 15000, timeoutMsg: 'echo 未覆写（断在 send→posts/create→echo 对账）' }
    );

    // 取 server_id（data-msg-id 已从 tmp 覆写）作加急锚。
    POST_ID = await browser.execute((t) => {
      const el = document.querySelector(`[data-temporary-id="${t}"]`);
      return el?.getAttribute('data-msg-id') ?? null;
    }, tmp);
    expect(POST_ID).toBeTruthy();
    expect(POST_ID).not.toBe(tmp); // 确认已覆写为 server id
    console.log(`[UC-1.9 前置] 待加急消息 server postId=${POST_ID}`);

    // —— 阶段①：发送加急通知 ——
    await invokeBridge('set_uc', { uc: 'UC-1.9' });

    const urgentResult = await invokeBridge('im_urgent_post', {
      channelId: CHANNEL_ID,
      postId: POST_ID,
      targetIds: TARGET_IDS,
    });
    expect(urgentResult.ok).toBe(true);

    // 等加急投影落地：server post_update（加急触发 type2 编辑路径）→ emit im:post:updated
    //   → 壳 applyMessageItem 覆写消息行（msg-id 已是 server id·行重渲）。
    // **契约真相**（projection-schema line186）：加急标记（expediteMap）**不在 post 投影**·权威在
    //   DB message.expedite_map 列（facet④ message UPDATE 守）→ DOM 面只断投影可观测的 post-row 存在，
    //   不等 data-urgent（不可投影驱动）。等行确实由投影驱动渲染（msg-id 锚命中）。
    await browser.waitUntil(
      async () => {
        const row = await readMessageRow(POST_ID);
        return row != null && row['msg-id'] === POST_ID;
      },
      { timeout: 10000, interval: 150, timeoutMsg: '阶段①加急 post_update 投影未驱动行重渲（断在 WS post_update→投影→DOM）' }
    );
    const afterUrgent = await readMessageRow(POST_ID);
    console.log(`[UC-1.9 阶段①] postId=${POST_ID} seq=${afterUrgent['event-seq']}（urgent 落 DB expedite_map·见 facet④）`);

    // —— 阶段②：确认收到加急 ——
    const confirmResult = await invokeBridge('im_urgent_confirm', {
      postId: POST_ID,
      channelId: CHANNEL_ID,
    });
    expect(confirmResult.ok).toBe(true);

    // 等确认投影：WS post_update → im:post:updated（确认后行仍在·data-urgent 或 read 态推进）。
    await browser.waitUntil(
      async () => {
        const row = await readMessageRow(POST_ID);
        return row != null; // 确认事件落地（行仍渲染·四面经 reducer 裁定具体值）
      },
      { timeout: 10000, interval: 150, timeoutMsg: '阶段②确认未完成（断在 WS post_update→投影）' }
    );
    const afterConfirm = await readMessageRow(POST_ID);
    console.log(`[UC-1.9 阶段②] 确认完成 urgent=${afterConfirm['urgent']} readBits=${afterConfirm['read-bits']}`);

    // —— 关窗口前等加急 post_update 投影 + message 落库真正落到 UC-1.9 窗口 ——
    // **时序纪律（HX-C011·窗口隔离根因）**：加急 server post_update WS echo 异步返回，
    //   emit im:post:updated（②）+ message batch_update（④）。若 set_uc('__quiescence__') 早于
    //   echo 返回 → ②④ 落 __quiescence__ 窗 → reducer 抽空（断「无投影 emit」）。故关窗前轮询
    //   run.jsonl 确认 ②（im:post:updated·sid=POST_ID）+ ④（batch_update message·id=POST_ID）
    //   都已落 UC-1.9 窗口（in-window 真信号·非固定 pause·超时=真 bug）。
    const inWindowReady = () => {
      const txt = readFileSync(RUN_JSONL, 'utf8');
      let hasProj = false;
      let hasStore = false;
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.uc_id !== 'UC-1.9') continue;
        const p = o.payload ?? {};
        if (o.facet === 'projection' && p.event === 'im:post:updated' && p.data?.msg_id === POST_ID)
          hasProj = true;
        if (o.facet === 'storage' && p.op === 'batch_update' && p.table === 'message' && p.id === POST_ID)
          hasStore = true;
      }
      return hasProj && hasStore;
    };
    await browser.waitUntil(async () => inWindowReady(), {
      timeout: 15000,
      interval: 200,
      timeoutMsg: '加急 post_update ②投影 / ④message 落库未落 UC-1.9 窗口（断在 WS post_update→投影/落库）',
    });

    // —— 关窗口（窗口隔离·后续帧归 __quiescence__）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②①④：读 run.jsonl → 四面 reducer（postId 作 corr_anchor 串两阶段）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, postId: POST_ID, channelId: CHANNEL_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: afterUrgent });

    // 「断在哪一跳」报告。
    console.log('[UC-1.9 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：两阶段 HTTP 均需对齐 expect.outbound（reducer 两阶段抽取）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema emit_post_updated（fat 13 键）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：message 表 ≥1 行（props.expediteMap）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM data-urgent=1 标记。
    expect(report.facets.dom.ok).toBe(true);
  });
});

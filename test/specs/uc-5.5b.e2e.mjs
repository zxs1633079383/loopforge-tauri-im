// UC-5.5b 消息置顶 post_pin round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
// 写族 WS 回声范式（仿 uc-3.3 模板·post_update echo）。
//
// 串四面（spec §7）：
//   ① outbound : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound
//                （channel_pinned.rs::SetMessageTopCommand 派生：POST channel/add/postPinned
//                {channelId,postId} camelCase·bodyForbidden 锚 snake_case channel_id/post_id 泄漏
//                + 锚 unpin 路由 channel/remove/postPinned 误混）。
//                **本面经 go-mattermost :8065 可真跑·与 ②③④ 的 cses-java WS 阻塞解耦。**
//   ② projection: 读 run.jsonl → reducer 聚 corr_key(sid=postId) → 断 im:post:updated fat 13 键集
//                （emit_post_updated·post_pin payload=pinned post 信息）。
//   ③ DOM    : 被置顶消息行渲染 data-pinned（self 已置顶·Phase2 UI 设计阶段确定形态）。
//   ④ storage: Recording<NativeStorage> tee 落库 op → update message 行（patch pinned 态）≥1 行。
//
// ⛔ 后端可达性（2026-06-26）：① 经 go 可真跑；②③④ post_pin WS 回声 → im:post:updated / DOM /
//   落库 三面均**阻于 cses-java 业务 WS 广播链断**（7091/3391=000·JDWP suspend）→ 现跑这三面会
//   waitUntil 超时（真 backend-down·非掩盖）。cses-java 恢复后四面真跑转绿（C004/C008/C011：契约只读·
//   绿由 reducer 裁定·禁橡皮章冒充绿）。spec 本身是契约的一部分（Phase1 authored·四面期望预设）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；置顶后等 post_pin→im:post:updated 投影 / DOM 覆写）。超时=真
//   bug / backend-down，不掩盖（少 invoke→① 红·少回灌→②③④ 红·可证伪对偶）。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳·seeded DB /tmp/loopforge-im.db 含真频道）
//   - debug-only invoke set_uc / im_send / im_post_pin 已注册（实现 phase·helix registry）
//   - 先发送一条消息建基础（有可置顶的 server post·取其 server_id）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-5.5b.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
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

// 读被置顶消息行的 data-* 终态（锚 [data-msg-id=sid]，置顶后行标 data-pinned）。
const readPinRow = (msgId) =>
  browser.execute((mid) => {
    const el = document.querySelector(`[data-msg-id="${mid}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      pinned: ds.pinned ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      _msgId: mid,
    };
  }, msgId);

/**
 * 等 run.jsonl 出现匹配的 ① 出站 http-req hop（urlEndsWith 锚·①面就绪 probe·与 5.6w 同款）。
 * 守可证伪：少 invoke / 出站未发 → 超时红（断在 invoke→HTTP 这跳）。
 */
async function waitOutbound(urlEndsWith) {
  await browser.waitUntil(
    () => {
      let jsonl = '';
      try {
        jsonl = readFileSync(RUN_JSONL, 'utf8');
      } catch {
        return false;
      }
      for (const line of jsonl.split('\n')) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (
          ev.facet === 'outbound' &&
          ev.hop === 'http-req' &&
          String(ev.payload?.url ?? '').endsWith(urlEndsWith)
        ) {
          return true;
        }
      }
      return false;
    },
    { timeout: 12000, interval: 150, timeoutMsg: `${urlEndsWith} 出站未发（断在 invoke→HTTP 这跳）` }
  );
}

/**
 * 发一条消息建基础并取其 server_id（置顶目标）。send 经 go-mattermost :8065 round-trip
 * （posts/create → WS post echo 覆写乐观行 status=sent → server_id）——**此链经 go 可真跑**
 * （与 post_pin 业务 echo 经 cses-java 解耦）。返回 {CH, MSG_ID}。
 */
async function sendAndGetServerId(ucWindow) {
  await invokeBridge('set_uc', { uc: ucWindow });
  const CH = await browser.execute(
    () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
  );
  expect(CH).toBeTruthy();

  const charset = 'ybndrfg8ejkmcpqxot1uwisza345h769';
  let SEND_TMP = '';
  for (let i = 0; i < 26; i++) SEND_TMP += charset[Math.floor(Math.random() * 32)];
  const TEXT = `pin-${Math.random().toString(36).slice(2, 8)}`;

  const sendRes = await invokeBridge('im_send', { channelId: CH, text: TEXT, temporaryId: SEND_TMP });
  expect(sendRes.ok).toBe(true);

  // 乐观行上屏（im:post:sending 投影驱动）。
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        (t) =>
          document
            .querySelector(`[data-temporary-id="${t}"][data-send-status="sending"]`)
            ?.getAttribute('data-temporary-id') ?? null,
        SEND_TMP
      )) === SEND_TMP,
    { timeout: 8000, timeoutMsg: '乐观行未上屏（断在 im_send→im:post:sending→乐观渲染）' }
  );

  // echo 覆写 status=sent → 取 server_id。
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        (t) => document.querySelector(`[data-temporary-id="${t}"]`)?.getAttribute('data-send-status') ?? null,
        SEND_TMP
      )) === 'sent',
    { timeout: 15000, timeoutMsg: 'echo 未覆写（断在 WS post→reconcile→DOM·或 cses-java 宕）' }
  );

  const MSG_ID = await browser.execute(
    (t) => document.querySelector(`[data-temporary-id="${t}"]`)?.getAttribute('data-msg-id') ?? null,
    SEND_TMP
  );
  expect(MSG_ID).toBeTruthy();
  expect(MSG_ID).not.toBe(SEND_TMP); // 确认已覆写为 server_id
  return { CH, MSG_ID };
}

describe('UC-5.5b · 消息置顶 post_pin round-trip（四面契约）', () => {
  // 流程：① 先发送一条消息（依赖 UC-1.1 基础）→ 取其 server_id → 置顶 im_post_pin
  //   分两 it：① 出站面（go-served·真可达绿）/ ②③④ post_pin echo 面（cses-java·⛔backend-down）。

  before(async () => {
    // 就绪 probe（spec §3.1 / four-facet-oracle §2）：等 data-ready 标志
    //   = increment_channel_end 收齐 + HTTP inflight==0 + cursor 稳。
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );
  });

  // ───────────────────────── ① 出站面（go-mattermost :8065 在线·真可达绿）─────────────────────────
  // send round-trip（posts/create→WS echo）+ post_pin 出站均经 go·与 post_pin 业务 echo（cses-java）解耦。
  // 独立 it 保 ① 绿信号不被 ②③④（backend-down）红淹没（同 5.6w ① / ②④ 分块）。
  it('① 发消息取 server_id → im_post_pin 置顶 → POST channel/add/postPinned {channelId,postId}（camelCase·go-served）', async () => {
    const { CH, MSG_ID } = await sendAndGetServerId('UC-5.5b-1-send');

    await invokeBridge('set_uc', { uc: 'UC-5.5b' });
    // invoke im_post_pin，camelCase {channelId,postId}（channel_pinned.rs builder 读 camel·
    // bridge 字节透传不转 snake → 发 snake 会 require_str 失败）。
    const pinResult = await invokeBridge('im_post_pin', { channelId: CH, postId: MSG_ID });
    expect(pinResult.ok).toBe(true);

    // ① 就绪 probe：等 channel/add/postPinned 出站落进 run.jsonl（少 invoke→出站未发→超时红·可证伪）。
    await waitOutbound('channel/add/postPinned');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // 锚定置顶目标 server_id（sid 维度）。出站 body.postId 是字符串 → corr-key 抽 sid → 聚束。
    const expectWithAnchor = { ...EXPECT, corrAnchor: { ...EXPECT.corrAnchor, postId: MSG_ID } };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: null });

    console.log('[UC-5.5b ① 报告] ' + report.summary);
    if (!report.facets.outbound.ok) console.log('  ✖ outbound: ' + report.facets.outbound.issues.join('; '));
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：POST channel/add/postPinned {channelId,postId} camelCase
    //   （bodyForbidden 锚 snake channel_id/post_id 泄漏 + unpin 路由误混）。go-served·真可达绿。
    expect(report.facets.outbound.ok).toBe(true);
  });

  // ──────────────── ②③④ 投影/落库/DOM 面（WS post_pin echo·⛔backend-down·cses-java 宕机）────────────────
  //
  // post_pin server echo = WS post_pin → im:post:updated（fat 13 键）→ message pinned patch + DOM data-pinned。
  // cses-java（7091/3391=000·JDWP suspend）→ go→cses-java 业务 WS 广播链断 → 无 post_pin echo →
  // 下列 waitUntil(data-pinned) 超时（真 backend-down·it 红·非吞掉=非 tautology·C008）。后端恢复后
  // 重跑 `harness.sh reload-app && harness.sh spec 5.5b` 裁定 ②③④ 绿（C004/C009/C011：契约只读·绿由
  // reducer 裁定·禁伪造绿）。
  it('②③④ post_pin echo → 投影 im:post:updated（fat 13 键）+ message pinned patch + DOM data-pinned（⛔backend-down）', async () => {
    const { CH, MSG_ID } = await sendAndGetServerId('UC-5.5b-3-send');

    await invokeBridge('set_uc', { uc: 'UC-5.5b-echo' });
    const pinResult = await invokeBridge('im_post_pin', { channelId: CH, postId: MSG_ID });
    expect(pinResult.ok).toBe(true);

    // ⛔backend-down 闸门：等 WS post_pin → im:post:updated 投影驱动行的 DOM data-pinned。
    let pinState = null;
    await browser.waitUntil(
      async () => {
        pinState = await readPinRow(MSG_ID);
        return pinState && pinState.pinned != null && pinState.pinned !== '';
      },
      {
        timeout: 15000,
        interval: 150,
        timeoutMsg:
          '置顶投影未生效（data-pinned·断在 WS post_pin→emit_post_updated→投影→DOM·或 ⛔ cses-java 业务 WS 广播链宕）',
      }
    );

    console.log(
      `[UC-5.5b DOM] msgId=${MSG_ID} after pin: data-pinned=${pinState === null ? 'row missing' : pinState.pinned}`
    );
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const expectWithAnchor = { ...EXPECT, corrAnchor: { ...EXPECT.corrAnchor, postId: MSG_ID } };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: pinState });

    console.log('[UC-5.5b ②③④ 报告] ' + report.summary);
    for (const f of ['projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }
    expect(report.parseErrors.length).toBe(0);
    // ② 投影字段集 == emit_post_updated（im:post:updated · fat 13 键·缺/多即 fail）。⛔ cses-java。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：update message 行 ≥1（pinned patch）。⛔ cses-java。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：行标 data-pinned（Phase2 UI 确认形态后细化）。⛔ cses-java。
    expect(report.facets.dom.ok).toBe(true);
  });
});

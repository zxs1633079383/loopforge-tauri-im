// UC-3.1 会话已读回执 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）·Phase2 已接线（im_read_channel + onReadChannel + data-read-bits 渲染）。
// **L1 单连接可观测性切分**（read echo 多设备-only·见底部 ②④ 说明）：
//   ① 绿     : Recording<NativeHttp> tee 出站 body → 对齐 expect.outbound（POST channels/view
//              {channels:[{id}]}·fire-and-forget·真源 partials/6:139）。Go 返 viewChannel success。
//              corr_key = ch（channels[0].id→ch·装饰器 event.rs::extract_corr_key 专探）。
//   ③ 绿     : 目标消息行 data-read-bits 非空（app.component.ts:145 [attr.data-read-bits]=m.readBits·
//              壳纯渲染·send echo im:post:received fat 集已置 self read bit·无前端算）。
//   ②④ L2   : read echo `event_type=6` 是**多设备 echo**（partials/6:140）——server 只广播给该用户
//              其他设备，不回灌发起读的本连接。L1 单账号单连接结构性观测不到 im:post:read 投影(②)/
//              read echo 落库(④)。非 helix/loopforge bug，是 server 多设备语义。真绿须 L2 双账号
//              （CLAUDE.md §8.7）。spec 用可证伪护栏断 ②④ 缺席（gap 自愈即翻红·不橡皮章）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；read 等投影/DOM 覆写完成）。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 post_read type6 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_send` / `im_read_channel` 已注册（spec §5/§7）
//   - 先发送消息 UC-1.1 建基础（有可标已读的 server_id 消息行）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-3.1.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
// 薄壳约定（W2 实现）：window.__lf.invoke(cmd, args) → @tauri-apps/api invoke。
//
// executeAsync：WKWebDriver execute/sync 无法序列化 Promise；done 回调里 await invoke 再 done
// 一个可序列化结果（ok/err 包成纯对象，不把 Promise 回传）。
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

// 读已读后消息行的 data-* 终态（锚 [data-msg-id=sid]，已读作用在 server_id 行）。
const readReceiptRow = (msgId) =>
  browser.execute((mid) => {
    const el = document.querySelector(`[data-msg-id="${mid}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'read-bits': ds.readBits ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      _msgId: mid,
    };
  }, msgId);

describe('UC-3.1 · 会话已读回执 round-trip（四面契约）', () => {
  // 已读流程：① 先发一条消息建基础（依赖 UC-1.1）取其 server_id ② invoke im_read_channel 标会话已读
  //   ③ 观察 outbound channels/view + WS post_read 投影 im:post:read + DOM data-read-bits + 落库 read_bits。
  let CHANNEL_ID;
  let MSG_ID; // server_id 作已读目标行锚（sid 维度）

  before(async () => {
    // 就绪 probe（spec §3.1 / four-facet-oracle §2）：等 data-ready 标志
    //   = increment_channel_end 收齐 + HTTP inflight==0 + cursor 稳。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // 取当前频道 id（薄壳暴露在会话容器 [data-active-channel] 上）。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
  });

  it('①③ 绿 + ②④ L2-pending：发消息建基础 → 标会话已读 → channels/view 出站(①绿) + DOM data-read-bits(③绿)；read echo 多设备-only → ②④ 单连接不可观测(L2-pending·可证伪护栏断缺席)', async () => {
    // —— 第一步：发送消息建基础（复用 UC-1.1 发消息流，沉淀一条可标已读的 server_id 行） ——
    await invokeBridge('set_uc', { uc: 'UC-3.1-send' });

    const TEXT = `read-test-${Math.random().toString(36).slice(2, 8)}`;
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 等乐观行出现，取 temporaryId 锚。
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
      { timeout: 8000, timeoutMsg: '乐观行未上屏（断在 click→store.send→乐观渲染）' }
    );

    // 等 echo 覆写（status=sent），取 temporaryId。
    let tmp = null;
    await browser.waitUntil(
      async () => {
        tmp = await browser.execute(
          () =>
            document
              .querySelector('[data-send-status="sent"]')
              ?.getAttribute('data-temporary-id') ?? null
        );
        return !!tmp;
      },
      { timeout: 15000, timeoutMsg: 'echo 未覆写（断在 WS post→reconcile→DOM）' }
    );

    // 取 server_id（data-msg-id 已从 tmp 覆写）作已读目标锚。
    MSG_ID = await browser.execute((t) => {
      const el = document.querySelector(`[data-temporary-id="${t}"]`);
      return el?.getAttribute('data-msg-id') ?? null;
    }, tmp);
    expect(MSG_ID).toBeTruthy();
    expect(MSG_ID).not.toBe(tmp); // 确认已覆写为 server_id

    // —— 第二步：标会话已读 ——
    await invokeBridge('set_uc', { uc: 'UC-3.1' });

    // invoke im_read_channel（会话级已读 → 入泵 im_channels_view → 出站 POST channels/view {channels:[{id}]}
    // fire-and-forget → Go 写 channelmembers.last_read_seq → event_type=6 echo → im:post:read fat 投影）。
    const readResult = await invokeBridge('im_read_channel', { channelId: CHANNEL_ID });
    expect(readResult.ok).toBe(true);

    // 断言③：已读后目标 server_id 行带 data-read-bits（self 位置位·send echo im:post:received fat
    // 集已置 self read bit）。L1 单连接：read echo 不回灌自身（见下 ②④ 说明），故 read-bits 由
    // send 路径 fat 投影驱动·壳纯渲染（无前端算）——data-* 属性存在即 ③ 绿（self 位编码定值待 L2 细化）。
    let receiptState = null;
    await browser.waitUntil(
      async () => {
        receiptState = await readReceiptRow(MSG_ID);
        return receiptState && receiptState['read-bits'] != null && receiptState['read-bits'] !== '';
      },
      { timeout: 15000, interval: 150, timeoutMsg: 'DOM data-read-bits 未上屏（断在 send echo fat→渲染）' }
    );

    console.log(
      `[UC-3.1 DOM] msgId=${MSG_ID} after read: data-read-bits=${receiptState?.['read-bits']} seq=${receiptState?.['event-seq']}`
    );

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 读 run.jsonl → 四面 reducer ——
    // 锚：① channels/view 出站 corr_key = ch（channels[0].id→ch·装饰器 event.rs 专探）；③ DOM 锚
    // 目标 server_id 行（sid）。两锚都注入——ch 绑 ① 出站束，sid 绑 ③ 目标行。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: CHANNEL_ID, sid: MSG_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: receiptState });

    console.log('[UC-3.1 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);

    // —— L1 单连接可观测面（硬断言·绿）——
    // ① 出站 read body：POST channels/view {channels:[{id}]}（fire-and-forget·真源 partials/6:139）。
    //    Go 返 `viewChannel success`（已读已写 channelmembers.last_read_seq·run.jsonl 实证）。
    expect(report.facets.outbound.ok).toBe(true);
    // ③ DOM：目标行 data-read-bits 非空（self 位·send echo fat 集驱动·壳纯渲染）。
    expect(report.facets.dom.ok).toBe(true);

    // —— ②④ = L2 多设备面（单连接结构性不可观测·非 bug·run.jsonl 证据见下）——
    // 真源 partials/6:140：read echo `event_type=6` 是**多设备 echo**——server 写 last_read_seq 后只
    // 广播给该用户**其他**设备/连接，**不回灌发起读的本连接**。L1 单账号单连接 e2e：channels/view
    // 成功（① 绿）但本连接收不到 post_read 回声 → 无 im:post:read 投影（②）→ 无 read echo 落库（④）。
    // 这是 server 多设备语义，非 helix/loopforge 缺陷。②④ 的真绿须 L2 双账号/多设备（CLAUDE.md §8.7）。
    //
    // 可证伪护栏（C008/C011·不橡皮章）：显式断言 read echo 确实缺席（projection/storage 红）——
    // 证明 ②④ 是**真实 server 多设备 gap**而非被掩盖。若未来 server 改为回灌本连接（②④ 转绿），
    // 本断言会**翻红**，强制复核把 ②④ 升级为硬绿断言（gap 自愈即暴露·不留橡皮章假阴性）。
    expect(report.facets.projection.ok).toBe(false); // ② read echo 投影缺席（L2-pending·见上）
    expect(report.facets.storage.ok).toBe(false); // ④ read echo 落库缺席（L2-pending·见上）
  });
});

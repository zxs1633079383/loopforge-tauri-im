// UC-3.3 模板已收到 ACK round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；①④ rewire 待接通（Phase2 串行）→ 四面期望预设：
//   ① outbound : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound
//                （helix template_received.rs 派生：POST post/templateReceived {postId} camelCase·
//                **/post 单数前缀**命名陷阱·bodyForbidden 锚 snake_case post_id 泄漏）。
//   ② projection: 读 run.jsonl → reducer 聚 corr_key → 断 im:post:updated fat 13 键集（RecordingSink tee）。
//   ③ DOM    : 待接线 —— UI 设计阶段确定模板已收到行表现（data-template-received）。
//              本 spec 针对**意图中的 data-* 契约**编写（选择器按契约设计）；
//              现在跑会红（Phase2 未接线），Phase2 接线后转绿——这是正常的，spec 本身是契约的一部分。
//   ④ storage: Recording<NativeStorage> tee 落库 op → update message 表 ≥1 行（edit_content_op props.template patch）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；ack 等 post_update 投影/DOM 覆写完成）。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 post_update echo 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_template_received` 已注册（spec §5/§7；helix registry im_template_received）
//   - 先发送一条模板消息 UC-1.1 建基础（有可回执的模板消息·取其 server_id）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-3.3.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
// 薄壳约定（W2 实现）：window.__lf.invoke(cmd, args) → @tauri-apps/api invoke。
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

// 读模板已收到回执后行的 data-* 终态（锚 [data-msg-id=sid]，回执后行标 data-template-received）。
const readAckRow = (msgId) =>
  browser.execute((mid) => {
    const el = document.querySelector(`[data-msg-id="${mid}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'template-received': ds.templateReceived ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      _msgId: mid,
    };
  }, msgId);

describe('UC-3.3 · 模板已收到 ACK round-trip（四面契约）', () => {
  // 流程：① 先发送一条模板消息（依赖 UC-1.1 基础）② 取其 server_id ③ 回执 templateReceived
  //       ④ 观察 WS post_update → 投影 im:post:updated / DOM data-template-received / 存储 props.template patch 四面。
  let CHANNEL_ID;
  let MSG_ID; // server_id 作回执目标锚（sid 维度，无 tmp——操作既有 server post）

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

    // 取当前频道 id。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );
  });

  it('①②③④：发模板消息 → 取 server_id → templateReceived 回执 → WS post_update + 投影 im:post:updated + 落库 props.template patch + DOM data-template-received', async () => {
    // —— 第一步：发送一条模板消息建基础（复用 UC-1.1 发消息流，取得可回执的 server post） ——
    await invokeBridge('set_uc', { uc: 'UC-3.3-send' });

    const TEXT = `tpl-${Math.random().toString(36).slice(2, 8)}`;
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 等乐观行出现。
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

    // 等 echo 覆写（status=sent）→ 取 server_id。
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

    MSG_ID = await browser.execute(
      (t) => {
        const el = document.querySelector(`[data-temporary-id="${t}"]`);
        return el?.getAttribute('data-msg-id') ?? null;
      },
      tmp
    );
    expect(MSG_ID).toBeTruthy();
    expect(MSG_ID).not.toBe(tmp); // 确认已覆写为 server_id

    // —— 第二步：模板已收到回执 ——
    await invokeBridge('set_uc', { uc: 'UC-3.3' });

    // invoke im_template_received，参数 camelCase {postId}（helix template_received.rs builder 读 camel postId；
    // bridge paramNames:['payload'] 字节透传不转 snake → 发 snake post_id 会 require_str 失败）。
    const ackResult = await invokeBridge('im_template_received', { postId: MSG_ID });
    expect(ackResult.ok).toBe(true);

    // 断言③：等 WS post_update 投影回灌后行的 DOM 表现（data-template-received）。
    // Phase2 UI 设计前，spec 记录意图：消息行应标 data-template-received（self 已确认收到）。
    let ackState = null;
    await browser.waitUntil(
      async () => {
        ackState = await readAckRow(MSG_ID);
        return ackState && ackState['template-received'] != null && ackState['template-received'] !== '';
      },
      { timeout: 15000, interval: 150, timeoutMsg: '模板已收到投影未生效（data-template-received，断在 WS post_update→gate→投影→DOM）' }
    );

    console.log(
      `[UC-3.3 DOM] msgId=${MSG_ID} after templateReceived: data-template-received=${
        ackState === null ? 'row missing' : ackState['template-received']
      }`
    );

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②（+①④ pending Phase2）：读 run.jsonl → 四面 reducer ——
    // 锚定本次回执目标 server_id（sid 维度·无 tmp）注入 corrAnchor.postId。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, postId: MSG_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: ackState });

    // 「断在哪一跳」报告。
    console.log('[UC-3.3 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言（现阶段 Phase1 契约设计，Phase2 接线后四面会转绿）。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：POST post/templateReceived {postId} camelCase（/post 单数前缀·bodyForbidden snake_case 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema emit_post_updated（im:post:updated · fat 13 键，缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：update message 表 ≥1 行（edit_content_op props.template patch）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：行标 data-template-received（Phase2 UI 确认具体形态后细化）。
    expect(report.facets.dom.ok).toBe(true);
  });
});

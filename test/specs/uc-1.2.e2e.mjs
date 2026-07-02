// UC-1.2 发送DOCUMENT消息 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；①④ rewire 已接通（组装根走 host 泛型壳 + 全 port 装饰）→ 四面全断言：
//   ③ DOM    : 真驱动 —— 填字 + 点 [data-testid=send-document-btn] → store.sendDocument 真乐观流 →
//              从 DOM 读 store 生成的 data-temporary-id → 等 echo → data-msg-id 从 tmp 变 server、
//              status=sent、type=DOCUMENT（WebdriverIO 直读）。
//   ②        : 读 run.jsonl → reducer 聚 corr_key → 断 projection 字段集（RecordingSink tee）。
//   ①        : Recording<NativeHttp> tee 出站 body → 严格对齐 expect.outbound（真机curl真源派生，
//              camelCase + bodyForbidden 锚 snake_case 旧形态泄漏）。
//   ④        : Recording<NativeStorage> tee 落库 op → batch_upsert message 表 ≥1 行。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；echo 等覆写完成）。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 echo 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_send` 已注册（spec §5/§7）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）
//
// 现状：DOCUMENT 发送复用 composer draft 输入框 + [data-testid=send-document-btn]，
// 真路径必须是「填 draft -> 点文档按钮 -> store.sendDocument(channelId, draft)」。

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.2.expect.json', import.meta.url), 'utf8')
);

// run.jsonl 路径：W1 用 env 暴露；缺省回退 src-tauri 标准落点。
const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// debug-only invoke 注入（spec §7 step1）：经前端薄壳暴露的 window.__lf 桥透传到 Tauri invoke。
// 薄壳约定（W2 实现）：window.__lf.invoke(cmd, args) → @tauri-apps/api invoke。
//
// Bug-1 修：同步 browser.execute 返回 invoke 的 Promise → WKWebDriver execute/sync 序列化
// Promise 报 "unsupported type"。改用 executeAsync —— done 回调里 await invoke 再 done 一个
// 可序列化结果（ok/err 包成纯对象，不把 Promise 回传）。
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

// 读乐观/覆写行的 data-* 终态（锚 [data-temporary-id=t]，贯穿乐观→覆写不变）。
const readRow = (tmp) =>
  browser.execute((t) => {
    const el = document.querySelector(`[data-temporary-id="${t}"]`);
    if (!el) return null;
    const ds = el.dataset;
    return {
      'msg-id': ds.msgId ?? null,
      'send-status': ds.sendStatus ?? null,
      'temporary-id': ds.temporaryId ?? null,
      'channel-id': ds.channelId ?? null,
      'event-seq': ds.eventSeq ?? null,
      'read-bits': ds.readBits ?? null,
      'type': ds.type ?? null,
      _temporaryId: t,
    };
  }, tmp);

describe('UC-1.2 · 发送DOCUMENT消息 round-trip（四面契约）', () => {
  // Bug-2 修：temporaryId 由 store.sendDocument() 生成（点发送按钮触发真乐观流），e2e 从 DOM 读取
  //   store 写出的 data-temporary-id 作 corr_key 锚——不再固定注入 TMP 绕过乐观语义。
  const DOC_TEXT = `doc-${Date.now()}`;
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe（spec §3.1 / four-facet-oracle §2）：等 data-ready 标志
    //   = increment_channel_end 收齐 + HTTP inflight==0 + cursor 稳。
    // 薄壳把就绪态渲染成 [data-ready="true"]（W2 实现）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // 取当前频道 id（薄壳暴露在 [data-active-channel] 的会话容器上）。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );

    // 开 UC 窗口（debug-only set_uc 注入）→ 窗口内帧/投影归 UC-1.2。
    await invokeBridge('set_uc', { uc: 'UC-1.2' });
  });

  it('①②③④：乐观上屏 → echo tmp→server 覆写 + 出站 body + 投影字段集 + 落库行', async () => {
    // —— ③ DOM 主驱动：触发document send按钮 ——
    // Bug-2 修：不再固定注入 im_send。点 [data-testid=send-document-btn] → store.sendDocument()
    //   生成 temporaryId + invoke im_send；sending 行由 helix `im:post:sending` 投影驱动（壳纯渲染，不 JS 合成）。
    const composeInput = await $('[data-testid="compose-input"]');
    await composeInput.setValue(DOC_TEXT);

    const sendDocBtn = await $('[data-testid="send-document-btn"]');
    await sendDocBtn.click();

    // 断言③-a：等乐观 sending 行出现（im:post:sending 投影驱动），从 DOM 读真 temporaryId 作锚。
    await browser.waitUntil(
      async () => {
        const tid = await browser.execute(
          () =>
            document
              .querySelector('[data-send-status="sending"][data-type="DOCUMENT"]')
              ?.getAttribute('data-temporary-id') ?? null
        );
        return !!tid;
      },
      { timeout: 8000, timeoutMsg: '乐观行未上屏（断在 click→store.sendDocument→乐观渲染）' }
    );
    const TMP = await browser.execute(
      () =>
        document
          .querySelector('[data-send-status="sending"][data-type="DOCUMENT"]')
          ?.getAttribute('data-temporary-id') ?? null
    );
    expect(TMP).toBeTruthy();

    const optimistic = await readRow(TMP);
    expect(optimistic).not.toBeNull();
    expect(optimistic['send-status']).toBe('sending');
    expect(optimistic['msg-id']).toBe(TMP); // 乐观期 data-msg-id == tmp
    expect(optimistic['type']).toBe('DOCUMENT'); // 类型应为DOCUMENT

    // 断言③-b：等 echo 覆写 —— data-send-status=sent 且 data-msg-id ≠ tmp（变 server_id）。
    await browser.waitUntil(
      async () => {
        const r = await readRow(TMP);
        return r && r['send-status'] === 'sent' && r['msg-id'] && r['msg-id'] !== TMP;
      },
      { timeout: 15000, interval: 150, timeoutMsg: 'echo 未覆写（断在 WS post→reconcile→DOM）' }
    );
    const settled = await readRow(TMP);
    console.log(`[UC-1.2 DOM] tmp=${TMP} → msgId=${settled['msg-id']} status=${settled['send-status']} seq=${settled['event-seq']} type=${settled['type']}`);
    expect(settled['type']).toBe('DOCUMENT'); // 覆写后type仍为DOCUMENT

    // —— 关窗口（窗口外的后续帧不再归本 UC）——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ②（+①④ pending）：读 run.jsonl → 四面 reducer ——
    // 锚定本次 send 的 temporaryId（store 生成的真值注入 corrAnchor.tmp）。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, tmp: TMP },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: settled });

    // 「断在哪一跳」报告（①④ rewire 已接通 → 四面全断言，无放水）。
    console.log('[UC-1.2 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 四面严格断言（reducer 的 diffOutbound/diffStorage 已是严格比对，照用，不放水）。
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：严格对齐 expect.outbound（camelCase 必填集 + bodyForbidden snake_case 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == projection-schema message_item_data（fat 13 键，缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert message 表 ≥1 行。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM tmp→server 覆写 + status=sent + type=DOCUMENT。
    expect(report.facets.dom.ok).toBe(true);
  });
});

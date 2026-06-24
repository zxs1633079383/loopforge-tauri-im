// UC-send-1 发消息 round-trip e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 串四面（spec §7）；本轮目标 ②③ 跑通，①④ 诚实 pending（见文末 it.skip）：
//   ③ DOM    : 真驱动 —— 填字 + 点 [data-testid=send-btn] → store.send 真乐观流 →
//              从 DOM 读 store 生成的 data-temporary-id → 等 echo → data-msg-id 从 tmp 变 server、
//              status=sent（WebdriverIO 直读）。
//   ②        : 读 run.jsonl → reducer 聚 corr_key → 断 projection 字段集（已 tee 观测点）。
//   ①④      : helix 泛型壳 rewire（outbound body tee + storage 落行）未做 → 无观测点 →
//              诚实留红，本轮 it.skip 标 pending，不假绿、不改 expect 掩盖。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：不用固定 pause 猜 settle，一律 waitUntil 等条件
//   （before 等 data-ready 就绪 probe；echo 等覆写完成）。超时=真 bug，不掩盖。
//
// 依赖前置（W1/W4 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 echo 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_send` 已注册（spec §5/§7）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file 路径）

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-send-1.expect.json', import.meta.url), 'utf8')
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
      _temporaryId: t,
    };
  }, tmp);

describe('UC-send-1 · 发消息 round-trip（四面契约）', () => {
  // Bug-2 修：temporaryId 由 store.send() 生成（点发送按钮触发真乐观流），e2e 从 DOM 读取
  //   store 写出的 data-temporary-id 作 corr_key 锚——不再固定注入 TMP 绕过乐观语义。
  const TEXT = `lf-${Math.random().toString(36).slice(2, 8)}`;
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

    // 取当前频道 id（薄壳暴露在 [data-channel-id] 的会话容器上）。
    CHANNEL_ID = await browser.execute(
      () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
    );

    // 开 UC 窗口（debug-only set_uc 注入）→ 窗口内帧/投影归 UC-send-1。
    await invokeBridge('set_uc', { uc: 'UC-send-1' });
  });

  it('②③：乐观上屏 → echo tmp→server 覆写 + 投影字段集（①④见下方 pending）', async () => {
    // —— ③ DOM 主驱动：填字 + 点发送按钮 ——
    // Bug-2 修：不再固定注入 im_send。点 [data-testid=send-btn] → store.send() 生成 temporaryId
    //   + invoke im_send；sending 行由 helix `im:post:sending` 投影驱动（壳纯渲染，不 JS 合成）。
    const input = await $('[data-role="composer-input"]');
    await input.setValue(TEXT);
    const sendBtn = await $('[data-testid="send-btn"]');
    await sendBtn.click();

    // 断言③-a：等乐观 sending 行出现（im:post:sending 投影驱动），从 DOM 读真 temporaryId 作锚。
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
    const TMP = await browser.execute(
      () =>
        document
          .querySelector('[data-send-status="sending"]')
          ?.getAttribute('data-temporary-id') ?? null
    );
    expect(TMP).toBeTruthy();

    const optimistic = await readRow(TMP);
    expect(optimistic).not.toBeNull();
    expect(optimistic['send-status']).toBe('sending');
    expect(optimistic['msg-id']).toBe(TMP); // 乐观期 data-msg-id == tmp

    // 断言③-b：等 echo 覆写 —— data-send-status=sent 且 data-msg-id ≠ tmp（变 server_id）。
    await browser.waitUntil(
      async () => {
        const r = await readRow(TMP);
        return r && r['send-status'] === 'sent' && r['msg-id'] && r['msg-id'] !== TMP;
      },
      { timeout: 15000, interval: 150, timeoutMsg: 'echo 未覆写（断在 WS post→reconcile→DOM）' }
    );
    const settled = await readRow(TMP);
    console.log(`[UC-send-1 DOM] tmp=${TMP} → msgId=${settled['msg-id']} status=${settled['send-status']} seq=${settled['event-seq']}`);

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

    // 「断在哪一跳」报告（本轮目标 ②③ 绿；①④ helix 泛型壳 rewire 未做 → 诚实留红）。
    console.log('[UC-send-1 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 本轮断言只覆盖 ②③（②投影字段集 + ③ tmp→server 覆写）。
    expect(report.parseErrors.length).toBe(0);
    expect(report.facets.projection.ok).toBe(true); // ② 投影字段集 == projection-schema message_item_data
    expect(report.facets.dom.ok).toBe(true); // ③ tmp→server 覆写
  });

  // ①④ 诚实留红：helix 泛型壳 rewire（outbound HTTP body tee + storage 落行观测点）未做 →
  //   reducer 在 outbound/storage 两面无 hop 必报「断在这跳」。不假绿、不改 expect 掩盖
  //   （contract-readonly-autofix §1 + HX-C011 可证伪）。pending 显式声明缺口，待泛型壳落地解锁。
  it.skip('①④（pending）：outbound body 对齐真机curl真源 + message 落行 —— 待 helix 泛型壳 rewire', async () => {
    // 接通后取消 .skip，断言 report.facets.outbound.ok / report.facets.storage.ok。
  });
});

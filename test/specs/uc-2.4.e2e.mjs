// UC-2.4 一级/二级回复列表查询 e2e —— WebdriverIO，读族 request-response 传输。
//
// 读族特性（spec §1.2 / four-facet-oracle）：
//   - 无 WS 回声（write 特有）；HTTP 200 响应体本身就是数据 → query::emit_read_result 透传回灌。
//   - 四面契约退化为 ③ 面（DOM 交互/触发 invoke）+ ① 面（outbound query body 逐字检） + ② 面（projection envelope）；④ 面（storage）为 N/A（读路径）。
//   - 无 corr_key 锚（write 用 temporaryId，读用 req_id 由前端 bridge 内部维护）。
//   - e2e 驱动：DOM 触发 invoke(im_query_replies)  → 等 im:read:result 回灌 → 断言投影/出站 body。
//
// 时序纪律（HX-C011）：waitUntil 等 projection 回灌完成，无固定 pause。
//
// 依赖前置（W1/W4 提供）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）
//   - Replay 模式喂金标 tape（确定性 reply 帧），或真 go 一轮
//   - debug-only invoke `set_uc` / `im_query_replies` 已注册（spec §5）
//   - 初始消息/回复链存在（Phase 2 fixture setup 注入）
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（W1 LogSink.to_file）

import { browser, $, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-2.4.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

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

describe('UC-2.4 · 一级/二级回复列表（读族 request-response）', () => {
  let REPLY_ID;
  let REQ_ID;

  before(async () => {
    // 就绪 probe（spec §3.1）：等 data-ready 标志
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    // 开 UC 窗口
    await invokeBridge('set_uc', { uc: 'UC-2.4' });
  });

  it('①②：getReplies 一级回复列表 + 投影透传', async () => {
    // —— ③ DOM：点击消息行触发回复抽屉 ——
    // 选定一条含回复的消息（由 Phase 2 fixture 注入）
    const messageWithReplies = await $('[data-reply-count]:not([data-reply-count="0"])');
    expect(messageWithReplies).toBeDefined();

    REPLY_ID = await messageWithReplies.getAttribute('data-msg-id');
    expect(REPLY_ID).toBeTruthy();

    // 生成 req_id（e2e 侧 UUID，前端 bridge 透传 invoke 参数）
    REQ_ID = `req-${Math.random().toString(36).slice(2, 12)}`;

    // 点开回复抽屉（触发 im_query_replies invoke）
    const replyDrawerBtn = await messageWithReplies.$('[data-role="open-reply-drawer"]');
    await replyDrawerBtn.click();

    // —— 断言 ②：等 im:read:result 投影回灌 ——
    // 读族无 WS 回声，直接等 projection 事件（HTTP 200 → query::emit_read_result）
    let readResultData = null;
    await browser.waitUntil(
      async () => {
        const result = await browser.execute((rid) => {
          // 前端 bridge 将回灌的 im:read:result 缓存到全局状态（W2 实现）
          // 模式：window.__lf._readResultCache[req_id] = {event:'im:read:result', data:{req_id, body}}
          // @ts-ignore
          const cached = window.__lf?._readResultCache?.[rid];
          return cached ? { event: cached.event, dataKeys: Object.keys(cached.data || {}) } : null;
        }, REQ_ID);
        readResultData = result;
        return result !== null;
      },
      { timeout: 10000, interval: 100, timeoutMsg: 'im:read:result 未回灌' }
    );

    expect(readResultData.event).toBe('im:read:result');
    expect(readResultData.dataKeys).toContain('req_id');
    expect(readResultData.dataKeys).toContain('body');
    console.log(`[UC-2.4 projection] im:read:result received for req_id=${REQ_ID}`);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ①（pending）：读 run.jsonl → 验证出站 body ——
    // 注：本 UC 写族 oracle 仅验证 HTTP 请求体（① outbound）是否逐字对齐期望。
    // 投影（②）已于上面 DOM 侧验证（im:read:result 回灌）；④ storage = N/A。
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, req_id: REQ_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');

    // 造一份虚拟 DOM 面（读族无状态 DOM 突变）
    const fakeDom = {
      'msg-id': REPLY_ID,
      'req-id': REQ_ID,
    };

    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: fakeDom });

    console.log('[UC-2.4 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    // 断言（读族断面简化：① 出站 body、② 投影 envelope；③④ skip）
    expect(report.parseErrors.length).toBe(0);
    // ① 出站：getReplies 的 replyId/pageSize/pageNumber/revoke 逐字检（body 须全 camelCase，禁 snake_case 泄漏）
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影：im:read:result 携 {req_id, body}（外层键集恒定，body 内层由后端权威）
    expect(report.facets.projection.ok).toBe(true);
  });

  it('①②：getReplyBranch 二级回复分支 + 投影透传', async () => {
    // —— ③ DOM：点击一级回复触发分支抽屉 ——
    // 在已打开的回复列表中选一条一级回复（含二级分支）
    const replyWithBranch = await $('[data-reply-drawer] [data-branch-count]:not([data-branch-count="0"])');
    expect(replyWithBranch).toBeDefined();

    const firstLevelReplyId = await replyWithBranch.getAttribute('data-msg-id');
    expect(firstLevelReplyId).toBeTruthy();

    // 生成 req_id for getReplyBranch
    const REQ_ID_BRANCH = `req-${Math.random().toString(36).slice(2, 12)}`;

    // 点开分支抽屉（触发 im_query_reply_branch invoke）
    const branchBtn = await replyWithBranch.$('[data-role="open-reply-branch"]');
    await branchBtn.click();

    // —— 断言 ②：等 im:read:result 投影回灌 ——
    let branchReadResultData = null;
    await browser.waitUntil(
      async () => {
        const result = await browser.execute((rid) => {
          // @ts-ignore
          const cached = window.__lf?._readResultCache?.[rid];
          return cached ? { event: cached.event, dataKeys: Object.keys(cached.data || {}) } : null;
        }, REQ_ID_BRANCH);
        branchReadResultData = result;
        return result !== null;
      },
      { timeout: 10000, interval: 100, timeoutMsg: 'getReplyBranch im:read:result 未回灌' }
    );

    expect(branchReadResultData.event).toBe('im:read:result');
    expect(branchReadResultData.dataKeys).toContain('req_id');
    expect(branchReadResultData.dataKeys).toContain('body');
    console.log(`[UC-2.4 branch] im:read:result received for req_id=${REQ_ID_BRANCH}`);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— ① 验证 getReplyBranch 出站 body ——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, req_id: REQ_ID_BRANCH },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const fakeDom = {
      'msg-id': firstLevelReplyId,
      'req-id': REQ_ID_BRANCH,
    };

    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: fakeDom });

    console.log('[UC-2.4 branch 四面报告] ' + report.summary);
    if (!report.facets.outbound.ok) console.log(`  ✖ outbound: ${report.facets.outbound.issues.join('; ')}`);

    // getReplyBranch endpoint 验证（replyFirstLevelId/pageSize/offset/revoke 逐字检）
    expect(report.parseErrors.length).toBe(0);
    expect(report.facets.outbound.ok).toBe(true);
    expect(report.facets.projection.ok).toBe(true);
  });
});

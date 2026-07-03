// UC-10.1 待办列表 e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-10.1 是**内核自驱**（≠ 前端命令触发·同 UC-4.1 就绪根）：WS hello 收尾时 global
// increment_channel_end 把本会话攒到的 about-me（mention/urgent）post id build 成
// `posts/queryTodoList {postIds}` HTTP 请求 → 回报装配 emit `im:todo:updated {items}`
// → 壳渲染 AX todo-panel data-todo 行。e2e 不点按钮——只等自驱链路落定，再读三面对账。
//
// 串三面（issue #31 锚点·契约只读 expect/uc-10.1.expect.json·④ 落库 N/A·projection-only）：
//   ① 出站   : POST posts/queryTodoList，body {postIds:[]string}（camelCase·非空）。
//              该出站无单 channel/post 领域键 → reducer runFourFacetSelfDriven 在 UC 窗口内按
//              endpoint(urlEndsWith) 直找（窗口隔离保证唯一·无 about-me 则不发 → ① 红·非 tautology）。
//   ②        : 读 run.jsonl → reducer 按 event 找 im:todo:updated → 断外层键集 {items}（缺/多即红）。
//   ③ DOM    : 等至少一行 data-todo-id（store.todos() 由 im:todo:updated 投影 applyTodoUpdated 填）。
//              读首行 todo-id 注入 reducer。
//   ④        : N/A（projection-only·port_reply TodoQuery 分支仅 emit 不落库·无 todo 表）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置（reload-app --uc UC-10.1 提供，本 spec 不创建）：
//   - debug app 已起（4445 webdriver + 1420 前端薄壳）·bootstrap UC=UC-10.1（hello hop 归 UC-10.1）
//   - 真 go 一轮 hello —— self-driven todo 需真后端推 increment_channel 帧含 mention/urgent post id
//   - run.jsonl 落点经 env HELIX_RUN_JSONL 暴露（**本 UC 不可在 spec 内 truncate**·todo 事件在
//     boot 时已流过·见 expect _note + harness reload-app --uc 机制）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetSelfDriven } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-10.1.expect.json', import.meta.url), 'utf8')
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

describe('UC-10.1 · 待办列表（内核自驱·三面契约 ①②③·④ N/A）', () => {
  after(async () => {
    await invokeBridge('set_uc', { uc: '__quiescence__' });
  });

  before(async () => {
    // 归因 marker：尽早把 still-in-flight 的 self-driven todo read-result 认领到 UC-10.1。
    // run.sh / harness reload-app --uc 已覆盖 boot-before-WDIO 场景；这里覆盖 WDIO attach 后才触发的慢链路。
    const marker = await invokeBridge('set_uc', { uc: 'UC-10.1' });
    expect(marker.ok).toBe(true);

    // 就绪 probe：等 data-ready=true（increment_channel_end 收齐 + inflight0 + cursor 稳）。
    // todo 自驱发生在 hello 收尾（global increment-end）→ ready 置位时 queryTodoList 已发起/回报。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳·断在 hello→increment 自驱链）' }
    );
  });

  it('①②③：hello 收尾自驱 queryTodoList → im:todo:updated 投影 + DOM todo 行（④ N/A·projection-only）', async () => {
    // —— ③ DOM：等至少一行 data-todo-id 渲染（store.todos() 由 im:todo:updated 投影 applyTodoUpdated 填）——
    await browser.waitUntil(
      async () => {
        const id = await browser.execute(
          () => document.querySelector('[data-todo-id]')?.getAttribute('data-todo-id') ?? null
        );
        return !!id;
      },
      { timeout: 20000, interval: 200, timeoutMsg: 'todo-panel 无 todo 行（断在 hello→queryTodoList→im:todo:updated→store.todos→DOM·或 hello 无 about-me mention/urgent 可拉）' }
    );

    // —— ③ DOM 面：读首行 data-todo-id（+ 可选 type/can-del）注入 reducer ——
    const domFacet = await browser.execute(() => {
      const row = document.querySelector('[data-todo-id]');
      return {
        'todo-id': row?.getAttribute('data-todo-id') ?? null,
        'todo-type': row?.getAttribute('data-todo-type') ?? null,
        'todo-can-del': row?.getAttribute('data-todo-can-del') ?? null,
      };
    });
    expect(domFacet['todo-id']).toBeTruthy();
    console.log(`[UC-10.1 DOM] 首行 todo-id=${domFacet['todo-id']}（type=${domFacet['todo-type']}·canDel=${domFacet['todo-can-del']}）`);

    // —— 三面 reducer（runFourFacetSelfDriven·UC 窗口内按 endpoint+event 直找·④ N/A 不裁定）——
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacetSelfDriven({ jsonl, expect: EXPECT, dom: domFacet });

    console.log('[UC-10.1 三面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：POST posts/queryTodoList body {postIds}（camelCase·无 snake/Pascal 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影：im:todo:updated 外层键集 {items}（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ③ DOM：todo-panel 至少一行 data-todo-id 非空。
    expect(report.facets.dom.ok).toBe(true);
    // 整体绿（④ projection-only N/A·不参与裁定）。
    expect(report.green).toBe(true);
  });
});

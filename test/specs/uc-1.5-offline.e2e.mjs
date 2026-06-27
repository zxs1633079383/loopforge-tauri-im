// UC-1.5-offline OBSERVER —— 撤回离线分支冷启动重放观察（WebdriverIO·直连 4445）。
//
// 阶段②（见 uc-1.5-offline-setup.e2e.mjs 头注 + scripts/run-uc-1.5-offline.sh）：
//   驱动脚本已：① 跑 setup（建群+发+撤回·写锚 /tmp/uc-offrev-anchor.json）→ ② 回退锚频道 cursor
//   到撤回前 → ③ reload-app --uc UC-1.5-offline（冷启动 increment 重放 PostUpsert(M)→im:post:received
//   载行 + PostRevoke(M)→im:post:deleted 标撤回·重放帧 uc_id=UC-1.5-offline）。
//   本 spec 经 `--keep` 跑（不 truncate run.jsonl·保冷启动重放帧）·读重放 run.jsonl 裁 ②③。
//
// 串四面（契约只读 expect/uc-1.5-offline.expect.json）：
//   ② 投影 : im:post:deleted（fat MessageItemData·17 键）·按 sid=S + ch=C 锚（缺/多即红）。
//   ③ DOM  : 重放载入的行 data-revoke=1（applyPostDeleted → markRevokedById 命中 server-id S）。
//   ① N/A  : 离线重放无 per-post 出站（撤回命令在 setup 在线发·重放靠批量 increment·见 expect ①）。
//   ④ N/A  : 离线 PostRevoke 重放 projection-only（emit_post_deleted 无 storage effect·见 expect ④）。
//
// 时序纪律（HX-C011）：一律 waitUntil 等条件·禁固定 pause。超时=真 bug（重放未发生 / 行未标）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-1.5-offline.expect.json', import.meta.url), 'utf8'),
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ??
  new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

const ANCHOR_FILE = process.env.UC_OFFREV_ANCHOR ?? '/tmp/uc-offrev-anchor.json';

// 读撤回目标行（server-id S）的 data-* 终态（③ 注入 reducer 的 DOM 面）。
const readPostDom = (serverId) =>
  browser.execute((id) => {
    const row = document.querySelector(`[data-msg-id="${id}"]`);
    return {
      'msg-id': row?.getAttribute('data-msg-id') ?? null,
      revoke: row?.getAttribute('data-revoke') ?? null,
    };
  }, serverId);

describe('UC-1.5-offline · 撤回离线 gap-replay（四面契约·断面 ②③）', () => {
  let C; // 锚频道
  let S; // 撤回目标 server_id

  before(async () => {
    const anchor = JSON.parse(readFileSync(ANCHOR_FILE, 'utf8'));
    C = anchor.C;
    S = anchor.S;
    expect(C).toBeTruthy();
    expect(S).toBeTruthy();
    console.log(`[UC-1.5-offline] 读锚：C=${C} S=${S}`);

    // 就绪 probe（冷启动重放在 hello 收尾随 increment 流过·等就绪确保重放已落定）。
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready'),
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（断在冷启动 hello→increment 重放链）' },
    );
  });

  it('②③：冷启动 increment 重放 PostRevoke → 投影 im:post:deleted + DOM data-revoke=1', async () => {
    // —— ③ DOM：等重放载入的行 S 标 data-revoke=1（im:post:received 载行 → im:post:deleted 标撤回）——
    await browser.waitUntil(
      async () => {
        const dom = await readPostDom(S);
        return dom.revoke === '1';
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg:
          '撤回行 data-revoke 未标 1（断在冷启动重放 PostUpsert→im:post:received 载行 / PostRevoke→im:post:deleted→applyPostDeleted 标行）',
      },
    );
    const domFacet = await readPostDom(S);
    expect(domFacet.revoke).toBe('1');

    // —— 四面 reducer（ch + sid 双锚·sid 经 msg_id 别名聚 im:post:deleted 束）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: C, sid: S },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-1.5-offline 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ② 投影：im:post:deleted fat 键集（缺/多即 fail）·sid=S 锚命中。
    expect(report.facets.projection.ok).toBe(true);
    // ③ DOM：撤回行 data-revoke=1。
    expect(report.facets.dom.ok).toBe(true);
    // ①④ N/A（expect 已声明）·本 UC 不裁（离线重放无 per-post 出站 / projection-only 无 storage）。
  });
});

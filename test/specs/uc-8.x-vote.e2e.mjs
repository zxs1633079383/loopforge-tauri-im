// UC-8.x 投票 CRUD e2e —— WebdriverIO，vote/score 第二网关 :3399（partials/6 集合八·五命令）。
//
// 命令族（helix-im outbound/vote_score.rs · 真源 partials/6 §用例集合八 L257-272）：
//   - im_vote_create → POST vote/createVote（写族·整 args 透传·{title,content,options,isReal,votes,...}）
//   - im_vote_do     → POST vote/vote        （写族·{id, indexes:[], postId?}）
//   - im_vote_read   → POST vote/readVote     （读族 is_read=true·{id}·im:read:result{req_id, body} 回灌）
//   - im_vote_close  → POST vote/closeVote    （写族·{id}）
//   - im_vote_delete → POST vote/deleteVote   （写族·{id}）
//
// 断面（reducer runFourFacetRead 裁定·见 expect/uc-8.x-vote.expect.json $schema-note）：
//   - 写族（create/do/close/delete）：① 出站 wire body 逐字检（urlEndsWith + bodyFields camelCase +
//     bodyForbidden 禁 snake/req_id 泄漏）；② projection.optional → reducer isProjectionOptional 短路总绿
//     （写族 fire-and-forget·is_read=false·数据走 server WS post_updated 回声·单账号 L1 无可观测 echo·
//     真 server-data/WS-dep·见 ledger UC-8.x）。③ DOM data-vote / ④ message.props 同 server-data-dep = N/A。
//   - 读族（read）：①② —— ① 出站 {id}；② projection im:read:result {req_id, body} 外层键集 + req_id 锚
//     （emit_read_result 200 OR emit_read_error 500 皆产此 envelope·键集恒可观测·envelope 面与 inner 真
//     vote id 的 data-dep 解耦）。
//
// 驱动（最简 + 确定性·同 UC-9.x 书签）：e2e 经 window.__lf.invoke 直 invoke 各 vote 命令注入真实参数 →
//   waitUntil 等 run.jsonl 出现本窗口该 endpoint 的 outbound http-req（写族）/ + im:read:result（读族）→
//   跑 runFourFacetRead 裁定。每命令独立 set_uc 窗口（窗口隔离保证 endpoint 唯一·非 tautology）。
//
// 时序纪律（HX-C011）：waitUntil 等 hop 落进 run.jsonl，无固定 pause。少 invoke → ① 红（可证伪对偶）。
//
// 依赖前置（run.sh / harness up 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db 含真频道）+ HELIX_RUN_JSONL 暴露 hop 落点。
// 覆盖（对 coverage-crossmap.md）：vote/{createVote,vote,readVote,closeVote,deleteVote} 五端点全实跑。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacetRead } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-8.x-vote.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（与 onCreateVote 等同命令·求确定性）。 */
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

/** 取当前活动频道（store 锚定·bootstrap dialogList 设）。 */
const getActiveChannel = () =>
  browser.execute(() =>
    document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
  );

/** 读 run.jsonl 全文（torn 末行由 reducer parseJsonl 容忍·此处只 split 找 hop）。 */
function readJsonlLines() {
  let txt = '';
  try {
    txt = readFileSync(RUN_JSONL, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // torn 末行（常驻并发追加）→ 略过（守 C008 仅放末行）。
    }
  }
  return out;
}

/** 等 ucId 窗口内某 endpoint 的 outbound http-req 落进 run.jsonl（写族 ① 面落点）。 */
async function waitOutbound(ucId, urlEndsWith) {
  await browser.waitUntil(
    () =>
      readJsonlLines().some(
        (ev) =>
          ev.uc_id === ucId &&
          ev.facet === 'outbound' &&
          ev.hop === 'http-req' &&
          String(ev.payload?.url ?? '').endsWith(urlEndsWith)
      ),
    { timeout: 15000, interval: 150, timeoutMsg: `${urlEndsWith} 出站 http-req 未落 ${ucId} 窗口` }
  );
}

/** 等 ucId 窗口内本次 reqId 的 im:read:result projection 回灌（读族 ② 面落点·200 或 500 皆落）。 */
async function waitReadResult(ucId, reqId, endpoint) {
  await browser.waitUntil(
    () =>
      readJsonlLines().some(
        (ev) =>
          ev.uc_id === ucId &&
          ev.facet === 'projection' &&
          ev.hop === 'projection' &&
          ev.payload?.event === 'im:read:result' &&
          (ev.payload?.data?.req_id ?? ev.payload?.data?.reqId) === reqId
      ),
    { timeout: 15000, interval: 150, timeoutMsg: `${endpoint} im:read:result(req_id=${reqId}) 未回灌 ${ucId} 窗口` }
  );
}

const UC = 'UC-8.x';

describe('UC-8.x · 投票 CRUD（vote/score 第二网关·写族 4 ① + 读族 1 ①②）', () => {
  let CHANNEL_ID;
  // 投票卡 id：vote 写族无真 server 回声给真 id·用确定性合成 id 作 wire 字段（① 出站只检 wire body
  // 字段集/形态·不依赖 server 真 vote 存在·读族 ② envelope 面亦与真 id 解耦——envelope 恒回灌）。
  const VOTE_ID = `vote-${Math.random().toString(36).slice(2, 10)}`;

  before(async () => {
    // 就绪 probe：等 data-ready 标志。
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('[data-ready]')?.getAttribute('data-ready')
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过' }
    );

    CHANNEL_ID = await getActiveChannel();
    expect(CHANNEL_ID).toBeTruthy();
    console.log(`[UC-8.x setup] activeChannel=${CHANNEL_ID} voteId=${VOTE_ID}`);
  });

  it('① 写族：vote/createVote 发起投票（整 args 透传·camelCase wire·② N/A optional）', async () => {
    await invokeBridge('set_uc', { uc: UC });

    // 整 args 透传：im_vote_create({fields}) → helix VoteCreateCommand 整 obj 透传出站 body。
    const r = await invokeBridge('im_vote_create', {
      fields: {
        title: '团建地点投票',
        content: '本周五团建去哪',
        options: ['爬山', '聚餐', '密室'],
        isReal: false,
        votes: 1,
      },
    });
    expect(r.ok).toBe(true);

    await waitOutbound(UC, 'vote/createVote');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const report = runFourFacetRead({
      jsonl: readFileSync(RUN_JSONL, 'utf8'),
      expect: EXPECT.voteCreate,
      reqId: null,
      ucId: UC,
    });
    console.log('[UC-8.x voteCreate 报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('① 写族：vote/vote 提交投票（{id, indexes:[], postId?}·② N/A optional）', async () => {
    await invokeBridge('set_uc', { uc: UC });

    const r = await invokeBridge('im_vote_do', {
      id: VOTE_ID,
      indexes: ['0', '2'],
    });
    expect(r.ok).toBe(true);

    await waitOutbound(UC, 'vote/vote');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const report = runFourFacetRead({
      jsonl: readFileSync(RUN_JSONL, 'utf8'),
      expect: EXPECT.voteDo,
      reqId: null,
      ucId: UC,
    });
    console.log('[UC-8.x voteDo 报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('①② 读族：vote/readVote 读详情（{id}·im:read:result {req_id, body} 回灌）', async () => {
    await invokeBridge('set_uc', { uc: UC });

    const reqId = `req-${Math.random().toString(36).slice(2, 12)}`;
    const r = await invokeBridge('im_vote_read', { id: VOTE_ID, reqId });
    expect(r.ok).toBe(true);

    await waitReadResult(UC, reqId, 'voteRead');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const report = runFourFacetRead({
      jsonl: readFileSync(RUN_JSONL, 'utf8'),
      expect: EXPECT.voteRead,
      reqId,
      ucId: UC,
    });
    console.log('[UC-8.x voteRead 读族报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('① 写族：vote/closeVote 截止投票（{id}·② N/A optional）', async () => {
    await invokeBridge('set_uc', { uc: UC });

    const r = await invokeBridge('im_vote_close', { id: VOTE_ID });
    expect(r.ok).toBe(true);

    await waitOutbound(UC, 'vote/closeVote');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const report = runFourFacetRead({
      jsonl: readFileSync(RUN_JSONL, 'utf8'),
      expect: EXPECT.voteClose,
      reqId: null,
      ucId: UC,
    });
    console.log('[UC-8.x voteClose 报告] ' + report.summary);
    expect(report.green).toBe(true);
  });

  it('① 写族：vote/deleteVote 删除投票（{id}·② N/A optional）', async () => {
    await invokeBridge('set_uc', { uc: UC });

    const r = await invokeBridge('im_vote_delete', { id: VOTE_ID });
    expect(r.ok).toBe(true);

    await waitOutbound(UC, 'vote/deleteVote');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const report = runFourFacetRead({
      jsonl: readFileSync(RUN_JSONL, 'utf8'),
      expect: EXPECT.voteDelete,
      reqId: null,
      ucId: UC,
    });
    console.log('[UC-8.x voteDelete 报告] ' + report.summary);
    expect(report.green).toBe(true);
  });
});

// UC-5.2 创建话题（消息转话题）e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// UC-5.2 是命令触发型 UC（≠ UC-4.1 自驱）：ML 行级 [data-testid=make-topic-btn] /
// 或 bridge 直 invoke im_make_topic → 出站 POST posts/makeTopic → server 建话题（=新 channel）→
// WS channel_created 推回 → 投影 im:channel:created → CL 区新话题行 + DB channel 新行。
// （makeTopic 同时推 post_update 给原消息挂 topicId·本 UC 四面只锚话题 channel 创建链。）
//
// 串四面（issue #9 锚点 · 契约只读 expect/uc-5.2.expect.json）：
//   ①        : POST posts/makeTopic，body 锚真机curl真源 §2（rootId/teamId/postId/displayName/
//              type:T/users[CREATOR+MEMBER]/picturetype/picture/forceCreate·全 camelCase）。出站 body
//              无 server 分配的话题 channelId → reducer createOutbound fallback（URL endsWith
//              posts/makeTopic·窗口内唯一一条 makeTopic）归本束。
//   ②        : 读 run.jsonl → reducer 按 server 分配话题 ch 聚 → 断 im:channel:created 投影字段集
//              {channel_id, channel}（缺/多即 fail·建话题与建群同投影工厂）。
//   ③ DOM    : 等新建话题 ch 行 data-channel-id 渲染（store.channels() 由 im:channel:created 投影
//              upsert·复用 UC-5.1 applyChannelCreated）。
//   ④        : 落库 batch_upsert channel ≥1 行（表感知归一·channel 表 id 抽成 ch → 与 ② 同束）。
//
// 时序纪律（HX-C011 / four-facet-oracle §2）：一律 waitUntil 等条件，禁固定 pause 猜 settle。超时=真 bug。
//
// 依赖前置（W4 提供）：debug app 已起（4445 + 1420）+ 真 go 一轮（建话题需真后端推 channel_created）+
//   debug-only invoke set_uc / im_make_topic 已注册 + run.jsonl 落点经 env HELIX_RUN_JSONL 暴露。
//
// 真实数据锚（seeded /tmp/loopforge-im.db·非臆造·sqlite 实查）：
//   - 根群 ROOT_CHANNEL=1o1d6dud9irztp1wyrtf9b1qpo（self 444 是 OWNER·team 64118eebd2b665246b7880eb·
//     208 条真消息）→ rootId（话题挂载根群·creator 须在群内）。
//   - 原消息 POST_ID=en4i1ufndbryuqxryfzfn4n13r（该群内真 server post id·type=TEXT·revoke=0）→
//     postId（被转成话题的消息）。
//   - 真成员 MEMBER_IDS=['5ffd465e263864787b87aa01']（该群 channel_member 真 userId·role=MEMBER）。
//
// 锚话题选取（建话题 server 分配话题 channelId·客户端发请求时未知）：发 makeTopic 前快照已存在的
//   data-channel-id 集，makeTopic 后等出现「新」channel 行（不在快照集）= 本次 server 分配的话题 ch
//   → 锚四面。诚实退化：若无新行出现则 fail（不放水·非 tautology·根群本身已在快照内不会误判）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-5.2.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

// 真实 seeded 锚（sqlite 实查·非臆造）——见文件头说明。
const ROOT_CHANNEL = '1o1d6dud9irztp1wyrtf9b1qpo';
const POST_ID = 'en4i1ufndbryuqxryfzfn4n13r';
const MEMBER_IDS = ['5ffd465e263864787b87aa01'];

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

// 当前 DOM 已渲染的 channel id 集（快照·用于发 makeTopic 后 diff 出新建话题 ch）。
const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-channel-id]'))
      .map((el) => el.getAttribute('data-channel-id'))
      .filter((id) => !!id)
  );

// 读某 channel 行的 data-*（③ 注入 reducer 的 DOM 面）。
const readChannelDom = (channelId) =>
  browser.execute((id) => {
    const row = document.querySelector(`[data-channel-id="${id}"]`);
    return {
      'channel-id': row?.getAttribute('data-channel-id') ?? null,
    };
  }, channelId);

describe('UC-5.2 · 创建话题 / 消息转话题（四面契约）', () => {
  let NEW_TOPIC_ID;

  before(async () => {
    // 就绪 probe：等 data-ready=true（increment_channel_end 收齐 + inflight0 + cursor 稳）。
    await browser.waitUntil(
      async () => {
        const r = await browser.execute(
          () => document.querySelector('[data-ready]')?.getAttribute('data-ready')
        );
        return r === 'true';
      },
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    // 开 UC 窗口（窗口内帧/投影归 UC-5.2）。
    await invokeBridge('set_uc', { uc: 'UC-5.2' });
  });

  it('①②③④：消息转话题出站 posts/makeTopic → 投影 created + 落库 channel 行 + DOM 新话题行', async () => {
    // —— 发 makeTopic 前：快照已有 channel id 集（含根群 ROOT_CHANNEL）——
    const beforeIds = new Set(await snapshotChannelIds());

    // —— 触发建话题（bridge 直 invoke·注入真实 rootId/postId/memberIds·C007 行级按钮同链路）——
    const r = await invokeBridge('im_make_topic', {
      rootId: ROOT_CHANNEL,
      postId: POST_ID,
      displayName: `lf-topic-${Math.random().toString(36).slice(2, 8)}`,
      memberIds: MEMBER_IDS,
    });
    expect(r.ok).toBe(true);

    // —— ③ DOM：等出现「新」channel 行（不在 beforeIds 快照内）= 本次 server 分配的话题 ch ——
    await browser.waitUntil(
      async () => {
        const ids = await snapshotChannelIds();
        return ids.some((id) => !beforeIds.has(id));
      },
      { timeout: 20000, interval: 200, timeoutMsg: '无新话题 channel 行（断在 posts/makeTopic→WS channel_created→投影→DOM）' }
    );
    const afterIds = await snapshotChannelIds();
    NEW_TOPIC_ID = afterIds.find((id) => !beforeIds.has(id));
    expect(NEW_TOPIC_ID).toBeTruthy();
    console.log(`[UC-5.2 DOM] 新建话题 channelId=${NEW_TOPIC_ID}（before=${beforeIds.size} after=${afterIds.length}）`);

    const domFacet = await readChannelDom(NEW_TOPIC_ID);

    // —— 关窗口 ——
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    // —— 四面 reducer（server 分配话题 ch 作锚）——
    const expectWithAnchor = {
      ...EXPECT,
      corrAnchor: { ...EXPECT.corrAnchor, ch: NEW_TOPIC_ID },
    };
    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({ jsonl, expect: expectWithAnchor, dom: domFacet });

    console.log('[UC-5.2 四面报告] ' + report.summary);
    for (const f of ['outbound', 'projection', 'storage', 'dom']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }

    expect(report.parseErrors.length).toBe(0);
    // ① 出站：posts/makeTopic body 形态（真源 §2·camelCase 必填集 + bodyForbidden channelId/orient 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
    // ② 投影字段集 == emit_channel_created {channel_id, channel}（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ 落库：batch_upsert channel ≥1 行（话题=新 channel）。
    expect(report.facets.storage.ok).toBe(true);
    // ③ DOM：新建话题 channel 行 data-channel-id 非空。
    expect(report.facets.dom.ok).toBe(true);
  });
});

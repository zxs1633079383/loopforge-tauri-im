// UC-5.6w 公告写族 save/read/delete e2e —— WebdriverIO，直连 4445 内嵌 webdriver（wdio.conf.mjs）。
//
// 写族 WS post_update 回声（仿 UC-3.3 模板）。三条公告写端点（save/read/delete）的 server echo 统一
// 是 WS `post_update`（gap-posts §69：announcement* → post_update ✅ 一致·EventKind::PostEdit gate）→
// helix to_effect::emit_post_updated → 投影 `im:post:updated`（fat 13 键·同 emit_post_received）→
// edit_content_op patch message 行（batch_update·保留本地 read_bits）。
//
// 断面分层（2026-06-26 后端实测·docs/harness/log.md 多条 PARTIAL 先例）：
//   ① 出站：cses-im-server :8066 在线·HTTP 出站可真跑 → reducer diffOutbound 严格裁
//      （urlEndsWith post/announcement/{save,read,delete} + bodyFields camelCase + bodyForbidden 锚
//      snake 泄漏）。**①面真可达绿**（本 spec 前三 it·独立 it 保 ① 绿信号不被 ②④ 红淹没）。
//   ②④ 投影/落库：经 WS post_update echo 驱动 → **阻于 cses-java 宕机**（端口 7091/3399/3391 全 000·
//      JDWP suspend=y·go→cses-java 业务 WS 广播链全断·raw-WS 双观测连 base post 帧都不推·见 log.md
//      #14/#15/#37/#42/#47）→ ②④ 当前不可观测·标 ⛔backend-down。后端恢复后重跑
//      `harness.sh reload-app && harness.sh spec 5.6w` 裁 ②④ 绿。**禁伪造绿**（C009/C011：绿由
//      reducer 裁定·后端宕机=诚实 PARTIAL）。本 spec 后三 it 用 waitUntil 等 post_update echo
//      落进 run.jsonl（C008 可证伪：echo 未到 → 超时抛 ⛔backend-down → it 红·非吞掉=非 tautology）。
//   ③ DOM：save echo 绿后必须再走 announcement list read-result，把 AX 公告面板刷出
//      [data-announcement-id][data-post-id]；reducer 不裁冻结 ③，但 spec 单独断 UI 真实回显。
//
// endpoint / wire body 真源（partials/1 §26-29 + helix outbound/posts_announcement.rs）：
//   - save  : POST post/announcement/save  · body = 整个 args 透传（camelCase Post·壳补 userId）
//   - read  : POST post/announcement/read  · body {postId, channelId}
//   - delete: POST post/announcement/delete· body {postIds, postId} 两字段同值数组
//
// 命令名（实现 phase 接·命名一致）：im_announcement_save / im_announcement_read / im_announcement_delete
//   （JS invoke 用 camelCase·Tauri 映射 snake Rust 参数·helix builder 读 snake post_id/channel_id/
//    post_ids 翻 camel wire·save 整体透传 camelCase）。
//
// 时序纪律（HX-C011 / C008）：一律 waitUntil 等 run.jsonl hop 落点，禁固定 pause 猜 settle。超时=真
//   信号（① 缺 invoke→HTTP 跳红·②④ 缺 echo→backend-down 红），不掩盖。
//
// 依赖前置（harness up / run.sh 提供）：debug app 起（4445 webdriver + 1420 前端薄壳·seeded DB
//   /tmp/loopforge-im.db 含真频道）+ HELIX_RUN_JSONL 暴露 hop 落点 + debug-only invoke
//   `set_uc` / `im_announcement_{save,read,delete}` 已注册（实现 phase）。

import { browser, expect } from '@wdio/globals';
import { readFileSync } from 'node:fs';
import { runFourFacet } from '../reducer/four-facet-reducer.mjs';

const EXPECT = JSON.parse(
  readFileSync(new URL('../expect/uc-5.6w.expect.json', import.meta.url), 'utf8')
);

const RUN_JSONL =
  process.env.HELIX_RUN_JSONL ?? new URL('../../src-tauri/run.jsonl', import.meta.url).pathname;

/** 经薄壳 __lf 桥直 invoke Tauri 命令（与 UI 按钮同命令·求确定性）。 */
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

/** 取当前活跃频道 id（公告作用目标·send 族同源）。 */
const getActiveChannel = () =>
  browser.execute(
    () => document.querySelector('[data-active-channel]')?.getAttribute('data-active-channel')
  );

/** 取首个已渲染公告消息行的 server_id（作 read/delete 的真实公告 postId 目标·无则 null）。 */
const getFirstAnnouncementServerId = () =>
  browser.execute(() => {
    for (const el of document.querySelectorAll('[data-type="ANNOUNCEMENT"][data-msg-id]')) {
      const id = el.getAttribute('data-msg-id');
      const tmp = el.getAttribute('data-temporary-id');
      // 已 echo 覆写的 server_id（≠ temporaryId·非乐观行）。
      if (id && id !== tmp) return id;
    }
    return null;
  });

const findAnnouncementDomByPostId = (postId) =>
  browser.execute((targetPostId) => {
    for (const el of document.querySelectorAll('[data-testid="announcement-panel"] [data-announcement-id][data-post-id]')) {
      if (el.getAttribute('data-post-id') !== targetPostId) continue;
      return {
        announcementId: el.getAttribute('data-announcement-id'),
        postId: el.getAttribute('data-post-id'),
        text: el.textContent?.trim() ?? '',
      };
    }
    return null;
  }, postId);

/** 等公告 save 的真实投影落地，并取 server post msg_id（read/delete 的 postId 来源）。 */
async function waitAnnouncementPostId(channelId, message) {
  let found = null;
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
        if (ev.facet !== 'projection') continue;
        const event = ev.payload?.event;
        if (event !== 'im:post:received' && event !== 'im:post:updated') continue;
        const d = ev.payload?.data ?? {};
        const sameChannel = d.channel_id === channelId || d.channelId === channelId;
        if (sameChannel && d.type === 'ANNOUNCEMENT' && d.message === message && d.msg_id) {
          found = d.msg_id;
          return true;
        }
      }
      return false;
    },
    {
      timeout: 12000,
      interval: 150,
      timeoutMsg: '公告 seed save 已出站但未见真实 post 投影 msg_id（断在 go→WS→helix 投影）',
    }
  );
  return found;
}

async function createAnnouncementPost(channelId, messagePrefix = 'announcement-seed') {
  const message = `${messagePrefix}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await invokeBridge('im_announcement_save', {
    channelId,
    type: 'ANNOUNCEMENT',
    message,
  });
  expect(created.ok).toBe(true);
  return await waitAnnouncementPostId(channelId, message);
}

async function refreshAnnouncementDom(channelId, postId) {
  const reqId = `announcement-list-${Date.now()}`;
  const r = await invokeBridge('im_announcement_list', {
    channelId,
    postId,
    reqId,
  });
  expect(r.ok).toBe(true);
  await browser.waitUntil(
    async () => !!(await findAnnouncementDomByPostId(postId)),
    {
      timeout: 12000,
      interval: 150,
      timeoutMsg: `公告 read-result 未渲染到 AX DOM（postId=${postId}，断在 announcement list/detail→im:read:result→data-announcement-id）`,
    }
  );
  return await findAnnouncementDomByPostId(postId);
}

/**
 * 等 run.jsonl 出现匹配的 ① 出站 http-req hop（urlEndsWith 锚·①面就绪 probe）。
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
 * 等 run.jsonl 出现 echo 投影 hop（写族 ②④ 就绪 probe）。
 * matcher: {ch} 锚频道（save·新公告）/ {sid} 锚 server postId（read/delete·既有公告）。
 * events: 可接受的投影事件名集合（probe 端·机器件）。**新公告 save** 后端广播 `im:post:received`
 *   （非 `im:post:updated`）·故 save 传 ['im:post:received','im:post:updated'] 让 probe 等到真帧；
 *   read/delete（改既有公告）默认仅 `im:post:updated`。注：reducer ② 仍按**冻结 oracle**
 *   （expect.projection.event）裁定 → save ② 当前对 im:post:updated → 若实推 received 则 ② 红
 *   （待 oracle 人审·见本 spec 顶注 + 报告 oracle 校正提案·禁自改 expect·C004/C009）。
 * 守可证伪（C008）：echo 未到 → 超时抛 ⛔backend-down（后端未广播·it 红·非吞掉）。
 */
async function waitPostUpdateEcho({ ch, sid }, endpoint, events = ['im:post:updated']) {
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
          ev.facet === 'projection' &&
          ev.hop === 'projection' &&
          events.includes(ev.payload?.event)
        ) {
          const d = ev.payload?.data ?? {};
          if (sid && (d.msg_id === sid || d.id === sid)) return true;
          if (ch && (d.channel_id === ch || d.channelId === ch)) return true;
        }
      }
      return false;
    },
    {
      timeout: 15000,
      interval: 150,
      timeoutMsg:
        `${endpoint} post_update echo（im:post:updated）未回灌 → ⛔backend-down` +
        `（cses-java 宕机·go→cses-java 业务 WS 广播链断·见 docs/harness/log.md #14/#15/#37/#42/#47）`,
    }
  );
}

describe('UC-5.6w · 公告写族 save/read/delete（WS post_update echo·① 可达绿·②④ ⛔backend-down）', () => {
  let CHANNEL_ID;

  before(async () => {
    // 就绪 probe：等 data-ready（increment_channel_end 收齐 + HTTP inflight==0 + cursor 稳）。
    await browser.waitUntil(
      async () =>
        (await browser.execute(() =>
          document.querySelector('[data-ready]')?.getAttribute('data-ready')
        )) === 'true',
      { timeout: 30000, interval: 200, timeoutMsg: '就绪 probe 未通过（increment_end+inflight0+cursor 稳）' }
    );

    CHANNEL_ID = await getActiveChannel();
    expect(CHANNEL_ID).toBeTruthy();
    console.log(`[UC-5.6w before] CHANNEL_ID=${CHANNEL_ID}`);
  });

  // ───────────────────────── ① 出站面（cses-im-server :8066 在线·真可达绿）─────────────────────────

  it('① save：POST post/announcement/save（camelCase Post wire·壳补 userId）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-5.6w-save' });

    // save body = 整个 args 透传（helix args.clone）·camelCase Post 字段（go 校验 ChannelId/UserId/Type
    // 非空·壳补 userId）。type 取非空值（go 仅校验非空）·message 为公告内容。
    const r = await invokeBridge('im_announcement_save', {
      channelId: CHANNEL_ID,
      type: 'ANNOUNCEMENT',
      message: `announcement-${Math.random().toString(36).slice(2, 8)}`,
    });
    expect(r.ok).toBe(true);

    await waitOutbound('post/announcement/save');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({
      jsonl,
      expect: { ...EXPECT.announcementSave, corrAnchor: { ch: CHANNEL_ID } },
      dom: null,
      ucId: 'UC-5.6w-save',
    });
    console.log(
      '[UC-5.6w save ① 报告] ' +
        (report.facets.outbound.ok ? '✅ outbound 绿' : report.summary)
    );
    if (!report.facets.outbound.ok) console.log('  ✖ outbound: ' + report.facets.outbound.issues.join('; '));
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：POST post/announcement/save {channelId, type, message} camelCase（bodyForbidden snake 泄漏）。
    expect(report.facets.outbound.ok).toBe(true);
  });

  it('① read：POST post/announcement/read {postId, channelId}', async () => {
    await invokeBridge('set_uc', { uc: '__quiescence__' });
    const READ_POST_ID = await createAnnouncementPost(CHANNEL_ID, 'announcement-read-outbound');
    expect(READ_POST_ID).toBeTruthy();
    await invokeBridge('set_uc', { uc: 'UC-5.6w-read' });

    // JS camelCase {postId, channelId} → Tauri 映射 snake post_id/channel_id → helix 读 snake 翻 camel wire。
    const r = await invokeBridge('im_announcement_read', {
      postId: READ_POST_ID,
      channelId: CHANNEL_ID,
    });
    expect(r.ok).toBe(true);

    await waitOutbound('post/announcement/read');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({
      jsonl,
      expect: { ...EXPECT.announcementRead, corrAnchor: { sid: READ_POST_ID } },
      dom: null,
      ucId: 'UC-5.6w-read',
    });
    console.log(
      '[UC-5.6w read ① 报告] ' + (report.facets.outbound.ok ? '✅ outbound 绿' : report.summary)
    );
    if (!report.facets.outbound.ok) console.log('  ✖ outbound: ' + report.facets.outbound.issues.join('; '));
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：POST post/announcement/read {postId, channelId} camelCase（bodyForbidden post_id/channel_id）。
    expect(report.facets.outbound.ok).toBe(true);
  });

  it('① delete：POST post/announcement/delete {postIds, postId}（两字段同值数组）', async () => {
    await invokeBridge('set_uc', { uc: '__quiescence__' });
    const DELETE_POST_ID = await createAnnouncementPost(CHANNEL_ID, 'announcement-delete-outbound');
    expect(DELETE_POST_ID).toBeTruthy();
    await invokeBridge('set_uc', { uc: 'UC-5.6w-delete' });

    // JS camelCase {postIds:[...]} → Tauri 映射 snake post_ids → helix 翻 wire {postIds, postId} 双数组。
    const r = await invokeBridge('im_announcement_delete', {
      postIds: [DELETE_POST_ID],
    });
    expect(r.ok).toBe(true);

    await waitOutbound('post/announcement/delete');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({
      jsonl,
      expect: { ...EXPECT.announcementDelete, corrAnchor: { sid: DELETE_POST_ID } },
      dom: null,
      ucId: 'UC-5.6w-delete',
    });
    console.log(
      '[UC-5.6w delete ① 报告] ' +
        (report.facets.outbound.ok ? '✅ outbound 绿' : report.summary)
    );
    if (!report.facets.outbound.ok) console.log('  ✖ outbound: ' + report.facets.outbound.issues.join('; '));
    expect(report.parseErrors.length).toBe(0);
    // ① 出站 body：POST post/announcement/delete {postIds, postId} 两字段同值数组（bodyForbidden post_ids）。
    expect(report.facets.outbound.ok).toBe(true);
  });

  // ──────────────── ②④ 投影/落库面（WS post_update echo·⛔backend-down·cses-java 宕机）────────────────
  //
  // 后端恢复（cses-java 起·端口 7091/3399/3391 返 200）后这三 it 自然转绿；当前 cses-java JDWP
  // suspend=y 冻结 → 无 post_update 广播 → 下列 waitPostUpdateEcho 超时抛 ⛔backend-down（it 红·
  // 诚实 PARTIAL·非伪造绿）。C008：echo 未到即红=falsifiable，非 tautology。

  it('②④ save：post_update echo → im:post:updated（fat 13 键）+ message batch_update（⛔backend-down）', async () => {
    await invokeBridge('set_uc', { uc: 'UC-5.6w-save-echo' });
    const ECHO_CH = CHANNEL_ID;
    const message = `announcement-echo-${Math.random().toString(36).slice(2, 8)}`;
    const r = await invokeBridge('im_announcement_save', {
      channelId: ECHO_CH,
      type: 'ANNOUNCEMENT',
      message,
    });
    expect(r.ok).toBe(true);

    // ⛔backend-down 闸门：等公告保存的 echo（按频道锚·新公告 post）。新公告广播 im:post:received
    // （非 updated）→ probe 接受两者等到真帧；reducer ② 仍按冻结 oracle 裁（待 oracle 人审）。
    const savedPostId = await waitAnnouncementPostId(ECHO_CH, message);
    expect(savedPostId).toBeTruthy();
    const domAnnouncement = await refreshAnnouncementDom(ECHO_CH, savedPostId);
    expect(domAnnouncement.postId).toBe(savedPostId);
    expect(domAnnouncement.announcementId).toBeTruthy();
    expect(domAnnouncement.text).toContain(message);
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({
      jsonl,
      expect: { ...EXPECT.announcementSave, corrAnchor: { ch: ECHO_CH } },
      dom: null,
      ucId: 'UC-5.6w-save-echo',
    });
    const ok24 = report.facets.projection.ok && report.facets.storage.ok;
    console.log('[UC-5.6w save ②④ 报告] ' + (ok24 ? '✅ projection/storage 绿' : report.summary));
    for (const f of ['projection', 'storage']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }
    expect(report.parseErrors.length).toBe(0);
    // ② 投影 im:post:updated fat 13 键集（缺/多即 fail）。
    expect(report.facets.projection.ok).toBe(true);
    // ④ message 表 batch_update ≥1 行（edit_content_op patch）。
    expect(report.facets.storage.ok).toBe(true);
  });

  it('②④ read：post_update echo → im:post:updated（fat 13 键）+ message batch_update（⛔backend-down）', async () => {
    await invokeBridge('set_uc', { uc: '__quiescence__' });
    const READ_ECHO_POST_ID = await createAnnouncementPost(CHANNEL_ID, 'announcement-read-echo');
    expect(READ_ECHO_POST_ID).toBeTruthy();
    await invokeBridge('set_uc', { uc: 'UC-5.6w-read-echo' });
    const r = await invokeBridge('im_announcement_read', {
      postId: READ_ECHO_POST_ID,
      channelId: CHANNEL_ID,
    });
    expect(r.ok).toBe(true);

    // ⛔backend-down 闸门：等公告 read 的 post_update echo（按 server postId 锚）。
    await waitPostUpdateEcho({ sid: READ_ECHO_POST_ID }, 'read');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({
      jsonl,
      expect: { ...EXPECT.announcementRead, corrAnchor: { sid: READ_ECHO_POST_ID } },
      dom: null,
      ucId: 'UC-5.6w-read-echo',
    });
    const ok24 = report.facets.projection.ok && report.facets.storage.ok;
    console.log('[UC-5.6w read ②④ 报告] ' + (ok24 ? '✅ projection/storage 绿' : report.summary));
    for (const f of ['projection', 'storage']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }
    expect(report.parseErrors.length).toBe(0);
    expect(report.facets.projection.ok).toBe(true);
    expect(report.facets.storage.ok).toBe(true);
  });

  it('②④ delete：post_update echo → im:post:updated（fat 13 键）+ message batch_update（⛔backend-down）', async () => {
    await invokeBridge('set_uc', { uc: '__quiescence__' });
    const DELETE_ECHO_POST_ID = await createAnnouncementPost(CHANNEL_ID, 'announcement-delete-echo');
    expect(DELETE_ECHO_POST_ID).toBeTruthy();
    await invokeBridge('set_uc', { uc: 'UC-5.6w-delete-echo' });
    const r = await invokeBridge('im_announcement_delete', {
      postIds: [DELETE_ECHO_POST_ID],
    });
    expect(r.ok).toBe(true);

    // ⛔backend-down 闸门：等公告删除的 post_update echo（按 server postId 锚·注：若 server 实推
    // posts_update 复数批帧·后端恢复后据 run.jsonl 校正投影事件名·契约变更提案交人审·禁自改 oracle）。
    await waitPostUpdateEcho({ sid: DELETE_ECHO_POST_ID }, 'delete');
    await invokeBridge('set_uc', { uc: '__quiescence__' });

    const jsonl = readFileSync(RUN_JSONL, 'utf8');
    const report = runFourFacet({
      jsonl,
      expect: { ...EXPECT.announcementDelete, corrAnchor: { sid: DELETE_ECHO_POST_ID } },
      dom: null,
      ucId: 'UC-5.6w-delete-echo',
    });
    const ok24 = report.facets.projection.ok && report.facets.storage.ok;
    console.log('[UC-5.6w delete ②④ 报告] ' + (ok24 ? '✅ projection/storage 绿' : report.summary));
    for (const f of ['projection', 'storage']) {
      if (!report.facets[f].ok) console.log(`  ✖ ${f}: ${report.facets[f].issues.join('; ')}`);
    }
    expect(report.parseErrors.length).toBe(0);
    expect(report.facets.projection.ok).toBe(true);
    expect(report.facets.storage.ok).toBe(true);
  });
});

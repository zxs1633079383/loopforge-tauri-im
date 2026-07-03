import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
  inject,
} from "@angular/core";
import { ImStoreService } from "./im/im-store.service";
import { MessageRow } from "./im/message-row.model";
import { ImAuxPanelComponent } from "./im/ui/im-aux-panel.component";
import { ImChannelListComponent } from "./im/ui/im-channel-list.component";
import { ImComposerComponent } from "./im/ui/im-composer.component";
import { ImMemberPanelComponent } from "./im/ui/im-member-panel.component";
import { ImMessageListComponent } from "./im/ui/im-message-list.component";
import { ImServerRailComponent } from "./im/ui/im-server-rail.component";
import { ImStatusBarComponent } from "./im/ui/im-status-bar.component";

/**
 * LoopForge IM 薄壳根组件 —— 6 语义区骨架（issue #46 · spec docs/spec/angular-ui-plan.md）。
 *
 * 覆盖**所有 UC** 的简单语义 DOM 页骨架：H 状态 / CL 频道列表 / ML 消息列表[已绿勿动] /
 * MB 成员区 / CP composer / AX 辅助区。后续每个 UC issue 只往现成区绑数据/加交互件。
 *
 * 铁律（CLAUDE §1 + harness C007）：
 *  - 壳纯渲染：data-* 直映投影字段，不在 JS 合成。
 *  - 加法式：不回退已绿 UC-1.1/1.2/1.5 冻结集（data-msg-id/-temporary-id/-channel-id/
 *    -event-seq/-send-status/-read-bits/-revoke/-type 形态禁改）。
 *  - 事件必配组件方法：模板每加 (click)="fn()" → 同 commit 加 fn()（否则 ng serve 假死）。
 *  - 未设字段不渲染该属性：[attr.data-x]="m.x ?? null"（null → Angular 不渲染）。
 *
 * 交互件方法走真实 store/Tauri invoke；测试只允许经 UI 或 `window.__lf.invoke`
 * 打到 helix 指令，不允许直接改前端内存态造假。
 */
@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    ImAuxPanelComponent,
    ImChannelListComponent,
    ImComposerComponent,
    ImMemberPanelComponent,
    ImMessageListComponent,
    ImServerRailComponent,
    ImStatusBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <main
      class="im"
      [attr.data-ready]="store.ready()"
      [attr.data-active-channel]="store.activeChannel()"
      [attr.data-health]="store.health() || null"
    >
      <!-- ═══ H 状态指示区 ═══ -->
      <app-im-status-bar
        [ready]="store.ready()"
        [activeChannel]="store.activeChannel()"
        (healthClick)="onHealth()"
        (readChannelClick)="onReadChannel()"
      />

      <div class="im__body">
        <!-- ═══ SR 服务器栏（装饰·无 data-*·Discord 视觉）═══ -->
        <app-im-server-rail [serverIcons]="serverIcons" />
        <app-im-channel-list
          [channels]="store.channels()"
          [activeChannel]="store.activeChannel()"
          (createChannelClick)="onCreateChannel()"
          (queryChannelsClick)="onQueryChannels()"
          (onlineStatusClick)="onOnlineStatus()"
          (modulesGetAllClick)="onModulesGetAll()"
          (announcementListClick)="onAnnouncementList()"
          (announcementSaveClick)="onAnnouncementSave()"
          (syncChannelsClick)="onSyncChannels()"
          (teamUpsertClick)="onTeamUpsert()"
          (selectChannel)="onSelectChannel($event)"
          (changeChannel)="onChangeChannel($event.channel, $event.field, $event.value)"
          (closeChannel)="onCloseChannel($event)"
          (teamQuit)="onTeamQuit($event)"
          (ensureChannelLoaded)="onEnsureChannelLoaded($event)"
        />

        <app-im-message-list
          [rows]="store.rows()"
          [activeChannel]="store.activeChannel()"
          (loadOlderClick)="onLoadOlder()"
          (revokeClick)="onRevoke($event)"
          (postReadClick)="onPostRead($event)"
          (templateReceivedClick)="onTemplateReceived($event)"
          (quickReplyClick)="onQuickReply($event.row, $event.emoji)"
          (forwardClick)="onForward($event.row, $event.targetChannels)"
          (makeTopicClick)="onMakeTopic($event)"
          (urgentPostClick)="onUrgentPost($event)"
          (urgentConfirmClick)="onUrgentConfirm($event)"
          (locateClick)="onLocate($event)"
          (loadRepliesClick)="onLoadReplies($event)"
          (loadReplyBranchClick)="onLoadReplyBranch($event)"
          (bookmarkCreateClick)="onCreateBookmark($event)"
          (bookmarkDeleteClick)="onDeleteBookmark($event)"
          (postPinClick)="onPinMessage($event)"
          (announcementAcceptListClick)="onAnnouncementAcceptList($event)"
          (announcementDetailClick)="onAnnouncementDetail($event)"
          (announcementReadClick)="onAnnouncementRead($event)"
          (announcementDeleteClick)="onAnnouncementDelete($event)"
          (voteCreateClick)="onCreateVote($event)"
          (voteSubmitClick)="onSubmitVote($event)"
          (voteReadClick)="onReadVote($event)"
          (voteCloseClick)="onCloseVote($event)"
          (voteDeleteClick)="onDeleteVote($event)"
          (averagePublishClick)="onPublishAverage($event)"
          (averageAttendClick)="onAttendAverage($event)"
          (averageReadClick)="onReadAverage($event)"
          (averageCloseClick)="onCloseAverage($event)"
          (averageDeleteClick)="onDeleteAverage($event)"
          (resendClick)="onResend($event)"
        />

        <!-- ═══ MB 成员区 ═══ -->
        <app-im-member-panel
          [members]="store.members()"
          [membersAttr]="store.membersAttr()"
          (loadMembersClick)="onLoadMembers()"
          (memberChange)="onChangeMember($event.action, $event.memberId)"
          (nicknameChange)="onChangeNickname($event.memberId, $event.nickname)"
          (managerChange)="onChangeManger($event.memberId, $event.set)"
        />
      </div>

      <app-im-aux-panel
        [bookmarks]="store.bookmarks()"
        [todos]="store.todos()"
        [replies]="store.replies()"
        (bookmarkClick)="onBookmark()"
      />

      <app-im-composer
        [activeChannel]="store.activeChannel()"
        [(draft)]="draft"
        (sendClick)="onSend()"
        (sendDocumentClick)="onSendDocument()"
        (sendUrgentClick)="onSendUrgent()"
        (scheduleClick)="onSchedule()"
        (cancelScheduleClick)="onCancelSchedule()"
        (readChannelClick)="onReadChannel()"
      />
    </main>
  `,
  styles: [
    `
      /* pd.cses7 消息页风格 reskin：暗顶栏/侧栏 + 浅色会话列表/消息流，保留语义 DOM 锚点。 */
      .im {
        --top: #2c2a3a; --rail: #413f50; --surface: #ffffff; --panel: #ffffff;
        --canvas: #F5F7FB; --hover: #F1F3F6; --active: #E6E8ED; --pinned: #F4F6F9;
        --bubble: #ffffff;
        --txt: #1f2430; --txt-2: #5b6472; --txt-3: #8a94a3; --muted: #a6afbc;
        --accent: #4857e2; --cyan: #00baa0; --green: #22a06b; --red: #ef4444;
        --yellow: #f6a623; --divider: #e5e8ef;
        display: flex; flex-direction: column; height: 100vh;
        background: var(--canvas); color: var(--txt);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        font-size: 14px; letter-spacing: 0;
      }
      app-im-server-rail, app-im-channel-list, app-im-message-list, app-im-member-panel,
      app-im-member-panel-header, app-im-member-actions, app-im-member-row,
      app-im-member-empty, app-im-aux-panel, app-im-composer { display: contents; }
      .im__hd {
        display: flex; gap: 12px; align-items: center;
        min-height: 56px; padding: 0 16px; background: var(--top); color: #fff;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        font-weight: 700; box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
      }
      .im__ready { font-size: 12px; color: #b9b8c8; font-weight: 600; }
      .im__ready[data-ready="true"] { color: var(--green); }
      .im__body { flex: 1; display: flex; min-height: 0; }
      .im__col { overflow-y: auto; }
      .im__col::-webkit-scrollbar { width: 8px; }
      .im__col::-webkit-scrollbar-thumb { background: #c8ced8; border-radius: 4px; }
      .im__channels {
        width: clamp(240px, 30vw, 330px); background: var(--surface); padding: 12px 18px;
        border-right: 1px solid var(--divider);
      }
      .im__members {
        width: 224px; background: var(--panel); padding: 14px 12px;
        border-left: 1px solid var(--divider);
        box-shadow: -8px 0 24px rgba(31, 36, 48, 0.06);
      }
      .im__list { flex: 1; background: var(--canvas); padding: 10px 0 88px; }
      .im__col-hd {
        display: flex; gap: 4px; align-items: center; flex-wrap: wrap;
        font-size: 18px; font-weight: 700; color: var(--txt); padding: 0 0 12px; margin-bottom: 4px;
      }
      .mem-panel__head {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 0 0 10px; margin-bottom: 8px;
        border-bottom: 1px solid var(--divider);
      }
      .mem-panel__title {
        display: flex; align-items: baseline; gap: 6px;
        min-width: 0; color: var(--txt); font-size: 16px; font-weight: 700;
      }
      .mem-panel__count {
        color: var(--accent); font-size: 12px; font-weight: 700;
      }
      .mem-panel__actions {
        display: grid; grid-template-columns: 1fr auto auto; gap: 6px;
        align-items: center; margin-bottom: 10px;
        padding: 8px; border-radius: 8px; background: #F5F7FB;
      }
      .mem-panel__member-input { width: 100%; min-width: 0; }
      .mem-empty {
        display: flex; flex-direction: column; gap: 4px; align-items: center;
        padding: 18px 8px; color: var(--txt-3); text-align: center;
        border: 1px dashed #d8dde7; border-radius: 8px; background: #FAFBFE;
      }
      .mem-empty__title { color: var(--txt-2); font-size: 13px; font-weight: 700; }
      .mem-empty__hint { font-size: 12px; line-height: 1.4; }
      .ch, .mem {
        position: relative; display: flex; align-items: center; gap: 10px;
        padding: 10px 8px; margin: 0; border-radius: 6px; cursor: pointer;
        color: var(--txt-2); font-size: 14px; font-weight: 500; min-height: 44px;
      }
      .ch { border-bottom: 1px solid #f0f2f6; }
      .ch:hover, .mem:hover { background: var(--hover); color: var(--txt); }
      .ch--active { background: var(--active); color: var(--txt); }
      .ch__avatar {
        width: 38px; height: 38px; border-radius: 8px; flex: none;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(145deg, #eef3ff, #dfe6f8); color: var(--accent);
        font-weight: 700;
      }
      .ch__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .ch__name, .mem__name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ch__name { color: var(--txt); font-weight: 600; }
      .ch__preview { color: var(--txt-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ch__meta { flex: none; min-width: 18px; display: flex; justify-content: flex-end; }
      .ch__badge {
        min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px;
        display: inline-flex; align-items: center; justify-content: center;
        background: #ff4059; color: #fff; font-size: 11px; font-weight: 700;
      }
      /* ops 浮层：绝对定位移出常规流（行收紧到只剩名/文本）·默认 opacity:0·hover 浮现。
         仍 pointer-events:auto + 不 display/visibility-hide → WebdriverIO 按 testid 仍可点。
         （若 uc-2.3 因遮挡掉绿则回退常规流·见提交说明） */
      .ch__ops, .mem__ops, .msg__ops {
        position: absolute; opacity: 0; transition: opacity 0.1s;
        display: flex; flex-wrap: wrap; align-items: center; gap: 3px;
        background: #fff; border: 1px solid var(--divider); border-radius: 6px; padding: 4px;
        box-shadow: 0 8px 26px rgba(31, 36, 48, 0.12); z-index: 3;
      }
      .ch__ops, .mem__ops {
        right: 6px; top: 50%; transform: translateY(-50%); flex-wrap: nowrap;
      }
      .msg__ops { right: 12px; top: 2px; max-width: 60%; justify-content: flex-end; }
      .ch:hover .ch__ops, .mem:hover .mem__ops, .msg:hover .msg__ops {
        opacity: 1; z-index: 6;
      }
      .msg {
        position: relative; display: flex; gap: 10px; align-items: flex-start;
        padding: 6px 24px; word-break: break-word; white-space: pre-wrap;
      }
      .msg:hover { background: rgba(255, 255, 255, 0.55); }
      .msg__text {
        flex: 1; width: fit-content; max-width: min(620px, 76%);
        padding: 10px 14px; border-radius: 10px; background: var(--bubble);
        color: var(--txt); font-size: 15px; line-height: 1.45;
        box-shadow: 0 1px 2px rgba(31, 36, 48, 0.04);
      }
      .msg--sending { opacity: 0.6; }
      .msg--failed .msg__text { color: var(--red); }
      .msg--revoked .msg__text {
        opacity: 0.5; font-style: italic; text-decoration: line-through;
      }
      .msg--highlighted { background: #fff7df; box-shadow: inset 3px 0 0 var(--yellow); }
      .im__aux {
        display: flex; gap: 12px; padding: 6px 24px; align-items: center;
        border-top: 1px solid var(--divider); background: var(--surface);
      }
      .im__panel { display: inline-flex; gap: 5px; align-items: center; }
      .aux-chip { width: 8px; height: 8px; border-radius: 50%; background: var(--cyan); }
      .im__load-older {
        display: block; margin: 4px auto 10px; color: var(--txt-2);
        background: transparent; border: none; font-size: 13px; cursor: pointer;
      }
      .im__compose {
        position: fixed; left: clamp(324px, calc(72px + 30vw), 402px); right: 248px; bottom: 20px;
        display: flex; gap: 8px; padding: 10px 14px; flex-wrap: wrap;
        align-items: center; background: var(--surface); border: 1px solid var(--divider);
        border-radius: 14px; box-shadow: 0 10px 30px rgba(31, 36, 48, 0.10);
        z-index: 20; max-height: 38vh; overflow-y: auto;
      }
      .im__compose-to { color: var(--txt-3); border-right: 1px solid var(--divider); padding-right: 12px; }
      .im__compose-to strong { color: var(--accent); font-weight: 700; }
      .im__compose-to {
        white-space: nowrap;
      }
      .im__input {
        flex: 1; min-width: 180px; padding: 10px 12px; border-radius: 10px;
        border: none; background: transparent; color: var(--txt); font-size: 14px;
      }
      .im__input::placeholder { color: var(--txt-3); }
      .im__send {
        padding: 9px 16px; border-radius: 8px; border: none;
        background: var(--accent); color: #fff; cursor: pointer;
        font-weight: 600; font-size: 13px;
      }
      .im__send:hover { background: #3e4ad6; }
      .im__send:disabled, .im__mini:disabled { opacity: 0.4; cursor: not-allowed; }
      .im__mini {
        padding: 5px 9px; border-radius: 6px; border: none;
        background: #eef1f6; color: var(--txt-2); cursor: pointer;
        font-size: 12px; font-weight: 500;
      }
      .im__mini:hover { background: #e0e5ee; color: var(--txt); }
      .im__mini:active { background: var(--accent); color: #fff; }
      .im__mini-input {
        width: 72px; padding: 5px 8px; border-radius: 6px; border: none;
        background: #f5f7fb; color: var(--txt-2); font-size: 12px;
      }
      .im__rail {
        width: 72px; background: var(--rail); display: flex;
        flex-direction: column; align-items: center; gap: 8px; padding: 12px 0;
        overflow-y: auto;
      }
      .im__rail-home, .im__rail-srv, .im__rail-add {
        width: 48px; height: 48px; border-radius: 24px; flex: none;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; font-weight: 700; font-size: 15px; color: #fff;
        transition: border-radius 0.15s;
      }
      .im__rail-home { background: var(--accent); border-radius: 8px; }
      .im__rail-srv { background: rgba(255, 255, 255, 0.12); }
      .im__rail-home:hover, .im__rail-srv:hover { border-radius: 16px; }
      .im__rail-add { background: rgba(255, 255, 255, 0.10); color: var(--green); font-size: 22px; }
      .im__rail-div {
        width: 32px; height: 2px; border-radius: 1px; flex: none;
        background: rgba(255, 255, 255, 0.16);
      }
      .msg { padding-top: 8px; padding-bottom: 4px; }
      .msg__avatar {
        width: 40px; height: 40px; border-radius: 20px; flex: none;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-weight: 600; font-size: 16px; margin-top: 2px;
      }
      .msg__body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .msg__body .msg__text { flex: none; }
      .msg__head { display: flex; align-items: baseline; gap: 8px; }
      .msg__author { color: var(--txt); font-weight: 600; font-size: 15px; }
      .msg__time { color: var(--txt-3); font-size: 12px; }
      .mem__avatar {
        width: 32px; height: 32px; border-radius: 16px; flex: none;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-weight: 600; font-size: 13px;
      }
      .mem__crown { color: var(--yellow); font-size: 13px; flex: none; }
      @media (max-width: 920px) {
        .im__channels { width: 250px; }
        .im__members { width: 184px; }
        .im__compose { left: 84px; right: 12px; bottom: 12px; }
      }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  readonly store = inject(ImStoreService);

  readonly serverIcons = ["CS", "设", "运"];

  // 活动频道不再硬编码：由 store.activeChannel() 提供（stream 第一个真实频道胜出，含 increment）。
  // demo-channel 非合法 26 位频道 id，helix parse 会拒（missing/invalid channel_id）。

  draft = "";

  ngOnInit(): void {
    void this.store.start();
  }

  ngOnDestroy(): void {
    this.store.stop();
  }

  // ═══ CP 已绿交互件（真实 store 流 · UC-1.1/1.2）═══

  onSend(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return; // 未锚定真实频道（increment 未流入）→ 不发
    const text = this.draft;
    this.draft = "";
    void this.store.send(channelId, text);
  }

  onSendDocument(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    const text = this.draft.trim();
    if (!text) return;
    this.draft = "";
    void this.store.sendDocument(channelId, text);
  }

  // ═══ CP 交互件（真实 store/Tauri invoke · C007 必配方法）═══

  /** UC-1.9 加急（composer 便捷入口）：对当前频道最近一条已发送消息（有 msgId·非乐观）发加急。
   *  targetIds 取当前成员区已加载成员（无则空·则不发·e2e 走 bridge 注入真实 targetIds）。
   *  真实加急驱动经 onUrgentPost(row)·此便捷入口仅为 UI 完整性。 */
  onSendUrgent(): void {
    const sent = this.store.rows().filter((m) => !!m.msgId);
    const row = sent[sent.length - 1];
    if (!row) return;
    this.onUrgentPost(row);
  }

  /** UC-1.9 加急（消息行）：rootId=消息所在群 channelId·postId=消息 server id →
   *  store.urgentPost（targetIds 取成员区已加载成员·壳不臆造）。e2e 走 bridge 直 invoke
   *  注入真实 targetIds 覆盖此 UI 便捷路径。 */
  onUrgentPost(row: MessageRow): void {
    const channelId = row.channelId;
    const postId = row.msgId;
    if (!channelId || !postId) return; // 无频道 / 无 server id（未对账消息）→ 不发
    const targetIds = this.store.members().map((m) => m.memberId).filter(Boolean);
    if (targetIds.length === 0) return; // 无目标成员（后端 Validate 拒空）
    void this.store.urgentPost(channelId, postId, targetIds);
  }

  /** UC-1.9 确认收到加急（消息行·阶段②）：postId=消息 server id + channelId →
   *  store.urgentConfirm。e2e 走 bridge 直 invoke 覆盖。 */
  onUrgentConfirm(row: MessageRow): void {
    const channelId = row.channelId;
    const postId = row.msgId;
    if (!channelId || !postId) return;
    void this.store.urgentConfirm(postId, channelId);
  }

  /** UC-1.10 定时消息：channelId=当前活动频道·message=草稿（空则不发）·
   *  schedulePostAt=当前 + 1 小时（毫秒）→ store.createSchedule（body 嵌套 post 由 Rust/helix 拼·
   *  壳不臆造）。hasSchedule 由 helix `im:channel:schedule-created` 投影驱动 data-has-schedule-post·
   *  壳纯渲染·无乐观合成。e2e 走 bridge 直 invoke 注入真实参数覆盖此 UI 便捷路径。 */
  onSchedule(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    const message = this.draft.trim();
    if (!message) return;
    this.draft = "";
    const schedulePostAt = Date.now() + 3600 * 1000;
    void this.store.createSchedule(channelId, message, schedulePostAt);
  }

  /** UC-1.10 取消定时：channelId=当前活动频道 → store.cancelSchedule（body{channelId} 由
   *  Rust/helix 拼·壳不臆造）。hasSchedule 由 helix `im:channel:schedule-canceled` 投影驱动
   *  data-has-schedule-post 清空·壳纯渲染·无乐观合成。无 activeChannel → 不发。 */
  onCancelSchedule(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    void this.store.cancelSchedule(channelId);
  }

  /** UC-3.1 会话已读：进/看当前会话 → store.readChannel（会话/区间模式标整会话已读·body 仅
   *  channelId 由 Rust/helix 拼·壳不臆造）。无 activeChannel → 不发。data-read-bits 由 helix
   *  `im:post:read`（fat·WS post_read type6 echo）投影驱动·壳纯渲染·无乐观合成。e2e 走 bridge
   *  直 invoke 注入真实 channelId 覆盖此 UI 便捷路径。 */
  onReadChannel(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return; // 无活动会话 → 不发
    void this.store.readChannel(channelId);
  }

  /** UC-12.1 健康探针：store.checkHealth（invoke im_health → 出站 GET /api/cses/health·无请求体·
   *  连通性 ① 面）。读族无 WS 回声·HTTP 200 裸 `{status:"OK"}` 经 helix `im:read:result{req_id, body}`
   *  透传回灌 → store 设 _health → data-health 指示件。e2e 走 bridge 直 invoke 注入确定性 reqId。 */
  onHealth(): void {
    void this.store.checkHealth();
  }

  /** UC-5.1 创建群聊：生成唯一群名 → store.createChannel（teamId/自身 CREATOR 由 Rust 拼·壳不臆造）。
   *  memberIds 取当前成员区（MB）已加载成员 id（无则空·Rust 命令自动补自身 CREATOR 满足 Users≥1）。
   *  e2e 走 bridge 直 invoke 注入真实 memberIds 覆盖此 UI 便捷路径。 */
  onCreateChannel(): void {
    const displayName = this.draft.trim();
    if (!displayName) return;
    this.draft = "";
    const memberIds = this.store.members().map((m) => m.memberId).filter(Boolean);
    void this.store.createChannel(displayName, memberIds);
  }

  /**
   * UC-5.8 条件查频道（条件分页查询·读族）：store.queryChannels（invoke im_channel_query →
   * 出站 channel/query·condition map 平铺 + pageNumber/pageSize/offset 同层）。读族无 WS 回声·
   * 查询结果靠 helix `im:read:result{req_id, body}` 透传回灌（前端从 body 抽频道渲染·非冻结契约面）。
   * 最简 UI：取一个本地已渲染频道的 displayName 作 condition（保证有命中·真实「按名查」流），
   * 无频道则空 condition（仅带分页·查全部）。e2e 走 bridge 直 invoke 注入确定性 condition/reqId。
   */
  onQueryChannels(): void {
    const first = this.store.channels()[0];
    const condition = first?.displayName
      ? { name: first.displayName }
      : {};
    void this.store.queryChannels(condition, 0, 20, 0);
  }

  /**
   * UC-5.7 频道成员在线状态（批量查在线·读族）：store.loadOnlineStatus（invoke
   * im_channel_online_status → 出站 channel/onlineStatus·内联 {channelIds:[]string}）。读族无 WS 回声·
   * 在线状态靠 helix `im:read:result{req_id, body}`（data=[]ChannelOnlineStatusGroup）透传回灌
   * （前端从 body 抽在线状态渲染·非冻结契约面）。最简 UI：取本地已渲染频道 id 作 channelIds
   * （保证有命中·真实「批量查在线」流），无频道则不发。e2e 走 bridge 直 invoke 注入确定性 channelIds/reqId。
   */
  onOnlineStatus(): void {
    const ids = this.store.channels().map((c) => c.channelId).filter(Boolean);
    void this.store.loadOnlineStatus(ids);
  }

  /**
   * UC-10.3 获取全部功能模块（读族）：store.getAllModules（invoke im_modules_get_all → 出站
   * modules/getAll·无 body）。读族无 WS 回声·模块列表靠 helix `im:read:result{req_id, body}` 透传
   * 回灌（前端从 body 抽模块渲染·非冻结契约面）。最简 UI：无入参直触发拉全部模块。
   * e2e 走 bridge 直 invoke 注入确定性 reqId。
   */
  onModulesGetAll(): void {
    void this.store.getAllModules();
  }

  /**
   * UC-5.6r 公告·列表查询（读族）：store.announcementList（invoke im_announcement_list → 出站
   * post/announcement/list {channelId}）。读族无 WS 回声·公告列表靠 helix `im:read:result{req_id,
   * body}` 透传回灌（前端从 body 抽公告渲染·非冻结契约面）。最简 UI：取当前活动频道 id 作 channelId·
   * 无则不发。e2e 走 bridge 直 invoke 注入确定性 channelId/reqId 覆盖此便捷路径。
   */
  onAnnouncementList(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    void this.store.announcementList(channelId);
  }

  /**
   * UC-5.6w 公告·保存（写族 WS post_update echo）：store.announcementSave（invoke im_announcement_save →
   * 出站 post/announcement/save·camelCase Post·壳后端补 userId）。type=TEXT，message 使用用户动作触发时生成的真实请求正文。
   * server echo（im:post:updated）⛔ 当前阻于后端 WS 业务广播链(切 cses-im-server 后待复验)·① 出站经 cses-im-server 可真跑。无活动频道 → 不发。
   * e2e 走 bridge 直 invoke 注入真实 channelId/type/message 覆盖此便捷路径。
   */
  onAnnouncementSave(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    const message = this.draft.trim();
    if (!message) return;
    this.draft = "";
    void this.store.announcementSave(channelId, "TEXT", message);
  }

  /** UC-4.2 按需 sync：触发引擎重连 → 重检 per-channel needSync gap → 对落后频道自驱
   *  channel/sync/notify → server 回放离线区间事件 → ML 增量消息行（im:post:received）+ CL
   *  data-unread badge 累加（im:channel:update-by-post）+ message 落库 + cursor 跳空洞。
   *  薄壳只调 store.syncChannels（invoke im_sync_channels·业务全在 helix-im·壳不臆造 sync 逻辑）。 */
  onSyncChannels(): void {
    this.store.syncChannels();
  }

  /** UC-11.1 维护公司大群：生成唯一大群名 → store.teamUpsert（teamId/自身 owner+CREATOR 由 Rust 拼·
   *  壳不臆造）。memberIds 取当前成员区（MB）已加载成员 id（无则空·Rust 命令自动补自身 CREATOR）。
   *  公司大群=建群路径（id 缺省）→ helix im:channel:created 投影驱动 CL 新行（壳纯渲染）。
   *  e2e 走 bridge 直 invoke 注入真实 memberIds 覆盖此 UI 便捷路径。 */
  onTeamUpsert(): void {
    const displayName = this.draft.trim();
    if (!displayName) return;
    this.draft = "";
    const memberIds = this.store.members().map((m) => m.memberId).filter(Boolean);
    void this.store.teamUpsert(displayName, memberIds);
  }

  // ═══ CL 频道行交互件（真实 store/Tauri invoke）═══

  /** UC-2.1 切群首屏：点 CL 频道行 → store.queryMessages（invoke im_query_messages_by_channel·
   *  纯本地 Scan·无 HTTP 出站）→ helix Scan 回报 emit im:messages:query_result → ML 区渲染该频道
   *  首屏消息行（data-msg-id 直映·壳纯渲染·无乐观合成）。同时把 activeChannel 切到目标频道。 */
  onSelectChannel(channelId: string): void {
    if (!channelId) return;
    void this.store.queryMessages(channelId);
  }

  /**
   * UC-5.4 群属性修改。改群名 → store.changeChannelDisplayName（invoke
   * im_channel_change_display_name → 出站 channel/change/displayName）；改公告 →
   * store.changeChannelNotice（→ channel/change/notice）。属性回读靠 helix `im:channel:update`
   * （thin）触发 dialogList 重查 → CL 行 data-channel-display-name/-notice 更新（壳纯渲染）。
   */
  onChangeChannel(
    channel: { channelId: string },
    field: string,
    value: string,
  ): void {
    const channelId = channel?.channelId;
    if (!channelId) return;
    if (field === "displayName") {
      void this.store.changeChannelDisplayName(channelId, value);
    } else if (field === "notice") {
      void this.store.changeChannelNotice(channelId, value);
    } else if (field === "top") {
      // UC-5.5 频道置顶：value '1'=置顶 / '0'=取消（模板按 c.top 取反传入）→ store.changeChannelTop
      // （invoke im_channel_change_top → 出站 channel/change/top {channelId, top:bool}）。置顶态回读
      // 靠 helix im:channel:update（thin）触发 dialogList 重查 → CL 行 data-channel-top 更新（壳纯渲染）。
      void this.store.changeChannelTop(channelId, value === "1");
    }
  }

  /**
   * UC-5.3 关闭/退出群：点频道行「关闭/退出群」→ store.closeChannel（invoke im_channel_close →
   * 出站 channel/close {channelId}）。CL 区该行的移除靠 helix `im:channel:closed`（{channelId,
   * deleteAt}·WS channel_close 透传）投影驱动 applyChannelClosed 删行（壳纯渲染·无乐观合成）。
   */
  onCloseChannel(channel: { channelId: string }): void {
    const channelId = channel?.channelId;
    if (!channelId) return;
    void this.store.closeChannel(channelId);
  }

  /** UC-11.2 退出公司：点频道行「退」→ store.teamQuit（invoke im_team_quit → 出站 DELETE
   *  teams/member/quit·body {userId, teamId} 由 Rust 从 profile 单一真源拼·壳不臆造 creds）。
   *  退公司=退该 team 下所有群；CL 区行移除靠 helix 配套 `channel_close` / `channel_member_update`
   *  投影驱动（壳纯渲染·无乐观合成·quit_company 帧本身 helix graceful no-op）。channel 参数仅作
   *  UI 触发点（退的是整个 team·非单频道）。e2e 走 bridge 直 invoke im_team_quit 覆盖此 UI 便捷路径。 */
  onTeamQuit(_channel: unknown): void {
    void this.store.teamQuit();
  }

  /**
   * UC-4.5 陌生 channel 兜底：进入未加载过的频道触发单频道增量同步 → store.ensureChannelLoaded
   * （invoke im_ensure_channel_loaded → 出站 channel/load/incrementByChannelId {channelId}）。
   * 读族无 WS 回声·该 channel 增量靠 helix `im:read:result{req_id, body}` 透传回灌驱动单频道增量
   * 渲染。无 channelId → 不发。e2e 走 bridge 直 invoke 注入真实 channelId/reqId 覆盖此 UI 便捷路径。
   */
  onEnsureChannelLoaded(channel: { channelId: string }): void {
    const channelId = channel?.channelId;
    if (!channelId) return;
    void this.store.ensureChannelLoaded(channelId);
  }

  // ═══ ML 消息行交互件（真实 store/Tauri invoke）═══

  /** UC-1.5 撤回：msgId=消息 server id → store.revoke（body `{postId}` 由 Rust/helix 拼·壳不臆造）。
   *  无 server id（未对账乐观消息）→ 不发。data-revoke=1 由 helix `im:post:batch-updated`（在线
   *  posts_update echo）/ `im:post:deleted`（离线 fat）投影驱动 markRevokedById·壳纯渲染·无乐观合成。 */
  onRevoke(row: MessageRow): void {
    if (!row.msgId) return; // 无 server id（未对账消息）→ 不发
    void this.store.revoke(row.msgId);
  }

  /** UC-3.2 单条已读：postId=消息 server id + channelId=消息所在群 → store.markRead
   *  （posts 列表模式 `{channelId, posts:[postId]}` 由 Rust/helix 拼·壳不臆造）。无 server id
   *  （未对账乐观消息）/ 无频道 → 不发。data-read-bits 由 helix `im:post:read`（fat·post_read echo）
   *  投影驱动·壳纯渲染·无乐观合成。e2e 走 bridge 直 invoke 注入真实 postId 覆盖此 UI 便捷路径。 */
  onPostRead(row: MessageRow): void {
    const postId = row.msgId;
    const channelId = row.channelId;
    if (!postId || !channelId) return; // 无 server id（未对账消息）/ 无频道 → 不发
    void this.store.markRead(postId, channelId);
  }

  /** UC-3.3 模板已收到：postId=模板消息 server id → store.templateReceived（body `{postId}`
   *  camelCase 由 Rust/helix 拼·壳不臆造）。无 server id（未对账乐观消息）→ 不发。
   *  data-template-received 由 helix `im:post:updated`（fat·WS post_update·props.template.userIds
   *  含 self）投影驱动·壳纯渲染·无乐观合成。e2e 走 bridge 直 invoke 注入真实 postId 覆盖此 UI 便捷路径。 */
  onTemplateReceived(row: MessageRow): void {
    const postId = row.msgId;
    if (!postId) return; // 无 server id（未对账消息）→ 不发
    void this.store.templateReceived(postId);
  }

  /** UC-1.8 快捷回复 emoji：postId=消息 server id + emoji（用户选）→ store.quickReply
   *  （自身 userId 由 Rust 从 identity 补·壳不臆造）。无 server id（未对账消息）→ 不发。
   *  reactions 由 helix `im:post:updated`（props.quickReply）投影驱动 data-reactions·壳纯渲染。
   *  e2e 走 bridge 直 invoke 注入真实 postId/emoji 覆盖此 UI 便捷路径。 */
  onQuickReply(row: MessageRow, emoji: string): void {
    const postId = row.msgId;
    if (!postId || !emoji) return; // 无 server id（未对账消息）/ 无 emoji → 不发
    void this.store.quickReply(postId, emoji);
  }

  /** UC-1.7 转发/合并：把消息行转发到 N 目标频道。postId=消息 server id（无则不发·未对账乐观
   *  消息不可转发）·message=行文本 → 构造 Post 对象数组 → store.relayMessages（endpoint
   *  posts/createPosts + camelCase 化由 Rust/helix 拼·壳不臆造 body）。targetChannels 显式传入则用
   *  之（e2e 走 bridge 直 invoke 注入真实目标频道）；UI 便捷路径取频道列表中非源频道的前 N 个。
   *  转发行由 helix `im:post:received`（fat·各目标频道独立）投影驱动追加·壳纯渲染·无乐观合成。 */
  onForward(row: MessageRow, targetChannels: string[]): void {
    const postId = row.msgId;
    if (!postId) return; // 无 server id（未对账乐观消息）→ 不可转发
    // 目标频道：显式传入优先（e2e bridge），否则取频道列表非源频道前 2 个（UI 便捷路径）。
    const targets =
      targetChannels.length > 0
        ? targetChannels
        : this.store
            .channels()
            .map((c) => c.channelId)
            .filter((id) => id && id !== row.channelId)
            .slice(0, 2);
    if (targets.length === 0) return; // 无可转发目标频道 → 不发
    // Post 对象：转发源消息正文 + type（前端从本地行取真实文本·透传给后端在各目标频道建**新**消息）。
    // **不带源 id / 不造 temporaryId**——server PreSave 负责新 id；投影按 server id 追加新行。
    const posts: Array<Record<string, unknown>> = [
      { message: row.text, type: row.type || "TEXT" },
    ];
    void this.store.relayMessages(posts, targets);
  }

  /** UC-5.2 创建话题（消息转话题）：rootId=消息所在群 channelId·postId=消息 server id →
   *  store.makeTopic（teamId/自身 CREATOR 由 Rust 拼·壳不臆造）。memberIds 取当前成员区已加载
   *  成员（无则空·Rust 自动补自身 CREATOR）。e2e 走 bridge 直 invoke 注入真实 rootId/postId/
   *  memberIds 覆盖此 UI 便捷路径。 */
  onMakeTopic(row: MessageRow): void {
    const rootId = row.channelId;
    const postId = row.msgId;
    if (!rootId || !postId) return; // 无根群 / 无 server id（未对账消息）→ 不发
    const displayName = row.text.trim();
    if (!displayName) return;
    const memberIds = this.store.members().map((m) => m.memberId).filter(Boolean);
    void this.store.makeTopic(rootId, postId, displayName, memberIds);
  }

  /** UC-2.3 按 postId 定位：postId=消息 server id + channelId=消息所在群 → store.locatePost
   *  （读族纯本地·定位已加载行打高亮·复用 query_result ②④·新增 ③ DOM data-highlighted）。无 server id
   *  （未对账乐观消息·定位锚须 server postId）→ 不定位。e2e 取已加载行 msg-id 后点击本按钮。 */
  onLocate(row: MessageRow): void {
    const postId = row.msgId;
    if (!postId) return; // 无 server id（未对账乐观消息）→ 定位锚须 server postId
    void this.store.locatePost(postId, row.channelId);
  }

  /** UC-2.4 加载一级回复链：replyId=消息 server id → store.loadReplies（读族 getReplies·endpoint +
   *  wire body camelCase 化由 Rust/helix 拼·壳不臆造）。无 server id（未对账乐观消息）→ 不发。
   *  回复链由 helix `im:read:result`（读族透传·{req_id, body}）投影驱动 AX reply-drawer data-reply-id·
   *  壳纯渲染·无乐观合成。e2e 走 bridge 直 invoke 注入真实 replyId + reqId 覆盖此 UI 便捷路径。 */
  onLoadReplies(row: MessageRow): void {
    const replyId = row.msgId;
    if (!replyId) return; // 无 server id（未对账乐观消息）→ 不可取回复链
    void this.store.loadReplies(replyId);
  }

  /** UC-2.4 加载二级回复分支：replyFirstLevelId=一级回复 server id → store.loadReplyBranch（读族
   *  getReplyBranch）。同 onLoadReplies 走 im:read:result 透传回灌。无 server id → 不发。 */
  onLoadReplyBranch(row: MessageRow): void {
    const firstLevelId = row.msgId;
    if (!firstLevelId) return;
    void this.store.loadReplyBranch(firstLevelId);
  }

  /** UC-1.4 重发失败：复用失败行原 temporaryId 重走 posts/create（upsert）。 */
  onResend(row: MessageRow): void {
    void this.store.resend(row.temporaryId, row.channelId, row.text);
  }

  /** UC-2.2 上拉更早历史：以当前最旧已加载行作锚 → store.loadOlder（invoke im_load_older_context）
   *  → helix 多轮 postContext 编排回报后 emit im:messages:older_loaded → prepend 更早行。 */
  onLoadOlder(): void {
    void this.store.loadOlder();
  }

  // ═══ MB 成员区交互件（真实 store/Tauri invoke）═══

  /**
   * UC-6.4 成员快照/全量（读族·按 channelIds 拉成员·自愈）：channelId=当前活动频道 →
   * store.loadMembersByIds（invoke im_members_by_ids → 出站 channels/member/byIds
   * {channelIds:[活动频道]}）。读族无 WS 回声·成员靠 helix `im:read:result{req_id, body}` 透传回灌
   * （body=map[channelId][]IdWithCompanyExt）驱动 MB 区渲染（data-member-count）。无活动频道 → 不发。
   * e2e 走 bridge 直 invoke 注入真实 channelIds/reqId 覆盖此 UI 便捷路径。
   */
  onLoadMembers(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    void this.store.loadMembersByIds([channelId]);
  }

  /**
   * UC-6.1 拉/踢人：action='join' 拉成员进群 / 'leave' 踢成员出群·memberId=成员 userId（输入框值）→
   * store.changeMember（invoke im_channel_member_change → 出站 channel/member/change
   * {channelId, joinUsers/leaveUsers:[{id,teamId,role}]}）。channelId=当前活动频道（MB 区成员属当前会话）。
   * 成员回读靠 helix `im:channel:member-updated`（{channel_id, channel}）投影驱动 → MB 区成员行 +
   * data-members 刷新（壳纯渲染）。无 memberId / 无活动频道 → 不发。e2e 走 bridge 直 invoke 注入真实
   * channelId/joinUserIds 覆盖此 UI 便捷路径。
   */
  onChangeMember(action: string, memberId: string): void {
    const channelId = this.store.activeChannel();
    const uid = (memberId ?? "").trim();
    if (!uid || !channelId) return;
    const joins = action === "join" ? [uid] : [];
    const leaves = action === "leave" ? [uid] : [];
    void this.store.changeMember(channelId, joins, leaves);
  }

  /**
   * UC-6.3 改群昵称：memberId=被改昵称的成员 userId·nick=新昵称（输入框值）→
   * store.changeMemberNickname（invoke im_update_member_nickname → 出站
   * channel/member/change/nickname {channelId, userId, nickname}）。channelId=当前活动频道
   * （MB 区成员属于当前会话）。昵称回读靠 helix `im:channel:memberNickname`（{channelId, userId,
   * nickName}）投影驱动 → MB 区该成员行 data-nickname 更新（壳纯渲染）。无 memberId / 无活动频道
   * → 不发。e2e 走 bridge 直 invoke 注入真实 channelId/userId 覆盖此 UI 便捷路径。
   */
  onChangeNickname(memberId: string, nick: string): void {
    const channelId = this.store.activeChannel();
    if (!memberId || !channelId) return;
    void this.store.changeMemberNickname(channelId, memberId, nick);
  }

  /**
   * UC-6.2 设/撤管理员：memberId=被设/撤管理员的成员 userId·set（true=设·false=撤）→
   * store.setManger（invoke im_channel_set_manger → 出站 channel/add/manger | channel/remove/manger
   * {channelId, users:[{id,name,role,teamId}]}）。channelId=当前活动频道（MB 区成员属当前会话）。
   * data-admin 只接受后端/helix 成员投影回灌，不在壳内乐观造管理员态。
   * 无 memberId / 无活动频道 → 不发。e2e 通过真实成员行按钮触发。
   */
  onChangeManger(memberId: string, set: boolean): void {
    const channelId = this.store.activeChannel();
    if (!memberId || !channelId) return;
    void this.store.setManger(channelId, memberId, set);
  }

  // ═══ AX 辅助区交互件（真实 store/Tauri invoke）═══

  /**
   * UC-9.x 书签·加载收藏列表（读族）：channelId=当前活动频道 → store.loadBookmarks（invoke
   * im_bookmark_load → 出站 post/bookmark/load {channelId, userId} + 扁平 PageOpts）。读族无 WS 回声·
   * 收藏列表靠 helix `im:read:result{req_id, body}` 透传回灌驱动 AX 书签面板（data-bookmark-id）。
   * 无活动频道 → 不发。e2e 走 bridge 直 invoke 注入真实 channelId/reqId 覆盖此 UI 便捷路径。
   */
  onBookmark(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    void this.store.loadBookmarks(channelId);
  }

  /**
   * UC-9.x 书签·收藏消息：channelId=当前活动频道·postId=被收藏消息 server id（msgId）→
   * store.createBookmark（invoke im_bookmark_create → 出站 post/bookmark/create
   * {channelId, userId, postIds:[postId]}）。读族透传回灌 im:read:result。无 server id（仅本地乐观行·
   * 未对账）/ 无活动频道 → 不发。e2e 走 bridge 直 invoke 注入真实 channelId/postIds 覆盖此便捷路径。
   */
  onCreateBookmark(row: MessageRow): void {
    const channelId = this.store.activeChannel();
    const postId = (row.msgId ?? "").trim();
    if (!channelId || !postId) return;
    void this.store.createBookmark(channelId, [postId]);
  }

  /**
   * UC-9.x 书签·取消收藏：postId=被取消收藏的消息 server id（msgId）→ store.deleteBookmark（invoke
   * im_bookmark_delete → 出站 post/bookmark/delete {userId, postId}）。读族透传回灌 im:read:result。
   * 无 server id → 不发。e2e 走 bridge 直 invoke 注入真实 postId 覆盖此便捷路径。
   */
  onDeleteBookmark(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    if (!postId) return;
    void this.store.deleteBookmark(postId);
  }

  // ── UC-5.6r/5.6w/5.5b 公告 + 置顶交互件（C007 必配方法 · 便捷 UI 入口 · e2e 走 bridge 直 invoke 覆盖）──
  // postId 取自 row.msgId（消息 server id）·无 server id（未对账乐观行）→ 不发。读族（acceptList/detail）
  // 靠 im:read:result 投影驱动；写族（read/delete/pin）靠 im:post:updated 投影驱动·壳无乐观合成。

  /**
   * UC-5.6r 公告·接受列表（读族）：postId=公告消息 server id（msgId）→ store.announcementAcceptList
   * （invoke im_announcement_accept_list → 出站 post/announcement/acceptList {postId}）。读族透传回灌
   * im:read:result。无 server id → 不发。e2e 走 bridge 直 invoke 注入真实 postId/reqId 覆盖此便捷路径。
   */
  onAnnouncementAcceptList(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    if (!postId) return;
    void this.store.announcementAcceptList(postId);
  }

  /**
   * UC-5.6r 公告·详情（读族）：postIds=[公告消息 server id]（msgId）→ store.announcementDetail（invoke
   * im_announcement_detail → 出站 post/announcement/detail {postIds:[]}）。读族透传回灌 im:read:result。
   * 无 server id → 不发。e2e 走 bridge 直 invoke 注入真实 postIds/reqId 覆盖此便捷路径。
   */
  onAnnouncementDetail(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    if (!postId) return;
    void this.store.announcementDetail([postId]);
  }

  /**
   * UC-5.6w 公告·确认收到（写族 WS post_update echo）：postId=公告消息 server id（msgId）+ channelId=
   * 当前活动频道 → store.announcementRead（invoke im_announcement_read → 出站 post/announcement/read
   * {postId, channelId}）。server echo（im:post:updated）⛔ 当前阻于 cses-java·① 出站可真跑。无 server
   * id / 无活动频道 → 不发。e2e 走 bridge 直 invoke 注入真实 postId/channelId 覆盖此便捷路径。
   */
  onAnnouncementRead(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    const channelId = this.store.activeChannel();
    if (!postId || !channelId) return;
    void this.store.announcementRead(postId, channelId);
  }

  /**
   * UC-5.6w 公告·删除（写族 WS post_update echo）：postIds=[公告消息 server id]（msgId）→
   * store.announcementDelete（invoke im_announcement_delete → 出站 post/announcement/delete {postIds,
   * postId} 两字段同值数组）。server echo ⛔ 当前阻于 cses-java·① 出站可真跑。无 server id → 不发。
   * e2e 走 bridge 直 invoke 注入真实 postIds 覆盖此便捷路径。
   */
  onAnnouncementDelete(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    if (!postId) return;
    void this.store.announcementDelete([postId]);
  }

  /**
   * UC-5.5b 消息置顶（写族 WS post_pin echo）：channelId=当前活动频道·postId=被置顶消息 server id
   * （msgId）→ store.pinMessage（invoke im_post_pin → 出站 channel/add/postPinned {channelId, postId}）。
   * WS 回 post_pin → im:post:updated（pinned 态）→ DOM data-pinned。⛔ ②③④ 当前阻于 cses-java·① 出站经
   * cses-im-server 可真跑。无 server id（未对账乐观行）/ 无活动频道 → 不发。pinned 态靠投影驱动·壳纯渲染·
   * 无乐观合成。e2e 走 bridge 直 invoke 注入真实 channelId/postId 覆盖此便捷路径。
   */
  onPinMessage(row: MessageRow): void {
    const channelId = this.store.activeChannel();
    const postId = (row.msgId ?? "").trim();
    if (!channelId || !postId) return;
    void this.store.pinMessage(channelId, postId);
  }

  // ── UC-8.x 投票 CRUD 交互件（C007 必配方法 · composer 输入提供业务参数）─────
  // 投票卡 id 取自 row.vote（emit_post_updated props.vote 透传的卡 id）·缺则取 row.msgId（消息 server id）。
  // 写族（create/do/close/delete）fire-and-forget 无乐观合成；读族（read）靠 im:read:result 投影驱动。

  /** UC-8.x 投票·发起：composer 输入 `标题|选项A,选项B`，空/不足两项不发。 */
  onCreateVote(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    if (!postId) return;
    const draft = this.draft.trim();
    const [rawTitle, rawOptions = ""] = draft.split("|");
    const title = rawTitle.trim();
    const options = rawOptions
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (!title || options.length < 2) return;
    this.draft = "";
    void this.store.createVote({
      title,
      content: row.text,
      options,
      isReal: false,
      votes: 1,
    });
  }

  /** UC-8.x 投票·提交：对投票卡（id=row.vote||msgId）提交所选项 indexes。
   *  当前按钮提交第一个选项；完整选项选择控件在 UI/UX 拆分阶段补齐。 */
  onSubmitVote(row: MessageRow): void {
    const id = (row.vote ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.submitVote(id, ["0"], (row.msgId ?? "").trim() || undefined);
  }

  /** UC-8.x 投票·读详情（读族）：读投票卡详情（id=row.vote||msgId）→ im:read:result 回灌。 */
  onReadVote(row: MessageRow): void {
    const id = (row.vote ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.readVote(id);
  }

  /** UC-8.x 投票·截止：截止投票卡（id=row.vote||msgId）。 */
  onCloseVote(row: MessageRow): void {
    const id = (row.vote ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.closeVote(id);
  }

  /** UC-8.x 投票·删除：删除投票卡（id=row.vote||msgId）。 */
  onDeleteVote(row: MessageRow): void {
    const id = (row.vote ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.deleteVote(id);
  }

  // ── UC-8.x 平均分 CRUD 交互件（C007 必配方法 · composer 输入提供业务参数）─────
  // 平均分卡 id 取自 row.average（emit_post_updated props.average 透传的卡 id）·缺则取 row.msgId（消息 server id）。
  // 写族（publish/attend/close/delete）fire-and-forget 无乐观合成；读族（read）靠 im:read:result 投影驱动。

  /** UC-8.x 平均分·发布：composer 输入标题，空则不发。 */
  onPublishAverage(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    if (!postId) return;
    const title = this.draft.trim();
    if (!title) return;
    this.draft = "";
    void this.store.publishAverage({
      title,
      content: row.text,
      maxScore: 100,
      minScore: 0,
      isDelMaxMin: false,
      isAnonymous: false,
      cutoff: "",
      members: [],
    });
  }

  /** UC-8.x 平均分·提交评分：composer 输入数字分值，非法则不发。 */
  onAttendAverage(row: MessageRow): void {
    const id = (row.average ?? row.msgId ?? "").trim();
    if (!id) return;
    const score = Number(this.draft.trim());
    if (!Number.isFinite(score)) return;
    this.draft = "";
    void this.store.attendAverage(id, score, (row.msgId ?? "").trim() || undefined);
  }

  /** UC-8.x 平均分·读详情（读族）：读平均分卡详情（id=row.average||msgId）→ im:read:result 回灌。 */
  onReadAverage(row: MessageRow): void {
    const id = (row.average ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.readAverage(id);
  }

  /** UC-8.x 平均分·截止：截止平均分卡（id=row.average||msgId）。 */
  onCloseAverage(row: MessageRow): void {
    const id = (row.average ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.closeAverage(id, (row.msgId ?? "").trim() || undefined);
  }

  /** UC-8.x 平均分·删除：删除平均分卡（id=row.average||msgId）。 */
  onDeleteAverage(row: MessageRow): void {
    const id = (row.average ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.deleteAverage(id);
  }
}

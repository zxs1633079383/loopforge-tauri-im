import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ImStoreService } from "./im/im-store.service";
import { MessageRow } from "./im/message-row.model";

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
 * 交互件方法当前多为**占位骨架**（仅保证模板编译 + 事件挂载位就绪），
 * 真实 invoke 由各 UC issue（#7-#45）逐个接通。已绿的 onSend/onSendDocument 走真实 store 流。
 */
@Component({
  selector: "app-root",
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="im"
      [attr.data-ready]="store.ready()"
      [attr.data-active-channel]="store.activeChannel()"
      [attr.data-health]="store.health() || null"
    >
      <!-- ═══ H 状态指示区 ═══ -->
      <header class="im__hd" data-testid="status-bar">
        <span>LoopForge IM</span>
        <span class="im__ready" [attr.data-ready]="store.ready()">
          {{ store.ready() ? "ready" : "loading…" }}
        </span>
        <button
          class="im__mini"
          type="button"
          data-testid="health-btn"
          (click)="onHealth()"
        >health</button>
        <button
          class="im__mini"
          type="button"
          data-testid="read-channel-btn"
          [disabled]="!store.activeChannel()"
          (click)="onReadChannel()"
        >已读</button>
      </header>

      <div class="im__body">
        <!-- ═══ CL 频道列表区 ═══ -->
        <aside class="im__col im__channels" data-testid="channel-list">
          <div class="im__col-hd">
            <span>频道</span>
            <button
              class="im__mini"
              type="button"
              data-testid="create-channel-btn"
              (click)="onCreateChannel()"
            >+群</button>
            <button
              class="im__mini"
              type="button"
              data-testid="query-channel-btn"
              (click)="onQueryChannels()"
            >查</button>
            <button
              class="im__mini"
              type="button"
              data-testid="online-status-btn"
              (click)="onOnlineStatus()"
            >在线</button>
            <button
              class="im__mini"
              type="button"
              data-testid="modules-get-all-btn"
              (click)="onModulesGetAll()"
            >模块</button>
            <button
              class="im__mini"
              type="button"
              data-testid="announcement-list-btn"
              (click)="onAnnouncementList()"
            >公告列</button>
            <button
              class="im__mini"
              type="button"
              data-testid="announcement-save-btn"
              (click)="onAnnouncementSave()"
            >存公告</button>
            <button
              class="im__mini"
              type="button"
              data-testid="sync-channels-btn"
              (click)="onSyncChannels()"
            >同步</button>
            <button
              class="im__mini"
              type="button"
              data-testid="team-upsert-btn"
              (click)="onTeamUpsert()"
            >团队</button>
          </div>
          @for (c of store.channels(); track c.channelId) {
            <div
              class="ch"
              [class.ch--active]="c.channelId === store.activeChannel()"
              [attr.data-channel-id]="c.channelId"
              [attr.data-channel-type]="c.channelType ?? null"
              [attr.data-channel-display-name]="c.displayName ?? null"
              [attr.data-channel-notice]="c.notice ?? null"
              [attr.data-channel-top]="c.top ? '1' : null"
              [attr.data-unread]="c.unread ?? null"
              [attr.data-has-schedule-post]="c.hasSchedule ? 'true' : null"
              [attr.data-active-channel]="
                c.channelId === store.activeChannel() ? '1' : null
              "
              (click)="onSelectChannel(c.channelId)"
            >
              <span class="ch__name">{{ c.displayName || c.channelId }}</span>
              <span class="ch__ops">
                <input
                  class="im__mini-input"
                  type="text"
                  data-testid="change-channel-name-input"
                  placeholder="新群名"
                  #chNameInput
                  (click)="$event.stopPropagation()"
                />
                <button
                  class="im__mini"
                  type="button"
                  data-testid="change-channel-btn"
                  (click)="
                    $event.stopPropagation();
                    onChangeChannel(c, 'displayName', chNameInput.value)
                  "
                >改名</button>
                <input
                  class="im__mini-input"
                  type="text"
                  data-testid="change-channel-notice-input"
                  placeholder="公告"
                  #chNoticeInput
                  (click)="$event.stopPropagation()"
                />
                <button
                  class="im__mini"
                  type="button"
                  data-testid="change-channel-notice-btn"
                  (click)="
                    $event.stopPropagation();
                    onChangeChannel(c, 'notice', chNoticeInput.value)
                  "
                >公告</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="change-channel-top-btn"
                  (click)="
                    $event.stopPropagation();
                    onChangeChannel(c, 'top', c.top ? '0' : '1')
                  "
                >{{ c.top ? '取消置顶' : '置顶' }}</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="close-channel-btn"
                  (click)="onCloseChannel(c)"
                >×</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="team-quit-btn"
                  (click)="onTeamQuit(c)"
                >退</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="ensure-channel-loaded-btn"
                  (click)="$event.stopPropagation(); onEnsureChannelLoaded(c)"
                >兜底</button>
              </span>
            </div>
          }
        </aside>

        <!-- ═══ ML 消息列表区（现状已绿·形态禁改·加法式扩待加 data-*）═══ -->
        <section class="im__col im__list" data-testid="msg-list">
          <button
            class="im__mini im__load-older"
            type="button"
            data-testid="load-older-btn"
            [disabled]="!store.activeChannel()"
            (click)="onLoadOlder()"
          >↑ 更早</button>
          @for (m of store.rows(); track m.temporaryId) {
            <div
              class="msg"
              [class.msg--sending]="m.sendStatus === 'sending'"
              [class.msg--failed]="m.sendStatus === 'failed'"
              [class.msg--revoked]="m.revoked"
              [class.msg--highlighted]="m.highlighted"
              [attr.data-msg-id]="m.msgId"
              [attr.data-temporary-id]="m.temporaryId"
              [attr.data-channel-id]="m.channelId"
              [attr.data-event-seq]="m.eventSeq === null ? '' : m.eventSeq"
              [attr.data-send-status]="m.sendStatus"
              [attr.data-read-bits]="m.readBits"
              [attr.data-revoke]="m.revoked ? '1' : null"
              [attr.data-highlighted]="m.highlighted ? 'true' : null"
              [attr.data-type]="m.type"
              [attr.data-urgent]="m.urgent ? '1' : null"
              [attr.data-reactions]="m.reactions ?? null"
              [attr.data-template-received]="m.templateReceived ? '1' : null"
              [attr.data-reply-id]="m.replyId ?? null"
              [attr.data-pinned]="m.pinned ? '1' : null"
              [attr.data-system-notice]="m.systemNotice ? '1' : null"
              [attr.data-vote]="m.vote ?? null"
              [attr.data-average]="m.average ?? null"
            >
              <span class="msg__text">{{ m.text }}</span>
              <span class="msg__ops">
                <button
                  class="im__mini"
                  type="button"
                  data-testid="revoke-btn"
                  (click)="onRevoke(m)"
                >撤</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="read-post-btn"
                  (click)="onPostRead(m)"
                >读</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="template-received-btn"
                  (click)="onTemplateReceived(m)"
                >收</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="quick-reply-btn"
                  (click)="onQuickReply(m, '👍')"
                >👍</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="forward-btn"
                  (click)="onForward(m, [])"
                >转</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="make-topic-btn"
                  (click)="onMakeTopic(m)"
                >话题</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="urgent-btn"
                  (click)="onUrgentPost(m)"
                >急</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="urgent-confirm-btn"
                  (click)="onUrgentConfirm(m)"
                >确</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="locate-btn"
                  data-role="locate-post"
                  (click)="onLocate(m)"
                >定位</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="reply-drawer-btn"
                  data-role="open-reply-drawer"
                  (click)="onLoadReplies(m)"
                >回</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="reply-branch-btn"
                  data-role="open-reply-branch"
                  (click)="onLoadReplyBranch(m)"
                >支</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="bookmark-create-btn"
                  (click)="onCreateBookmark(m)"
                >藏</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="bookmark-delete-btn"
                  (click)="onDeleteBookmark(m)"
                >弃藏</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="post-pin-btn"
                  (click)="onPinMessage(m)"
                >顶</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="announcement-accept-list-btn"
                  (click)="onAnnouncementAcceptList(m)"
                >受</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="announcement-detail-btn"
                  (click)="onAnnouncementDetail(m)"
                >详公</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="announcement-read-btn"
                  (click)="onAnnouncementRead(m)"
                >阅公</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="announcement-delete-btn"
                  (click)="onAnnouncementDelete(m)"
                >删公</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="vote-create-btn"
                  (click)="onCreateVote(m)"
                >投</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="vote-do-btn"
                  (click)="onSubmitVote(m)"
                >选</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="vote-read-btn"
                  (click)="onReadVote(m)"
                >看</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="vote-close-btn"
                  (click)="onCloseVote(m)"
                >截</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="vote-delete-btn"
                  (click)="onDeleteVote(m)"
                >删投</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="average-publish-btn"
                  (click)="onPublishAverage(m)"
                >评</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="average-attend-btn"
                  (click)="onAttendAverage(m)"
                >打分</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="average-read-btn"
                  (click)="onReadAverage(m)"
                >看分</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="average-close-btn"
                  (click)="onCloseAverage(m)"
                >截分</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="average-delete-btn"
                  (click)="onDeleteAverage(m)"
                >删分</button>
                @if (m.sendStatus === "failed") {
                  <button
                    class="im__mini"
                    type="button"
                    data-testid="resend-btn"
                    (click)="onResend(m)"
                  >重发</button>
                }
              </span>
            </div>
          }
        </section>

        <!-- ═══ MB 成员区 ═══ -->
        <aside
          class="im__col im__members"
          data-testid="member-list"
          [attr.data-member-count]="store.members().length"
          [attr.data-members]="store.membersAttr() || null"
        >
          <div class="im__col-hd">
            <span>成员</span>
            <button
              class="im__mini"
              type="button"
              data-testid="load-members-btn"
              (click)="onLoadMembers()"
            >载</button>
            <input
              class="im__mini-input"
              type="text"
              data-testid="change-member-input"
              placeholder="成员id"
              #memChangeInput
            />
            <button
              class="im__mini"
              type="button"
              data-testid="change-member-btn"
              (click)="onChangeMember('join', memChangeInput.value)"
            >拉</button>
            <button
              class="im__mini"
              type="button"
              data-testid="kick-member-btn"
              (click)="onChangeMember('leave', memChangeInput.value)"
            >踢</button>
          </div>
          @for (mem of store.members(); track mem.memberId) {
            <div
              class="mem"
              [attr.data-member-id]="mem.memberId"
              [attr.data-admin]="mem.admin ? '1' : null"
              [attr.data-nickname]="mem.nickname ?? null"
            >
              <span class="mem__name">{{ mem.nickname || mem.memberId }}</span>
              <span class="mem__ops">
                <input
                  class="im__mini-input"
                  type="text"
                  data-testid="change-nickname-input"
                  placeholder="昵称"
                  #memNickInput
                  (click)="$event.stopPropagation()"
                />
                <button
                  class="im__mini"
                  type="button"
                  data-testid="change-nickname-btn"
                  (click)="
                    $event.stopPropagation();
                    onChangeNickname(mem.memberId, memNickInput.value)
                  "
                >名</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="change-manger-btn"
                  (click)="onChangeManger(mem.memberId, !mem.admin)"
                >管</button>
              </span>
            </div>
          }
        </aside>
      </div>

      <!-- ═══ AX 辅助区（抽屉显隐·按 UC 填）═══ -->
      <section class="im__aux" data-testid="aux-area">
        <div
          class="im__panel"
          data-testid="bookmark-panel"
          [attr.data-bookmark]="store.bookmarks().length"
        >
          <button
            class="im__mini"
            type="button"
            data-testid="bookmark-btn"
            (click)="onBookmark()"
          >书签</button>
          @for (b of store.bookmarks(); track b.bookmarkId) {
            <span class="aux-chip" [attr.data-bookmark-id]="b.bookmarkId"></span>
          }
        </div>
        <div class="im__panel" data-testid="todo-panel">
          @for (t of store.todos(); track t.todoId) {
            <span
              class="aux-chip"
              [attr.data-todo-id]="t.todoId"
              [attr.data-todo-type]="t.todoType ?? null"
              [attr.data-todo-can-del]="t.canDel ? '1' : null"
            ></span>
          }
        </div>
        <div class="im__panel" data-testid="reply-drawer">
          @for (r of store.replies(); track r.replyId) {
            <span class="aux-chip" [attr.data-reply-id]="r.replyId"></span>
          }
        </div>
      </section>

      <!-- ═══ CP composer ═══ -->
      <footer class="im__compose">
        <input
          class="im__input"
          type="text"
          data-testid="compose-input"
          data-role="composer-input"
          placeholder="输入消息…"
          [(ngModel)]="draft"
          (keydown.enter)="onSend()"
        />
        <button
          class="im__send"
          type="button"
          data-testid="send-btn"
          [disabled]="!store.activeChannel()"
          (click)="onSend()"
        >发送</button>
        <button
          class="im__send"
          type="button"
          data-testid="send-document-btn"
          [disabled]="!store.activeChannel()"
          (click)="onSendDocument()"
        >文档</button>
        <button
          class="im__send"
          type="button"
          data-testid="send-urgent-btn"
          [disabled]="!store.activeChannel()"
          (click)="onSendUrgent()"
        >加急</button>
        <button
          class="im__mini"
          type="button"
          data-testid="schedule-btn"
          [disabled]="!store.activeChannel()"
          (click)="onSchedule()"
        >定时</button>
        <button
          class="im__mini"
          type="button"
          data-testid="cancel-schedule-btn"
          [disabled]="!store.activeChannel()"
          (click)="onCancelSchedule()"
        >取消定时</button>
        <button
          class="im__mini"
          type="button"
          data-testid="read-channel-btn"
          [disabled]="!store.activeChannel()"
          (click)="onReadChannel()"
        >会话已读</button>
      </footer>
    </main>
  `,
  styles: [
    `
      .im { display: flex; flex-direction: column; height: 100vh; }
      .im__hd {
        display: flex; gap: 12px; justify-content: flex-start; align-items: center;
        padding: 8px 12px; background: #1d1d22; border-bottom: 1px solid #2a2a30;
        font-weight: 600;
      }
      .im__ready { font-size: 12px; opacity: 0.6; font-weight: 400; }
      .im__ready[data-ready="true"] { color: #5ad27a; opacity: 1; }
      .im__body { flex: 1; display: flex; min-height: 0; }
      .im__col { overflow-y: auto; }
      .im__channels { width: 180px; border-right: 1px solid #2a2a30; padding: 4px; }
      .im__members { width: 160px; border-left: 1px solid #2a2a30; padding: 4px; }
      .im__list { flex: 1; padding: 8px 12px; }
      .im__col-hd {
        display: flex; gap: 4px; align-items: center; flex-wrap: wrap;
        font-size: 12px; opacity: 0.7; margin-bottom: 6px;
      }
      .ch, .mem {
        display: flex; justify-content: space-between; align-items: center;
        padding: 4px 6px; border-radius: 6px; cursor: pointer; font-size: 13px;
      }
      .ch--active { background: #2a3550; }
      .ch__ops, .mem__ops, .msg__ops { display: inline-flex; gap: 2px; }
      .msg {
        margin: 4px 0; padding: 6px 10px; border-radius: 8px;
        background: #23232a; max-width: 70%; word-break: break-word;
        white-space: pre-wrap; display: flex; gap: 6px; align-items: center;
      }
      .msg--sending { opacity: 0.55; }
      .msg--failed { background: #3a1d1d; color: #ff9b9b; }
      .msg--revoked { opacity: 0.4; font-style: italic; text-decoration: line-through; }
      .im__aux {
        display: flex; gap: 8px; padding: 4px 12px;
        border-top: 1px solid #2a2a30; background: #18181c; min-height: 0;
      }
      .im__panel { display: inline-flex; gap: 4px; align-items: center; }
      .aux-chip { width: 8px; height: 8px; border-radius: 50%; background: #3b6ef5; }
      .im__load-older { display: block; margin: 0 auto 8px; }
      .im__compose {
        display: flex; gap: 8px; padding: 8px 12px; flex-wrap: wrap;
        border-top: 1px solid #2a2a30; background: #1d1d22;
      }
      .im__input {
        flex: 1; min-width: 120px; padding: 8px 10px; border-radius: 6px;
        border: 1px solid #2a2a30; background: #141417; color: #eee;
      }
      .im__send {
        padding: 8px 16px; border-radius: 6px; border: none;
        background: #3b6ef5; color: #fff; cursor: pointer; font-weight: 600;
      }
      .im__send:active { background: #2f59c9; }
      .im__send:disabled, .im__mini:disabled { opacity: 0.4; cursor: not-allowed; }
      .im__mini {
        padding: 2px 6px; border-radius: 4px; border: 1px solid #2a2a30;
        background: #23232a; color: #ccc; cursor: pointer; font-size: 11px;
      }
      .im__mini:active { background: #2f59c9; }
      .im__mini-input {
        width: 56px; padding: 2px 4px; border-radius: 4px;
        border: 1px solid #2a2a30; background: #1a1a1f; color: #ccc; font-size: 11px;
      }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  readonly store = inject(ImStoreService);

  // 活动频道不再硬编码：由 store.activeChannel() 提供（stream 第一个真实频道胜出，含 increment）。
  // demo-channel 非合法 26 位频道 id，helix parse 会拒（missing/invalid channel_id）。

  draft = "";

  ngOnInit(): void {
    void this.store.start();
    // UC-1.4 测试机件：debug/test 桥注入失败态注入器（仅 Tauri 环境·release 无 webdriver 不暴露 set_uc）。
    // 复用 store.markSendFailed 生产路径——复现真 invoke 抛错的 DOM 失败态（非合成任意态）。
    // 架构现实：im_send 入泵即返 Ok（不 await HTTP）→ 健康 live run 不会自然产生 failed 行；
    // 重发前置须注入一个失败态，故 e2e 经此桥把已上屏的乐观行标 failed 再点重发。
    if (
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in window &&
      window.__lf
    ) {
      window.__lf.debugMarkFailed = (temporaryId: string) =>
        this.store.markSendFailed(temporaryId);
      // UC-2.3 定位测试机件：读族纯本地无 Rust 命令，经此桥复用 store.locatePost 生产路径
      // （拉首屏 query_result ②④ + 给命中行打高亮 ③）。
      window.__lf.debugLocatePost = (postId: string, channelId?: string) =>
        this.store.locatePost(postId, channelId);
      // UC-6.2 设/撤管理员测试机件：复用 store.setManger 生产路径（① 出站 channel/add|remove/manger +
      // ③ DOM data-admin 乐观刷）。e2e 经此桥走与 UI『管』按钮同款 store 路径（非绕过·一次覆 ①③）。
      window.__lf.debugSetManger = (
        channelId: string,
        userId: string,
        set: boolean,
      ) => this.store.setManger(channelId, userId, set);
    }
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
    // 文档内容：草稿非空取草稿，否则给个默认 doc 文本（UC-1.2 验 type=DOCUMENT 透传）。
    const text = this.draft.trim() || `doc-${Math.random().toString(36).slice(2, 8)}`;
    this.draft = "";
    void this.store.sendDocument(channelId, text);
  }

  // ═══ CP 待接通交互件（占位骨架 · C007 必配方法 · 各 UC issue 接真实 invoke）═══
  // 这些方法当前**只占位**（保证模板编译 + 事件挂载位就绪），真实 invoke 由对应 UC issue 实现。
  // 占位实现：no-op（不在壳合成业务），仅消费参数避免 unused 告警。

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

  /** UC-1.10 定时消息：channelId=当前活动频道·message=草稿（空则给默认定时文本）·
   *  schedulePostAt=当前 + 1 小时（毫秒）→ store.createSchedule（body 嵌套 post 由 Rust/helix 拼·
   *  壳不臆造）。hasSchedule 由 helix `im:channel:schedule-created` 投影驱动 data-has-schedule-post·
   *  壳纯渲染·无乐观合成。e2e 走 bridge 直 invoke 注入真实参数覆盖此 UI 便捷路径。 */
  onSchedule(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    const message =
      this.draft.trim() || `lf-schedule-${Math.random().toString(36).slice(2, 8)}`;
    this.draft = "";
    const schedulePostAt = Date.now() + 3600 * 1000;
    void this.store.createSchedule(channelId, message, schedulePostAt);
  }

  /** UC-1.10 取消定时。占位 → 接 posts/cancelSchedule。 */
  onCancelSchedule(): void {
    /* UC-1.10 接通 */
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
    const displayName = `lf-grp-${Math.random().toString(36).slice(2, 8)}`;
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
   * 出站 post/announcement/save·camelCase Post·壳后端补 userId）。type=TEXT 占位·message=占位公告正文。
   * server echo（im:post:updated）⛔ 当前阻于后端 WS 业务广播链(切 cses-im-server 后待复验)·① 出站经 cses-im-server 可真跑。无活动频道 → 不发。
   * e2e 走 bridge 直 invoke 注入真实 channelId/type/message 覆盖此便捷路径。
   */
  onAnnouncementSave(): void {
    const channelId = this.store.activeChannel();
    if (!channelId) return;
    const message = `announcement-${Math.random().toString(36).slice(2, 8)}`;
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
    const displayName = `lf-team-${Math.random().toString(36).slice(2, 8)}`;
    const memberIds = this.store.members().map((m) => m.memberId).filter(Boolean);
    void this.store.teamUpsert(displayName, memberIds);
  }

  // ═══ CL 频道行交互件（占位骨架）═══

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

  // ═══ ML 消息行交互件（占位骨架）═══

  /** UC-1.5 撤回（命令已通·UI 触发件待接）。占位 → 接 im_revoke。 */
  onRevoke(_row: MessageRow): void {
    /* UC-1.5 接通 */
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
    // Post 对象：转发源消息正文 + 新 temporaryId + type（前端从本地行构造·透传给后端在各目标频道
    // 建**新**消息）。**不带源 id**——server PreSave 仅在 id=="" 时生成新 id（entity/post.go:188），
    // 带源 id 会让各目标频道副本复用同一 id → 落库冲突/去重 → 不产生新消息（实测 createPosts 返
    // SUCCESS 但目标频道无新行）。转发是「建新消息」非「引用原消息」，故 posts 元素只携内容不携源 id。
    const posts: Array<Record<string, unknown>> = [
      { message: row.text, temporaryId: this.genForwardTmp(), type: row.type || "TEXT" },
    ];
    void this.store.relayMessages(posts, targets);
  }

  /** 转发用临时 id（z-base-32 26 位·与 store.genTempId 同字符集·让转发 echo 可对账）。 */
  private genForwardTmp(): string {
    const charset = "ybndrfg8ejkmcpqxot1uwisza345h769";
    let s = "";
    for (let i = 0; i < 26; i++) s += charset[Math.floor(Math.random() * 32)];
    return s;
  }

  /** UC-5.2 创建话题（消息转话题）：rootId=消息所在群 channelId·postId=消息 server id →
   *  store.makeTopic（teamId/自身 CREATOR 由 Rust 拼·壳不臆造）。memberIds 取当前成员区已加载
   *  成员（无则空·Rust 自动补自身 CREATOR）。e2e 走 bridge 直 invoke 注入真实 rootId/postId/
   *  memberIds 覆盖此 UI 便捷路径。 */
  onMakeTopic(row: MessageRow): void {
    const rootId = row.channelId;
    const postId = row.msgId;
    if (!rootId || !postId) return; // 无根群 / 无 server id（未对账消息）→ 不发
    const displayName = `lf-topic-${Math.random().toString(36).slice(2, 8)}`;
    const memberIds = this.store.members().map((m) => m.memberId).filter(Boolean);
    void this.store.makeTopic(rootId, postId, displayName, memberIds);
  }

  /** UC-2.3 按 postId 定位：postId=消息 server id + channelId=消息所在群 → store.locatePost
   *  （读族纯本地·定位已加载行打高亮·复用 query_result ②④·新增 ③ DOM data-highlighted）。无 server id
   *  （未对账乐观消息·定位锚须 server postId）→ 不定位。e2e 走 bridge 直 store API / 取已加载行
   *  msg-id 作 target 注入覆盖此 UI 便捷路径。 */
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

  // ═══ MB 成员区交互件（占位骨架）═══

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
   * DOM data-admin 乐观本地刷（add/remove manger 后端 WS 已注释·② 投影 L1 不到达·权威态由 L2 #45
   * 广播帧对账·见 store.setManger doc）。无 memberId / 无活动频道 → 不发。e2e 走 bridge 直 invoke
   * 注入真实 channelId/userId 覆盖此 UI 便捷路径。
   */
  onChangeManger(memberId: string, set: boolean): void {
    const channelId = this.store.activeChannel();
    if (!memberId || !channelId) return;
    void this.store.setManger(channelId, memberId, set);
  }

  // ═══ AX 辅助区交互件（占位骨架）═══

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

  // ── UC-8.x 投票 CRUD 交互件（C007 必配方法 · 便捷 UI 入口 · e2e 走 bridge 直 invoke 覆盖）─────
  // 投票卡 id 取自 row.vote（emit_post_updated props.vote 透传的卡 id）·缺则取 row.msgId（消息 server id）。
  // 写族（create/do/close/delete）fire-and-forget 无乐观合成；读族（read）靠 im:read:result 投影驱动。

  /** UC-8.x 投票·发起：对当前频道发起投票卡（fields=最简 wire 字段集·真源 partials/6 §createVote）。
   *  此便捷入口用占位字段；e2e 走 bridge 直 invoke 注入真实 fields 覆盖。 */
  onCreateVote(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    if (!postId) return;
    void this.store.createVote({
      title: "投票",
      content: "",
      options: ["A", "B"],
      isReal: false,
      votes: 1,
    });
  }

  /** UC-8.x 投票·提交：对投票卡（id=row.vote||msgId）提交所选项 indexes（占位 ["0"]）。
   *  e2e 走 bridge 直 invoke 注入真实 id/indexes 覆盖。 */
  onSubmitVote(row: MessageRow): void {
    const id = (row.vote ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.submitVote(id, ["0"], (row.msgId ?? "").trim() || undefined);
  }

  /** UC-8.x 投票·读详情（读族）：读投票卡详情（id=row.vote||msgId）→ im:read:result 回灌。
   *  e2e 走 bridge 直 invoke 注入真实 id/reqId 覆盖。 */
  onReadVote(row: MessageRow): void {
    const id = (row.vote ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.readVote(id);
  }

  /** UC-8.x 投票·截止：截止投票卡（id=row.vote||msgId）。e2e 走 bridge 直 invoke 覆盖。 */
  onCloseVote(row: MessageRow): void {
    const id = (row.vote ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.closeVote(id);
  }

  /** UC-8.x 投票·删除：删除投票卡（id=row.vote||msgId）。e2e 走 bridge 直 invoke 覆盖。 */
  onDeleteVote(row: MessageRow): void {
    const id = (row.vote ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.deleteVote(id);
  }

  // ── UC-8.x 平均分 CRUD 交互件（C007 必配方法 · 便捷 UI 入口 · e2e 走 bridge 直 invoke 覆盖）─────
  // 平均分卡 id 取自 row.average（emit_post_updated props.average 透传的卡 id）·缺则取 row.msgId（消息 server id）。
  // 写族（publish/attend/close/delete）fire-and-forget 无乐观合成；读族（read）靠 im:read:result 投影驱动。

  /** UC-8.x 平均分·发布：对当前频道发布平均分卡（fields=最简 wire 字段集·真源 partials/6 §average/publish）。
   *  此便捷入口用占位字段；e2e 走 bridge 直 invoke 注入真实 fields 覆盖。 */
  onPublishAverage(row: MessageRow): void {
    const postId = (row.msgId ?? "").trim();
    if (!postId) return;
    void this.store.publishAverage({
      title: "平均分",
      content: "",
      maxScore: 100,
      minScore: 0,
      isDelMaxMin: false,
      isAnonymous: false,
      cutoff: "",
      members: [],
    });
  }

  /** UC-8.x 平均分·提交评分：对平均分卡（id=row.average||msgId）提交分值（占位 60）。
   *  e2e 走 bridge 直 invoke 注入真实 id/score 覆盖。 */
  onAttendAverage(row: MessageRow): void {
    const id = (row.average ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.attendAverage(id, 60, (row.msgId ?? "").trim() || undefined);
  }

  /** UC-8.x 平均分·读详情（读族）：读平均分卡详情（id=row.average||msgId）→ im:read:result 回灌。
   *  e2e 走 bridge 直 invoke 注入真实 id/reqId 覆盖。 */
  onReadAverage(row: MessageRow): void {
    const id = (row.average ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.readAverage(id);
  }

  /** UC-8.x 平均分·截止：截止平均分卡（id=row.average||msgId）。e2e 走 bridge 直 invoke 覆盖。 */
  onCloseAverage(row: MessageRow): void {
    const id = (row.average ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.closeAverage(id, (row.msgId ?? "").trim() || undefined);
  }

  /** UC-8.x 平均分·删除：删除平均分卡（id=row.average||msgId）。e2e 走 bridge 直 invoke 覆盖。 */
  onDeleteAverage(row: MessageRow): void {
    const id = (row.average ?? row.msgId ?? "").trim();
    if (!id) return;
    void this.store.deleteAverage(id);
  }
}

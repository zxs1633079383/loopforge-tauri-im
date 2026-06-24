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
              [attr.data-has-schedule]="c.hasSchedule ? '1' : null"
              [attr.data-active-channel]="
                c.channelId === store.activeChannel() ? '1' : null
              "
              (click)="onSelectChannel(c.channelId)"
            >
              <span class="ch__name">{{ c.displayName || c.channelId }}</span>
              <span class="ch__ops">
                <button
                  class="im__mini"
                  type="button"
                  data-testid="change-channel-btn"
                  (click)="onChangeChannel(c, 'displayName', '')"
                >改</button>
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
              [attr.data-msg-id]="m.msgId"
              [attr.data-temporary-id]="m.temporaryId"
              [attr.data-channel-id]="m.channelId"
              [attr.data-event-seq]="m.eventSeq === null ? '' : m.eventSeq"
              [attr.data-send-status]="m.sendStatus"
              [attr.data-read-bits]="m.readBits"
              [attr.data-revoke]="m.revoked ? '1' : null"
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
                  data-testid="reply-drawer-btn"
                  (click)="onLoadReplies(m)"
                >回</button>
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
            <button
              class="im__mini"
              type="button"
              data-testid="change-member-btn"
              (click)="onChangeMember('join')"
            >拉</button>
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
                <button
                  class="im__mini"
                  type="button"
                  data-testid="change-nickname-btn"
                  (click)="onChangeNickname(mem.memberId, '')"
                >名</button>
                <button
                  class="im__mini"
                  type="button"
                  data-testid="change-manger-btn"
                  (click)="onChangeManger(mem.memberId, 'ADMIN')"
                >管</button>
              </span>
            </div>
          }
        </aside>
      </div>

      <!-- ═══ AX 辅助区（抽屉显隐·按 UC 填）═══ -->
      <section class="im__aux" data-testid="aux-area">
        <div class="im__panel" data-testid="bookmark-panel">
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

  /** UC-1.9 加急。占位 → 接 posts/urgentPost。 */
  onSendUrgent(): void {
    /* UC-1.9 接通 */
  }

  /** UC-1.10 定时消息。占位 → 接 posts/createSchedule。 */
  onSchedule(): void {
    /* UC-1.10 接通 */
  }

  /** UC-1.10 取消定时。占位 → 接 posts/cancelSchedule。 */
  onCancelSchedule(): void {
    /* UC-1.10 接通 */
  }

  /** UC-3.1 会话已读。占位 → 接 im_read_channel。 */
  onReadChannel(): void {
    /* UC-3.1 接通 */
  }

  /** UC-12.1 健康探针。占位 → 接 im_health → GET /health。 */
  onHealth(): void {
    /* UC-12.1 接通 */
  }

  /** UC-5.1 创建群聊。占位 → 接 im_create_channel。 */
  onCreateChannel(): void {
    /* UC-5.1 接通 */
  }

  /** UC-5.8 条件查频道。占位 → 接 im_query_channels。 */
  onQueryChannels(): void {
    /* UC-5.8 接通 */
  }

  /** UC-4.2 按需 sync。占位 → 接增量 sync notify。 */
  onSyncChannels(): void {
    /* UC-4.2 接通 */
  }

  /** UC-11.1 维护公司大群。占位 → 接 im_team_upsert。 */
  onTeamUpsert(): void {
    /* UC-11.1 接通 */
  }

  // ═══ CL 频道行交互件（占位骨架）═══

  /** UC-2.1 切群首屏。占位 → 接 onSelectChannel → 加载该频道首屏。 */
  onSelectChannel(_channelId: string): void {
    /* UC-2.1 接通 */
  }

  /** UC-5.4 群属性修改。占位 → 接 channel/change/*。 */
  onChangeChannel(_channel: unknown, _field: string, _value: string): void {
    /* UC-5.4 接通 */
  }

  /** UC-5.3 关闭/退出群。占位 → 接 im_channel_close。 */
  onCloseChannel(_channel: unknown): void {
    /* UC-5.3 接通 */
  }

  /** UC-11.2 退出公司。占位 → 接 im_team_quit。 */
  onTeamQuit(_channel: unknown): void {
    /* UC-11.2 接通 */
  }

  // ═══ ML 消息行交互件（占位骨架）═══

  /** UC-1.5 撤回（命令已通·UI 触发件待接）。占位 → 接 im_revoke。 */
  onRevoke(_row: MessageRow): void {
    /* UC-1.5 接通 */
  }

  /** UC-3.2 单条已读。占位 → 接 im_post_read。 */
  onPostRead(_row: MessageRow): void {
    /* UC-3.2 接通 */
  }

  /** UC-3.3 模板已收到。占位 → 接 templateReceived。 */
  onTemplateReceived(_row: MessageRow): void {
    /* UC-3.3 接通 */
  }

  /** UC-1.8 快捷回复 emoji。占位 → 接 posts/quickReply。 */
  onQuickReply(_row: MessageRow, _emoji: string): void {
    /* UC-1.8 接通 */
  }

  /** UC-1.7 转发/合并。占位 → 接 im_create_posts。 */
  onForward(_row: MessageRow, _targetChannels: string[]): void {
    /* UC-1.7 接通 */
  }

  /** UC-5.2 创建话题（rootId=postId）。占位 → 接 im_make_topic。 */
  onMakeTopic(_row: MessageRow): void {
    /* UC-5.2 接通 */
  }

  /** UC-2.4 加载回复链。占位 → 接读族 getReplies。 */
  onLoadReplies(_row: MessageRow): void {
    /* UC-2.4 接通 */
  }

  /** UC-1.4 重发失败。占位 → 接 im_send 复用 temp_id。 */
  onResend(_row: MessageRow): void {
    /* UC-1.4 接通 */
  }

  /** UC-2.2 上拉更早历史。占位 → 接 im_load_older_context。 */
  onLoadOlder(): void {
    /* UC-2.2 接通 */
  }

  // ═══ MB 成员区交互件（占位骨架）═══

  /** UC-6.4 成员快照/全量。占位 → 接成员快照投影。 */
  onLoadMembers(): void {
    /* UC-6.4 接通 */
  }

  /** UC-6.1 拉/踢人。占位 → 接 add/remove member。 */
  onChangeMember(_action: string): void {
    /* UC-6.1 接通 */
  }

  /** UC-6.3 改群昵称。占位 → 接 member/change nickName。 */
  onChangeNickname(_memberId: string, _nick: string): void {
    /* UC-6.3 接通 */
  }

  /** UC-6.2 设/撤管理员。占位 → 接 add/remove manger。 */
  onChangeManger(_memberId: string, _role: string): void {
    /* UC-6.2 接通 */
  }

  // ═══ AX 辅助区交互件（占位骨架）═══

  /** UC-9.x 书签。占位 → 接读族书签 load。 */
  onBookmark(): void {
    /* UC-9.x 接通 */
  }
}

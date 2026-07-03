import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import { MessageRow } from "../message-row.model";
import { authorName, avatarColor, avatarInitial, shortTime } from "./im-ui-format";

@Component({
  selector: "app-im-message-list",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="im__col im__list" data-testid="msg-list">
      <button
        class="im__mini im__load-older"
        type="button"
        data-testid="load-older-btn"
        [disabled]="!activeChannel"
        (click)="loadOlderClick.emit()"
      >↑ 更早</button>
      @for (m of rows; track m.temporaryId) {
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
          <div
            class="msg__avatar"
            [style.background]="avatarColor(m.userId || currentUserId)"
            [attr.data-user-id]="m.userId ?? null"
          >{{ avatarInitial(m.userId || currentUserId) }}</div>
          <div class="msg__body">
            <div class="msg__head">
              <span class="msg__author">{{ authorName(m.userId, currentUserId) }}</span>
              <span class="msg__time">{{ shortTime(m.createAt) }}</span>
            </div>
            <span class="msg__text">{{ m.text }}</span>
            <span class="msg__ops">
              <button class="im__mini" type="button" data-testid="revoke-btn" (click)="revokeClick.emit(m)">撤</button>
              <button class="im__mini" type="button" data-testid="read-post-btn" (click)="postReadClick.emit(m)">读</button>
              <button class="im__mini" type="button" data-testid="template-received-btn" (click)="templateReceivedClick.emit(m)">收</button>
              <button class="im__mini" type="button" data-testid="quick-reply-btn" (click)="quickReplyClick.emit({ row: m, emoji: '👍' })">👍</button>
              <button class="im__mini" type="button" data-testid="forward-btn" (click)="forwardClick.emit({ row: m, targetChannels: [] })">转</button>
              <button class="im__mini" type="button" data-testid="make-topic-btn" (click)="makeTopicClick.emit(m)">话题</button>
              <button class="im__mini" type="button" data-testid="urgent-btn" (click)="urgentPostClick.emit(m)">急</button>
              <button class="im__mini" type="button" data-testid="urgent-confirm-btn" (click)="urgentConfirmClick.emit(m)">确</button>
              <button class="im__mini" type="button" data-testid="locate-btn" data-role="locate-post" (click)="locateClick.emit(m)">定位</button>
              <button class="im__mini" type="button" data-testid="reply-drawer-btn" data-role="open-reply-drawer" (click)="loadRepliesClick.emit(m)">回</button>
              <button class="im__mini" type="button" data-testid="reply-branch-btn" data-role="open-reply-branch" (click)="loadReplyBranchClick.emit(m)">支</button>
              <button class="im__mini" type="button" data-testid="bookmark-create-btn" (click)="bookmarkCreateClick.emit(m)">藏</button>
              <button class="im__mini" type="button" data-testid="bookmark-delete-btn" (click)="bookmarkDeleteClick.emit(m)">弃藏</button>
              <button class="im__mini" type="button" data-testid="post-pin-btn" (click)="postPinClick.emit(m)">顶</button>
              <button class="im__mini" type="button" data-testid="announcement-accept-list-btn" (click)="announcementAcceptListClick.emit(m)">受</button>
              <button class="im__mini" type="button" data-testid="announcement-detail-btn" (click)="announcementDetailClick.emit(m)">详公</button>
              <button class="im__mini" type="button" data-testid="announcement-read-btn" (click)="announcementReadClick.emit(m)">阅公</button>
              <button class="im__mini" type="button" data-testid="announcement-delete-btn" (click)="announcementDeleteClick.emit(m)">删公</button>
              <button class="im__mini" type="button" data-testid="vote-create-btn" (click)="voteCreateClick.emit(m)">投</button>
              <button class="im__mini" type="button" data-testid="vote-do-btn" (click)="voteSubmitClick.emit(m)">选</button>
              <button class="im__mini" type="button" data-testid="vote-read-btn" (click)="voteReadClick.emit(m)">看</button>
              <button class="im__mini" type="button" data-testid="vote-close-btn" (click)="voteCloseClick.emit(m)">截</button>
              <button class="im__mini" type="button" data-testid="vote-delete-btn" (click)="voteDeleteClick.emit(m)">删投</button>
              <button class="im__mini" type="button" data-testid="average-publish-btn" (click)="averagePublishClick.emit(m)">评</button>
              <button class="im__mini" type="button" data-testid="average-attend-btn" (click)="averageAttendClick.emit(m)">打分</button>
              <button class="im__mini" type="button" data-testid="average-read-btn" (click)="averageReadClick.emit(m)">看分</button>
              <button class="im__mini" type="button" data-testid="average-close-btn" (click)="averageCloseClick.emit(m)">截分</button>
              <button class="im__mini" type="button" data-testid="average-delete-btn" (click)="averageDeleteClick.emit(m)">删分</button>
              @if (m.sendStatus === "failed") {
                <button class="im__mini" type="button" data-testid="resend-btn" (click)="resendClick.emit(m)">重发</button>
              }
            </span>
          </div>
        </div>
      }
    </section>
  `,
})
export class ImMessageListComponent {
  @Input() rows: readonly MessageRow[] = [];
  @Input() activeChannel: string | null = null;
  @Input() currentUserId = "444";

  @Output() loadOlderClick = new EventEmitter<void>();
  @Output() revokeClick = new EventEmitter<MessageRow>();
  @Output() postReadClick = new EventEmitter<MessageRow>();
  @Output() templateReceivedClick = new EventEmitter<MessageRow>();
  @Output() quickReplyClick = new EventEmitter<{ row: MessageRow; emoji: string }>();
  @Output() forwardClick = new EventEmitter<{ row: MessageRow; targetChannels: string[] }>();
  @Output() makeTopicClick = new EventEmitter<MessageRow>();
  @Output() urgentPostClick = new EventEmitter<MessageRow>();
  @Output() urgentConfirmClick = new EventEmitter<MessageRow>();
  @Output() locateClick = new EventEmitter<MessageRow>();
  @Output() loadRepliesClick = new EventEmitter<MessageRow>();
  @Output() loadReplyBranchClick = new EventEmitter<MessageRow>();
  @Output() bookmarkCreateClick = new EventEmitter<MessageRow>();
  @Output() bookmarkDeleteClick = new EventEmitter<MessageRow>();
  @Output() postPinClick = new EventEmitter<MessageRow>();
  @Output() announcementAcceptListClick = new EventEmitter<MessageRow>();
  @Output() announcementDetailClick = new EventEmitter<MessageRow>();
  @Output() announcementReadClick = new EventEmitter<MessageRow>();
  @Output() announcementDeleteClick = new EventEmitter<MessageRow>();
  @Output() voteCreateClick = new EventEmitter<MessageRow>();
  @Output() voteSubmitClick = new EventEmitter<MessageRow>();
  @Output() voteReadClick = new EventEmitter<MessageRow>();
  @Output() voteCloseClick = new EventEmitter<MessageRow>();
  @Output() voteDeleteClick = new EventEmitter<MessageRow>();
  @Output() averagePublishClick = new EventEmitter<MessageRow>();
  @Output() averageAttendClick = new EventEmitter<MessageRow>();
  @Output() averageReadClick = new EventEmitter<MessageRow>();
  @Output() averageCloseClick = new EventEmitter<MessageRow>();
  @Output() averageDeleteClick = new EventEmitter<MessageRow>();
  @Output() resendClick = new EventEmitter<MessageRow>();

  readonly avatarColor = avatarColor;
  readonly avatarInitial = avatarInitial;
  readonly authorName = authorName;
  readonly shortTime = shortTime;
}

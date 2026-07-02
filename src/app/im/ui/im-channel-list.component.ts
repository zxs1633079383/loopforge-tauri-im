import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import { ChannelRow } from "../message-row.model";

export type ChannelChangeField = "displayName" | "notice" | "top";

@Component({
  selector: "app-im-channel-list",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="im__col im__channels" data-testid="channel-list">
      <div class="im__col-hd">
        <span>全部消息</span>
        <button class="im__mini" type="button" data-testid="create-channel-btn" (click)="createChannelClick.emit()">+群</button>
        <button class="im__mini" type="button" data-testid="query-channel-btn" (click)="queryChannelsClick.emit()">查</button>
        <button class="im__mini" type="button" data-testid="online-status-btn" (click)="onlineStatusClick.emit()">在线</button>
        <button class="im__mini" type="button" data-testid="modules-get-all-btn" (click)="modulesGetAllClick.emit()">模块</button>
        <button class="im__mini" type="button" data-testid="announcement-list-btn" (click)="announcementListClick.emit()">公告列</button>
        <button class="im__mini" type="button" data-testid="announcement-save-btn" (click)="announcementSaveClick.emit()">存公告</button>
        <button class="im__mini" type="button" data-testid="sync-channels-btn" (click)="syncChannelsClick.emit()">同步</button>
        <button class="im__mini" type="button" data-testid="team-upsert-btn" (click)="teamUpsertClick.emit()">团队</button>
      </div>
      @for (c of channels; track c.channelId) {
        <div
          class="ch"
          [class.ch--active]="c.channelId === activeChannel"
          [attr.data-channel-id]="c.channelId"
          [attr.data-channel-type]="c.channelType ?? null"
          [attr.data-channel-display-name]="c.displayName ?? null"
          [attr.data-channel-notice]="c.notice ?? null"
          [attr.data-channel-top]="c.top ? '1' : null"
          [attr.data-unread]="c.unread ?? null"
          [attr.data-last-message]="c.lastMessage ?? null"
          [attr.data-urgent]="c.urgent ? '1' : null"
          [attr.data-mention]="c.mention ? '1' : null"
          [attr.data-has-schedule-post]="c.hasSchedule ? 'true' : null"
          [attr.data-active-channel]="c.channelId === activeChannel ? '1' : null"
          (click)="selectChannel.emit(c.channelId)"
        >
          <span class="ch__avatar">{{ avatarText(c) }}</span>
          <span class="ch__main">
            <span class="ch__name">{{ c.displayName || c.channelId }}</span>
            <span class="ch__preview">{{ c.lastMessage || c.notice || "" }}</span>
          </span>
          <span class="ch__meta">
            @if (c.unread) {
              <span class="ch__badge">{{ c.unread }}</span>
            }
          </span>
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
                changeChannel.emit({ channel: c, field: 'displayName', value: chNameInput.value })
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
                changeChannel.emit({ channel: c, field: 'notice', value: chNoticeInput.value })
              "
            >公告</button>
            <button
              class="im__mini"
              type="button"
              data-testid="change-channel-top-btn"
              (click)="
                $event.stopPropagation();
                changeChannel.emit({ channel: c, field: 'top', value: c.top ? '0' : '1' })
              "
            >{{ c.top ? '取消置顶' : '置顶' }}</button>
            <button
              class="im__mini"
              type="button"
              data-testid="close-channel-btn"
              (click)="$event.stopPropagation(); closeChannel.emit(c)"
            >×</button>
            <button
              class="im__mini"
              type="button"
              data-testid="team-quit-btn"
              (click)="$event.stopPropagation(); teamQuit.emit(c)"
            >退</button>
            <button
              class="im__mini"
              type="button"
              data-testid="ensure-channel-loaded-btn"
              (click)="$event.stopPropagation(); ensureChannelLoaded.emit(c)"
            >兜底</button>
          </span>
        </div>
      }
    </aside>
  `,
})
export class ImChannelListComponent {
  @Input() channels: readonly ChannelRow[] = [];
  @Input() activeChannel: string | null = null;

  @Output() createChannelClick = new EventEmitter<void>();
  @Output() queryChannelsClick = new EventEmitter<void>();
  @Output() onlineStatusClick = new EventEmitter<void>();
  @Output() modulesGetAllClick = new EventEmitter<void>();
  @Output() announcementListClick = new EventEmitter<void>();
  @Output() announcementSaveClick = new EventEmitter<void>();
  @Output() syncChannelsClick = new EventEmitter<void>();
  @Output() teamUpsertClick = new EventEmitter<void>();
  @Output() selectChannel = new EventEmitter<string>();
  @Output() changeChannel = new EventEmitter<{
    channel: ChannelRow;
    field: ChannelChangeField;
    value: string;
  }>();
  @Output() closeChannel = new EventEmitter<ChannelRow>();
  @Output() teamQuit = new EventEmitter<ChannelRow>();
  @Output() ensureChannelLoaded = new EventEmitter<ChannelRow>();

  avatarText(channel: ChannelRow): string {
    const name = (channel.displayName || channel.channelId || "").trim();
    return name ? name.slice(0, 1).toUpperCase() : "消";
  }
}

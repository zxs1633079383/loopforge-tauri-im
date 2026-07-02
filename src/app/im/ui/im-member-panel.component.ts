import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import { MemberRow } from "../message-row.model";

export type MemberChangeAction = "join" | "leave";

@Component({
  selector: "app-im-member-panel",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="im__col im__members"
      data-testid="member-list"
      [attr.data-member-count]="members.length"
      [attr.data-members]="membersAttr || null"
    >
      <div class="im__col-hd">
        <span>成员</span>
        <button
          class="im__mini"
          type="button"
          data-testid="load-members-btn"
          (click)="loadMembersClick.emit()"
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
          (click)="memberChange.emit({ action: 'join', memberId: memChangeInput.value })"
        >拉</button>
        <button
          class="im__mini"
          type="button"
          data-testid="kick-member-btn"
          (click)="memberChange.emit({ action: 'leave', memberId: memChangeInput.value })"
        >踢</button>
      </div>
      @for (mem of members; track mem.memberId) {
        <div
          class="mem"
          [attr.data-member-id]="mem.memberId"
          [attr.data-admin]="mem.admin ? '1' : null"
          [attr.data-nickname]="mem.nickname ?? null"
        >
          <div
            class="mem__avatar"
            [style.background]="avatarColor(mem.memberId)"
          >{{ avatarInitial(mem.memberId) }}</div>
          <span class="mem__name">{{ mem.nickname || mem.memberId }}</span>
          @if (mem.admin) {
            <span class="mem__crown" title="管理员">♛</span>
          }
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
                nicknameChange.emit({ memberId: mem.memberId, nickname: memNickInput.value })
              "
            >名</button>
            <button
              class="im__mini"
              type="button"
              data-testid="change-manger-btn"
              (click)="managerChange.emit({ memberId: mem.memberId, set: !mem.admin })"
            >管</button>
          </span>
        </div>
      }
    </aside>
  `,
})
export class ImMemberPanelComponent {
  @Input() members: readonly MemberRow[] = [];
  @Input() membersAttr = "";

  @Output() loadMembersClick = new EventEmitter<void>();
  @Output() memberChange = new EventEmitter<{
    action: MemberChangeAction;
    memberId: string;
  }>();
  @Output() nicknameChange = new EventEmitter<{
    memberId: string;
    nickname: string;
  }>();
  @Output() managerChange = new EventEmitter<{
    memberId: string;
    set: boolean;
  }>();

  private readonly avatarPalette = [
    "#5865f2", "#23a55a", "#eb459e", "#f0b232",
    "#e67e22", "#3498db", "#9b59b6", "#1abc9c",
  ];

  avatarColor(userId?: string): string {
    const s = userId || "";
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return this.avatarPalette[h % this.avatarPalette.length];
  }

  avatarInitial(userId?: string): string {
    const s = (userId || "").trim();
    return s ? s[0].toUpperCase() : "·";
  }
}

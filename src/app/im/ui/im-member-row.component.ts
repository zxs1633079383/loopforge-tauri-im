import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import type { MemberRow } from "../message-row.model";
import { avatarColor, avatarInitial } from "./im-ui-format";

@Component({
  selector: "app-im-member-row",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mem"
      [attr.data-member-id]="member.memberId"
      [attr.data-admin]="member.admin ? '1' : null"
      [attr.data-nickname]="member.nickname ?? null"
    >
      <div
        class="mem__avatar"
        [style.background]="avatarColor(member.memberId)"
      >{{ avatarInitial(member.memberId) }}</div>
      <span class="mem__name">{{ member.nickname || member.memberId }}</span>
      @if (member.admin) {
        <span class="mem__crown" title="管理员">管</span>
      }
      <span class="mem__ops">
        <input
          class="im__mini-input"
          type="text"
          data-testid="change-nickname-input"
          placeholder="昵称"
          #nicknameInput
          (click)="$event.stopPropagation()"
        />
        <button
          class="im__mini"
          type="button"
          data-testid="change-nickname-btn"
          (click)="
            $event.stopPropagation();
            nicknameChange.emit({ memberId: member.memberId, nickname: nicknameInput.value })
          "
        >名</button>
        <button
          class="im__mini"
          type="button"
          data-testid="change-manger-btn"
          (click)="managerChange.emit({ memberId: member.memberId, set: !member.admin })"
        >管</button>
      </span>
    </div>
  `,
})
export class ImMemberRowComponent {
  @Input() member!: MemberRow;

  @Output() nicknameChange = new EventEmitter<{
    memberId: string;
    nickname: string;
  }>();
  @Output() managerChange = new EventEmitter<{
    memberId: string;
    set: boolean;
  }>();

  protected readonly avatarColor = avatarColor;
  protected readonly avatarInitial = avatarInitial;
}

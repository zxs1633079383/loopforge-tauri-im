import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import type { MemberRow } from "../message-row.model";
import { ImMemberActionsComponent } from "./im-member-actions.component";
import { ImMemberEmptyComponent } from "./im-member-empty.component";
import { ImMemberPanelHeaderComponent } from "./im-member-panel-header.component";
import { ImMemberRowComponent } from "./im-member-row.component";

export type MemberChangeAction = "join" | "leave";

@Component({
  selector: "app-im-member-panel",
  standalone: true,
  imports: [
    ImMemberActionsComponent,
    ImMemberEmptyComponent,
    ImMemberPanelHeaderComponent,
    ImMemberRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="im__col im__members"
      data-testid="member-list"
      [attr.data-member-count]="members.length"
      [attr.data-members]="membersAttr || null"
    >
      <app-im-member-panel-header
        [count]="members.length"
        (loadMembersClick)="loadMembersClick.emit()"
      ></app-im-member-panel-header>
      <app-im-member-actions
        (memberChange)="memberChange.emit($event)"
      ></app-im-member-actions>
      @for (mem of members; track mem.memberId) {
        <app-im-member-row
          [member]="mem"
          (nicknameChange)="nicknameChange.emit($event)"
          (managerChange)="managerChange.emit($event)"
        ></app-im-member-row>
      } @empty {
        <app-im-member-empty></app-im-member-empty>
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
}

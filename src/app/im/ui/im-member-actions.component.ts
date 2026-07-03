import { ChangeDetectionStrategy, Component, EventEmitter, Output } from "@angular/core";

export type MemberChangeAction = "join" | "leave";

@Component({
  selector: "app-im-member-actions",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mem-panel__actions">
      <input
        class="im__mini-input mem-panel__member-input"
        type="text"
        data-testid="change-member-input"
        placeholder="成员id"
        #memberInput
      />
      <button
        class="im__mini"
        type="button"
        data-testid="change-member-btn"
        (click)="emitMemberChange('join', memberInput.value)"
      >拉</button>
      <button
        class="im__mini"
        type="button"
        data-testid="kick-member-btn"
        (click)="emitMemberChange('leave', memberInput.value)"
      >踢</button>
    </div>
  `,
})
export class ImMemberActionsComponent {
  @Output() memberChange = new EventEmitter<{
    action: MemberChangeAction;
    memberId: string;
  }>();

  emitMemberChange(action: MemberChangeAction, memberId: string): void {
    this.memberChange.emit({ action, memberId });
  }
}

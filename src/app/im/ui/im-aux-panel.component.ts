import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import { BookmarkRow, ReplyRow, TodoRow } from "../message-row.model";

@Component({
  selector: "app-im-aux-panel",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="im__aux" data-testid="aux-area">
      <div
        class="im__panel"
        data-testid="bookmark-panel"
        [attr.data-bookmark]="bookmarks.length"
      >
        <button class="im__mini" type="button" data-testid="bookmark-btn" (click)="bookmarkClick.emit()">书签</button>
        @for (b of bookmarks; track b.bookmarkId) {
          <span class="aux-chip" [attr.data-bookmark-id]="b.bookmarkId"></span>
        }
      </div>
      <div class="im__panel" data-testid="todo-panel">
        @for (t of todos; track t.todoId) {
          <span
            class="aux-chip"
            [attr.data-todo-id]="t.todoId"
            [attr.data-todo-type]="t.todoType ?? null"
            [attr.data-todo-can-del]="t.canDel ? '1' : null"
          ></span>
        }
      </div>
      <div class="im__panel" data-testid="reply-drawer">
        @for (r of replies; track r.replyId) {
          <span class="aux-chip" [attr.data-reply-id]="r.replyId"></span>
        }
      </div>
    </section>
  `,
})
export class ImAuxPanelComponent {
  @Input() bookmarks: readonly BookmarkRow[] = [];
  @Input() todos: readonly TodoRow[] = [];
  @Input() replies: readonly ReplyRow[] = [];

  @Output() bookmarkClick = new EventEmitter<void>();
}

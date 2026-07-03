import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { BookmarkRow, ReplyRow, TodoRow } from "../message-row.model";
import { ImStoreService } from "../im-store.service";

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
          <span class="aux-chip" [attr.data-bookmark-id]="b.bookmarkId">{{ b.message }}</span>
        }
      </div>
      <div class="im__panel" data-testid="announcement-panel">
        @for (a of store.announcements(); track a.announcementId) {
          <span
            class="aux-chip"
            [attr.data-announcement-id]="a.announcementId"
            [attr.data-post-id]="a.postId"
          >{{ a.message }}</span>
        }
      </div>
      <div class="im__panel" data-testid="module-panel">
        @for (m of store.modules(); track m.moduleId) {
          <span class="aux-chip" [attr.data-module-id]="m.moduleId">{{ m.name }}</span>
        }
      </div>
      <div class="im__panel" data-testid="channel-query-panel">
        @for (c of store.queryChannelRows(); track c.channelId) {
          <span class="aux-chip" [attr.data-query-channel-id]="c.channelId">{{ c.displayName }}</span>
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
  protected readonly store = inject(ImStoreService);

  @Input() bookmarks: readonly BookmarkRow[] = [];
  @Input() todos: readonly TodoRow[] = [];
  @Input() replies: readonly ReplyRow[] = [];

  @Output() bookmarkClick = new EventEmitter<void>();
}

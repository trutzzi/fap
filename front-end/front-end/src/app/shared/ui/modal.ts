import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Icon } from './icon';

let nextId = 0;

/**
 * Modal built on the native `<dialog>` (focus trap, Escape and top layer for free).
 * It opens when rendered; the parent removes it from the DOM on `closed`:
 *
 * ```html
 * @if (editing()) { <app-modal heading="…" (closed)="editing.set(false)">…</app-modal> }
 * ```
 */
@Component({
  selector: 'app-modal',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      [attr.aria-labelledby]="titleId"
      [class.wide]="wide()"
      (close)="closed.emit()"
      (click)="onDialogClick($event)"
    >
      <div class="modal">
        <header>
          <h2 class="section-title" [id]="titleId">{{ heading() }}</h2>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon"
            aria-label="Închide"
            (click)="close()"
          >
            <app-icon name="close" />
          </button>
        </header>
        <ng-content />
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(560px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      padding: 0;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg);
      background: var(--surface);
      color: var(--text);
    }
    dialog.wide {
      width: min(720px, calc(100vw - 32px));
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.7);
    }
    .modal {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 24px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
  `,
})
export class Modal {
  readonly heading = input.required<string>();
  readonly wide = input(false);
  readonly closed = output<void>();

  protected readonly titleId = `modal-title-${nextId++}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  /** Clicks on the backdrop land on the `<dialog>` itself; content clicks land on `.modal`. */
  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }
}

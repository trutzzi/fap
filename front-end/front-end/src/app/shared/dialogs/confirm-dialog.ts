import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Observable, finalize } from 'rxjs';
import { errorMessage } from '../../core/data/query';
import { Modal } from '../ui/modal';

/** Asks for confirmation, then runs `action` and closes once it succeeds. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="heading()" (closed)="closed.emit()">
      <p style="margin: 0">{{ message() }}</p>
      @if (error(); as message) {
        <div class="form-error" role="alert">{{ message }}</div>
      }
      <div class="form-footer">
        <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
        <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="confirm()">
          {{ busy() ? 'Se procesează…' : confirmLabel() }}
        </button>
      </div>
    </app-modal>
  `,
})
export class ConfirmDialog {
  protected readonly modal = viewChild.required(Modal);

  readonly heading = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input('Confirmă');
  readonly action = input.required<() => Observable<unknown>>();
  readonly done = output<void>();
  readonly closed = output<void>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected confirm(): void {
    this.busy.set(true);
    this.error.set(null);
    this.action()()
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.done.emit();
          this.modal().close();
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
  }
}

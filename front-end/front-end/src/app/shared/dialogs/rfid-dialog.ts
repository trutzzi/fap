import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { MembersService } from '../../core/api/members.service';
import { MemberSummary } from '../../core/api/models';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { RfidPipe } from '../ui/formatting';
import { Modal } from '../ui/modal';
import { RFID_PATTERN } from './member-form-dialog';

/** Assign, replace or remove a member's RFID card. Card readers type the code + Enter. */
@Component({
  selector: 'app-rfid-dialog',
  imports: [Modal, ReactiveFormsModule, RfidPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Card RFID" (closed)="closed.emit()">
      <form class="form" (ngSubmit)="save(rfid.value.trim() || null)">
        <p class="muted" style="margin: 0">
          {{ member().fullName }} · card actual:
          <span class="mono">{{ member().rfid | rfid }}</span>
        </p>
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <div class="field">
          <label for="rfid-code">Cod card nou</label>
          <input
            id="rfid-code"
            class="input mono"
            [formControl]="rfid"
            autocomplete="off"
            autofocus
            placeholder="Apropie cardul de cititor"
            [attr.aria-invalid]="rfid.invalid && rfid.touched"
          />
          <span class="field-hint">Cititorul completează codul automat când apropii cardul.</span>
        </div>
        <div class="form-footer">
          @if (member().rfid) {
            <button
              type="button"
              class="btn btn-danger start"
              [disabled]="saving()"
              (click)="save(null)"
            >
              Elimină cardul
            </button>
          }
          <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
          <button
            type="submit"
            class="btn btn-primary"
            [disabled]="saving() || rfid.invalid || !rfid.value.trim()"
          >
            Salvează
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class RfidDialog {
  private readonly members = inject(MembersService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  readonly member = input.required<MemberSummary>();
  readonly saved = output<MemberSummary>();
  readonly closed = output<void>();

  protected readonly rfid = new FormControl('', {
    nonNullable: true,
    validators: [Validators.pattern(RFID_PATTERN)],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(rfid: string | null): void {
    if (this.saving() || (rfid !== null && this.rfid.invalid)) return;
    this.saving.set(true);
    this.error.set(null);
    this.members
      .setRfid(this.member().id, { rfid })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (member) => {
          this.toast.success(rfid ? 'Cardul a fost alocat.' : 'Cardul a fost eliminat.');
          this.saved.emit(member);
          this.modal().close();
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
  }
}

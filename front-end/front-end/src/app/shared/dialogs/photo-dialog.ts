import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Observable, finalize } from 'rxjs';
import { MembersService } from '../../core/api/members.service';
import { MemberSummary } from '../../core/api/models';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { Modal } from '../ui/modal';
import { PhotoPicker } from '../ui/photo-picker';

/** Change or delete a member's photo (from the profile). Requires photo consent. */
@Component({
  selector: 'app-photo-dialog',
  imports: [Modal, PhotoPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="'Fotografie · ' + member().fullName" (closed)="closed.emit()">
      @if (error(); as message) {
        <div class="form-error" role="alert">{{ message }}</div>
      }
      <app-photo-picker
        [currentUrl]="member().photoUrl"
        [initials]="member().initials"
        [size]="320"
        (photo)="photo.set($event)"
      />
      <div class="form-footer">
        @if (member().photoUrl && !photo()) {
          <button type="button" class="btn btn-danger start" [disabled]="busy()" (click)="remove()">
            Șterge fotografia
          </button>
        }
        <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="busy() || !photo()"
          (click)="save()"
        >
          {{ busy() ? 'Se salvează…' : 'Salvează' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class PhotoDialog {
  private readonly members = inject(MembersService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  readonly member = input.required<MemberSummary>();
  readonly saved = output<MemberSummary>();
  readonly closed = output<void>();

  protected readonly photo = signal<Blob | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(): void {
    const photo = this.photo();
    if (!photo || this.busy()) return;
    this.run(this.members.uploadPhoto(this.member().id, photo), 'Fotografia a fost salvată.');
  }

  protected remove(): void {
    if (this.busy()) return;
    this.run(this.members.deletePhoto(this.member().id), 'Fotografia a fost ștearsă.');
  }

  private run(request: Observable<MemberSummary>, success: string): void {
    this.busy.set(true);
    this.error.set(null);
    request.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: (member) => {
        this.toast.success(success);
        this.saved.emit(member);
        this.modal().close();
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}

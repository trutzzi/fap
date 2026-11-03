import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { STAFF_PASSWORD_MIN_LENGTH, StaffAccount } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { Modal } from '../ui/modal';

const sameAsNew = (group: AbstractControl): ValidationErrors | null =>
  group.get('newPassword')?.value === group.get('confirm')?.value ? null : { mismatch: true };

/**
 * Changes a staff password: the signed-in user's own (asks for the current one), or, for
 * an admin, any account's (`account`). Either way the API signs that user out elsewhere.
 */
@Component({
  selector: 'app-password-dialog',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="heading()" (closed)="closed.emit()">
      <form class="form" [formGroup]="form" (ngSubmit)="save()" novalidate>
        @if (account(); as a) {
          <p class="muted" style="margin: 0">
            {{ a.name }} · {{ a.email }}. Contul va fi deconectat de pe toate dispozitivele.
          </p>
        }
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <!-- Lets password managers save the new password for the right account. -->
        <input type="hidden" autocomplete="username" [value]="username()" />
        @if (!account()) {
          <div class="field">
            <label for="current-password">Parola actuală</label>
            <input
              id="current-password"
              class="input"
              type="password"
              formControlName="currentPassword"
              autocomplete="current-password"
              [attr.aria-invalid]="invalid('currentPassword')"
            />
            @if (invalid('currentPassword')) {
              <span class="field-error">Introdu parola actuală.</span>
            }
          </div>
        }
        <div class="field">
          <label for="new-password">Parola nouă</label>
          <input
            id="new-password"
            class="input"
            type="password"
            formControlName="newPassword"
            autocomplete="new-password"
            [attr.aria-invalid]="invalid('newPassword')"
          />
          <span class="field-hint" [class.field-error]="invalid('newPassword')">
            Cel puțin {{ minLength }} caractere.
          </span>
        </div>
        <div class="field">
          <label for="confirm-password">Repetă parola nouă</label>
          <input
            id="confirm-password"
            class="input"
            type="password"
            formControlName="confirm"
            autocomplete="new-password"
            [attr.aria-invalid]="mismatch()"
          />
          @if (mismatch()) {
            <span class="field-error">Parolele nu coincid.</span>
          }
        </div>
        <div class="form-footer">
          <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving()">
            {{ saving() ? 'Se salvează…' : 'Salvează parola' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class PasswordDialog {
  private readonly auth = inject(AuthService);
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  /** The account an admin sets a password for; omitted: the signed-in user's own. */
  readonly account = input<StaffAccount | null>(null);
  readonly closed = output<void>();

  protected readonly minLength = STAFF_PASSWORD_MIN_LENGTH;
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly heading = computed(() =>
    this.account() ? 'Setează parola' : 'Schimbă parola',
  );
  protected readonly username = computed(
    () => this.account()?.email ?? this.auth.user()?.email ?? '',
  );

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      currentPassword: [''],
      newPassword: ['', [Validators.required, Validators.minLength(STAFF_PASSWORD_MIN_LENGTH)]],
      confirm: ['', Validators.required],
    },
    { validators: sameAsNew },
  );

  protected invalid(name: 'currentPassword' | 'newPassword'): boolean {
    if (!this.submitted()) return false;
    return name === 'currentPassword'
      ? !this.account() && !this.form.controls.currentPassword.value
      : this.form.controls.newPassword.invalid;
  }

  protected mismatch(): boolean {
    return this.submitted() && this.form.hasError('mismatch');
  }

  protected save(): void {
    this.submitted.set(true);
    const { currentPassword, newPassword } = this.form.getRawValue();
    const account = this.account();
    if (this.form.invalid || (!account && !currentPassword) || this.saving()) return;
    const request: Observable<void> = account
      ? this.academy.setStaffPassword(account.id, { password: newPassword })
      : this.auth.changePassword({ currentPassword, newPassword });
    this.saving.set(true);
    this.error.set(null);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.toast.success(
          account ? `Parola pentru ${account.name} a fost setată.` : 'Parola a fost schimbată.',
        );
        this.modal().close();
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}

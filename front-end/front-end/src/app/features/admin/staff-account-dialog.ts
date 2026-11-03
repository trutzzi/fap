import {
  ChangeDetectionStrategy,
  Component,
  inject,
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
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { Role, STAFF_PASSWORD_MIN_LENGTH, StaffAccount } from '../../core/api/models';
import { ROLE_LABELS } from '../../core/auth/auth.service';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { Modal } from '../../shared/ui/modal';

const ROLE_HINTS: Record<Role, string> = {
  admin: 'Acces complet, inclusiv administrare și conturi.',
  reception: 'Membri, abonamente, plăți, carduri și check-in.',
  coach: 'Doar antrenamentele proprii, orarul și kiosk-ul.',
};

const samePassword = (group: AbstractControl): ValidationErrors | null =>
  group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: true };

/** New staff account (admin): name, email, role and a first password. */
@Component({
  selector: 'app-staff-account-dialog',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Cont nou" (closed)="closed.emit()">
      <form class="form" [formGroup]="form" (ngSubmit)="save()" novalidate>
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <div class="form-grid">
          <div class="field">
            <label for="staff-name">Nume</label>
            <input
              id="staff-name"
              class="input"
              formControlName="name"
              autocomplete="off"
              [attr.aria-invalid]="invalid('name')"
            />
            @if (invalid('name')) {
              <span class="field-error">Numele este obligatoriu.</span>
            }
          </div>
          <div class="field">
            <label for="staff-email">Email</label>
            <input
              id="staff-email"
              class="input"
              type="email"
              formControlName="email"
              autocomplete="off"
              [attr.aria-invalid]="invalid('email')"
            />
            @if (invalid('email')) {
              <span class="field-error">Introdu o adresă de email validă.</span>
            }
          </div>
        </div>
        <div class="field">
          <label for="staff-role">Rol</label>
          <select id="staff-role" class="input" formControlName="role">
            @for (role of roles; track role) {
              <option [value]="role">{{ roleLabels[role] }}</option>
            }
          </select>
          <span class="field-hint">{{ roleHints[form.controls.role.value] }}</span>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="staff-password">Parolă</label>
            <input
              id="staff-password"
              class="input"
              type="password"
              formControlName="password"
              autocomplete="new-password"
              [attr.aria-invalid]="invalid('password')"
            />
            <span class="field-hint" [class.field-error]="invalid('password')">
              Cel puțin {{ minLength }} caractere. Persoana o poate schimba după autentificare.
            </span>
          </div>
          <div class="field">
            <label for="staff-confirm">Repetă parola</label>
            <input
              id="staff-confirm"
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
        </div>
        <div class="form-footer">
          <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving()">
            {{ saving() ? 'Se creează…' : 'Creează contul' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class StaffAccountDialog {
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  readonly created = output<StaffAccount>();
  readonly closed = output<void>();

  protected readonly roles: Role[] = ['reception', 'coach', 'admin'];
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly roleHints = ROLE_HINTS;
  protected readonly minLength = STAFF_PASSWORD_MIN_LENGTH;
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      name: ['', [Validators.required, Validators.maxLength(60)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(120)]],
      role: ['reception' as Role, Validators.required],
      password: ['', [Validators.required, Validators.minLength(STAFF_PASSWORD_MIN_LENGTH)]],
      confirm: ['', Validators.required],
    },
    { validators: samePassword },
  );

  protected invalid(name: 'name' | 'email' | 'password'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected mismatch(): boolean {
    return this.submitted() && this.form.hasError('mismatch');
  }

  protected save(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.saving()) return;
    const { name, email, role, password } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.academy
      .createStaffAccount({ name: name.trim(), email: email.trim(), role, password })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (account) => {
          this.toast.success(`Contul pentru ${account.name} a fost creat.`);
          this.created.emit(account);
          this.modal().close();
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
  }
}

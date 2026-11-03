import { NgOptimizedImage } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { MemberAccountService } from '../../core/account/member-account.service';
import { PIN_PATTERN, digitsOnly } from '../../core/account/pin';
import { AcademyService } from '../../core/api/academy.service';
import { createQuery, errorMessage } from '../../core/data/query';

/** Member sign-in: phone number + the PIN received by SMS. */
@Component({
  selector: 'app-account-login-page',
  imports: [ReactiveFormsModule, NgOptimizedImage, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-login-page.html',
  styleUrl: '../login/login-page.css',
})
export class AccountLoginPage {
  private readonly accounts = inject(MemberAccountService);
  private readonly router = inject(Router);
  private readonly academy = inject(AcademyService);

  protected readonly club = createQuery(
    () => null,
    () => this.academy.club(),
  );
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    phone: ['', [Validators.required, Validators.pattern(/^[0-9 +().-]{6,30}$/)]],
    pin: ['', [Validators.required, Validators.pattern(PIN_PATTERN)]],
  });

  protected onPinInput(input: HTMLInputElement): void {
    const pin = digitsOnly(input.value);
    if (pin !== input.value) this.form.controls.pin.setValue(pin);
  }

  protected invalid(name: 'phone' | 'pin'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    this.accounts
      .login(this.form.getRawValue())
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => void this.router.navigate(['/cont']),
        error: (err: unknown) => {
          this.error.set(errorMessage(err));
          if (err instanceof HttpErrorResponse && err.status === 401) {
            this.form.controls.pin.reset();
          }
        },
      });
  }
}

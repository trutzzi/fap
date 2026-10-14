import { NgOptimizedImage } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { safeRedirect } from '../../core/auth/auth.guards';
import { AuthService } from '../../core/auth/auth.service';
import { createQuery, errorMessage } from '../../core/data/query';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, NgOptimizedImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly academy = inject(AcademyService);

  /** `?redirect=` — where to go after signing in (same-app paths only). */
  readonly redirect = input<string>();

  protected readonly club = createQuery(
    () => null,
    () => this.academy.club(),
  );
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected invalid(name: 'email' | 'password'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    this.auth
      .login(this.form.getRawValue())
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => void this.router.navigateByUrl(safeRedirect(this.redirect())),
        error: (err: unknown) => {
          this.error.set(errorMessage(err));
          if (err instanceof HttpErrorResponse && err.status === 401) {
            this.form.controls.password.reset();
          }
        },
      });
  }
}

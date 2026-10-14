import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';

@Component({
  selector: 'app-admin-club-page',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card club" aria-labelledby="club-title">
      <div>
        <h2 id="club-title" class="section-title">Date club</h2>
        <p class="muted" style="margin: 4px 0 0">Apar în aplicație și pe materialele clubului.</p>
      </div>
      @if (club.error(); as message) {
        <div class="form-error" role="alert">{{ message }}</div>
      }
      <form class="form" [formGroup]="form" (ngSubmit)="save()">
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <div class="field">
          <label for="club-name">Nume club</label>
          <input
            id="club-name"
            class="input"
            formControlName="name"
            [attr.aria-invalid]="invalid('name')"
          />
          @if (invalid('name')) {
            <span class="field-error">Numele clubului este obligatoriu.</span>
          }
        </div>
        <div class="field">
          <label for="club-address">Adresă</label>
          <input
            id="club-address"
            class="input"
            formControlName="address"
            autocomplete="street-address"
          />
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="club-phone">Telefon</label>
            <input id="club-phone" class="input" type="tel" formControlName="phone" />
          </div>
          <div class="field">
            <label for="club-email">Email</label>
            <input
              id="club-email"
              class="input"
              type="email"
              formControlName="email"
              [attr.aria-invalid]="invalid('email')"
            />
            @if (invalid('email')) {
              <span class="field-error">Introdu o adresă de email validă.</span>
            }
          </div>
          <div class="field">
            <label for="club-website">Site</label>
            <input
              id="club-website"
              class="input"
              formControlName="website"
              placeholder="fightacademy.ro"
            />
          </div>
          <div class="field">
            <label for="club-timezone">Fus orar</label>
            <select id="club-timezone" class="input" formControlName="timezone">
              @for (tz of timezones; track tz) {
                <option [value]="tz">{{ tz }}</option>
              }
            </select>
            <span class="field-hint">Folosit pentru „azi”, orele antrenamentelor și check-in.</span>
          </div>
        </div>
        <div class="form-footer">
          <button type="submit" class="btn btn-primary" [disabled]="saving() || !club.value()">
            {{ saving() ? 'Se salvează…' : 'Salvează' }}
          </button>
        </div>
      </form>
    </section>
  `,
  styles: `
    .club {
      max-width: 760px;
    }
  `,
})
export class AdminClubPage {
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);

  protected readonly club = createQuery(
    () => null,
    () => this.academy.club(),
  );
  protected readonly timezones = Intl.supportedValuesOf('timeZone');
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    address: ['', Validators.maxLength(160)],
    phone: ['', Validators.maxLength(30)],
    email: ['', [Validators.email, Validators.maxLength(120)]],
    website: ['', Validators.maxLength(120)],
    timezone: ['Europe/Bucharest', Validators.required],
  });

  constructor() {
    effect(() => {
      const club = this.club.value();
      if (club) this.form.setValue(club);
    });
  }

  protected invalid(name: 'name' | 'email'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected save(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.academy
      .updateClub(this.form.getRawValue())
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => this.toast.success('Datele clubului au fost salvate.'),
        error: (err) => this.error.set(errorMessage(err)),
      });
  }
}

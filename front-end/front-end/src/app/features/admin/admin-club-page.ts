import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { SmsCreditInfo } from '../../shared/ui/sms-credit';
import { FeedbackSound, FeedbackTone } from '../../core/util/feedback-sound';

@Component({
  selector: 'app-admin-club-page',
  imports: [ReactiveFormsModule, SmsCreditInfo],
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
        <div class="field">
          <label class="check">
            <input type="checkbox" formControlName="smsEnabled" />
            Trimite prin SMS codul PIN al membrilor noi
          </label>
          <span class="field-hint">
            Oprit: recepția vede codul PIN și i-l comunică membrului. Pornit: PIN-ul pleacă prin SMS
            (necesită contul SMSLink configurat pe server).
          </span>
        </div>
        <div class="field">
          <label class="check">
            <input type="checkbox" formControlName="expiryReminderSms" />
            Trimite SMS de reamintire cu 3 zile înainte de expirarea abonamentului
          </label>
          <span class="field-hint">
            Un singur SMS pe perioadă de abonament, între 10:00 și 20:00. Necesită contul SMSLink
            configurat pe server; erorile apar în pagina de logs.
          </span>
          <app-sms-credit />
        </div>
        <fieldset class="field">
          <legend>Sunete kiosk</legend>
          <label for="club-volume" class="volume">
            Volum
            <input
              id="club-volume"
              type="range"
              min="0"
              max="100"
              step="5"
              formControlName="kioskVolume"
            />
            <strong>{{
              form.controls.kioskVolume.value === 0
                ? 'Oprit'
                : form.controls.kioskVolume.value + '%'
            }}</strong>
          </label>
          <div class="tests">
            <span class="muted">Ascultă:</span>
            <button type="button" class="btn btn-sm" (click)="test('success')">Acces permis</button>
            <button type="button" class="btn btn-sm" (click)="test('warning')">
              Limită atinsă
            </button>
            <button type="button" class="btn btn-sm" (click)="test('danger')">
              Refuzat / expirat
            </button>
          </div>
          <span class="field-hint">
            Se aplică pe toate tabletele kiosk în cel mult un minut după salvare. Fiecare kiosk
            poate opri sunetul din butonul „Sunet”.
          </span>
        </fieldset>
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
    .volume {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .volume input {
      flex: 1;
      accent-color: var(--accent);
    }
    .volume strong {
      min-width: 3.5em;
      text-align: right;
    }
    .tests {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
  `,
})
export class AdminClubPage {
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  private readonly sound = inject(FeedbackSound);

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
    smsEnabled: [false],
    kioskVolume: [60],
    expiryReminderSms: [false],
  });

  constructor() {
    effect(() => {
      const club = this.club.value();
      if (club) this.form.setValue(club);
    });
  }

  /** Plays a check-in sound at the slider's volume (before saving). */
  protected test(tone: FeedbackTone): void {
    this.sound.preview(tone, this.form.controls.kioskVolume.value);
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

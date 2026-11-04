import { DatePipe, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { MemberAccountService } from '../../core/account/member-account.service';
import { PIN_PATTERN, digitsOnly } from '../../core/account/pin';
import { CheckInRecord, MemberAccount } from '../../core/api/models';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { WEEKDAYS, WEEKDAYS_SHORT, formatDate, isoWeekday, toIsoDate } from '../../core/util/dates';
import { InstallPrompt } from '../../core/util/install-prompt';
import { funFactOfTheDay } from '../../core/account/fun-facts';
import { onInterval } from '../../core/util/interval';
import { IsoDatePipe } from '../../shared/ui/formatting';
import { QrCode } from '../../shared/ui/qr-code';
import { MemberNotifications } from './member-notifications';
import { SessionMeter } from '../../shared/ui/session-meter';
import { StatusBadge } from '../../shared/ui/status-badge';

/** The server rotates the code every 30 s; fetching a bit sooner keeps it always valid. */
const QR_REFRESH_MS = 25_000;
const ACCOUNT_REFRESH_MS = 60_000;

/**
 * Member portal home: the rotating check-in QR code (scanned by the kiosk tablet at the
 * entrance), the current subscription and recent check-ins. Mobile first.
 */
@Component({
  selector: 'app-account-page',
  imports: [
    DatePipe,
    NgOptimizedImage,
    ReactiveFormsModule,
    IsoDatePipe,
    QrCode,
    MemberNotifications,
    SessionMeter,
    StatusBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-page.html',
  styleUrl: './account-page.css',
})
export class AccountPage {
  private readonly accounts = inject(MemberAccountService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly account = this.accounts.account;
  protected readonly qr = createQuery(
    () => null,
    () => this.accounts.qr(),
  );
  protected readonly install = inject(InstallPrompt);
  protected readonly weekdays = WEEKDAYS;
  /** Today's motivating fact from the member's own numbers. */
  protected readonly funFact = computed(() => {
    const a = this.account();
    return a ? funFactOfTheDay(a.stats, a.joinedAt, toIsoDate(new Date())) : '';
  });
  /** Bar heights for the last 8 weeks, relative to the busiest week. */
  protected readonly weekBars = computed(() => {
    const weeks = this.account()?.stats.weeks ?? [];
    const max = Math.max(1, ...weeks.map((w) => w.count));
    return weeks.map((w) => ({ ...w, height: Math.round((w.count / max) * 100) }));
  });
  /** Newest first; unread ones keep their "Nou" badge until the next refresh. */
  protected readonly announcements = createQuery(
    () => null,
    () => this.accounts.announcements(),
  );

  protected readonly savingPin = signal(false);
  protected readonly pinSubmitted = signal(false);
  protected readonly pinError = signal<string | null>(null);
  protected readonly pinForm = inject(NonNullableFormBuilder).group({
    currentPin: ['', [Validators.required, Validators.pattern(PIN_PATTERN)]],
    newPin: ['', [Validators.required, Validators.pattern(PIN_PATTERN)]],
  });

  constructor() {
    onInterval(QR_REFRESH_MS, () => this.qr.reload());
    onInterval(ACCOUNT_REFRESH_MS, () => this.refreshAll());
    // Phones pause timers in the background: refresh as soon as the page is shown again.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          this.qr.reload();
          this.refreshAll();
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
    });
    // Seen once listed: mark them read (the server keeps the date for the staff's counts).
    effect(() => {
      if (this.announcements.value()?.some((a) => !a.read)) {
        untracked(() => this.accounts.markAnnouncementsRead().subscribe(() => this.refresh()));
      }
    });
    // Signed out (logout, or reception issued a new PIN): back to the login.
    effect(() => {
      if (!this.account()) void this.router.navigate(['/cont/login']);
    });
  }

  protected weekCounts(account: MemberAccount): string {
    return account.stats.weeks.map((w) => w.count).join(', ');
  }

  protected historyDate(record: CheckInRecord): string {
    const iso = toIsoDate(new Date(record.timestamp));
    return `${WEEKDAYS_SHORT[isoWeekday(iso) - 1]}, ${formatDate(iso)}`;
  }

  protected pinInvalid(name: 'currentPin' | 'newPin'): boolean {
    return this.pinSubmitted() && this.pinForm.controls[name].invalid;
  }

  protected onPinInput(name: 'currentPin' | 'newPin', input: HTMLInputElement): void {
    const pin = digitsOnly(input.value);
    if (pin !== input.value) this.pinForm.controls[name].setValue(pin);
  }

  protected changePin(): void {
    this.pinSubmitted.set(true);
    if (this.pinForm.invalid || this.savingPin()) return;
    this.savingPin.set(true);
    this.pinError.set(null);
    this.accounts
      .changePin(this.pinForm.getRawValue())
      .pipe(finalize(() => this.savingPin.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Codul PIN a fost schimbat.');
          this.pinForm.reset();
          this.pinSubmitted.set(false);
        },
        error: (err) => this.pinError.set(errorMessage(err)),
      });
  }

  protected logout(): void {
    this.accounts.logout().subscribe();
  }

  private refresh(): void {
    this.accounts.load().subscribe();
  }

  /** Account data and announcements, refreshed together (interval, tab shown again). */
  protected refreshAll(): void {
    this.refresh();
    this.announcements.reload();
  }
}

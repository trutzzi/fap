import { DatePipe, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { CheckInRequest, CheckInResult } from '../../core/api/models';
import { checkInMessage } from '../../core/checkin-messages';
import { createQuery, errorMessage } from '../../core/data/query';
import { formatDayMonth } from '../../core/util/dates';
import { FeedbackSound } from '../../core/util/feedback-sound';
import { clock, onInterval } from '../../core/util/interval';
import { MemberPickerDialog } from '../../shared/dialogs/member-picker-dialog';
import { Icon } from '../../shared/ui/icon';
import { MemberAvatar } from '../../shared/ui/member-avatar';
import { SessionMeter } from '../../shared/ui/session-meter';
import { AuthService } from '../../core/auth/auth.service';

/** How long a check-in result stays on screen before returning to idle. */
const RESULT_VISIBLE_MS = 8000;
const STATUS_REFRESH_MS = 60_000;

const TONE_COLOR = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

/**
 * Full-screen check-in kiosk. USB/HID RFID readers behave like keyboards: they type the
 * card code followed by Enter into the focused field, so a hidden input keeps focus.
 */
@Component({
  selector: 'app-kiosk-page',
  imports: [
    DatePipe,
    NgOptimizedImage,
    RouterLink,
    Icon,
    SessionMeter,
    MemberAvatar,
    MemberPickerDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kiosk-page.html',
  styleUrl: './kiosk-page.css',
})
export class KioskPage {
  private readonly academy = inject(AcademyService);
  /** Name search needs member data, which coaches may not read. */
  protected readonly canSearch = inject(AuthService).isStaff;
  protected readonly sound = inject(FeedbackSound);
  private readonly reader = viewChild.required<ElementRef<HTMLInputElement>>('reader');

  protected readonly now = clock();
  protected readonly status = createQuery(
    () => null,
    () => this.academy.kioskStatus(),
  );
  protected readonly result = signal<CheckInResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly searching = signal(false);

  protected readonly view = computed(() => {
    const result = this.result();
    if (!result) return null;
    const message = checkInMessage(result);
    const sub = result.member?.subscription ?? null;
    const limited = sub?.sessionLimit != null;
    return {
      ...message,
      color: TONE_COLOR[message.tone],
      member: result.member,
      name: result.member?.fullName ?? 'Card necunoscut',
      line: result.trainingLabel ?? result.member?.courses.map((c) => c.name).join(' · ') ?? '',
      sub,
      limited,
      usage: !sub
        ? ''
        : result.outcome === 'allowed' && limited
          ? `Ședința ${sub.used} din ${sub.sessionLimit}`
          : limited
            ? `${sub.used} din ${sub.sessionLimit} ședințe folosite`
            : sub.planName,
      until: !sub
        ? ''
        : result.outcome === 'expired'
          ? `Expirat pe ${formatDayMonth(sub.endDate)}`
          : `Valabil până la ${formatDayMonth(sub.endDate)}`,
    };
  });

  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    onInterval(STATUS_REFRESH_MS, () => this.status.reload());
    afterNextRender(() => this.focusReader());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.resetTimer));
  }

  protected scan(input: HTMLInputElement): void {
    const rfid = input.value.trim();
    input.value = '';
    if (rfid) this.submit({ rfid });
  }

  protected submit(request: CheckInRequest): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.academy
      .checkIn(request)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (result) => this.show(result),
        error: (err) => this.error.set(errorMessage(err)),
      });
  }

  /** Keeps the hidden reader input focused, except while the name search is open. */
  protected focusReader(): void {
    if (!this.searching()) this.reader().nativeElement.focus({ preventScroll: true });
  }

  protected closeSearch(): void {
    this.searching.set(false);
    setTimeout(() => this.focusReader());
  }

  private show(result: CheckInResult): void {
    this.result.set(result);
    this.sound.play(checkInMessage(result).tone);
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.result.set(null), RESULT_VISIBLE_MS);
  }
}

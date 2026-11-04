import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { tap } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { MembersService } from '../../core/api/members.service';
import {
  CheckInMethod,
  CheckInRecord,
  MemberAccessResult,
  PeriodPaymentStatus,
  PlanId,
  SubscriptionPeriod,
} from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { checkInMessage } from '../../core/checkin-messages';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import {
  WEEKDAYS_SHORT,
  addMonthsToMonth,
  daysInMonth,
  formatDate,
  formatMonth,
  isoWeekday,
  toIsoDate,
  toMonth,
} from '../../core/util/dates';
import { ConfirmDialog } from '../../shared/dialogs/confirm-dialog';
import { MemberAccessDialog } from '../../shared/dialogs/member-access-dialog';
import { MemberFormDialog } from '../../shared/dialogs/member-form-dialog';
import { PhotoDialog } from '../../shared/dialogs/photo-dialog';
import { PaymentDialog } from '../../shared/dialogs/payment-dialog';
import { RfidDialog } from '../../shared/dialogs/rfid-dialog';
import { SubscriptionDialog } from '../../shared/dialogs/subscription-dialog';
import { IsoDatePipe, RfidPipe } from '../../shared/ui/formatting';
import { Icon } from '../../shared/ui/icon';
import { MemberAvatar } from '../../shared/ui/member-avatar';
import { SessionMeter } from '../../shared/ui/session-meter';
import { StatusBadge } from '../../shared/ui/status-badge';

type ProfileDialog =
  | 'edit'
  | 'photo'
  | 'payment'
  | 'rfid'
  | 'access'
  | 'clear-history'
  | 'renew'
  | 'change'
  | 'delete';

const METHOD_LABELS: Record<CheckInMethod, string> = {
  rfid: 'Card RFID',
  qr: 'Cod QR',
  manual: 'Manual · recepție',
};

const PERIOD_BADGE: Record<PeriodPaymentStatus, { label: string; tone: string }> = {
  paid: { label: 'Plătit', tone: 'badge--success' },
  partial: { label: 'Parțial', tone: 'badge--warning' },
  unpaid: { label: 'Neplătit', tone: 'badge--danger' },
  'no-price': { label: 'Fără preț', tone: 'badge--muted' },
};

interface CalendarCell {
  day: number | null;
  present: boolean;
  today: boolean;
  future: boolean;
}

@Component({
  selector: 'app-member-profile-page',
  imports: [
    DatePipe,
    RouterLink,
    Icon,
    StatusBadge,
    SessionMeter,
    RfidPipe,
    IsoDatePipe,
    MemberFormDialog,
    SubscriptionDialog,
    RfidDialog,
    ConfirmDialog,
    PhotoDialog,
    PaymentDialog,
    MemberAccessDialog,
    MemberAvatar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './member-profile-page.html',
  styleUrl: './member-profile-page.css',
})
export class MemberProfilePage {
  private readonly membersApi = inject(MembersService);
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  /** Deleting a member (and their history) is admin-only. */
  protected readonly isAdmin = inject(AuthService).isAdmin;

  /** Route parameter `:id`. */
  readonly id = input.required<string>();

  protected readonly weekdays = WEEKDAYS_SHORT;
  protected readonly today = toIsoDate(new Date());
  /** Resets to the current month when navigating to another member. */
  protected readonly month = linkedSignal({
    source: this.id,
    computation: () => toMonth(this.today),
  });
  protected readonly dialog = signal<ProfileDialog | null>(null);
  protected readonly upgradePlan = signal<PlanId | null>(null);
  protected readonly paying = signal<SubscriptionPeriod | null>(null);
  protected readonly periodBadge = PERIOD_BADGE;
  protected readonly methodLabels = METHOD_LABELS;
  /** Result of the last "send password" action, shown in a dialog. */
  protected readonly accessResult = signal<MemberAccessResult | null>(null);

  /** Whether new PINs go out by SMS (club settings); changes the wording only. */
  protected readonly smsEnabled = computed(() => this.club.value()?.smsEnabled ?? false);
  private readonly club = createQuery(
    () => null,
    () => this.academy.club(),
  );

  protected readonly member = createQuery(
    () => this.id(),
    (id) => this.membersApi.get(id),
  );
  protected readonly attendance = createQuery(
    () => ({ id: this.id(), month: this.month() }),
    ({ id, month }) => this.membersApi.attendance(id, month),
  );

  protected readonly monthLabel = computed(() => formatMonth(this.month()));
  protected readonly isCurrentMonth = computed(() => this.month() >= toMonth(this.today));
  protected readonly joinedLabel = computed(() => {
    const joined = this.member.value()?.joinedAt;
    return joined ? formatMonth(toMonth(joined)).toLowerCase() : '';
  });

  protected readonly calendar = computed<CalendarCell[]>(() => {
    const month = this.month();
    const present = new Set(
      this.attendance.value()?.month === month ? this.attendance.value()!.days : [],
    );
    const blanks = isoWeekday(`${month}-01`) - 1;
    const cells: CalendarCell[] = Array.from({ length: blanks }, () => ({
      day: null,
      present: false,
      today: false,
      future: false,
    }));
    for (let day = 1; day <= daysInMonth(month); day++) {
      const iso = `${month}-${String(day).padStart(2, '0')}`;
      cells.push({
        day,
        present: present.has(day),
        today: iso === this.today,
        future: iso > this.today,
      });
    }
    return cells;
  });

  protected readonly attendanceSummary = computed(() => {
    const days = this.calendar()
      .filter((c) => c.present)
      .map((c) => c.day);
    return days.length
      ? `Prezență în ${this.monthLabel()}: zilele ${days.join(', ')}`
      : `Nicio prezență în ${this.monthLabel()}`;
  });

  protected readonly deleteAction = () => this.membersApi.delete(this.id());
  /** A check-in about to be removed (confirmation open). */
  protected readonly removingCheckIn = signal<CheckInRecord | null>(null);
  protected readonly removeCheckInAction = () =>
    this.membersApi.deleteCheckIn(this.id(), this.removingCheckIn()!.id);
  protected readonly clearHistoryAction = () => this.membersApi.clearHistory(this.id());

  protected readonly accessAction = () =>
    this.membersApi.sendAccess(this.id()).pipe(tap((result) => this.accessResult.set(result)));

  constructor() {
    const title = inject(Title);
    effect(() => {
      const name = this.member.value()?.fullName;
      if (name) title.setTitle(`${name} · FightAcademy`);
    });
  }

  protected historyDate(record: CheckInRecord): string {
    const iso = toIsoDate(new Date(record.timestamp));
    return `${WEEKDAYS_SHORT[isoWeekday(iso) - 1]}, ${formatDate(iso)}`;
  }

  protected shiftMonth(delta: number): void {
    this.month.update((m) => addMonthsToMonth(m, delta));
  }

  protected openSubscription(mode: 'renew' | 'change', plan: PlanId | null = null): void {
    this.upgradePlan.set(plan);
    this.dialog.set(mode);
  }

  protected checkIn(): void {
    const member = this.member.value();
    if (!member) return;
    this.academy.checkIn({ memberId: member.id }).subscribe({
      next: (result) => {
        const message = checkInMessage(result);
        if (message.tone === 'success') this.toast.success(message.headline);
        else this.toast.error(`${message.headline}. ${message.footer}`);
        this.refresh();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected collect(period: SubscriptionPeriod): void {
    this.paying.set(period);
    this.dialog.set('payment');
  }

  protected refresh(): void {
    this.member.reload();
    this.attendance.reload();
  }

  protected onHistoryChanged(message: string): void {
    this.toast.success(message);
    this.refresh();
  }

  protected onDeleted(): void {
    this.toast.success('Membrul a fost șters.');
    void this.router.navigate(['/membri']);
  }
}

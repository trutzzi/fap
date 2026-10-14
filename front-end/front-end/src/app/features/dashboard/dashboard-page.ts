import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AcademyService } from '../../core/api/academy.service';
import { MembersService } from '../../core/api/members.service';
import { Alert, MemberSummary, PlanId, TodayTraining } from '../../core/api/models';
import { checkInMessage } from '../../core/checkin-messages';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { MONTHS, WEEKDAYS_SHORT, isoWeekday } from '../../core/util/dates';
import { clock, onInterval } from '../../core/util/interval';
import { MemberFormDialog } from '../../shared/dialogs/member-form-dialog';
import { MemberPickerDialog } from '../../shared/dialogs/member-picker-dialog';
import { SubscriptionDialog } from '../../shared/dialogs/subscription-dialog';
import { AttendeeList, attendeesSummary } from '../../shared/ui/attendee-list';
import { MemberAvatar } from '../../shared/ui/member-avatar';

const REFRESH_MS = 30_000;

interface SubscriptionTarget {
  member: MemberSummary;
  mode: 'renew' | 'change';
  plan: PlanId | null;
}

@Component({
  selector: 'app-dashboard-page',
  imports: [
    DatePipe,
    RouterLink,
    AttendeeList,
    MemberAvatar,
    MemberFormDialog,
    MemberPickerDialog,
    SubscriptionDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
})
export class DashboardPage {
  private readonly academy = inject(AcademyService);
  private readonly members = inject(MembersService);
  private readonly toast = inject(ToastService);

  protected readonly now = clock(30_000);
  protected readonly dashboard = createQuery(
    () => null,
    () => this.academy.dashboard(),
  );

  protected readonly dialog = signal<'new-member' | 'check-in' | null>(null);
  protected readonly subscriptionTarget = signal<SubscriptionTarget | null>(null);

  protected readonly kpis = computed(() => {
    const d = this.dashboard.value();
    if (!d) return [];
    const month = this.now().getMonth();
    return [
      {
        label: 'Membri activi',
        value: d.activeMembers,
        sub: `+${d.newMembersThisMonth} luna aceasta`,
      },
      {
        label: 'Prezențe azi',
        value: d.checkinsToday,
        sub: `${d.today.length} antrenamente programate`,
      },
      {
        label: `Prezențe ${MONTHS[month]}`,
        value: d.checkinsThisMonth,
        sub: `față de ${d.checkinsLastMonth} în ${MONTHS[(month + 11) % 12]}`,
      },
      { label: 'Expiră în 7 zile', value: d.expiringSoon, sub: 'abonamente de reînnoit' },
    ];
  });

  protected readonly week = computed(() => {
    const days = this.dashboard.value()?.week ?? [];
    const max = Math.max(...days.map((d) => d.count), 1);
    return days.map((d, i) => ({
      ...d,
      label: WEEKDAYS_SHORT[isoWeekday(d.date) - 1],
      height: Math.round((d.count / max) * 120),
      today: i === days.length - 1,
    }));
  });

  protected readonly weekSummary = computed(() =>
    this.week()
      .map((d) => `${d.label}: ${d.count}`)
      .join(', '),
  );

  constructor() {
    onInterval(REFRESH_MS, () => this.dashboard.reload());
  }

  protected readonly attendeesSummary = attendeesSummary;

  protected trainingStatus(t: TodayTraining): string {
    if (t.state === 'done') return 'Încheiat';
    if (t.state === 'live') return 'În desfășurare';
    const h = Math.floor(t.startsInMin / 60);
    const m = t.startsInMin % 60;
    return h > 0 ? `Peste ${h} h ${m} min` : `Peste ${m} min`;
  }

  protected trainingCount(t: TodayTraining): string {
    if (t.state === 'upcoming') {
      return t.checkins > 0
        ? `${t.checkins} check-in anticipat din ${t.capacity} locuri`
        : `${t.capacity} locuri`;
    }
    return `${t.checkins} prezențe din ${t.capacity} locuri`;
  }

  protected fill(t: TodayTraining): number {
    return Math.min(100, Math.round((t.checkins / t.capacity) * 100));
  }

  protected checkIn(member: MemberSummary): void {
    this.academy.checkIn({ memberId: member.id }).subscribe({
      next: (result) => {
        const message = checkInMessage(result);
        const text = `${member.fullName}: ${message.headline}`;
        if (message.tone === 'success') this.toast.success(text);
        else this.toast.error(`${text}. ${message.footer}`);
        this.dashboard.reload();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }

  protected resolveAlert(alert: Alert): void {
    if (!alert.memberId) return;
    this.members.get(alert.memberId).subscribe({
      next: (member) =>
        this.subscriptionTarget.set(
          alert.kind === 'limit'
            ? { member, mode: 'change', plan: 'unlimited' }
            : { member, mode: 'renew', plan: member.subscription?.planId ?? null },
        ),
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }
}

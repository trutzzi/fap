import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { ScheduleEntry } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { createQuery } from '../../core/data/query';
import {
  MONTHS,
  WEEKDAYS,
  addDays,
  isIsoDate,
  parseIsoDate,
  startOfWeek,
  toIsoDate,
} from '../../core/util/dates';
import { Icon } from '../../shared/ui/icon';

/** Read-only week view; admins edit courses, the schedule and plans under /admin. */
@Component({
  selector: 'app-schedule-page',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './schedule-page.html',
  styleUrl: './schedule-page.css',
})
export class SchedulePage {
  private readonly academy = inject(AcademyService);
  private readonly router = inject(Router);
  protected readonly isAdmin = inject(AuthService).isAdmin;

  /** `?week=YYYY-MM-DD` — any day of the week to show; defaults to the current week. */
  readonly week = input<string>();

  protected readonly weekdays = WEEKDAYS;
  protected readonly weekStart = computed(() => {
    const week = this.week();
    return startOfWeek(isIsoDate(week) ? week : toIsoDate(new Date()));
  });
  protected readonly isCurrentWeek = computed(
    () => this.weekStart() === startOfWeek(toIsoDate(new Date())),
  );
  protected readonly weekLabel = computed(() => {
    const start = parseIsoDate(this.weekStart());
    const end = parseIsoDate(addDays(this.weekStart(), 6));
    const startLabel =
      start.getMonth() === end.getMonth()
        ? `${start.getDate()}`
        : `${start.getDate()} ${MONTHS[start.getMonth()]}`;
    return `Săptămâna ${startLabel} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  });

  protected readonly schedule = createQuery(
    () => this.weekStart(),
    (week) => this.academy.schedule(week),
  );
  protected readonly courses = createQuery(
    () => null,
    () => this.academy.courses(),
  );
  /** Prices are staff-only; coaches don't load them. */
  protected readonly isStaff = inject(AuthService).isStaff;
  protected readonly plans = createQuery(
    () => this.isStaff(),
    (staff) => (staff ? this.academy.plans() : of([])),
  );

  protected shiftWeek(weeks: number | null): void {
    const week = weeks === null ? null : addDays(this.weekStart(), weeks * 7);
    void this.router.navigate([], {
      queryParams: { week },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected dayNumber(date: string): number {
    return parseIsoDate(date).getDate();
  }

  protected entryStat(entry: ScheduleEntry): string {
    if (entry.state === 'live') return `${entry.attendance} prezenți · live`;
    if (entry.state === 'done') return `${entry.attendance} prezenți`;
    return entry.average !== null ? `~${entry.average} sportivi` : `${entry.slot.capacity} locuri`;
  }
}

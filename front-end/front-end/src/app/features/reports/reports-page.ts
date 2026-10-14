import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ReportsService } from '../../core/api/reports.service';
import { createQuery } from '../../core/data/query';
import {
  WEEKDAYS_SHORT,
  addMonthsToMonth,
  formatDayMonth,
  formatMonth,
  toIsoDate,
  toMonth,
} from '../../core/util/dates';
import { Icon } from '../../shared/ui/icon';

/** Hours shown in the heat map (the gym's working day). */
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7);

@Component({
  selector: 'app-reports-page',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports-page.html',
  styleUrl: './reports-page.css',
})
export class ReportsPage {
  private readonly reports = inject(ReportsService);
  private readonly router = inject(Router);

  /** `?luna=YYYY-MM` */
  readonly luna = input<string>();

  protected readonly currentMonth = toMonth(toIsoDate(new Date()));
  protected readonly month = computed(() => {
    const m = this.luna();
    return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : this.currentMonth;
  });
  protected readonly monthLabel = computed(() => formatMonth(this.month()));
  protected readonly data = createQuery(
    () => this.month(),
    (month) => this.reports.summary(month),
  );

  protected readonly hours = HOURS;
  protected readonly weekdays = WEEKDAYS_SHORT;

  protected readonly maxCourse = computed(() =>
    Math.max(...(this.data.value()?.byCourse ?? []).map((c) => c.checkins), 1),
  );

  /** 7 rows (Mon–Sun) × working hours, with an intensity from 0 to 1. */
  protected readonly heatmap = computed(() => {
    const cells = this.data.value()?.heatmap ?? [];
    const max = Math.max(...cells.map((c) => c.count), 1);
    const at = new Map(cells.map((c) => [`${c.weekday}|${c.hour}`, c.count]));
    return WEEKDAYS_SHORT.map((label, i) => ({
      label,
      cells: HOURS.map((hour) => {
        const count = at.get(`${i + 1}|${hour}`) ?? 0;
        return { hour, count, level: count / max };
      }),
    }));
  });

  protected readonly busiest = computed(() => {
    const top = [...(this.data.value()?.heatmap ?? [])].sort((a, b) => b.count - a.count)[0];
    return top ? `${WEEKDAYS_SHORT[top.weekday - 1]} ${top.hour}:00 (${top.count})` : '—';
  });

  protected csv(kind: 'attendance' | 'payments' | 'members'): string {
    return this.reports.csvUrl(kind, this.month());
  }

  protected shiftMonth(delta: number): void {
    const next = addMonthsToMonth(this.month(), delta);
    void this.router.navigate([], {
      queryParams: { luna: next === this.currentMonth ? null : next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected lastSeen(date: string | null, days: number | null): string {
    return date
      ? `ultima dată ${formatDayMonth(date)} (acum ${days} zile)`
      : 'nu a venit niciodată';
  }
}

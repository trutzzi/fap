import type { Response } from 'express';
import {
  CourseReport,
  InactiveMember,
  MemberStatus,
  ReportsSummary,
} from '../../app/core/api/models';
import { METHOD_LABELS } from '../../app/core/api/finance.service';
import {
  addDays,
  daysBetween,
  daysInMonth,
  formatDayMonth,
  isoWeekday,
  toIsoDate,
} from '../../app/core/util/dates';
import { Db } from './db';
import { Views } from './views';

const INACTIVE_DAYS = 14;
const BOM = String.fromCharCode(0xfeff);

const STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Activ',
  expiring: 'Expiră curând',
  limit: 'Limită atinsă',
  expired: 'Expirat',
  none: 'Fără abonament',
};

/** Mock of the back-end's `/reports` summary and CSV exports (see reports.routes.ts there). */
export class MockReports {
  constructor(
    private readonly db: Db,
    private readonly views: Views,
  ) {}

  summary(month: string): ReportsSummary {
    const today = toIsoDate(new Date());
    const checkIns = this.db.checkins.filter((c) => c.date.startsWith(month));
    const slotCourse = new Map(this.db.slots.map((s) => [s.id, s.courseId]));

    const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    const weekdayCount = new Map<number, number>();
    for (let d = `${month}-01`; d <= lastDay && d <= today; d = addDays(d, 1)) {
      weekdayCount.set(isoWeekday(d), (weekdayCount.get(isoWeekday(d)) ?? 0) + 1);
    }

    const byCourse: CourseReport[] = [
      ...this.db.courses.map((c) => ({
        courseId: c.id as string | null,
        name: c.name,
        color: c.color,
      })),
      { courseId: null, name: 'Acces liber / altele', color: '#a0a0a8' },
    ]
      .map(({ courseId, name, color }) => {
        const rows = checkIns.filter(
          (c) => ((c.slotId && slotCourse.get(c.slotId)) ?? null) === courseId,
        );
        const trainings = courseId
          ? this.db.slots
              .filter((s) => s.courseId === courseId)
              .reduce((sum, s) => sum + (weekdayCount.get(s.weekday) ?? 0), 0)
          : 0;
        return {
          courseId,
          name,
          color,
          checkins: rows.length,
          members: new Set(rows.map((r) => r.memberId)).size,
          trainings,
          average: trainings ? Math.round((rows.length / trainings) * 10) / 10 : null,
        };
      })
      .filter((c) => c.courseId !== null || c.checkins > 0);

    const cells = new Map<string, number>();
    for (const c of checkIns) {
      const key = `${isoWeekday(c.date)}|${new Date(c.timestamp).getHours()}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }

    const lastSeen = new Map<string, string>();
    for (const c of this.db.checkins) {
      if (c.date > (lastSeen.get(c.memberId) ?? '')) lastSeen.set(c.memberId, c.date);
    }
    const inactive: InactiveMember[] = this.db.members
      .map((m) => this.views.summary(m))
      .filter((m) => m.subscription && ['active', 'expiring', 'limit'].includes(m.status))
      .map((m) => {
        const lastCheckIn = lastSeen.get(m.id) ?? null;
        return {
          memberId: m.id,
          fullName: m.fullName,
          phone: m.phone,
          planName: m.subscription!.planName,
          lastCheckIn,
          daysSince: lastCheckIn ? daysBetween(lastCheckIn, today) : null,
        };
      })
      .filter((m) => m.daysSince === null || m.daysSince >= INACTIVE_DAYS)
      .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));

    const perMember = new Map<string, { fullName: string; checkins: number }>();
    for (const c of checkIns) {
      const m = this.db.members.find((x) => x.id === c.memberId);
      const entry = perMember.get(c.memberId) ?? {
        fullName: m ? `${m.firstName} ${m.lastName}` : '—',
        checkins: 0,
      };
      entry.checkins++;
      perMember.set(c.memberId, entry);
    }

    return {
      month,
      totals: {
        checkins: checkIns.length,
        members: perMember.size,
        refused: this.db.refusedScans.filter((r) => r.date.startsWith(month)).length,
      },
      byCourse,
      heatmap: [...cells.entries()].map(([key, count]) => {
        const [weekday, hour] = key.split('|').map(Number);
        return { weekday, hour, count };
      }),
      inactive,
      inactiveDays: INACTIVE_DAYS,
      topMembers: [...perMember.entries()]
        .map(([memberId, v]) => ({ memberId, ...v }))
        .sort((a, b) => b.checkins - a.checkins || a.fullName.localeCompare(b.fullName, 'ro'))
        .slice(0, 10),
    };
  }

  attendanceCsv(res: Response, month: string): void {
    const rows = this.db.checkins
      .filter((c) => c.date.startsWith(month))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((c) => {
        const m = this.db.members.find((x) => x.id === c.memberId);
        return [
          c.date,
          new Date(c.timestamp).toTimeString().slice(0, 5),
          m ? `${m.firstName} ${m.lastName}` : '',
          m?.phone ?? '',
          c.trainingLabel ?? 'Acces liber',
          c.method === 'rfid' ? 'Card RFID' : 'Manual',
        ];
      });
    sendCsv(
      res,
      `prezente-${month}.csv`,
      ['Data', 'Ora', 'Membru', 'Telefon', 'Antrenament', 'Metodă'],
      rows,
    );
  }

  paymentsCsv(res: Response, month: string): void {
    const rows = this.db.payments
      .filter((p) => p.date.startsWith(month))
      .sort((a, b) => a.paidAt.localeCompare(b.paidAt))
      .map((p) => {
        const m = this.db.members.find((x) => x.id === p.memberId);
        const period = this.db.periods.find((x) => x.id === p.periodId);
        const plan = period && this.db.plans.find((x) => x.id === period.planId);
        return [
          p.date,
          m ? `${m.firstName} ${m.lastName}` : '',
          period && plan
            ? `${plan.name} · ${formatDayMonth(period.startDate)} – ${formatDayMonth(period.endDate)}`
            : '',
          METHOD_LABELS[p.method],
          p.amount,
          p.receivedBy ?? '',
          p.note,
        ];
      });
    sendCsv(
      res,
      `plati-${month}.csv`,
      ['Data', 'Membru', 'Abonament', 'Metodă', 'Sumă (lei)', 'Încasat de', 'Notă'],
      rows,
    );
  }

  membersCsv(res: Response): void {
    const rows = this.db.members.map((entity) => {
      const m = this.views.summary(entity);
      return [
        m.fullName,
        m.phone,
        m.email,
        m.courses.map((c) => c.name).join(', '),
        m.subscription?.planName ?? '',
        m.subscription?.endDate ?? '',
        m.subscription ? m.subscription.used : '',
        STATUS_LABELS[m.status],
        m.rfid ?? '',
      ];
    });
    sendCsv(
      res,
      `membri-${toIsoDate(new Date())}.csv`,
      [
        'Nume',
        'Telefon',
        'Email',
        'Cursuri',
        'Abonament',
        'Valabil până la',
        'Ședințe folosite',
        'Status',
        'Card RFID',
      ],
      rows,
    );
  }
}

/** Same format as the back-end: `;` separators, UTF-8 BOM, formula-injection guard. */
function sendCsv(
  res: Response,
  filename: string,
  header: string[],
  rows: (string | number | null)[][],
): void {
  const cell = (value: string | number | null): string => {
    if (value === null) return '';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const body = [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n');
  res
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .send(BOM + body + '\r\n');
}

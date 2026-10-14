import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AcademyService } from '../../core/api/academy.service';
import { TodayTraining } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { createQuery } from '../../core/data/query';
import { clock, onInterval } from '../../core/util/interval';
import { AttendeeList, attendeesSummary } from '../../shared/ui/attendee-list';

const REFRESH_MS = 30_000;

/** Today's classes with who checked in (coaches: only the courses they coach). */
@Component({
  selector: 'app-trainings-today-page',
  imports: [DatePipe, AttendeeList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trainings-today-page.html',
  styleUrl: './trainings-today-page.css',
})
export class TrainingsTodayPage {
  private readonly academy = inject(AcademyService);
  private readonly auth = inject(AuthService);

  protected readonly now = clock(30_000);
  protected readonly isStaff = this.auth.isStaff;
  protected readonly isCoach = () => this.auth.user()?.role === 'coach';
  protected readonly data = createQuery(
    () => null,
    () => this.academy.trainingsToday(),
  );
  protected readonly summary = attendeesSummary;

  constructor() {
    onInterval(REFRESH_MS, () => this.data.reload());
  }

  protected status(t: TodayTraining): string {
    if (t.state === 'done') return 'Încheiat';
    if (t.state === 'live') return 'În desfășurare';
    return `Începe la ${t.time}`;
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AcademyService } from '../../core/api/academy.service';
import { Course, TrainingSlot } from '../../core/api/models';
import { createQuery } from '../../core/data/query';
import { WEEKDAYS } from '../../core/util/dates';
import { Icon } from '../../shared/ui/icon';
import { CourseDialog } from './course-dialog';
import { SlotDialog } from './slot-dialog';

type CoursesDialog =
  | { kind: 'course'; course: Course | null }
  | { kind: 'slot'; slot: TrainingSlot | null; weekday: number };

/** Courses and the recurring weekly training template. */
@Component({
  selector: 'app-admin-courses-page',
  imports: [Icon, CourseDialog, SlotDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-courses-page.html',
  styleUrl: './admin-courses-page.css',
})
export class AdminCoursesPage {
  private readonly academy = inject(AcademyService);

  protected readonly courses = createQuery(
    () => null,
    () => this.academy.courses(),
  );
  protected readonly slots = createQuery(
    () => null,
    () => this.academy.slots(),
  );
  protected readonly dialog = signal<CoursesDialog | null>(null);

  protected readonly week = computed(() => {
    const byId = new Map((this.courses.value() ?? []).map((c) => [c.id, c]));
    const slots = this.slots.value() ?? [];
    return WEEKDAYS.map((name, i) => ({
      name,
      weekday: i + 1,
      entries: slots
        .filter((s) => s.weekday === i + 1)
        .map((slot) => ({ slot, course: byId.get(slot.courseId) })),
    }));
  });

  protected reload(): void {
    this.courses.reload();
    this.slots.reload();
  }
}

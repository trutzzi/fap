import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { Course } from '../../core/api/models';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { Modal } from '../../shared/ui/modal';

@Component({
  selector: 'app-course-dialog',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="course() ? 'Editează cursul' : 'Curs nou'" (closed)="closed.emit()">
      <form class="form" [formGroup]="form" (ngSubmit)="save()">
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <div class="field">
          <label for="course-name">Nume curs</label>
          <input id="course-name" class="input" formControlName="name" autofocus />
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="course-coach">Antrenor</label>
            <input id="course-coach" class="input" formControlName="coach" />
          </div>
          <div class="field">
            <label for="course-color">Culoare în orar</label>
            <input id="course-color" class="input" type="color" formControlName="color" />
          </div>
        </div>
        <div class="field">
          <label for="course-coach-account">Cont antrenor</label>
          <select id="course-coach-account" class="input" formControlName="coachUserId">
            <option [ngValue]="null">Niciun cont</option>
            @for (c of coaches.value() ?? []; track c.id) {
              <option [ngValue]="c.id">{{ c.name }}</option>
            }
          </select>
          <span class="field-hint">
            Antrenorul vede prezențele de azi la acest curs. Conturile se creează cu
            <code>npm run user:create -- --role coach</code>.
          </span>
        </div>
        <div class="form-footer">
          @if (course(); as c) {
            <button
              type="button"
              class="btn btn-danger start"
              [disabled]="saving()"
              (click)="remove(c)"
            >
              {{ confirmingDelete() ? 'Confirmă ștergerea' : 'Șterge cursul' }}
            </button>
          }
          <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving() || form.invalid">
            Salvează
          </button>
        </div>
        @if (confirmingDelete()) {
          <p class="field-error" role="alert" style="margin: 0">
            Ștergerea elimină și antrenamentele cursului din orar și îl scoate de la membrii
            înscriși.
          </p>
        }
      </form>
    </app-modal>
  `,
})
export class CourseDialog implements OnInit {
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  readonly course = input<Course | null>(null);
  readonly changed = output<void>();
  readonly closed = output<void>();

  protected readonly coaches = createQuery(
    () => null,
    () => this.academy.coaches(),
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    coach: ['', [Validators.required, Validators.maxLength(60)]],
    color: ['#ff3b3b', Validators.required],
    coachUserId: [null as string | null],
  });

  ngOnInit(): void {
    const c = this.course();
    if (c) {
      this.form.setValue({
        name: c.name,
        coach: c.coach,
        color: c.color,
        coachUserId: c.coachUserId,
      });
    }
  }

  protected save(): void {
    if (this.form.invalid) return;
    const c = this.course();
    const input = this.form.getRawValue();
    this.run(
      c ? this.academy.updateCourse(c.id, input) : this.academy.createCourse(input),
      'Cursul a fost salvat.',
    );
  }

  protected remove(course: Course): void {
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.run(this.academy.deleteCourse(course.id), `Cursul ${course.name} a fost șters.`);
  }

  private run(request: Observable<unknown>, success: string): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.toast.success(success);
        this.changed.emit();
        this.modal().close();
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }
}

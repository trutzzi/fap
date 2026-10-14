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
import { Course, TrainingSlot } from '../../core/api/models';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { WEEKDAYS } from '../../core/util/dates';
import { Modal } from '../../shared/ui/modal';

/** Create or edit a recurring weekly training. */
@Component({
  selector: 'app-slot-dialog',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [heading]="slot() ? 'Editează antrenamentul' : 'Antrenament nou'"
      (closed)="closed.emit()"
    >
      <form class="form" [formGroup]="form" (ngSubmit)="save()">
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <div class="form-grid">
          <div class="field">
            <label for="slot-course">Curs</label>
            <select id="slot-course" class="input" formControlName="courseId">
              @for (course of courses(); track course.id) {
                <option [value]="course.id">{{ course.name }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="slot-day">Zi</label>
            <select id="slot-day" class="input" formControlName="weekday">
              @for (day of weekdays; track $index) {
                <option [ngValue]="$index + 1">{{ day }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="slot-time">Ora de început</label>
            <input id="slot-time" class="input" type="time" formControlName="time" />
          </div>
          <div class="field">
            <label for="slot-duration">Durată (minute)</label>
            <input
              id="slot-duration"
              class="input"
              type="number"
              min="15"
              max="240"
              step="15"
              formControlName="durationMin"
            />
          </div>
          <div class="field">
            <label for="slot-capacity">Locuri</label>
            <input
              id="slot-capacity"
              class="input"
              type="number"
              min="1"
              max="200"
              formControlName="capacity"
            />
          </div>
          <div class="field">
            <label for="slot-label">Etichetă (opțional)</label>
            <input
              id="slot-label"
              class="input"
              formControlName="label"
              placeholder="ex. Karate · Începători"
            />
          </div>
        </div>
        <div class="form-footer">
          @if (slot(); as s) {
            <button
              type="button"
              class="btn btn-danger start"
              [disabled]="saving()"
              (click)="remove(s)"
            >
              {{ confirmingDelete() ? 'Confirmă ștergerea' : 'Șterge' }}
            </button>
          }
          <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving() || form.invalid">
            Salvează
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class SlotDialog implements OnInit {
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  readonly slot = input<TrainingSlot | null>(null);
  readonly courses = input.required<Course[]>();
  readonly weekday = input(1);
  readonly changed = output<void>();
  readonly closed = output<void>();

  protected readonly weekdays = WEEKDAYS;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    courseId: ['', Validators.required],
    weekday: [1, Validators.required],
    time: ['18:00', Validators.required],
    durationMin: [60, [Validators.required, Validators.min(15), Validators.max(240)]],
    capacity: [20, [Validators.required, Validators.min(1), Validators.max(200)]],
    label: [''],
  });

  ngOnInit(): void {
    const s = this.slot();
    if (s) {
      this.form.setValue({
        courseId: s.courseId,
        weekday: s.weekday,
        time: s.time,
        durationMin: s.durationMin,
        capacity: s.capacity,
        label: s.label ?? '',
      });
    } else {
      this.form.patchValue({ courseId: this.courses()[0]?.id ?? '', weekday: this.weekday() });
    }
  }

  protected save(): void {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const input = { ...v, label: v.label.trim() || null };
    const s = this.slot();
    this.run(
      s ? this.academy.updateSlot(s.id, input) : this.academy.createSlot(input),
      'Orarul a fost actualizat.',
    );
  }

  protected remove(slot: TrainingSlot): void {
    if (!this.confirmingDelete()) {
      this.confirmingDelete.set(true);
      return;
    }
    this.run(this.academy.deleteSlot(slot.id), 'Antrenamentul a fost șters din orar.');
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

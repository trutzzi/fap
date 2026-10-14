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
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { Plan } from '../../core/api/models';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { Modal } from '../../shared/ui/modal';

/** Edit a plan's name, description, price and (limited plan only) session count. */
@Component({
  selector: 'app-plan-dialog',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="'Editează · ' + plan().name" (closed)="closed.emit()">
      <form class="form" [formGroup]="form" (ngSubmit)="save()">
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <div class="field">
          <label for="plan-name">Nume</label>
          <input id="plan-name" class="input" formControlName="name" autofocus />
        </div>
        <div class="field">
          <label for="plan-description">Descriere</label>
          <textarea
            id="plan-description"
            class="input textarea"
            rows="3"
            formControlName="description"
          ></textarea>
        </div>
        <div class="form-grid">
          @if (limited()) {
            <div class="field">
              <label for="plan-sessions">Ședințe pe perioadă</label>
              <input
                id="plan-sessions"
                class="input"
                type="number"
                min="1"
                max="100"
                formControlName="sessionLimit"
              />
            </div>
          }
          <div class="field">
            <label for="plan-price">Preț lunar (lei)</label>
            <input
              id="plan-price"
              class="input"
              type="number"
              min="0"
              step="1"
              formControlName="price"
            />
            <span class="field-hint">Lasă gol dacă prețul nu este stabilit încă.</span>
          </div>
        </div>
        @if (limited()) {
          <p class="field-hint" style="margin: 0">
            Schimbarea numărului de ședințe se aplică imediat tuturor abonamentelor de acest tip.
          </p>
        }
        <div class="form-footer">
          <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving() || form.invalid">
            Salvează
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class PlanDialog implements OnInit {
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  readonly plan = input.required<Plan>();
  readonly changed = output<void>();
  readonly closed = output<void>();

  protected readonly limited = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    description: ['', Validators.maxLength(300)],
    sessionLimit: [null as number | null, [Validators.min(1), Validators.max(100)]],
    price: [null as number | null, [Validators.min(0), Validators.max(100_000)]],
  });

  ngOnInit(): void {
    const p = this.plan();
    this.limited.set(p.sessionLimit !== null);
    if (this.limited()) this.form.controls.sessionLimit.addValidators(Validators.required);
    this.form.setValue({
      name: p.name,
      description: p.description,
      sessionLimit: p.sessionLimit,
      price: p.price,
    });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.academy
      .updatePlan(this.plan().id, { ...v, sessionLimit: this.limited() ? v.sessionLimit : null })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Abonamentul a fost actualizat.');
          this.changed.emit();
          this.modal().close();
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
  }
}

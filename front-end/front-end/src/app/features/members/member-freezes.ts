import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { MembersService } from '../../core/api/members.service';
import { SubscriptionFreeze, SubscriptionUsage } from '../../core/api/models';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { addDays, toIsoDate } from '../../core/util/dates';
import { ConfirmDialog } from '../../shared/dialogs/confirm-dialog';
import { DateInput } from '../../shared/ui/date-input';
import { IsoDatePipe } from '../../shared/ui/formatting';
import { Modal } from '../../shared/ui/modal';

/** Pausing the current subscription (holiday, injury) and the list of pauses. */
@Component({
  selector: 'app-member-freezes',
  imports: [ReactiveFormsModule, Modal, ConfirmDialog, DateInput, IsoDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (f of freezes(); track f.id) {
      <p class="freeze" [class.now]="f.from <= today && f.to >= today">
        <span>
          Suspendat {{ f.from | isoDate }} – {{ f.to | isoDate }} ({{ f.days }}
          {{ f.days === 1 ? 'zi' : 'zile' }}){{ f.reason ? ' · ' + f.reason : '' }}
        </span>
        @if (isAdmin()) {
          <button type="button" class="btn btn-sm btn-ghost" (click)="undoing.set(f)">
            Anulează
          </button>
        }
      </p>
    }
    <button type="button" class="btn btn-sm btn-ghost" (click)="open()">
      Suspendă abonamentul
    </button>

    @if (editing()) {
      <app-modal heading="Suspendă abonamentul" (closed)="editing.set(false)">
        <form class="form" [formGroup]="form" (ngSubmit)="save()" novalidate>
          <p class="muted" style="margin: 0">
            Abonamentul se prelungește cu zilele suspendate; ședințele nefolosite rămân. Acum expiră
            pe {{ subscription().endDate | isoDate }}.
          </p>
          @if (error(); as message) {
            <div class="form-error" role="alert">{{ message }}</div>
          }
          <div class="form-grid">
            <div class="field">
              <label for="freeze-from">Începând cu</label>
              <app-date-input inputId="freeze-from" formControlName="from" />
            </div>
            <div class="field">
              <label for="freeze-days">Zile</label>
              <input
                id="freeze-days"
                class="input"
                type="number"
                min="1"
                max="90"
                formControlName="days"
              />
            </div>
          </div>
          <div class="field">
            <label for="freeze-reason">Motiv (opțional)</label>
            <input
              id="freeze-reason"
              class="input"
              formControlName="reason"
              placeholder="Concediu, accidentare…"
            />
          </div>
          <p class="muted" style="margin: 0">
            Va expira pe <strong>{{ newEnd() | isoDate }}</strong
            >.
          </p>
          <div class="form-footer">
            <button type="button" class="btn btn-ghost" (click)="editing.set(false)">
              Anulează
            </button>
            <button type="submit" class="btn btn-primary" [disabled]="saving() || form.invalid">
              Suspendă
            </button>
          </div>
        </form>
      </app-modal>
    }
    @if (undoing(); as f) {
      <app-confirm-dialog
        heading="Anulează suspendarea"
        [message]="
          'Anulezi suspendarea ' +
          (f.from | isoDate) +
          ' – ' +
          (f.to | isoDate) +
          '? Data de expirare revine cu ' +
          f.days +
          ' zile mai devreme.'
        "
        confirmLabel="Anulează suspendarea"
        [action]="undoAction"
        (done)="done('Suspendarea a fost anulată.')"
        (closed)="undoing.set(null)"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .freeze {
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .freeze.now {
      color: var(--warning);
      font-weight: 600;
    }
  `,
})
export class MemberFreezes {
  private readonly members = inject(MembersService);
  private readonly toast = inject(ToastService);

  readonly memberId = input.required<string>();
  readonly subscription = input.required<SubscriptionUsage>();
  readonly freezes = input<SubscriptionFreeze[]>([]);
  readonly isAdmin = input(false);
  readonly changed = output<void>();

  protected readonly today = toIsoDate(new Date());
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly undoing = signal<SubscriptionFreeze | null>(null);
  protected readonly undoAction = () => this.members.unfreeze(this.memberId(), this.undoing()!.id);

  protected readonly form = inject(NonNullableFormBuilder).group({
    from: [this.today, Validators.required],
    days: [7, [Validators.required, Validators.min(1), Validators.max(90)]],
    reason: ['', Validators.maxLength(200)],
  });

  protected newEnd(): string {
    const days = Number(this.form.controls.days.value) || 0;
    return addDays(this.subscription().endDate, Math.max(days, 0));
  }

  protected open(): void {
    const sub = this.subscription();
    const from = this.today < sub.startDate ? sub.startDate : this.today;
    this.form.reset({ from, days: 7, reason: '' });
    this.error.set(null);
    this.editing.set(true);
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    const { from, days, reason } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.members
      .freeze(this.memberId(), { from, days: Number(days), reason })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.editing.set(false);
          this.done(`Abonamentul a fost suspendat ${days} zile.`);
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
  }

  protected done(message: string): void {
    this.toast.success(message);
    this.changed.emit();
  }
}

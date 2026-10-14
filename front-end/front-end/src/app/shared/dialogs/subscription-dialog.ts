import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { MembersService } from '../../core/api/members.service';
import { MemberSummary, PlanId } from '../../core/api/models';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { addDays, addMonths, isIsoDate, toIsoDate } from '../../core/util/dates';
import { IsoDatePipe } from '../ui/formatting';
import { Modal } from '../ui/modal';

/**
 * Renew a subscription (new period) or switch plan within the current period.
 * Setting a subscription replaces the member's current one.
 */
@Component({
  selector: 'app-subscription-dialog',
  imports: [Modal, ReactiveFormsModule, IsoDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [heading]="mode() === 'renew' ? 'Reînnoiește abonamentul' : 'Schimbă abonamentul'"
      (closed)="closed.emit()"
    >
      <form class="form" [formGroup]="form" (ngSubmit)="submit()">
        <p class="muted" style="margin: 0">
          {{ member().fullName }}
          @if (member().subscription; as sub) {
            · acum: {{ sub.planName }}, până la {{ sub.endDate | isoDate }}
          }
        </p>
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <fieldset class="field">
          <legend>Tip abonament</legend>
          <div class="checks">
            @for (plan of plans.value() ?? []; track plan.id) {
              <label class="check">
                <input type="radio" formControlName="planId" [value]="plan.id" />
                {{ plan.name }}
                <span class="muted">· {{ plan.price === null ? '[PREȚ]' : plan.price }} lei</span>
              </label>
            }
          </div>
        </fieldset>
        <div class="field">
          <label for="subscription-start">Începe la</label>
          <input id="subscription-start" class="input" type="date" formControlName="startDate" />
          @if (endDate(); as end) {
            <span class="field-hint">Valabil până la {{ end | isoDate }} inclusiv.</span>
          }
        </div>
        <div class="form-footer">
          <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving() || form.invalid">
            {{ saving() ? 'Se salvează…' : 'Confirmă' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class SubscriptionDialog implements OnInit {
  private readonly members = inject(MembersService);
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  readonly member = input.required<MemberSummary>();
  /** `renew` starts a new period today; `change` keeps the current period dates. */
  readonly mode = input<'renew' | 'change'>('renew');
  readonly plan = input<PlanId | null>(null);
  readonly saved = output<MemberSummary>();
  readonly closed = output<void>();

  protected readonly plans = createQuery(
    () => null,
    () => this.academy.plans(),
  );
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    planId: ['sessions12' as PlanId, Validators.required],
    startDate: [toIsoDate(new Date()), Validators.required],
  });

  private readonly startDate = toSignal(this.form.controls.startDate.valueChanges, {
    initialValue: this.form.controls.startDate.value,
  });
  protected readonly endDate = computed(() => {
    const start = this.startDate();
    return isIsoDate(start) ? addDays(addMonths(start, 1), -1) : null;
  });

  ngOnInit(): void {
    const sub = this.member().subscription;
    const keepPeriod = this.mode() === 'change' && sub;
    this.form.setValue({
      planId: this.plan() ?? sub?.planId ?? 'sessions12',
      startDate: keepPeriod ? sub.startDate : toIsoDate(new Date()),
    });
  }

  protected submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.members
      .setSubscription(this.member().id, this.form.getRawValue())
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (member) => {
          this.toast.success(`Abonamentul lui ${member.fullName} a fost actualizat.`);
          this.saved.emit(member);
          this.modal().close();
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
  }
}

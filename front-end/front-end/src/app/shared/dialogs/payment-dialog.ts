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
import { FinanceService, PAYMENT_METHODS } from '../../core/api/finance.service';
import { PaymentMethod, SubscriptionPeriod } from '../../core/api/models';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { IsoDatePipe } from '../ui/formatting';
import { Modal } from '../ui/modal';

/** Record a payment, usually for a subscription period ("Încasează"). */
@Component({
  selector: 'app-payment-dialog',
  imports: [Modal, ReactiveFormsModule, IsoDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Încasează" (closed)="closed.emit()">
      <form class="form" [formGroup]="form" (ngSubmit)="save()">
        <p class="muted" style="margin: 0">
          {{ memberName() }}
          @if (period(); as p) {
            · {{ p.planName }}, {{ p.startDate | isoDate: 'short' }} –
            {{ p.endDate | isoDate: 'short' }}
            @if (p.price !== null) {
              · rest de plată <strong>{{ p.due }} lei</strong>
            }
          }
        </p>
        @if (error(); as message) {
          <div class="form-error" role="alert">{{ message }}</div>
        }
        <div class="form-grid">
          <div class="field">
            <label for="payment-amount">Sumă (lei)</label>
            <input
              id="payment-amount"
              class="input"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              formControlName="amount"
              autofocus
              [attr.aria-invalid]="submitted() && form.controls.amount.invalid"
            />
            @if (submitted() && form.controls.amount.invalid) {
              <span class="field-error">Introdu o sumă în lei întregi.</span>
            }
          </div>
          <fieldset class="field">
            <legend>Metodă</legend>
            <div class="checks">
              @for (m of methods; track m.value) {
                <label class="check">
                  <input type="radio" formControlName="method" [value]="m.value" />
                  {{ m.label }}
                </label>
              }
            </div>
          </fieldset>
        </div>
        <div class="field">
          <label for="payment-note">Notă (opțional)</label>
          <input id="payment-note" class="input" formControlName="note" maxlength="200" />
        </div>
        <div class="form-footer">
          <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving()">
            {{ saving() ? 'Se salvează…' : 'Încasează' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
})
export class PaymentDialog implements OnInit {
  private readonly finance = inject(FinanceService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);

  readonly memberId = input.required<string>();
  readonly memberName = input.required<string>();
  readonly period = input<SubscriptionPeriod | null>(null);
  readonly saved = output<void>();
  readonly closed = output<void>();

  protected readonly methods = PAYMENT_METHODS;
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    amount: [
      null as number | null,
      [Validators.required, Validators.min(1), Validators.max(100_000)],
    ],
    method: ['cash' as PaymentMethod, Validators.required],
    note: [''],
  });

  ngOnInit(): void {
    const due = this.period()?.due;
    if (due) this.form.controls.amount.setValue(due);
  }

  protected save(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.saving()) return;
    const { amount, method, note } = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.finance
      .createPayment({
        memberId: this.memberId(),
        periodId: this.period()?.id ?? null,
        amount: Math.round(amount!),
        method,
        note,
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.toast.success(`Încasat: ${amount} lei.`);
          this.saved.emit();
          this.modal().close();
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
  }
}

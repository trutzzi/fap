import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { FinanceService, METHOD_LABELS } from '../../core/api/finance.service';
import { Payment, PeriodPaymentStatus, SubscriptionPeriod } from '../../core/api/models';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmDialog } from '../../shared/dialogs/confirm-dialog';
import { IsoDatePipe } from '../../shared/ui/formatting';
import { Icon } from '../../shared/ui/icon';
import { Modal } from '../../shared/ui/modal';

const BADGE: Record<PeriodPaymentStatus, { label: string; tone: string }> = {
  paid: { label: 'Plătit', tone: 'badge--success' },
  partial: { label: 'Parțial', tone: 'badge--warning' },
  unpaid: { label: 'Neplătit', tone: 'badge--danger' },
  'no-price': { label: 'Fără preț', tone: 'badge--muted' },
};

/**
 * The member's sold subscription periods with what was paid. Each period lists its
 * payments; an admin can delete a wrong payment and correct the period's price.
 */
@Component({
  selector: 'app-member-periods',
  imports: [DatePipe, IsoDatePipe, Icon, Modal, ReactiveFormsModule, ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="period-list">
      @for (p of periods(); track p.id) {
        <li class="period" [class.current]="p.current">
          <div class="period-main">
            <strong>{{ p.planName }}</strong>
            <span class="muted small">
              {{ p.startDate | isoDate }} – {{ p.endDate | isoDate }}
              @if (p.current) {
                · curent
              }
            </span>
          </div>
          <span class="period-amount">
            @if (p.price === null) {
              {{ p.paid ? p.paid + ' lei încasați · ' : '' }}<span class="muted">[PREȚ]</span>
            } @else {
              {{ p.paid }} / {{ p.price }} lei
            }
          </span>
          @if (p.price !== null && p.paid > p.price) {
            <!-- Usually a payment recorded twice: open "Plăți" to delete it. -->
            <span class="badge badge--warning">+{{ p.paid - p.price }} lei în plus</span>
          } @else {
            <span class="badge" [class]="badge[p.status].tone">{{ badge[p.status].label }}</span>
          }
          <div class="actions">
            @if (paymentsOf(p.id).length) {
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                [attr.aria-expanded]="open().has(p.id)"
                (click)="toggle(p.id)"
              >
                Plăți ({{ paymentsOf(p.id).length }})
              </button>
            }
            @if (isAdmin()) {
              <button type="button" class="btn btn-sm btn-ghost" (click)="editPrice(p)">
                Modifică prețul
              </button>
            }
            @if (p.status !== 'paid') {
              <button type="button" class="btn btn-sm" (click)="collect.emit(p)">Încasează</button>
            }
          </div>
          @if (open().has(p.id)) {
            <ul class="payments">
              @for (pay of paymentsOf(p.id); track pay.id) {
                <li>
                  <span>{{ pay.paidAt | date: 'dd-MM-yyyy, HH:mm' }}</span>
                  <strong>{{ pay.amount }} lei</strong>
                  <span class="muted">
                    {{ methods[pay.method] }}{{ pay.receivedBy ? ' · ' + pay.receivedBy : '' }}
                  </span>
                  @if (isAdmin()) {
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost btn-icon"
                      title="Șterge plata"
                      [attr.aria-label]="'Șterge plata de ' + pay.amount + ' lei'"
                      (click)="removing.set(pay)"
                    >
                      <app-icon name="close" [size]="16" />
                    </button>
                  }
                </li>
              }
            </ul>
          }
        </li>
      } @empty {
        <li class="state-message">Niciun abonament vândut încă.</li>
      }
    </ul>

    @if (removing(); as pay) {
      <app-confirm-dialog
        heading="Șterge plata"
        [message]="
          'Ștergi plata de ' +
          pay.amount +
          ' lei din ' +
          (pay.paidAt | date: 'dd-MM-yyyy') +
          '? Suma iese din încasări și din totalul perioadei. Acțiunea nu poate fi anulată.'
        "
        confirmLabel="Șterge plata"
        [action]="removeAction"
        (done)="onChanged('Plata a fost ștearsă.')"
        (closed)="removing.set(null)"
      />
    }

    @if (pricing(); as p) {
      <app-modal heading="Prețul perioadei" (closed)="pricing.set(null)">
        <form class="form" (ngSubmit)="savePrice(price.value)">
          <p class="muted" style="margin: 0">
            {{ p.planName }}, {{ p.startDate | isoDate }} – {{ p.endDate | isoDate }} · încasat
            {{ p.paid }} lei
          </p>
          @if (priceError(); as message) {
            <div class="form-error" role="alert">{{ message }}</div>
          }
          <div class="field">
            <label for="period-price">Preț (lei)</label>
            <input
              id="period-price"
              class="input"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              [formControl]="price"
            />
            <span class="field-hint">Lasă gol pentru „fără preț”.</span>
          </div>
          <div class="form-footer">
            <button type="button" class="btn btn-ghost" (click)="pricing.set(null)">
              Anulează
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              [disabled]="savingPrice() || price.invalid"
            >
              Salvează
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styles: `
    .period-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .period {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .period.current {
      border-color: var(--border-strong);
      background: var(--surface-soft);
    }
    .period-main {
      flex: 1 1 200px;
      display: flex;
      flex-direction: column;
    }
    .period-amount {
      font-weight: 600;
      color: var(--text-strong);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .payments {
      flex-basis: 100%;
      list-style: none;
      margin: 0;
      padding: 8px 0 0;
      border-top: 1px solid var(--border);
    }
    .payments li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 14px;
      padding: 4px 0;
      font-size: 14px;
    }
    .payments .muted {
      flex: 1;
    }
    .small {
      font-size: 13px;
    }
  `,
})
export class MemberPeriods {
  private readonly finance = inject(FinanceService);
  private readonly toast = inject(ToastService);

  readonly memberId = input.required<string>();
  /** Re-read when the parent reloads the member (new array after a change). */
  readonly periods = input.required<SubscriptionPeriod[]>();
  readonly isAdmin = input(false);
  readonly collect = output<SubscriptionPeriod>();
  /** A payment or a price changed: the parent reloads the member. */
  readonly changed = output<void>();

  protected readonly badge = BADGE;
  protected readonly methods = METHOD_LABELS;
  protected readonly payments = createQuery(
    () => ({ id: this.memberId(), periods: this.periods() }),
    ({ id }) => this.finance.memberPayments(id),
  );
  private readonly byPeriod = computed(() => {
    const map = new Map<string, Payment[]>();
    for (const p of this.payments.value() ?? []) {
      if (p.periodId) map.set(p.periodId, [...(map.get(p.periodId) ?? []), p]);
    }
    return map;
  });
  protected readonly open = signal(new Set<string>());
  protected readonly removing = signal<Payment | null>(null);
  protected readonly removeAction = () => this.finance.deletePayment(this.removing()!.id);

  protected readonly pricing = signal<SubscriptionPeriod | null>(null);
  protected readonly price = new FormControl<number | null>(null, [Validators.min(0)]);
  protected readonly savingPrice = signal(false);
  protected readonly priceError = signal<string | null>(null);

  protected paymentsOf(periodId: string): Payment[] {
    return this.byPeriod().get(periodId) ?? [];
  }

  protected toggle(periodId: string): void {
    const next = new Set(this.open());
    if (next.has(periodId)) next.delete(periodId);
    else next.add(periodId);
    this.open.set(next);
  }

  protected editPrice(period: SubscriptionPeriod): void {
    this.price.setValue(period.price);
    this.priceError.set(null);
    this.pricing.set(period);
  }

  protected savePrice(value: number | null): void {
    const period = this.pricing();
    if (!period || this.price.invalid) return;
    const price = value === null || (value as unknown) === '' ? null : Math.round(Number(value));
    this.savingPrice.set(true);
    this.finance
      .setPeriodPrice(period.id, { price })
      .pipe(finalize(() => this.savingPrice.set(false)))
      .subscribe({
        next: () => {
          this.pricing.set(null);
          this.onChanged('Prețul perioadei a fost actualizat.');
        },
        error: (err) => this.priceError.set(errorMessage(err)),
      });
  }

  protected onChanged(message: string): void {
    this.toast.success(message);
    this.changed.emit();
  }
}

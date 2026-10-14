import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FinanceService, METHOD_LABELS } from '../../core/api/finance.service';
import { Payment, UnpaidPeriod } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { MONTHS, addMonthsToMonth, formatMonth, toIsoDate, toMonth } from '../../core/util/dates';
import { PaymentDialog } from '../../shared/dialogs/payment-dialog';
import { IsoDatePipe } from '../../shared/ui/formatting';
import { Icon } from '../../shared/ui/icon';

/** Revenue, unpaid subscription periods and the month's payments. */
@Component({
  selector: 'app-payments-page',
  imports: [DatePipe, RouterLink, Icon, IsoDatePipe, PaymentDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payments-page.html',
  styleUrl: './payments-page.css',
})
export class PaymentsPage {
  private readonly finance = inject(FinanceService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly isAdmin = inject(AuthService).isAdmin;

  /** `?luna=YYYY-MM` */
  readonly luna = input<string>();

  protected readonly currentMonth = toMonth(toIsoDate(new Date()));
  protected readonly month = computed(() => {
    const m = this.luna();
    return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : this.currentMonth;
  });
  protected readonly monthLabel = computed(() => formatMonth(this.month()));
  protected readonly data = createQuery(
    () => this.month(),
    (month) => this.finance.summary(month),
  );
  protected readonly methodLabels = METHOD_LABELS;
  protected readonly collecting = signal<UnpaidPeriod | null>(null);

  protected readonly chart = computed(() => {
    const monthly = this.data.value()?.monthly ?? [];
    const max = Math.max(...monthly.map((m) => m.amount), 1);
    return monthly.map((m) => ({
      ...m,
      label: MONTHS[Number(m.month.slice(5, 7)) - 1].slice(0, 3),
      height: Math.round((m.amount / max) * 120),
      selected: m.month === this.month(),
    }));
  });

  protected readonly activeTotal = computed(() =>
    (this.data.value()?.subscriptions.activeByPlan ?? []).reduce((s, p) => s + p.count, 0),
  );

  protected shiftMonth(delta: number): void {
    const next = addMonthsToMonth(this.month(), delta);
    void this.router.navigate([], {
      queryParams: { luna: next === this.currentMonth ? null : next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected lei(amount: number): string {
    return `${amount.toLocaleString('ro-RO')} lei`;
  }

  protected remove(payment: Payment): void {
    if (!confirm(`Ștergi plata de ${payment.amount} lei de la ${payment.memberName}?`)) return;
    this.finance.deletePayment(payment.id).subscribe({
      next: () => {
        this.toast.success('Plata a fost ștearsă.');
        this.data.reload();
      },
      error: (err) => this.toast.error(errorMessage(err)),
    });
  }
}

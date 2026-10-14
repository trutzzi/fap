import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { FinanceSummary, NewPaymentInput, Payment, PaymentMethod } from './models';

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Numerar' },
  { value: 'card', label: 'Card' },
  { value: 'transfer', label: 'Transfer bancar' },
];

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Numerar',
  card: 'Card',
  transfer: 'Transfer bancar',
};

/** Payments, revenue and subscription sales (staff only). */
@Injectable({ providedIn: 'root' })
export class FinanceService {
  private readonly http = inject(HttpClient);

  summary(month: string): Observable<FinanceSummary> {
    return this.http.get<FinanceSummary>('/api/finance', { params: { month } });
  }

  createPayment(input: NewPaymentInput): Observable<Payment> {
    return this.http.post<Payment>('/api/payments', input);
  }

  deletePayment(id: string): Observable<void> {
    return this.http.delete<void>(`/api/payments/${encodeURIComponent(id)}`);
  }
}

import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SmsService } from '../../core/api/sms.service';
import { createQuery } from '../../core/data/query';

/**
 * The SMSLink balance, shown wherever the app sends SMS. With `need`, also how many SMS a
 * send will use, and a warning when the credit is not enough.
 */
@Component({
  selector: 'app-sms-credit',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (credit.value(); as c) {
      <p class="line" [class.warn]="short() || !c.configured || c.error">
        @if (need() !== null) {
          Se vor trimite <strong>{{ need() }} SMS</strong> ({{
            need() === 1 ? 'un SMS' : 'câte unul'
          }}
          pe număr de telefon) ·
        }
        @if (!c.configured) {
          SMSLink nu este configurat pe server: SMS-urile nu vor pleca.
        } @else if (c.error) {
          Creditul SMS nu poate fi citit ({{ c.error }}).
        } @else {
          Credit SMS: <strong>{{ c.credit | number: '1.0-0' : 'ro' }}</strong>
          @if (short()) {
            · insuficient pentru acest trimis
          }
        }
      </p>
    }
  `,
  styles: `
    .line {
      margin: 0;
      font-size: 13px;
      color: var(--text-muted);
    }
    .warn {
      color: var(--warning);
    }
  `,
})
export class SmsCreditInfo {
  private readonly sms = inject(SmsService);
  /** SMS the next send will use; `null` to show only the balance. */
  readonly need = input<number | null>(null);
  protected readonly credit = createQuery(
    () => null,
    () => this.sms.credit(),
  );
  protected readonly short = computed(() => {
    const c = this.credit.value()?.credit;
    const need = this.need();
    return c != null && need !== null && need > c;
  });
}

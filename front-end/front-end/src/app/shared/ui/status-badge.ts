import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MemberStatus } from '../../core/api/models';

const STATUS: Record<MemberStatus, { label: string; tone: string }> = {
  active: { label: 'Activ', tone: 'badge--success' },
  expiring: { label: 'Expiră curând', tone: 'badge--warning' },
  limit: { label: 'Limită atinsă', tone: 'badge--danger' },
  expired: { label: 'Expirat', tone: 'badge--muted' },
  none: { label: 'Fără abonament', tone: 'badge--muted' },
};

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="info().tone">{{ info().label }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<MemberStatus>();
  protected readonly info = computed(() => STATUS[this.status()]);
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AcademyService } from '../../core/api/academy.service';
import { Plan } from '../../core/api/models';
import { createQuery } from '../../core/data/query';
import { PlanDialog } from './plan-dialog';

@Component({
  selector: 'app-admin-plans-page',
  imports: [PlanDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (plans.error(); as message) {
      <div class="card state-message state-message--error" role="alert">{{ message }}</div>
    }
    <div class="plans">
      @for (p of plans.value() ?? []; track p.id) {
        <article class="card plan" [class.featured]="p.sessionLimit === null">
          <div class="card-header">
            <h2 class="plan-name">{{ p.name }}</h2>
            <button type="button" class="btn btn-sm" (click)="editing.set(p)">Editează</button>
          </div>
          <span class="price">
            {{ p.price === null ? '[PREȚ]' : p.price }} <span class="muted unit">lei / lună</span>
          </span>
          <p class="muted">{{ p.description }}</p>
          <dl class="facts">
            <div>
              <dt>Ședințe</dt>
              <dd>{{ p.sessionLimit === null ? 'Nelimitat' : p.sessionLimit + ' pe perioadă' }}</dd>
            </div>
            <div>
              <dt>Membri</dt>
              <dd>{{ p.memberCount }}</dd>
            </div>
          </dl>
        </article>
      }
    </div>
    @if (editing(); as plan) {
      <app-plan-dialog [plan]="plan" (changed)="plans.reload()" (closed)="editing.set(null)" />
    }
  `,
  styles: `
    .plans {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
      gap: 16px;
    }
    .plan.featured {
      border-color: var(--primary);
    }
    .plan-name {
      font-size: 24px;
      font-weight: 500;
    }
    .price {
      font-size: 28px;
      font-weight: 800;
      color: var(--text-strong);
    }
    .unit {
      font-size: 14px;
      font-weight: 600;
    }
    p {
      margin: 0;
      font-size: 14px;
    }
    .facts {
      display: flex;
      gap: 32px;
      margin: 0;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    dt {
      font-size: 12px;
      color: var(--text-muted);
    }
    dd {
      margin: 0;
      font-weight: 600;
      color: var(--text-strong);
    }
  `,
})
export class AdminPlansPage {
  private readonly academy = inject(AcademyService);
  protected readonly plans = createQuery(
    () => null,
    () => this.academy.plans(),
  );
  protected readonly editing = signal<Plan | null>(null);
}

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AcademyService } from '../../core/api/academy.service';
import { StaffAccount } from '../../core/api/models';
import { AuthService, ROLE_LABELS } from '../../core/auth/auth.service';
import { createQuery } from '../../core/data/query';
import { PasswordDialog } from '../../shared/dialogs/password-dialog';
import { StaffAccountDialog } from './staff-account-dialog';

/** Staff accounts: list, create, set a password. */
@Component({
  selector: 'app-admin-accounts-page',
  imports: [DatePipe, PasswordDialog, StaffAccountDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card accounts" aria-labelledby="accounts-title">
      <div class="card-header">
        <div>
          <h2 id="accounts-title" class="section-title">Conturi personal</h2>
          <p class="muted" style="margin: 4px 0 0">
            Setează parola oricărui cont. Persoana va fi deconectată și intră apoi cu parola nouă.
          </p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" (click)="creating.set(true)">
          Cont nou
        </button>
      </div>
      @if (accounts.error(); as message) {
        <div class="form-error" role="alert">{{ message }}</div>
      }
      <ul class="list">
        @for (a of accounts.value() ?? []; track a.id) {
          <li>
            <span class="who">
              <strong>{{ a.name }}</strong>
              @if (a.id === me()?.id) {
                <span class="badge badge--muted">tu</span>
              }
              @if (!a.active) {
                <span class="badge badge--danger">Dezactivat</span>
              }
              <span class="muted small">{{ a.email }} · {{ roleLabels[a.role] }}</span>
            </span>
            <span class="muted small last">
              {{
                a.lastLoginAt
                  ? 'Ultima autentificare: ' + (a.lastLoginAt | date: 'd MMM y, HH:mm')
                  : 'Nu s-a autentificat încă'
              }}
            </span>
            <button type="button" class="btn btn-sm" (click)="editing.set(a)">
              Setează parola
            </button>
          </li>
        } @empty {
          @if (!accounts.loading()) {
            <li class="state-message">Niciun cont.</li>
          }
        }
      </ul>
    </section>
    @if (editing(); as account) {
      <app-password-dialog [account]="account" (closed)="editing.set(null)" />
    }
    @if (creating()) {
      <app-staff-account-dialog (created)="accounts.reload()" (closed)="creating.set(false)" />
    }
  `,
  styles: `
    .accounts {
      max-width: 760px;
    }
    .list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .list li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .who {
      flex: 1 1 260px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
    }
    .who .small {
      flex-basis: 100%;
    }
    .small {
      font-size: 13px;
    }
  `,
})
export class AdminAccountsPage {
  private readonly academy = inject(AcademyService);
  protected readonly me = inject(AuthService).user;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly editing = signal<StaffAccount | null>(null);
  protected readonly creating = signal(false);
  protected readonly accounts = createQuery(
    () => null,
    () => this.academy.staffAccounts(),
  );
}

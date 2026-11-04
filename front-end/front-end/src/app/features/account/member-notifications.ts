import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  effect,
  inject,
  output,
  untracked,
} from '@angular/core';
import { MemberAccountService } from '../../core/account/member-account.service';
import { PushNotifications } from '../../core/account/push-notifications';
import { createQuery } from '../../core/data/query';
import { onInterval } from '../../core/util/interval';

const REFRESH_MS = 60_000;

/** The member's inbox ("Notificări") and the switch for phone notifications. */
@Component({
  selector: 'app-member-notifications',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="notif-title">
      <h2 id="notif-title" class="section-title">Notificări</h2>
      @switch (push.state()) {
        @case ('off') {
          <p class="muted small">
            Primește pe telefon confirmarea check-in-ului, reamintirile și anunțurile clubului.
          </p>
          <button type="button" class="btn btn-primary" (click)="enable()">
            Activează notificările
          </button>
        }
        @case ('on') {
          <p class="small on">
            Notificările pe telefon sunt pornite.
            <button type="button" class="btn btn-sm btn-ghost" (click)="push.disable()">
              Oprește
            </button>
          </p>
        }
        @case ('blocked') {
          <p class="muted small">
            Notificările sunt blocate pentru acest site. Le poți permite din setările browserului.
          </p>
        }
        @case ('needs-install') {
          <p class="muted small">
            Pe iPhone, notificările merg după ce adaugi aplicația pe ecranul principal (Partajează →
            „Adaugă pe ecranul principal”) și o deschizi de acolo.
          </p>
        }
      }

      <ul class="inbox">
        @for (n of notifications.value() ?? []; track n.id) {
          <li [class.refused]="n.kind === 'refused'">
            <div class="head">
              <strong>{{ n.title }}</strong>
              @if (!n.read) {
                <span class="badge badge--success">Nou</span>
              }
            </div>
            <span>{{ n.body }}</span>
            <span class="muted small">{{ n.createdAt | date: 'dd-MM-yyyy, HH:mm' }}</span>
          </li>
        } @empty {
          <li class="muted small">Nicio notificare încă.</li>
        }
      </ul>
    </section>
  `,
  styles: `
    .small {
      margin: 0;
      font-size: 13px;
    }
    .on {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .inbox {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 320px;
      overflow-y: auto;
    }
    .inbox li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 10px;
      border-left: 3px solid var(--success);
      font-size: 14px;
    }
    .inbox li.refused {
      border-left-color: var(--danger);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `,
})
export class MemberNotifications {
  private readonly accounts = inject(MemberAccountService);
  protected readonly push = inject(PushNotifications);
  /** Something was marked read: the parent refreshes the account's counters. */
  readonly seen = output<void>();

  protected readonly notifications = createQuery(
    () => null,
    () => this.accounts.notifications(),
  );

  constructor() {
    afterNextRender(() => void this.push.refresh());
    onInterval(REFRESH_MS, () => this.notifications.reload());
    // Listed means seen; "Nou" stays on screen until the next refresh.
    effect(() => {
      if (this.notifications.value()?.some((n) => !n.read)) {
        untracked(() => this.accounts.markNotificationsRead().subscribe(() => this.seen.emit()));
      }
    });
  }

  protected async enable(): Promise<void> {
    await this.push.enable();
  }
}

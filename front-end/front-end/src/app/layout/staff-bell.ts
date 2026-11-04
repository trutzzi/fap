import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { StaffEventKind, StaffNotifications } from '../core/api/models';
import { createQuery } from '../core/data/query';
import { onInterval } from '../core/util/interval';
import { Modal } from '../shared/ui/modal';

const REFRESH_MS = 30_000;

const TONE: Record<StaffEventKind, string> = {
  checkin: 'var(--success)',
  refused: 'var(--danger)',
  'sms-sent': 'var(--text-muted)',
  'sms-failed': 'var(--warning)',
};

/** The staff bell: latest check-ins, refused scans and SMS, with an unread count. */
@Component({
  selector: 'app-staff-bell',
  imports: [DatePipe, Modal, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="btn btn-sm btn-ghost bell"
      [attr.aria-label]="'Notificări' + (unread() ? ', ' + unread() + ' noi' : '')"
      title="Notificări"
      (click)="openFeed()"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      @if (unread()) {
        <span class="count">{{ unread() > 99 ? '99+' : unread() }}</span>
      }
    </button>
    @if (open()) {
      <app-modal heading="Notificări" (closed)="open.set(false)">
        <ul class="feed">
          @for (e of feed.value()?.items ?? []; track e.id) {
            <li [style.--tone]="tone[e.kind]">
              <span class="time muted">{{ e.at | date: 'dd-MM, HH:mm' }}</span>
              <span class="what">
                @if (e.memberId && e.memberName) {
                  <a [routerLink]="['/membri', e.memberId]" (click)="open.set(false)">{{
                    e.memberName
                  }}</a>
                } @else if (e.memberName) {
                  <strong>{{ e.memberName }}</strong>
                }
                <span>{{ e.text }}</span>
              </span>
            </li>
          } @empty {
            <li class="muted">Nimic nou încă.</li>
          }
        </ul>
      </app-modal>
    }
  `,
  styles: `
    .bell {
      position: relative;
    }
    .count {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 9px;
      background: var(--accent);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      line-height: 18px;
    }
    .feed {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      max-height: 60vh;
      overflow-y: auto;
    }
    .feed li {
      display: flex;
      gap: 12px;
      padding: 10px 4px 10px 10px;
      border-left: 3px solid var(--tone);
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }
    .time {
      flex: none;
      width: 84px;
    }
    .what {
      display: flex;
      flex-direction: column;
    }
  `,
})
export class StaffBell {
  private readonly http = inject(HttpClient);
  protected readonly tone = TONE;
  protected readonly open = signal(false);
  protected readonly feed = createQuery(
    () => null,
    () => this.http.get<StaffNotifications>('/api/notifications'),
  );
  protected readonly unread = computed(() => this.feed.value()?.unread ?? 0);

  constructor() {
    onInterval(REFRESH_MS, () => this.feed.reload());
  }

  /** Opening marks everything seen; the reload brings the count back to 0. */
  protected openFeed(): void {
    this.open.set(true);
    this.http.post<void>('/api/notifications/seen', {}).subscribe(() => this.feed.reload());
  }
}

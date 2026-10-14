import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Attendee, RefusalReason } from '../../core/api/models';
import { MemberAvatar } from './member-avatar';
import { StatusBadge } from './status-badge';

const REFUSED: Record<RefusalReason, string> = {
  limit: 'Refuzat · limită atinsă',
  expired: 'Refuzat · abonament expirat',
  'no-subscription': 'Refuzat · fără abonament',
};

/** "12 prezenți · 2 refuzați" for a disclosure summary. */
export function attendeesSummary(attendees: Attendee[]): string {
  const refused = attendees.filter((a) => a.refused).length;
  const admitted = attendees.length - refused;
  const parts = [admitted === 1 ? '1 prezent' : `${admitted} prezenți`];
  if (refused) parts.push(refused === 1 ? '1 refuzat' : `${refused} refuzați`);
  return parts.join(' · ');
}

/** Who came to a training: admitted members, then refused scans in red. */
@Component({
  selector: 'app-attendee-list',
  imports: [DatePipe, RouterLink, MemberAvatar, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="list">
      @for (a of attendees(); track a.memberId + (a.refused ?? '')) {
        <li class="row" [class.refused]="a.refused">
          <app-member-avatar [initials]="a.initials" [photoUrl]="a.photoUrl" [size]="photoSize()" />
          <div class="who">
            @if (linkToProfile()) {
              <a class="name" [routerLink]="['/membri', a.memberId]">{{ a.fullName }}</a>
            } @else {
              <span class="name">{{ a.fullName }}</span>
            }
            <span class="meta">
              {{ a.timestamp | date: 'HH:mm' }} ·
              @if (a.refused; as reason) {
                <strong class="refused-text">{{ refusedLabel[reason] }}</strong>
              } @else {
                {{ a.usageLabel }}
              }
            </span>
          </div>
          <app-status-badge [status]="a.status" />
        </li>
      } @empty {
        <li class="empty muted">{{ emptyText() }}</li>
      }
    </ul>
  `,
  styles: `
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      background: var(--surface-soft);
      border: 1px solid var(--border);
    }
    .row.refused {
      border-color: var(--danger);
      background: var(--danger-soft);
    }
    .who {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .name {
      font-weight: 600;
      color: var(--text-strong);
      text-decoration: none;
    }
    a.name:hover {
      color: var(--accent);
    }
    .meta {
      font-size: 13px;
      color: var(--text-muted);
    }
    .refused-text {
      color: var(--danger);
    }
    .empty {
      padding: 8px 2px;
      font-size: 13px;
    }
  `,
})
export class AttendeeList {
  readonly attendees = input.required<Attendee[]>();
  /** Staff can open the member's profile; coaches can't. */
  readonly linkToProfile = input(false);
  readonly photoSize = input(40);
  readonly emptyText = input('Nimeni încă.');

  protected readonly refusedLabel = REFUSED;
}

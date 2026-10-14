import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { MembersService } from '../../core/api/members.service';
import { MemberSummary } from '../../core/api/models';
import { createQuery } from '../../core/data/query';
import { Icon } from '../ui/icon';
import { MemberAvatar } from '../ui/member-avatar';
import { Modal } from '../ui/modal';
import { StatusBadge } from '../ui/status-badge';

const SEARCH_DEBOUNCE_MS = 250;

/** Search for a member by name or phone and pick one (manual check-in). */
@Component({
  selector: 'app-member-picker-dialog',
  imports: [Modal, Icon, StatusBadge, MemberAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="heading()" (closed)="closed.emit()">
      <label class="search">
        <app-icon name="search" [size]="18" />
        <span class="visually-hidden">Caută membru</span>
        <input
          #search
          class="input"
          type="search"
          autocomplete="off"
          autofocus
          placeholder="Nume sau telefon"
          [value]="term()"
          (input)="term.set(search.value)"
        />
      </label>
      <ul class="results" aria-live="polite">
        @if (results.error(); as message) {
          <li class="state-message state-message--error">{{ message }}</li>
        } @else {
          @for (member of results.value()?.items ?? []; track member.id) {
            <li>
              <button type="button" class="row-item result" (click)="pick(member)">
                <app-member-avatar [initials]="member.initials" [photoUrl]="member.photoUrl" />
                <span class="who">
                  <strong>{{ member.fullName }}</strong>
                  <span class="muted">{{ member.phone }}</span>
                </span>
                <app-status-badge [status]="member.status" />
              </button>
            </li>
          } @empty {
            <li class="state-message">
              {{ results.loading() ? 'Se caută…' : 'Niciun membru găsit.' }}
            </li>
          }
        }
      </ul>
    </app-modal>
  `,
  styles: `
    .search {
      position: relative;
      display: block;
      color: var(--text-muted);
    }
    .search app-icon {
      position: absolute;
      left: 14px;
      top: 13px;
    }
    .search .input {
      padding-left: 42px;
    }
    .results {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 120px;
    }
    .result {
      width: 100%;
      min-height: 56px;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .result:hover {
      border-color: var(--border-strong);
      background: var(--surface-hover);
    }
    .who {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      font-size: 14px;
    }
    .who strong {
      color: var(--text-strong);
    }
  `,
})
export class MemberPickerDialog {
  private readonly members = inject(MembersService);
  private readonly modal = viewChild.required(Modal);

  readonly heading = input('Check-in manual');
  readonly picked = output<MemberSummary>();
  readonly closed = output<void>();

  protected readonly term = signal('');
  private readonly debouncedTerm = toSignal(
    toObservable(this.term).pipe(debounceTime(SEARCH_DEBOUNCE_MS)),
    {
      initialValue: '',
    },
  );
  protected readonly results = createQuery(
    () => this.debouncedTerm().trim(),
    (q) => this.members.list({ q, pageSize: 6 }),
  );

  protected pick(member: MemberSummary): void {
    this.picked.emit(member);
    this.modal().close();
  }
}

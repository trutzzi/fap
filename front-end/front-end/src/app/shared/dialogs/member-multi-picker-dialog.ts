import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { MembersService } from '../../core/api/members.service';
import { MemberFilter, MemberSummary } from '../../core/api/models';
import { createQuery } from '../../core/data/query';
import { MemberAvatar } from '../ui/member-avatar';
import { Modal } from '../ui/modal';
import { StatusBadge } from '../ui/status-badge';

const SEARCH_DEBOUNCE_MS = 250;
/** Shown at once; narrow the search or filters for more. */
const MAX_RESULTS = 100;

const FILTERS: { value: MemberFilter; label: string }[] = [
  { value: 'all', label: 'Toți' },
  { value: 'active', label: 'Activi' },
  { value: 'expiring', label: 'Expiră curând' },
  { value: 'limit', label: 'Limită atinsă' },
  { value: 'expired', label: 'Expirați / fără abonament' },
];

/** Pick many members at once: search and filter, tick them (or all results), add. */
@Component({
  selector: 'app-member-multi-picker-dialog',
  imports: [Modal, StatusBadge, MemberAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="heading()" [wide]="true" (closed)="closed.emit()">
      <div class="filters">
        <input
          #search
          class="input"
          type="search"
          autocomplete="off"
          placeholder="Caută după nume sau telefon"
          aria-label="Caută membru"
          [value]="term()"
          (input)="term.set(search.value)"
        />
        <select #status class="input" aria-label="Status" (change)="filter.set($any(status.value))">
          @for (f of filters; track f.value) {
            <option [value]="f.value">{{ f.label }}</option>
          }
        </select>
        <select #course class="input" aria-label="Curs" (change)="courseId.set(course.value)">
          <option value="">Toate cursurile</option>
          @for (c of courses.value() ?? []; track c.id) {
            <option [value]="c.id">{{ c.name }}</option>
          }
        </select>
      </div>

      <label class="check all">
        <input
          type="checkbox"
          [checked]="allShownPicked()"
          [disabled]="!shown().length"
          (change)="toggleShown($any($event.target).checked)"
        />
        Selectează toți ({{ shown().length }}{{ more() ? '+' : '' }})
      </label>

      <ul class="results" aria-live="polite">
        @for (m of shown(); track m.id) {
          <li>
            <label class="row-item result">
              <input
                type="checkbox"
                [checked]="picked().has(m.id)"
                (change)="toggle(m, $any($event.target).checked)"
              />
              <app-member-avatar [initials]="m.initials" [photoUrl]="m.photoUrl" />
              <span class="who">
                <strong>{{ m.fullName }}</strong>
                <span class="muted">{{ m.phone }}</span>
              </span>
              <app-status-badge [status]="m.status" />
            </label>
          </li>
        } @empty {
          <li class="state-message">
            {{ results.loading() ? 'Se caută…' : 'Niciun membru găsit.' }}
          </li>
        }
      </ul>
      @if (more()) {
        <p class="muted small">Se afișează primii {{ max }}. Restrânge căutarea pentru alții.</p>
      }

      <div class="form-footer">
        <button type="button" class="btn btn-ghost" (click)="modal().close()">Anulează</button>
        <button type="button" class="btn btn-primary" [disabled]="!picked().size" (click)="done()">
          Adaugă {{ picked().size }} {{ picked().size === 1 ? 'membru' : 'membri' }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .filters {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      gap: 8px;
    }
    .all {
      margin: 4px 0;
    }
    .results {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 46vh;
      overflow-y: auto;
    }
    .result {
      width: 100%;
      min-height: 52px;
      cursor: pointer;
    }
    .result input {
      width: 18px;
      height: 18px;
      accent-color: var(--accent);
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
    .small {
      margin: 0;
      font-size: 13px;
    }
    @media (max-width: 600px) {
      .filters {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class MemberMultiPickerDialog {
  private readonly members = inject(MembersService);
  private readonly academy = inject(AcademyService);
  protected readonly modal = viewChild.required(Modal);

  readonly heading = input('Alege membrii');
  /** Members already chosen (kept ticked). */
  readonly initial = input<MemberSummary[]>([]);
  readonly confirmed = output<MemberSummary[]>();
  readonly closed = output<void>();

  protected readonly filters = FILTERS;
  protected readonly max = MAX_RESULTS;
  protected readonly term = signal('');
  protected readonly filter = signal<MemberFilter>('all');
  protected readonly courseId = signal('');
  private readonly debouncedTerm = toSignal(
    toObservable(this.term).pipe(debounceTime(SEARCH_DEBOUNCE_MS)),
    { initialValue: '' },
  );
  protected readonly courses = createQuery(
    () => null,
    () => this.academy.courses(),
  );
  protected readonly results = createQuery(
    () => ({
      q: this.debouncedTerm().trim(),
      filter: this.filter(),
      courseId: this.courseId() || undefined,
    }),
    (query) => this.members.list({ ...query, pageSize: MAX_RESULTS }),
  );
  protected readonly shown = computed(() => this.results.value()?.items ?? []);
  protected readonly more = computed(() => (this.results.value()?.total ?? 0) > MAX_RESULTS);

  /** Ticked members by id; survives changing the search or filters. */
  protected readonly picked = signal(new Map<string, MemberSummary>());
  protected readonly allShownPicked = computed(
    () => this.shown().length > 0 && this.shown().every((m) => this.picked().has(m.id)),
  );

  constructor() {
    queueMicrotask(() => this.picked.set(new Map(this.initial().map((m) => [m.id, m]))));
  }

  protected toggle(member: MemberSummary, checked: boolean): void {
    const next = new Map(this.picked());
    if (checked) next.set(member.id, member);
    else next.delete(member.id);
    this.picked.set(next);
  }

  protected toggleShown(checked: boolean): void {
    const next = new Map(this.picked());
    for (const m of this.shown()) {
      if (checked) next.set(m.id, m);
      else next.delete(m.id);
    }
    this.picked.set(next);
  }

  protected done(): void {
    this.confirmed.emit([...this.picked().values()]);
    this.modal().close();
  }
}

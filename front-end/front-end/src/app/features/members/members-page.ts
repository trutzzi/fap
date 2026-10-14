import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  numberAttribute,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { MembersService } from '../../core/api/members.service';
import { MemberFilter, MemberSummary } from '../../core/api/models';
import { createQuery } from '../../core/data/query';
import { MemberFormDialog } from '../../shared/dialogs/member-form-dialog';
import { IsoDatePipe, RfidPipe } from '../../shared/ui/formatting';
import { Icon } from '../../shared/ui/icon';
import { MemberAvatar } from '../../shared/ui/member-avatar';
import { SessionMeter } from '../../shared/ui/session-meter';
import { StatusBadge } from '../../shared/ui/status-badge';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const FILTERS: { value: MemberFilter; label: string }[] = [
  { value: 'all', label: 'Toate' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiră curând' },
  { value: 'limit', label: 'Limită atinsă' },
  { value: 'expired', label: 'Expirate' },
  { value: 'no-card', label: 'Fără card' },
];

@Component({
  selector: 'app-members-page',
  imports: [
    MemberAvatar,
    RouterLink,
    Icon,
    StatusBadge,
    SessionMeter,
    RfidPipe,
    IsoDatePipe,
    MemberFormDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './members-page.html',
  styleUrl: './members-page.css',
})
export class MembersPage {
  private readonly router = inject(Router);
  private readonly membersApi = inject(MembersService);
  private readonly academy = inject(AcademyService);

  // Filter state lives in the URL (`?q=&filter=&course=&page=`), bound by the router.
  readonly q = input<string>();
  readonly filter = input<MemberFilter>();
  readonly course = input<string>();
  readonly page = input(1, { transform: (v: unknown) => numberAttribute(v, 1) });

  protected readonly filters = FILTERS;
  protected readonly activeFilter = computed(() =>
    FILTERS.some((f) => f.value === this.filter()) ? this.filter()! : 'all',
  );
  protected readonly term = linkedSignal(() => this.q() ?? '');
  protected readonly creating = signal(false);

  protected readonly courses = createQuery(
    () => null,
    () => this.academy.courses(),
  );
  protected readonly members = createQuery(
    () => ({
      q: this.q(),
      filter: this.activeFilter(),
      courseId: this.course(),
      page: this.page(),
      pageSize: PAGE_SIZE,
    }),
    (query) => this.membersApi.list(query),
  );

  protected readonly pages = computed(() => {
    const result = this.members.value();
    return result ? Math.max(Math.ceil(result.total / result.pageSize), 1) : 1;
  });

  protected readonly range = computed(() => {
    const r = this.members.value();
    if (!r || r.total === 0) return null;
    const from = (r.page - 1) * r.pageSize + 1;
    return { from, to: from + r.items.length - 1, total: r.total };
  });

  constructor() {
    toObservable(this.term)
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => {
        if (term !== (this.q() ?? '')) this.navigate({ q: term || null, page: null });
      });
  }

  protected navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setFilter(filter: MemberFilter): void {
    this.navigate({ filter: filter === 'all' ? null : filter, page: null });
  }

  protected setCourse(course: string): void {
    this.navigate({ course: course || null, page: null });
  }

  protected goToPage(page: number): void {
    this.navigate({ page: page === 1 ? null : page });
  }

  protected onCreated(member: MemberSummary): void {
    void this.router.navigate(['/membri', member.id]);
  }
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CHECKIN_MILESTONES, MemberStats, STREAK_MILESTONES } from '../../core/api/models';

const CHECKIN_NAMES: Record<number, string> = {
  1: 'Primul pas',
  10: 'Pe drumul cel bun',
  25: 'Constant',
  50: 'Luptător',
  100: 'Centurion',
  200: 'Veteran',
  300: 'Războinic',
  500: 'Legendă',
};
const STREAK_NAMES: Record<number, string> = {
  4: 'O lună fără pauză',
  8: 'Două luni la rând',
  12: 'Trei luni la rând',
  26: 'Jumătate de an',
  52: 'Un an întreg',
};

interface Badge {
  id: string;
  name: string;
  /** "50 de antrenamente", "12 săptămâni la rând". */
  goal: string;
  earned: boolean;
  kind: 'checkins' | 'streak';
}

/** Badges for check-in milestones and week streaks, with the next goal in each series. */
@Component({
  selector: 'app-member-badges',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="badges-title">
      <h2 id="badges-title" class="section-title">Insignele tale</h2>
      <ul class="badges">
        @for (b of badges(); track b.id) {
          <li [class.earned]="b.earned" [class.streak]="b.kind === 'streak'">
            <span class="medal" aria-hidden="true">{{ b.kind === 'streak' ? '🔥' : '🥋' }}</span>
            <strong>{{ b.name }}</strong>
            <span class="muted small">{{ b.goal }}</span>
          </li>
        }
      </ul>
      @for (n of next(); track n) {
        <p class="muted small next">{{ n }}</p>
      }
    </section>
  `,
  styles: `
    .badges {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
      gap: 8px;
    }
    .badges li {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 10px 6px;
      border-radius: 12px;
      border: 1px dashed var(--border-strong);
      text-align: center;
      font-size: 13px;
      opacity: 0.45;
      filter: grayscale(1);
    }
    .badges li.earned {
      opacity: 1;
      filter: none;
      border-style: solid;
      border-color: var(--accent);
      background: var(--surface-hover);
    }
    .medal {
      font-size: 26px;
    }
    .small {
      font-size: 12px;
    }
    .next {
      margin: 0;
    }
  `,
})
export class MemberBadges {
  readonly stats = input.required<MemberStats>();

  protected readonly badges = computed<Badge[]>(() => {
    const { total, longestStreakWeeks } = this.stats();
    return [
      ...CHECKIN_MILESTONES.map((n) => ({
        id: `c${n}`,
        name: CHECKIN_NAMES[n] ?? `${n} antrenamente`,
        goal: n === 1 ? 'primul antrenament' : `${n} de antrenamente`,
        earned: total >= n,
        kind: 'checkins' as const,
      })),
      ...STREAK_MILESTONES.map((n) => ({
        id: `s${n}`,
        name: STREAK_NAMES[n] ?? `${n} săptămâni`,
        goal: `${n} săptămâni la rând`,
        earned: longestStreakWeeks >= n,
        kind: 'streak' as const,
      })),
    ];
  });

  /** What's left to the next badge of each series. */
  protected readonly next = computed(() => {
    const { total, longestStreakWeeks, currentStreakWeeks } = this.stats();
    const lines: string[] = [];
    const nextCount = CHECKIN_MILESTONES.find((n) => n > total);
    if (nextCount) {
      const left = nextCount - total;
      lines.push(
        `Următoarea insignă: „${CHECKIN_NAMES[nextCount]}” — încă ${left === 1 ? 'un antrenament' : `${left} antrenamente`}.`,
      );
    }
    const nextStreak = STREAK_MILESTONES.find((n) => n > longestStreakWeeks);
    if (nextStreak) {
      lines.push(
        `Seria ta: ${currentStreakWeeks} ${currentStreakWeeks === 1 ? 'săptămână' : 'săptămâni'}. Pentru „${STREAK_NAMES[nextStreak]}” ai nevoie de ${nextStreak} la rând.`,
      );
    }
    return lines;
  });
}

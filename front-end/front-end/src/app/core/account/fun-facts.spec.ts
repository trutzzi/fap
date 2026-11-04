import { MemberStats } from '../api/models';
import { funFactOfTheDay, funFacts } from './fun-facts';

const stats = (overrides: Partial<MemberStats> = {}): MemberStats => ({
  total: 24,
  thisMonth: 6,
  lastMonth: 4,
  trainingHours: 25,
  favoriteTraining: { label: 'Kickboxing', count: 18 },
  favoriteWeekday: 2,
  currentStreakWeeks: 5,
  longestStreakWeeks: 7,
  weeks: [],
  ...overrides,
});

describe('fun facts', () => {
  it('lists the facts that are true, in Romanian', () => {
    expect(funFacts(stats(), '2025-04-01', '2026-11-04')).toEqual([
      'Ai 24 antrenamente la activ, cam 25 ore de sală.',
      'Recordul tău: 7 săptămâni la rând fără pauză.',
      'Ești într-o serie de 5 săptămâni. Nu o rupe!',
      'Ziua ta preferată de antrenament e marți.',
      'Kickboxing e antrenamentul tău de bază: 18 prezențe până acum.',
      'Luna asta ai venit deja de 6 ori, mai des decât luna trecută (4). Bravo!',
      'Ești în echipa Fight Academy de 582 de zile.',
    ]);
  });

  it('encourages a member without check-ins and uses singulars', () => {
    expect(funFacts(stats({ total: 0 }), '2026-11-01', '2026-11-04')).toEqual([
      'Primul antrenament te așteaptă: arată codul QR la intrare și începe seria!',
    ]);
    const first = stats({
      total: 1,
      trainingHours: 1,
      longestStreakWeeks: 1,
      currentStreakWeeks: 1,
      favoriteTraining: { label: 'Box', count: 1 },
      lastMonth: 0,
    });
    expect(funFacts(first, '2026-11-01', '2026-11-04')[0]).toBe(
      'Ai un antrenament la activ, cam o oră de sală.',
    );
  });

  it('picks a different fact on different days', () => {
    const a = funFactOfTheDay(stats(), '2025-04-01', '2026-11-04');
    const b = funFactOfTheDay(stats(), '2025-04-01', '2026-11-05');
    expect(a).not.toBe(b);
  });
});

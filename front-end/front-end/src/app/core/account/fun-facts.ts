import { MemberStats } from '../api/models';
import { WEEKDAYS, daysBetween } from '../util/dates';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** Every motivating fact that is true for these stats (Romanian copy for the portal). */
export function funFacts(stats: MemberStats, joinedAt: string, today: string): string[] {
  if (stats.total === 0) {
    return ['Primul antrenament te așteaptă: arată codul QR la intrare și începe seria!'];
  }
  const facts = [
    `Ai ${plural(stats.total, 'un antrenament', 'antrenamente')} la activ, cam ${plural(stats.trainingHours, 'o oră', 'ore')} de sală.`,
  ];
  if (stats.longestStreakWeeks >= 2) {
    facts.push(`Recordul tău: ${stats.longestStreakWeeks} săptămâni la rând fără pauză.`);
  }
  if (stats.currentStreakWeeks >= 2) {
    facts.push(`Ești într-o serie de ${stats.currentStreakWeeks} săptămâni. Nu o rupe!`);
  }
  if (stats.favoriteWeekday) {
    facts.push(
      `Ziua ta preferată de antrenament e ${WEEKDAYS[stats.favoriteWeekday - 1].toLowerCase()}.`,
    );
  }
  if (stats.favoriteTraining && stats.favoriteTraining.count >= 2) {
    facts.push(
      `${stats.favoriteTraining.label} e antrenamentul tău de bază: ${stats.favoriteTraining.count} prezențe până acum.`,
    );
  }
  if (stats.lastMonth > 0 && stats.thisMonth > stats.lastMonth) {
    facts.push(
      `Luna asta ai venit deja de ${stats.thisMonth} ori, mai des decât luna trecută (${stats.lastMonth}). Bravo!`,
    );
  }
  const days = daysBetween(joinedAt, today);
  if (days >= 30) facts.push(`Ești în echipa Fight Academy de ${days} de zile.`);
  return facts;
}

/** One fact per day, so the portal shows something new each visit day. */
export function funFactOfTheDay(stats: MemberStats, joinedAt: string, today: string): string {
  const facts = funFacts(stats, joinedAt, today);
  return facts[Math.abs(daysBetween('2026-01-01', today)) % facts.length];
}

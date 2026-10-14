import { CheckInResult } from './api/models';
import { formatDayMonth } from './util/dates';

export type CheckInTone = 'success' | 'warning' | 'danger';

export interface CheckInMessage {
  tone: CheckInTone;
  headline: string;
  /** Guidance for the member, shown at the bottom of the kiosk panel. */
  footer: string;
}

/** Romanian copy for each check-in outcome, shared by the kiosk and manual check-in. */
export function checkInMessage(result: CheckInResult): CheckInMessage {
  const sub = result.member?.subscription ?? null;
  switch (result.outcome) {
    case 'allowed': {
      if (sub?.remaining === null) {
        return {
          tone: 'success',
          headline: 'Acces permis',
          footer: `A ${sub.used}-a prezență în această lună. Spor la antrenament!`,
        };
      }
      const remaining = sub?.remaining ?? 0;
      return {
        tone: 'success',
        headline: 'Acces permis',
        footer:
          remaining === 0
            ? 'Aceasta a fost ultima ședință din abonament. Reînnoiește la recepție.'
            : `Mai ai ${remaining === 1 ? 'o ședință' : `${remaining} ședințe`} în acest abonament. Spor la antrenament!`,
      };
    }
    case 'already-checked-in':
      return {
        tone: 'success',
        headline: 'Ești deja înregistrat',
        footer:
          'Check-in-ul pentru acest antrenament a fost făcut deja. Nu s-a consumat nicio ședință.',
      };
    case 'limit':
      return {
        tone: 'warning',
        headline: 'Limită atinsă',
        footer: 'Treci pe Nelimitat sau reînnoiește abonamentul la recepție.',
      };
    case 'expired':
      return {
        tone: 'danger',
        headline: 'Abonament expirat',
        footer: `Abonamentul a expirat pe ${sub ? formatDayMonth(sub.endDate) : '—'}. Reînnoiește-l la recepție pentru a intra la antrenament.`,
      };
    case 'no-subscription':
      return {
        tone: 'danger',
        headline: 'Fără abonament activ',
        footer: 'Nu ai un abonament activ. Te rugăm să mergi la recepție.',
      };
    case 'unknown-card':
      return {
        tone: 'danger',
        headline: 'Card necunoscut',
        footer: 'Cardul nu este alocat niciunui membru. Te rugăm să mergi la recepție.',
      };
  }
}

import { CheckInResult, MemberSummary, SubscriptionUsage } from './api/models';
import { checkInMessage } from './checkin-messages';

function result(
  outcome: CheckInResult['outcome'],
  subscription: Partial<SubscriptionUsage> | null,
): CheckInResult {
  const member = {
    fullName: 'Andrei Popescu',
    subscription: subscription && {
      planId: 'sessions12',
      planName: '12 ședințe / lună',
      sessionLimit: 12,
      price: null,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      used: 8,
      remaining: 4,
      ...subscription,
    },
  } as MemberSummary;
  return { outcome, member, trainingLabel: 'Kickboxing' };
}

describe('checkInMessage', () => {
  it('tells limited members how many sessions are left', () => {
    expect(checkInMessage(result('allowed', {})).footer).toContain('Mai ai 4 ședințe');
    expect(checkInMessage(result('allowed', { used: 11, remaining: 1 })).footer).toContain(
      'Mai ai o ședință',
    );
    expect(checkInMessage(result('allowed', { used: 12, remaining: 0 })).footer).toContain(
      'ultima ședință',
    );
  });

  it('counts attendance for unlimited members', () => {
    const message = checkInMessage(
      result('allowed', { sessionLimit: null, remaining: null, used: 15 }),
    );
    expect(message).toEqual(expect.objectContaining({ tone: 'success', headline: 'Acces permis' }));
    expect(message.footer).toContain('A 15-a prezență');
  });

  it('uses warning and danger tones for denied check-ins', () => {
    expect(checkInMessage(result('limit', {})).tone).toBe('warning');
    expect(checkInMessage(result('expired', { endDate: '2026-09-30' })).footer).toContain('30 sep');
    expect(
      checkInMessage({ outcome: 'unknown-card', member: null, trainingLabel: null }).headline,
    ).toBe('Card necunoscut');
  });
});

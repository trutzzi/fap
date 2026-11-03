import { describe, expect, it } from 'vitest';
import type { SubscriptionUsage } from '../src/contract/models.js';
import {
  accessSmsText,
  generateMemberPin,
  parseQrToken,
  phoneKey,
  qrToken,
  SMS_MAX_LENGTH,
  smsRecipient,
  verifyQrToken,
} from '../src/domain/member-access.js';
import { memberStatus, normalizeRfid, periodEnd, usage } from '../src/domain/membership.js';
import { smsLinkSender } from '../src/lib/sms.js';
import { currentSlot, scheduleSummary, trainingState } from '../src/domain/schedule.js';

const sub = (overrides: Partial<Parameters<typeof usage>[0]>): SubscriptionUsage =>
  usage({
    planId: 'sessions12',
    planName: '12 ședințe / lună',
    sessionLimit: 12,
    price: null,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    used: 0,
    ...overrides,
  });

describe('membership', () => {
  it('computes inclusive one-month periods', () => {
    expect(periodEnd('2026-10-01')).toBe('2026-10-31');
    expect(periodEnd('2026-01-31')).toBe('2026-02-27');
    expect(periodEnd('2026-12-15')).toBe('2027-01-14');
  });

  it('derives status from usage and dates', () => {
    const today = '2026-10-14';
    expect(memberStatus(null, today)).toBe('none');
    expect(memberStatus(sub({ used: 8 }), today)).toBe('active');
    expect(memberStatus(sub({ used: 11 }), today)).toBe('expiring');
    expect(memberStatus(sub({ used: 12 }), today)).toBe('limit');
    expect(memberStatus(sub({ endDate: '2026-10-16' }), today)).toBe('expiring');
    expect(memberStatus(sub({ endDate: '2026-10-13' }), today)).toBe('expired');
    expect(memberStatus(sub({ sessionLimit: null, used: 40 }), today)).toBe('active');
  });

  it('normalizes card codes', () => {
    expect(normalizeRfid('04a3·91f2')).toBe('04A391F2');
    expect(normalizeRfid(' 04:A3-91 F2 ')).toBe('04A391F2');
  });
});

describe('schedule', () => {
  const slot = (time: string, courseId = 'kb') => ({ weekday: 3, time, durationMin: 60, courseId });
  const at = (h: number, m: number) => new Date(2026, 9, 14, h, m);

  it('tracks a training through the day', () => {
    expect(trainingState('2026-10-14', slot('20:00'), at(19, 59))).toBe('upcoming');
    expect(trainingState('2026-10-14', slot('20:00'), at(20, 30))).toBe('live');
    expect(trainingState('2026-10-14', slot('20:00'), at(21, 0))).toBe('done');
    expect(trainingState('2026-10-13', slot('20:00'), at(9, 0))).toBe('done');
  });

  it('attaches check-ins to the current training, preferring the member’s course', () => {
    const slots = [slot('20:00', 'kb'), slot('20:15', 'bjj')];
    expect(currentSlot(slots, at(19, 20))).toBeNull();
    expect(currentSlot(slots, at(19, 50), ['kb'])?.courseId).toBe('kb');
    expect(currentSlot(slots, at(19, 50), ['bjj'])?.courseId).toBe('bjj');
  });

  it('summarizes weekly slots', () => {
    const days = (weekdays: number[], time: string) =>
      weekdays.map((weekday) => ({ weekday, time }));
    expect(scheduleSummary(days([1, 2, 3, 4, 5], '20:00'))).toBe('Luni – Vineri · 20:00');
    expect(scheduleSummary([...days([6], '14:00'), ...days([2, 4], '17:00')])).toBe(
      'Marți, Joi · 17:00 / Sâmbătă · 14:00',
    );
  });
});

describe('member access', () => {
  it('matches phone numbers written in different formats', () => {
    for (const phone of ['0722 513 418', '+40 722 513 418', '0040722513418', '722-513-418']) {
      expect(phoneKey(phone)).toBe('0722513418');
    }
    expect(smsRecipient('+40 (722) 513.418')).toBe('0722513418');
    expect(smsRecipient('+49 151 2345 6789')).toBe('004915123456789');
  });

  it('generates 6-digit PINs, leading zeros included', () => {
    for (let i = 0; i < 200; i++) expect(generateMemberPin()).toMatch(/^\d{6}$/);
  });

  it('fits the PIN SMS in one GSM message', () => {
    const text = accessSmsText(
      'Fight Academy Pitești',
      '042917',
      'https://fap.valentintruta.ro/cont',
    );
    expect(text).toBe(
      'Fight Academy Pitesti: codul tau PIN de membru este 042917. Intra cu nr. de telefon pe https://fap.valentintruta.ro/cont pentru codul QR de acces.',
    );
    expect(text.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
    const long = accessSmsText('Ș'.repeat(200), '042917', 'https://fap.valentintruta.ro/cont');
    expect(long.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
    expect(long).toMatch(/^S+: codul tau PIN/);
  });

  it('accepts a QR code for about a minute and a half, and only with its secret', () => {
    const issued = new Date(2026, 9, 14, 19, 45, 0);
    const { token, expiresAt } = qrToken('mem1', 'secret', issued);
    expect(token).toMatch(/^FA1\.mem1\.[0-9a-z]+\.[0-9a-f]{16}$/);
    const after = (seconds: number) => new Date(issued.getTime() + seconds * 1000);
    expect(verifyQrToken(token, 'secret', issued)).toBe(true);
    expect(verifyQrToken(token, 'secret', after(60))).toBe(true);
    expect(verifyQrToken(token, 'secret', new Date(expiresAt.getTime() - 1))).toBe(true);
    expect(verifyQrToken(token, 'secret', expiresAt)).toBe(false);
    expect(verifyQrToken(token, 'other-secret', issued)).toBe(false);
    expect(verifyQrToken(token.replace('mem1', 'mem2'), 'secret', issued)).toBe(false);
    expect(verifyQrToken('04A391F2', 'secret', issued)).toBe(false);
    expect(parseQrToken(token)?.memberId).toBe('mem1');
  });
});

describe('SMSLink sender', () => {
  const sender = (status: number, answer: string, calls: [string, RequestInit][] = []) =>
    smsLinkSender({ connectionId: 'C1', password: 'secret-pw', sender: 'FIGHTACAD' }, ((
      url: string,
      init: RequestInit,
    ) => {
      calls.push([url, init]);
      return Promise.resolve(new Response(answer, { status }));
    }) as typeof fetch);

  it('posts the message and accepts a MESSAGE answer', async () => {
    const calls: [string, RequestInit][] = [];
    await expect(
      sender(200, 'MESSAGE;1;123456;Sent', calls).send('0722513418', 'Salut'),
    ).resolves.toBe(true);
    const body = calls[0][1].body as URLSearchParams;
    expect(calls[0][0]).toBe('https://secure.smslink.ro/sms/gateway/communicate/index.php');
    expect(Object.fromEntries(body)).toEqual({
      connection_id: 'C1',
      password: 'secret-pw',
      to: '0722513418',
      message: 'Salut',
      sender: 'FIGHTACAD',
    });
  });

  it('throws on an ERROR answer without leaking the gateway password', async () => {
    const error = await sender(200, "ERROR;7;Password 'secret-pw' is not approved!")
      .send('0722513418', 'Salut')
      .catch((e: Error) => e);
    expect(String(error)).toContain('ERROR;7');
    expect(String(error)).not.toContain('secret-pw');
  });
});

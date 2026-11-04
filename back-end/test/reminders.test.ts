import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { expiryReminderText } from '../src/domain/member-access.js';
import { sendExpiryReminders } from '../src/modules/reminders/expiry-reminders.js';
import { db, resetData, signedIn, smsControl, smsOutbox, testPush, testSms } from './helpers.js';

let now = new Date(2026, 9, 14, 12, 0); // Wednesday 14 Oct, noon
const run = () =>
  sendExpiryReminders({
    db,
    sms: testSms,
    push: testPush,
    clock: () => now,
    publicUrl: 'https://club.test',
  });

const setReminders = (expiryReminderSms: boolean) =>
  db.club.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: 'Fight Academy Pitești',
      address: '',
      phone: '',
      email: '',
      website: '',
      timezone: 'Europe/Bucharest',
      expiryReminderSms,
    },
    update: { expiryReminderSms },
  });

/** A member whose subscription starts on `startDate` (ends one month − 1 day later). */
async function member(firstName: string, phone: string, startDate: string) {
  const staff = await signedIn('reception');
  const res = await staff
    .post('/api/members')
    .send({
      firstName,
      lastName: 'Test',
      phone,
      courseIds: [],
      subscription: { planId: 'unlimited', startDate },
    })
    .expect(201);
  return res.body as { id: string; subscription: { endDate: string } };
}

beforeEach(async () => {
  await resetData();
  now = new Date(2026, 9, 14, 12, 0);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('expiry reminder SMS', () => {
  it('fits one GSM SMS with the end date as dd-mm-yyyy', () => {
    expect(
      expiryReminderText(
        'Fight Academy Pitești',
        '2026-10-17',
        'https://fap.valentintruta.ro/cont',
      ),
    ).toBe(
      'Fight Academy Pitesti: abonamentul tau expira pe 17-10-2026. Reinnoieste-l la receptie. Contul tau: https://fap.valentintruta.ro/cont',
    );
    expect(
      expiryReminderText('Ș'.repeat(300), '2026-10-17', 'https://x.ro/cont').length,
    ).toBeLessThanOrEqual(160);
  });

  it('texts members within 3 days of the end, once per period, in the daytime only', async () => {
    const soon = await member('Ana', '0722000001', '2026-09-18'); // ends 17 Oct: in 3 days
    expect(soon.subscription.endDate).toBe('2026-10-17');
    await member('Ion', '0722000002', '2026-10-01'); // ends 31 Oct: not yet
    await member('Dan', '0722000003', '2026-09-10'); // ended 9 Oct: already expired

    expect(await run()).toEqual({ sent: 0, failed: 0 }); // switched off
    await setReminders(true);
    now = new Date(2026, 9, 14, 8, 30);
    expect(await run()).toEqual({ sent: 0, failed: 0 }); // too early in the morning

    now = new Date(2026, 9, 14, 12, 0);
    expect(await run()).toEqual({ sent: 1, failed: 0 });
    expect(smsOutbox).toEqual([
      { to: '0722000001', text: expect.stringContaining('expira pe 17-10-2026') },
    ]);
    expect(await run()).toEqual({ sent: 0, failed: 0 }); // not twice

    // Renewed: the new period gets its own reminder near its end.
    const staff = await signedIn('reception');
    await staff
      .put(`/api/members/${soon.id}/subscription`)
      .send({ planId: 'unlimited', startDate: '2026-10-18' })
      .expect(200);
    now = new Date(2026, 10, 14, 12, 0); // 14 Nov; new period ends 17 Nov
    expect(await run()).toEqual({ sent: 1, failed: 0 });
    expect(smsOutbox.at(-1)?.text).toContain('expira pe 17-11-2026');
  });

  it('logs a failed SMS once and does not retry it', async () => {
    await member('Ana', '0722000001', '2026-09-18');
    await setReminders(true);
    smsControl.fails = true;
    expect(await run()).toEqual({ sent: 0, failed: 1 });
    expect(await run()).toEqual({ sent: 0, failed: 0 });
    expect(await db.errorLog.findMany()).toMatchObject([{ source: 'sms' }]);
  });
});

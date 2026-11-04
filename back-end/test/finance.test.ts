import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, resetData, signedIn } from './helpers.js';

let staff: Awaited<ReturnType<typeof signedIn>>;

async function createMember(subscription: Record<string, unknown> | null = null) {
  const res = await staff
    .post('/api/members')
    .send({
      firstName: 'Ana',
      lastName: 'Pop',
      phone: '+40 722 000 111',
      courseIds: ['kb'],
      subscription,
    })
    .expect(201);
  return res.body as { id: string };
}

beforeEach(async () => {
  await resetData(); // plans: sessions12 = 200 lei, unlimited = 300 lei
  staff = await signedIn('reception');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('subscription periods and payments', () => {
  it('records the sold period and an optional payment at sale time', async () => {
    const { id } = await createMember({
      planId: 'sessions12',
      startDate: '2026-10-01',
      payment: { amount: 200, method: 'cash' },
    });
    const member = await staff.get(`/api/members/${id}`).expect(200);
    expect(member.body.periods).toEqual([
      expect.objectContaining({
        planId: 'sessions12',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        price: 200,
        paid: 200,
        due: 0,
        status: 'paid',
        current: true,
      }),
    ]);
  });

  it('updates the same period on a plan change and keeps history on renewal', async () => {
    const { id } = await createMember({ planId: 'sessions12', startDate: '2026-10-01' });
    await staff
      .put(`/api/members/${id}/subscription`)
      .send({ planId: 'unlimited', startDate: '2026-10-01' })
      .expect(200);
    await staff
      .put(`/api/members/${id}/subscription`)
      .send({
        planId: 'unlimited',
        startDate: '2026-11-01',
        payment: { amount: 300, method: 'card' },
      })
      .expect(200);
    const periods = (await staff.get(`/api/members/${id}`)).body.periods;
    expect(
      periods.map((p: { startDate: string; planId: string; status: string }) => [
        p.startDate,
        p.planId,
        p.status,
      ]),
    ).toEqual([
      ['2026-11-01', 'unlimited', 'paid'],
      ['2026-10-01', 'unlimited', 'unpaid'],
    ]);
  });

  it('summarizes revenue, methods and unpaid periods for the month', async () => {
    const paid = await createMember({
      planId: 'sessions12',
      startDate: '2026-10-01',
      payment: { amount: 200, method: 'cash' },
    });
    const owing = await createMember({ planId: 'unlimited', startDate: '2026-10-05' });
    const period = (await staff.get(`/api/members/${owing.id}`)).body.periods[0];
    await staff
      .post('/api/payments')
      .send({
        memberId: owing.id,
        periodId: period.id,
        amount: 100,
        method: 'transfer',
        note: 'avans',
      })
      .expect(201);

    const res = await staff.get('/api/finance?month=2026-10').expect(200);
    expect(res.body).toMatchObject({
      month: '2026-10',
      revenue: 300,
      outstanding: 200,
      unpricedPeriods: 0,
      subscriptions: { soldThisMonth: 2, renewalsThisMonth: 0 },
    });
    expect(res.body.byMethod).toEqual([
      { method: 'cash', amount: 200 },
      { method: 'card', amount: 0 },
      { method: 'transfer', amount: 100 },
    ]);
    expect(res.body.unpaid).toEqual([
      expect.objectContaining({ memberId: owing.id, status: 'partial', paid: 100, due: 200 }),
    ]);
    expect(res.body.payments).toHaveLength(2);
    expect(res.body.monthly.at(-1)).toEqual({ month: '2026-10', amount: 300 });
    expect(paid.id).toBeTruthy();
  });

  it('validates payments and keeps deletion admin-only', async () => {
    const a = await createMember({ planId: 'sessions12', startDate: '2026-10-01' });
    const b = await createMember({ planId: 'sessions12', startDate: '2026-10-01' });
    const periodOfB = (await staff.get(`/api/members/${b.id}`)).body.periods[0].id;

    const wrongMember = await staff
      .post('/api/payments')
      .send({ memberId: a.id, periodId: periodOfB, amount: 50, method: 'cash' });
    expect(wrongMember.status).toBe(400);
    const zero = await staff
      .post('/api/payments')
      .send({ memberId: a.id, periodId: null, amount: 0, method: 'cash' });
    expect(zero.body.message).toBe('Suma trebuie să fie de cel puțin 1 leu.');

    const payment = await staff
      .post('/api/payments')
      .send({ memberId: a.id, periodId: null, amount: 50, method: 'cash' })
      .expect(201);
    expect(payment.body).toMatchObject({ memberName: 'Ana Pop', receivedBy: 'Recepție Test' });
    await staff.delete(`/api/payments/${payment.body.id}`).expect(403);
    await (await signedIn('admin')).delete(`/api/payments/${payment.body.id}`).expect(204);
    await (await signedIn('coach')).get('/api/finance').expect(403);
  });
});

describe('fixing payment mistakes', () => {
  it('lists a member’s payments and lets an admin delete a duplicate and fix the price', async () => {
    // Prices not set yet: the period takes its price from the amount collected.
    await db.plan.update({ where: { id: 'sessions12' }, data: { price: null } });
    const { id } = await createMember({
      planId: 'sessions12',
      startDate: '2026-10-01',
      payment: { amount: 350, method: 'cash' },
    });
    const periodId = (await staff.get(`/api/members/${id}`)).body.periods[0].id;
    // Collected again by mistake on the same period.
    await staff
      .post('/api/payments')
      .send({ memberId: id, periodId, amount: 350, method: 'cash' })
      .expect(201);
    expect((await staff.get(`/api/members/${id}`)).body.periods[0]).toMatchObject({
      price: 350,
      paid: 700,
    });

    const payments = await staff.get(`/api/members/${id}/payments`).expect(200);
    expect(payments.body).toHaveLength(2);
    expect(payments.body[0]).toMatchObject({ amount: 350, periodId, receivedBy: 'Recepție Test' });

    const admin = await signedIn('admin');
    await staff.delete(`/api/payments/${payments.body[0].id}`).expect(403);
    await admin.delete(`/api/payments/${payments.body[0].id}`).expect(204);
    expect((await staff.get(`/api/members/${id}`)).body.periods[0]).toMatchObject({
      paid: 350,
      status: 'paid',
    });

    await staff.put(`/api/periods/${periodId}`).send({ price: 400 }).expect(403);
    const fixed = await admin.put(`/api/periods/${periodId}`).send({ price: 400 }).expect(200);
    expect(fixed.body).toMatchObject({
      price: 400,
      paid: 350,
      due: 50,
      status: 'partial',
      current: true,
    });
    const cleared = await admin.put(`/api/periods/${periodId}`).send({ price: null }).expect(200);
    expect(cleared.body).toMatchObject({ price: null, status: 'no-price' });
    const bad = await admin.put(`/api/periods/${periodId}`).send({ price: -5 }).expect(400);
    expect(bad.body.message).toBe('Prețul nu poate fi negativ.');
    await admin.put('/api/periods/nope').send({ price: 1 }).expect(404);
  });
});

import { Router } from 'express';
import type { StaffEvent, StaffNotifications } from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import type { SmsKind } from '../../generated/prisma/client.js';

const FEED_SIZE = 40;

const REFUSAL_TEXT = {
  limit: 'Refuzat: limită de ședințe atinsă',
  expired: 'Refuzat: abonament expirat',
  no_subscription: 'Refuzat: fără abonament',
} as const;

const SMS_KIND_TEXT: Record<SmsKind, string> = {
  pin: 'cod PIN',
  reminder: 'reamintire expirare',
  announcement: 'anunț',
};

/**
 * The staff bell (admin and reception; coaches are outside their allowlist): the latest
 * check-ins, refused scans and SMS, newest first. Read from the existing tables.
 */
export function staffFeedRouter({ db, clock }: Deps): Router {
  const router = Router();

  router.get('/notifications', async (req, res) => {
    const name = { select: { firstName: true, lastName: true } } as const;
    const [checkIns, refused, sms, user] = await Promise.all([
      db.checkIn.findMany({
        orderBy: { timestamp: 'desc' },
        take: FEED_SIZE,
        include: { member: name },
      }),
      db.refusedScan.findMany({
        orderBy: { timestamp: 'desc' },
        take: FEED_SIZE,
        include: { member: name },
      }),
      db.smsMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: FEED_SIZE,
        include: { member: name },
      }),
      db.user.findUnique({ where: { id: req.user!.id }, select: { notificationsSeenAt: true } }),
    ]);
    const fullName = (m: { firstName: string; lastName: string } | null) =>
      m ? `${m.firstName} ${m.lastName}` : null;
    const items: StaffEvent[] = [
      ...checkIns.map((c) => ({
        id: `c-${c.id}`,
        kind: 'checkin' as const,
        at: c.timestamp.toISOString(),
        memberId: c.memberId,
        memberName: fullName(c.member),
        text: `Check-in · ${c.trainingLabel ?? 'Acces liber'}`,
      })),
      ...refused.map((r) => ({
        id: `r-${r.id}`,
        kind: 'refused' as const,
        at: r.timestamp.toISOString(),
        memberId: r.memberId,
        memberName: fullName(r.member),
        text: `${REFUSAL_TEXT[r.reason]}${r.trainingLabel ? ` · ${r.trainingLabel}` : ''}`,
      })),
      ...sms.map((s) => ({
        id: `s-${s.id}`,
        kind: s.sent ? ('sms-sent' as const) : ('sms-failed' as const),
        at: s.createdAt.toISOString(),
        memberId: s.memberId,
        memberName: fullName(s.member),
        text: `SMS ${SMS_KIND_TEXT[s.kind]} către ${s.to}${s.sent ? '' : ` · eșuat${s.error ? `: ${s.error}` : ''}`}`,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, FEED_SIZE);
    const seen = user?.notificationsSeenAt?.toISOString() ?? '';
    const body: StaffNotifications = {
      items,
      unread: items.filter((i) => i.at > seen).length,
    };
    res.json(body);
  });

  /** The bell was opened: everything up to now counts as seen. */
  router.post('/notifications/seen', async (req, res) => {
    await db.user.update({ where: { id: req.user!.id }, data: { notificationsSeenAt: clock() } });
    res.status(204).end();
  });

  return router;
}

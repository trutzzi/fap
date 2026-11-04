import type { MemberAccessResult, PinSmsOutcome } from '../../contract/models.js';
import type { Db } from '../../db.js';
import type { Deps } from '../../deps.js';
import {
  accessSmsText,
  generateMemberPin,
  phoneKey,
  smsRecipient,
} from '../../domain/member-access.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { loadClub } from '../club/club.routes.js';
import { recordError } from '../logs/uptime-checks.js';
import { sendSms } from '../notifications/notify.js';

/**
 * Members with a portal PIN and the same phone number, in any format. Phones are not
 * unique (siblings share a parent's phone). Gym-sized table, so matching runs in memory.
 */
export async function membersWithPhone(
  db: Db,
  phone: string,
): Promise<{ id: string; passwordHash: string }[]> {
  const key = phoneKey(phone);
  if (!key) return [];
  const rows = await db.member.findMany({
    where: { passwordHash: { not: null } },
    select: { id: true, phone: true, passwordHash: true },
  });
  return rows
    .filter((m) => phoneKey(m.phone) === key)
    .map((m) => ({ id: m.id, passwordHash: m.passwordHash! }));
}

/** Siblings sharing a phone must not share a PIN either: the PIN decides who signs in. */
export async function pinTakenOnPhone(
  db: Db,
  phone: string,
  pin: string,
  memberId: string,
): Promise<boolean> {
  for (const other of await membersWithPhone(db, phone)) {
    if (other.id !== memberId && (await verifyPassword(pin, other.passwordHash))) return true;
  }
  return false;
}

/**
 * Gives the member a new 6-digit portal PIN and, when SMS sending is on in the club
 * settings, texts it to them. Earlier portal sessions are signed out. Whenever no SMS went
 * out, the PIN is returned so reception can hand it over; failures go to the logs page.
 */
export async function issueMemberAccess(
  { db, sms, clock, publicUrl }: Pick<Deps, 'db' | 'sms' | 'clock' | 'publicUrl'>,
  memberId: string,
): Promise<MemberAccessResult> {
  const { phone } = await db.member.findUniqueOrThrow({
    where: { id: memberId },
    select: { phone: true },
  });
  let pin = generateMemberPin();
  while (await pinTakenOnPhone(db, phone, pin, memberId)) pin = generateMemberPin();
  await db.member.update({
    where: { id: memberId },
    data: { passwordHash: await hashPassword(pin), sessions: { deleteMany: {} } },
  });

  const club = await loadClub(db);
  let outcome: PinSmsOutcome = 'disabled';
  if (club.smsEnabled) {
    const { ok, error } = await sendSms(
      { db, sms, clock },
      {
        memberId,
        to: smsRecipient(phone),
        kind: 'pin',
        text: accessSmsText(club.name, pin, `${publicUrl}/cont`),
      },
    );
    outcome = ok ? 'sent' : 'failed';
    if (!ok) await recordError(db, 'sms', error ?? 'SMS failed');
  }
  return { sms: outcome, phone, temporaryPin: outcome === 'sent' ? null : pin };
}

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { MEMBER_QR_PREFIX } from '../contract/models.js';

/**
 * Comparable form of a phone number: digits only, Romanian numbers in national form
 * (`+40 722 123 456`, `0040722123456` and `722123456` all become `0722123456`).
 */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0040')) return `0${digits.slice(4)}`;
  if (digits.startsWith('40') && digits.length === 11) return `0${digits.slice(2)}`;
  if (digits.startsWith('7') && digits.length === 9) return `0${digits}`;
  return digits;
}

/** The recipient as SMSLink expects it: `07…` nationally, `00…` for foreign numbers. */
export function smsRecipient(phone: string): string {
  const key = phoneKey(phone);
  return key.startsWith('0') ? key : `00${key}`;
}

/** Generated PINs: 6 digits, easy to type on a phone keypad and to remember. */
export const MEMBER_PIN_LENGTH = 6;
/** A PIN the member chooses: 4 to 6 digits. */
export const MEMBER_PIN_PATTERN = /^\d{4,6}$/;

export function generateMemberPin(): string {
  return String(randomInt(10 ** MEMBER_PIN_LENGTH)).padStart(MEMBER_PIN_LENGTH, '0');
}

/** SMS text is GSM 7-bit: no Romanian diacritics. */
export function toGsmText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '');
}

/** One SMS: at most 160 GSM characters, otherwise it is billed as several. */
export const SMS_MAX_LENGTH = 160;

/** The SMS carrying a new portal PIN; the club name is shortened to fit one SMS. */
export function accessSmsText(clubName: string, pin: string, portalUrl: string): string {
  const body = `: codul tau PIN de membru este ${pin}. Intra cu nr. de telefon pe ${portalUrl} pentru codul QR de acces.`;
  const club = toGsmText(clubName).trim() || 'Fight Academy';
  return toGsmText(club.slice(0, Math.max(SMS_MAX_LENGTH - body.length, 0)).trim() + body);
}

// ---- Rotating QR code ----

/** The code changes every step… */
export const QR_STEP_MS = 30_000;
/** …and stays valid this many steps after its own, so a screen refreshed late still works. */
const QR_GRACE_STEPS = 2;
const SIGNATURE_HEX = 16;

export function newQrSecret(): string {
  return randomBytes(32).toString('base64url');
}

function sign(secret: string, memberId: string, step: number): string {
  return createHmac('sha256', secret)
    .update(`${memberId}.${step}`)
    .digest('hex')
    .slice(0, SIGNATURE_HEX);
}

/** `FA1.<memberId>.<step base 36>.<signature>`; a screenshot stops working within ~90 s. */
export function qrToken(
  memberId: string,
  secret: string,
  now: Date,
): { token: string; expiresAt: Date } {
  const step = Math.floor(now.getTime() / QR_STEP_MS);
  return {
    token: `${MEMBER_QR_PREFIX}${memberId}.${step.toString(36)}.${sign(secret, memberId, step)}`,
    expiresAt: new Date((step + QR_GRACE_STEPS + 1) * QR_STEP_MS),
  };
}

/** The member id a well-formed token claims; check it with `verifyQrToken`. */
export function parseQrToken(
  token: string,
): { memberId: string; step: number; signature: string } | null {
  if (!token.startsWith(MEMBER_QR_PREFIX)) return null;
  const [memberId, step, signature] = token.slice(MEMBER_QR_PREFIX.length).split('.');
  if (!memberId || !step || !signature || !/^[0-9a-z]+$/.test(step)) return null;
  if (!/^[0-9a-f]+$/.test(signature) || signature.length !== SIGNATURE_HEX) return null;
  return { memberId, step: parseInt(step, 36), signature };
}

export function verifyQrToken(token: string, secret: string, now: Date): boolean {
  const parsed = parseQrToken(token);
  if (!parsed) return false;
  const age = Math.floor(now.getTime() / QR_STEP_MS) - parsed.step;
  // One step of tolerance the other way, for a clock that moved backwards slightly.
  if (age < -1 || age > QR_GRACE_STEPS) return false;
  const expected = Buffer.from(sign(secret, parsed.memberId, parsed.step));
  return timingSafeEqual(expected, Buffer.from(parsed.signature));
}

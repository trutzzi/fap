import { z } from 'zod';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  STAFF_PASSWORD_MIN_LENGTH,
  type MemberFilter,
} from '../contract/models.js';
import { MEMBER_PIN_PATTERN } from '../domain/member-access.js';
import { isIsoDate } from './dates.js';
import { badRequest } from './http-error.js';

/** Parses `data` or throws a 400 carrying the first issue's (Romanian) message. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest(result.error.issues[0]?.message ?? 'Date invalide.');
  return result.data;
}

const text = (label: string, max: number) =>
  z
    .string(`${label} este obligatoriu.`)
    .trim()
    .min(1, `${label} este obligatoriu.`)
    .max(max, `${label} poate avea maximum ${max} caractere.`);

const isoDate = (label: string) =>
  z.string(`${label} este invalidă.`).refine(isIsoDate, `${label} este invalidă.`);

export const planIdSchema = z.enum(['sessions12', 'unlimited'], 'Tipul de abonament este invalid.');

export const paymentMethodSchema = z.enum(
  ['cash', 'card', 'transfer'],
  'Metoda de plată este invalidă.',
);

export const paymentInputSchema = z.object({
  amount: z
    .number('Suma este invalidă.')
    .int('Suma trebuie să fie în lei întregi.')
    .min(1, 'Suma trebuie să fie de cel puțin 1 leu.')
    .max(100_000, 'Suma este prea mare.'),
  method: paymentMethodSchema,
  note: z.string().trim().max(200, 'Nota poate avea maximum 200 de caractere.').default(''),
});

export const newPaymentSchema = paymentInputSchema.extend({
  memberId: z.string('Membrul este invalid.').min(1, 'Membrul este invalid.'),
  periodId: z
    .string()
    .nullish()
    .transform((v) => v || null),
});

export const subscriptionSchema = z.object(
  {
    planId: planIdSchema,
    startDate: isoDate('Data de început'),
    payment: paymentInputSchema.nullish().transform((v) => v ?? null),
  },
  'Abonamentul este invalid.',
);

/** RFID as typed or scanned; normalized and checked for uniqueness by the service. */
const rfidSchema = z
  .string('Codul cardului RFID este invalid.')
  .trim()
  .nullish()
  .transform((v) => v || null);

export const memberSchema = z.object({
  firstName: text('Prenumele', 40),
  lastName: text('Numele', 40),
  phone: text('Telefonul', 20).regex(/^[0-9 +().-]{6,20}$/, 'Numărul de telefon este invalid.'),
  email: z
    .string()
    .trim()
    .max(120, 'Emailul poate avea maximum 120 de caractere.')
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Adresa de email este invalidă.')
    .default(''),
  courseIds: z
    .array(z.string(), 'Cursurile sunt invalide.')
    .default([])
    .transform((ids) => [...new Set(ids)]),
  rfid: rfidSchema,
  photoConsent: z.boolean('Acordul pentru fotografie este invalid.').default(false),
});

export const newMemberSchema = memberSchema.extend({
  subscription: subscriptionSchema.nullish().transform((v) => v ?? null),
});

export const rfidInputSchema = z.object({ rfid: rfidSchema });

export const courseSchema = z.object({
  name: text('Numele cursului', 40),
  coach: text('Antrenorul', 60),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Culoarea trebuie să fie în format #rrggbb.'),
  coachUserId: z
    .string()
    .nullish()
    .transform((v) => v || null),
});

const int = (label: string, min: number, max: number) =>
  z
    .number(`${label} trebuie să fie un număr între ${min} și ${max}.`)
    .int(`${label} trebuie să fie un număr întreg.`)
    .min(min, `${label} trebuie să fie un număr între ${min} și ${max}.`)
    .max(max, `${label} trebuie să fie un număr între ${min} și ${max}.`);

export const slotSchema = z.object({
  courseId: z.string('Cursul selectat nu există.').min(1, 'Cursul selectat nu există.'),
  weekday: int('Ziua', 1, 7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Ora trebuie să fie în format HH:mm.'),
  durationMin: int('Durata', 15, 240),
  capacity: int('Capacitatea', 1, 200),
  label: z
    .string()
    .trim()
    .max(40, 'Eticheta poate avea maximum 40 de caractere.')
    .nullish()
    .transform((v) => v || null),
});

export const planSchema = z.object({
  name: text('Numele abonamentului', 40),
  description: z
    .string()
    .trim()
    .max(300, 'Descrierea poate avea maximum 300 de caractere.')
    .default(''),
  sessionLimit: int('Numărul de ședințe', 1, 100).nullable(),
  price: z
    .number('Prețul este invalid.')
    .int('Prețul trebuie să fie în lei întregi.')
    .min(0, 'Prețul nu poate fi negativ.')
    .max(100_000, 'Prețul este prea mare.')
    .nullable(),
});

export const loginSchema = z.object({
  email: z
    .string('Introdu adresa de email.')
    .trim()
    .toLowerCase()
    .min(1, 'Introdu adresa de email.')
    .max(200),
  password: z.string('Introdu parola.').min(1, 'Introdu parola.').max(200),
});

const newStaffPassword = z
  .string('Introdu parola nouă.')
  .min(1, 'Introdu parola nouă.')
  .min(
    STAFF_PASSWORD_MIN_LENGTH,
    `Parola nouă trebuie să aibă cel puțin ${STAFF_PASSWORD_MIN_LENGTH} caractere.`,
  )
  .max(200, 'Parola nouă este prea lungă.');

export const ownPasswordSchema = z.object({
  currentPassword: z.string('Introdu parola actuală.').min(1, 'Introdu parola actuală.').max(200),
  newPassword: newStaffPassword,
});

export const setPasswordSchema = z.object({ password: newStaffPassword });

export const newStaffAccountSchema = z.object({
  name: text('Numele', 60),
  email: z
    .string('Adresa de email este invalidă.')
    .trim()
    .toLowerCase()
    .max(120, 'Emailul poate avea maximum 120 de caractere.')
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Adresa de email este invalidă.'),
  role: z.enum(['admin', 'reception', 'coach'], 'Rolul este invalid.'),
  password: z
    .string('Introdu parola.')
    .min(1, 'Introdu parola.')
    .min(
      STAFF_PASSWORD_MIN_LENGTH,
      `Parola trebuie să aibă cel puțin ${STAFF_PASSWORD_MIN_LENGTH} caractere.`,
    )
    .max(200, 'Parola este prea lungă.'),
});

const pin = (missing: string) =>
  z.string(missing).trim().min(1, missing).regex(MEMBER_PIN_PATTERN, 'PIN-ul are 4–6 cifre.');

export const memberLoginSchema = z.object({
  phone: z
    .string('Introdu numărul de telefon.')
    .trim()
    .min(1, 'Introdu numărul de telefon.')
    .max(30, 'Numărul de telefon este invalid.'),
  pin: pin('Introdu codul PIN.'),
});

export const pinChangeSchema = z.object({
  currentPin: pin('Introdu PIN-ul actual.'),
  newPin: pin('Introdu PIN-ul nou.'),
});

const isTimezone = (tz: string) => Intl.supportedValuesOf('timeZone').includes(tz);

export const clubSchema = z.object({
  name: text('Numele clubului', 80),
  address: z.string().trim().max(160, 'Adresa este prea lungă.').default(''),
  phone: z.string().trim().max(30, 'Telefonul este prea lung.').default(''),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Adresa de email este invalidă.')
    .default(''),
  website: z.string().trim().max(120, 'Adresa site-ului este prea lungă.').default(''),
  timezone: z.string('Fusul orar este invalid.').refine(isTimezone, 'Fusul orar este invalid.'),
  smsEnabled: z.boolean('Opțiunea pentru SMS este invalidă.').default(false),
  kioskVolume: int('Volumul', 0, 100).default(60),
  expiryReminderSms: z.boolean('Opțiunea pentru reamintiri este invalidă.').default(false),
});

export const checkInSchema = z
  .object({
    rfid: z.string().trim().optional(),
    qr: z.string().trim().max(200).optional(),
    memberId: z.string().optional(),
  })
  .refine((v) => v.rfid || v.qr || v.memberId, 'Trimite un card RFID, un cod QR sau un membru.');

const MEMBER_FILTERS = [
  'all',
  'active',
  'expiring',
  'limit',
  'expired',
  'no-card',
] as const satisfies MemberFilter[];

/** Query strings are lenient: invalid values fall back to defaults instead of failing. */
export const membersQuerySchema = z.object({
  q: z.string().optional().catch(undefined),
  filter: z.enum(MEMBER_FILTERS).catch('all'),
  courseId: z.string().min(1).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(10),
});

export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional()
  .catch(undefined);
export const weekSchema = z.string().refine(isIsoDate).optional().catch(undefined);

const id = (message: string) => z.string(message).min(1, message);

export const announcementSchema = z.object({
  title: text('Titlul', ANNOUNCEMENT_TITLE_MAX),
  body: text('Mesajul', ANNOUNCEMENT_BODY_MAX),
  audience: z.discriminatedUnion(
    'kind',
    [
      z.object({ kind: z.literal('all') }),
      z.object({ kind: z.literal('active') }),
      z.object({ kind: z.literal('course'), courseId: id('Alege un curs.') }),
      z.object({
        kind: z.literal('members'),
        memberIds: z
          .array(id('Membrul este invalid.'), 'Alege cel puțin un membru.')
          .min(1, 'Alege cel puțin un membru.')
          .max(1000)
          .transform((ids) => [...new Set(ids)]),
      }),
    ],
    'Alege destinatarii.',
  ),
  sms: z.boolean('Opțiunea SMS este invalidă.').default(false),
});

export const bulkDeleteSchema = z.object({
  memberIds: z
    .array(id('Membrul este invalid.'), 'Alege membrii de șters.')
    .min(1, 'Alege membrii de șters.')
    .max(500, 'Poți șterge cel mult 500 de membri odată.')
    .transform((ids) => [...new Set(ids)]),
});

export const periodPriceSchema = z.object({
  price: z
    .number('Prețul este invalid.')
    .int('Prețul trebuie să fie în lei întregi.')
    .min(0, 'Prețul nu poate fi negativ.')
    .max(100_000, 'Prețul este prea mare.')
    .nullable(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.url('Abonarea la notificări este invalidă.').startsWith('https://').max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

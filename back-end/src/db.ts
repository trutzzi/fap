import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from './generated/prisma/client.js';

export type Db = PrismaClient;
/** The full client or an interactive-transaction client; use for query helpers. */
export type DbClient = Prisma.TransactionClient;

export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * `@db.Date` columns map to JS Dates at UTC midnight. These helpers convert between
 * them and the API's local `YYYY-MM-DD` strings without timezone drift.
 */
export function toDbDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

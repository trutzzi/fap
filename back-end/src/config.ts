import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_TIMEZONE: z.string().default('Europe/Bucharest'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /**
   * Express `trust proxy`: which reverse proxies may set X-Forwarded-For (the client IP is
   * used for login rate limiting). `loopback` for a local proxy; `uniquelocal` behind a
   * proxy on a private/Docker network; or a hop count like `1`.
   */
  TRUST_PROXY: z
    .string()
    .default('loopback')
    .transform((v) => (/^\d+$/.test(v) ? Number(v) : v)),
  /** Public address of the app; the password SMS links to `<PUBLIC_URL>/cont`. */
  PUBLIC_URL: z
    .url()
    .default('http://localhost:4200')
    .transform((v) => v.replace(/\/+$/, '')),
  /** SMSLink.ro gateway (SMS with member passwords). Without both, SMS are only logged. */
  SMSLINK_CONNECTION_ID: z.string().default(''),
  SMSLINK_PASSWORD: z.string().default(''),
  /** Sender name approved by SMSLink; empty uses their numeric short number. */
  SMSLINK_SENDER: z.string().default(''),
  /** `true`: SMSLink validates requests but sends nothing. */
  SMSLINK_TEST: z
    .enum(['true', 'false', ''])
    .default('')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;

/** Reads and validates the environment; fails fast with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

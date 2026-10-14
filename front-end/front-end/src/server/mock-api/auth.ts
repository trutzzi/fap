import { randomBytes } from 'node:crypto';
import { Request, Response } from 'express';
import { AuthUser } from '../../app/core/api/models';

/**
 * Fake staff accounts for `npm run start:mock` only (in-memory data, no real members).
 * They do not work against the real back-end, whose accounts are created with
 * `npm run user:create`. Passwords are compared in plain text on purpose.
 */
export const MOCK_COACH_ID = 'u-antrenor';

export const DEMO_USERS: (AuthUser & { password: string })[] = [
  {
    id: 'u-admin',
    email: 'admin@fightacademy.ro',
    name: 'Administrator',
    role: 'admin',
    password: 'mock-admin',
  },
  {
    id: 'u-receptie',
    email: 'receptie@fightacademy.ro',
    name: 'Recepție',
    role: 'reception',
    password: 'mock-receptie',
  },
  {
    id: MOCK_COACH_ID,
    email: 'antrenor@fightacademy.ro',
    name: 'Albu Marius',
    role: 'coach',
    password: 'mock-antrenor',
  },
];

const COOKIE = 'fa_session';

/** In-memory sessions (token → user); reset when the dev server restarts. */
export class MockSessions {
  private readonly sessions = new Map<string, AuthUser>();

  login(email: string, password: string): AuthUser | null {
    const match = DEMO_USERS.find(
      (u) => u.email === email.trim().toLowerCase() && u.password === password,
    );
    if (!match) return null;
    const { password: _password, ...user } = match;
    return user;
  }

  start(res: Response, user: AuthUser): void {
    const token = randomBytes(24).toString('base64url');
    this.sessions.set(token, user);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
  }

  user(req: Request): AuthUser | undefined {
    const token = this.token(req);
    return token ? this.sessions.get(token) : undefined;
  }

  end(req: Request, res: Response): void {
    const token = this.token(req);
    if (token) this.sessions.delete(token);
    res.clearCookie(COOKIE, { path: '/' });
  }

  private token(req: Request): string | undefined {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === COOKIE) return value.join('=');
    }
    return undefined;
  }
}

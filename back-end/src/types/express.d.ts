import type { AuthUser } from '../contract/models.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` when the request carries a valid session cookie. */
      user?: AuthUser;
      /** Set inside `/api/account` for a valid member portal session (cookie `fa_member`). */
      member?: { id: string; sessionId: string };
    }
  }
}

export {};

import type { AuthUser } from '../contract/models.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` when the request carries a valid session cookie. */
      user?: AuthUser;
    }
  }
}

export {};

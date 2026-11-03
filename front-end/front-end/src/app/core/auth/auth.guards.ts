import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** The site's entry point (`/` redirects here); signed-out visitors are mostly members. */
const HOME = '/dashboard';

/**
 * Signed-in staff only. Signed-out visitors of the home page get the members' login (staff
 * reach theirs from its discreet link); a deeper staff link goes to the staff login and
 * comes back afterwards.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthService).user()) return true;
  const router = inject(Router);
  if (state.url === HOME) return router.createUrlTree(['/cont/login']);
  return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
};

/** Administrators only; reception is sent to the dashboard. */
export const adminGuard: CanActivateFn = () =>
  inject(AuthService).isAdmin() || inject(Router).createUrlTree(['/dashboard']);

/** Admin and reception only (members' personal data); coaches go to their classes. */
export const staffGuard: CanActivateFn = () =>
  inject(AuthService).isStaff() || inject(Router).createUrlTree(['/antrenamente']);

/** The login page is pointless once signed in. */
export const guestGuard: CanActivateFn = () =>
  !inject(AuthService).user() || inject(Router).createUrlTree(['/dashboard']);

/** Only same-app paths are allowed as a post-login redirect (no open redirects). */
export function safeRedirect(url: string | null | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/login')
    ? url
    : '/dashboard';
}

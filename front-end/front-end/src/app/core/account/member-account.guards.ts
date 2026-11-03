import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MemberAccountService } from './member-account.service';

/** Member portal pages; signed-out members go to the member login. */
export const memberGuard: CanActivateFn = async () => {
  const accounts = inject(MemberAccountService);
  const router = inject(Router);
  await accounts.restore();
  return accounts.account() ? true : router.createUrlTree(['/cont/login']);
};

/** The member login is pointless once signed in. */
export const memberGuestGuard: CanActivateFn = async () => {
  const accounts = inject(MemberAccountService);
  const router = inject(Router);
  await accounts.restore();
  return accounts.account() ? router.createUrlTree(['/cont']) : true;
};

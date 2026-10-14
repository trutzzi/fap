import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../ui/toast.service';
import { AuthService } from './auth.service';

/**
 * When the API answers 401 (session expired or revoked), forget the user and send them to
 * the login page, returning to the current page afterwards. Auth calls handle 401 themselves.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((err: unknown) => {
      const expired =
        err instanceof HttpErrorResponse && err.status === 401 && !req.url.startsWith('/api/auth/');
      if (expired && auth.user()) {
        auth.clear();
        toast.error('Sesiunea a expirat. Autentifică-te din nou.');
        void router.navigate(['/login'], { queryParams: { redirect: router.url } });
      }
      return throwError(() => err);
    }),
  );
};

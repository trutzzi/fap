import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, firstValueFrom, map, of, tap } from 'rxjs';
import { AuthUser, LoginInput, Role } from '../api/models';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  reception: 'Recepție',
  coach: 'Antrenor',
};

/**
 * The signed-in staff member. The session itself is an httpOnly cookie set by the API,
 * so the app never sees a token; it only knows who is signed in.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly _user = signal<AuthUser | null>(null);

  readonly user = this._user.asReadonly();
  readonly isAdmin = computed(() => this._user()?.role === 'admin');
  /** Admin or reception: everyone who may see members' personal data. */
  readonly isStaff = computed(() => {
    const role = this._user()?.role;
    return role === 'admin' || role === 'reception';
  });

  /** Loads the current session at startup; resolves (never rejects) once known. */
  restore(): Promise<void> {
    return firstValueFrom(
      this.http.get<AuthUser>('/api/auth/me').pipe(
        catchError(() => of(null)),
        map((user) => this._user.set(user)),
      ),
    );
  }

  login(input: LoginInput): Observable<AuthUser> {
    return this.http
      .post<AuthUser>('/api/auth/login', input)
      .pipe(tap((user) => this._user.set(user)));
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {}).pipe(
      catchError(() => of(undefined)),
      finalize(() => this._user.set(null)),
    );
  }

  /** Forgets the user locally, e.g. after the API reports the session expired. */
  clear(): void {
    this._user.set(null);
  }
}

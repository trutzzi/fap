import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, firstValueFrom, map, of, tap } from 'rxjs';
import {
  MemberAccount,
  MemberAnnouncement,
  MemberLoginInput,
  MemberQrCode,
  PinChangeInput,
} from '../api/models';

/**
 * The signed-in member of the member portal (`/cont`). Its session is the httpOnly
 * `fa_member` cookie, independent of a staff session in the same browser.
 */
@Injectable({ providedIn: 'root' })
export class MemberAccountService {
  private readonly http = inject(HttpClient);
  private readonly _account = signal<MemberAccount | null>(null);
  private restored = false;

  readonly account = this._account.asReadonly();

  /** Loads the session once (on the first visit to a portal page); never rejects. */
  async restore(): Promise<void> {
    if (this.restored) return;
    await firstValueFrom(this.load());
    this.restored = true;
  }

  /**
   * Refreshes the member's data (subscription, history). Only a 401 signs the member out
   * locally; a network error (weak signal at the gym) keeps what is already shown.
   */
  load(): Observable<MemberAccount | null> {
    return this.http.get<MemberAccount>('/api/account').pipe(
      catchError((err: unknown) =>
        of(err instanceof HttpErrorResponse && err.status === 401 ? null : this._account()),
      ),
      tap((account) => this._account.set(account)),
    );
  }

  login(input: MemberLoginInput): Observable<MemberAccount> {
    return this.http.post<MemberAccount>('/api/account/login', input).pipe(
      tap((account) => {
        this._account.set(account);
        this.restored = true;
      }),
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/account/logout', {}).pipe(
      catchError(() => of(undefined)),
      map(() => undefined),
      finalize(() => this._account.set(null)),
    );
  }

  announcements(): Observable<MemberAnnouncement[]> {
    return this.http.get<MemberAnnouncement[]>('/api/account/announcements');
  }

  /** Marks every announcement as read (the member has seen the list). */
  markAnnouncementsRead(): Observable<void> {
    return this.http.post<void>('/api/account/announcements/read', {});
  }

  qr(): Observable<MemberQrCode> {
    return this.http.get<MemberQrCode>('/api/account/qr');
  }

  /** Signs the member out on their other devices. */
  changePin(input: PinChangeInput): Observable<void> {
    return this.http.put<void>('/api/account/pin', input);
  }

  /** Forgets the member locally, e.g. after the API reports the session ended. */
  clear(): void {
    this._account.set(null);
  }
}

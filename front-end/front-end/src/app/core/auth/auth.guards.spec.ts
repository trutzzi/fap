import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { AuthUser } from '../api/models';
import { adminGuard, authGuard, guestGuard, safeRedirect, staffGuard } from './auth.guards';
import { AuthService } from './auth.service';

const ADMIN: AuthUser = { id: '1', email: 'a@x.ro', name: 'Ana', role: 'admin' };
const RECEPTION: AuthUser = { id: '2', email: 'r@x.ro', name: 'Radu', role: 'reception' };
const COACH: AuthUser = { id: '3', email: 'c@x.ro', name: 'Marius', role: 'coach' };

describe('auth guards', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function signIn(user: AuthUser | null) {
    const restored = TestBed.inject(AuthService).restore();
    const req = http.expectOne('/api/auth/me');
    if (user) req.flush(user);
    else req.flush({ message: 'x' }, { status: 401, statusText: 'Unauthorized' });
    await restored;
  }

  const run = (guard: typeof authGuard, url = '/membri?q=ana') =>
    TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
  const urlOf = (result: unknown) => TestBed.inject(Router).serializeUrl(result as UrlTree);

  it('sends signed-out visitors to the login page and keeps where they were going', async () => {
    await signIn(null);
    expect(urlOf(run(authGuard))).toBe('/login?redirect=%2Fmembri%3Fq%3Dana');
    expect(run(guestGuard)).toBe(true);
  });

  it('lets staff in and keeps them away from the login page', async () => {
    await signIn(RECEPTION);
    expect(run(authGuard)).toBe(true);
    expect(urlOf(run(guestGuard))).toBe('/dashboard');
  });

  it('allows the admin area to admins only', async () => {
    await signIn(RECEPTION);
    expect(urlOf(run(adminGuard))).toBe('/dashboard');
    await signIn(ADMIN);
    expect(run(adminGuard)).toBe(true);
  });

  it('keeps coaches away from members and sends them to their classes', async () => {
    await signIn(COACH);
    expect(urlOf(run(staffGuard))).toBe('/antrenamente');
    expect(urlOf(run(adminGuard))).toBe('/dashboard');
    await signIn(RECEPTION);
    expect(run(staffGuard)).toBe(true);
  });

  it('only redirects to paths inside the app after login', () => {
    expect(safeRedirect('/membri/42')).toBe('/membri/42');
    expect(safeRedirect('https://evil.example')).toBe('/dashboard');
    expect(safeRedirect('//evil.example')).toBe('/dashboard');
    expect(safeRedirect('/login?redirect=/x')).toBe('/dashboard');
    expect(safeRedirect(undefined)).toBe('/dashboard');
  });
});

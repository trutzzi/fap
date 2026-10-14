import { isPlatformBrowser, registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import localeRo from '@angular/common/locales/ro';
import {
  ApplicationConfig,
  LOCALE_ID,
  PLATFORM_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';

registerLocaleData(localeRo);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideClientHydration(withEventReplay()),
    { provide: LOCALE_ID, useValue: 'ro' },
    // Know who is signed in before the first route guard runs (browser only: the session
    // cookie never reaches the server-side renderer).
    provideAppInitializer(() =>
      isPlatformBrowser(inject(PLATFORM_ID)) ? inject(AuthService).restore() : undefined,
    ),
  ],
};

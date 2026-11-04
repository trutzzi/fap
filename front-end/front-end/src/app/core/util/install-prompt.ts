import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Chrome's install prompt event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Installing the app on the phone's home screen. Android/Chrome offers it through the
 * `beforeinstallprompt` event (kept here until the member taps "Instalează"); iPhones have no
 * such event, so the member uses Share → "Adaugă pe ecranul principal".
 */
@Injectable({ providedIn: 'root' })
export class InstallPrompt {
  private event: BeforeInstallPromptEvent | null = null;
  /** Chrome offered installation and it hasn't been used yet. */
  readonly canInstall = signal(false);
  /** Already running as an installed app. */
  readonly installed = signal(false);
  /** iPhone/iPad Safari: show the manual steps instead of a button. */
  readonly isIos = signal(false);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    this.installed.set(
      matchMedia('(display-mode: standalone)').matches ||
        (navigator as { standalone?: boolean }).standalone === true,
    );
    this.isIos.set(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
    addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.event = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });
    addEventListener('appinstalled', () => {
      this.installed.set(true);
      this.canInstall.set(false);
    });
  }

  async install(): Promise<void> {
    const event = this.event;
    if (!event) return;
    this.event = null;
    this.canInstall.set(false);
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') this.installed.set(true);
  }
}

import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { PushSubscriptionInput } from '../api/models';
import { MemberAccountService } from './member-account.service';

export type PushState =
  /** The browser can't do Web Push, or the server has it off. */
  | 'unsupported'
  /** iPhone/iPad in Safari: push works only once added to the Home Screen. */
  | 'needs-install'
  | 'off'
  | 'on'
  /** The member blocked notifications for the site; only the browser settings can undo it. */
  | 'blocked';

/** Base64url VAPID key → bytes, as `pushManager.subscribe` wants it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Phone notifications for the member portal (Web Push through `public/sw.js`). The member
 * turns them on with a tap, which also asks the browser's permission.
 */
@Injectable({ providedIn: 'root' })
export class PushNotifications {
  private readonly accounts = inject(MemberAccountService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly state = signal<PushState>('unsupported');
  private publicKey: string | null = null;

  /** Works out the current state; call when the portal opens. */
  async refresh(): Promise<void> {
    if (!this.browser) return;
    const standalone =
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      this.state.set(ios && !standalone ? 'needs-install' : 'unsupported');
      return;
    }
    try {
      this.publicKey = (await firstValueFrom(this.accounts.pushConfig())).publicKey;
    } catch {
      this.publicKey = null;
    }
    if (!this.publicKey) return this.state.set('unsupported');
    if (Notification.permission === 'denied') return this.state.set('blocked');
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    this.state.set(subscription ? 'on' : 'off');
    // Keep the server's copy current (subscriptions can change after a browser update).
    if (subscription) await this.save(subscription);
  }

  async enable(): Promise<void> {
    if (!this.publicKey) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      this.state.set(permission === 'denied' ? 'blocked' : 'off');
      return;
    }
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(this.publicKey),
      }));
    await this.save(subscription);
    this.state.set('on');
  }

  async disable(): Promise<void> {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await firstValueFrom(this.accounts.unsubscribePush(subscription.endpoint)).catch(
        () => undefined,
      );
      await subscription.unsubscribe();
    }
    this.state.set('off');
  }

  private async save(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON() as PushSubscriptionInput;
    await firstValueFrom(this.accounts.subscribePush(json)).catch(() => undefined);
  }
}

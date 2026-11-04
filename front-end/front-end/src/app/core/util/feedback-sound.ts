import { Injectable, signal } from '@angular/core';

export type FeedbackTone = 'success' | 'warning' | 'danger';

const MUTE_KEY = 'fa.kiosk.muted';

/** Notes per tone: [frequency Hz, start s, duration s]. */
const MELODIES: Record<FeedbackTone, [number, number, number][]> = {
  // Two rising notes: "come in".
  success: [
    [880, 0, 0.12],
    [1320, 0.13, 0.18],
  ],
  // One low, longer note: "attention".
  warning: [[440, 0, 0.35]],
  // Two falling notes: "no".
  danger: [
    [392, 0, 0.18],
    [262, 0.2, 0.32],
  ],
};

/** Loudest gain at volume 100; the club's volume (0–100) scales it. */
const MAX_GAIN = 0.8;

/**
 * Short synthesized sounds for the kiosk (no audio files): rising notes for an accepted
 * check-in, a low note for the session limit, falling notes for a refusal (expired, no
 * subscription, unknown card, old QR code). Browsers only allow audio after a user
 * gesture; a card scan arrives as key presses, which counts as one.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackSound {
  private context: AudioContext | null = null;
  readonly muted = signal(readMuted());
  /** 0–100, from the club settings (Administrare › Club). */
  readonly volume = signal(60);

  toggleMuted(): void {
    this.muted.update((m) => !m);
    try {
      localStorage.setItem(MUTE_KEY, this.muted() ? '1' : '0');
    } catch {
      // Storage may be unavailable (private mode); the setting then lasts for this visit.
    }
  }

  play(tone: FeedbackTone): void {
    if (!this.muted()) this.preview(tone, this.volume());
  }

  /** Plays a tone at `volume` even when this device is muted (settings page test). */
  preview(tone: FeedbackTone, volume: number): void {
    const peak = (Math.min(Math.max(volume, 0), 100) / 100) * MAX_GAIN;
    if (peak === 0 || typeof AudioContext === 'undefined') return;
    this.context ??= new AudioContext();
    const ctx = this.context;
    void ctx.resume();
    const start = ctx.currentTime + 0.01;
    for (const [frequency, offset, duration] of MELODIES[tone]) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = tone === 'success' ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      // Short fade in/out avoids clicks.
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(peak, start + offset + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + offset + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + duration + 0.05);
    }
  }
}

function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

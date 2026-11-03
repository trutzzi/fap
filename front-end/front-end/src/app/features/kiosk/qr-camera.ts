import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MEMBER_QR_PREFIX } from '../../core/api/models';

/** The browser's Shape Detection API (Chrome on Android/ChromeOS/macOS); not in lib.dom yet. */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

const SCAN_INTERVAL_MS = 250;
/** A code still held in front of the camera is not submitted again for this long. */
const REPEAT_AFTER_MS = 10_000;

function detectorClass(): BarcodeDetectorClass | null {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector ?? null;
}

/** True when this browser can read QR codes from the camera. */
export async function qrCameraSupported(): Promise<boolean> {
  const Detector = detectorClass();
  if (!Detector || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    return (await Detector.getSupportedFormats()).includes('qr_code');
  } catch {
    return false;
  }
}

/**
 * Live front-camera preview that reads member QR codes (codes of other apps are ignored).
 * Needs a secure context (HTTPS or localhost) and camera permission, granted once.
 */
@Component({
  selector: 'app-qr-camera',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <video #video muted playsinline aria-hidden="true"></video>
    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 24px;
      border: 2px solid var(--border-strong);
      background: #000;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      /* Front camera: mirror it so members see themselves as in a mirror. */
      transform: scaleX(-1);
    }
    .error {
      position: absolute;
      inset: 0;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 16px;
      text-align: center;
      font-size: 14px;
      color: var(--text);
    }
  `,
})
export class QrCamera {
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  /** A member QR code read by the camera. */
  readonly scanned = output<string>();
  protected readonly error = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private last = { value: '', at: 0 };

  constructor() {
    afterNextRender(() => void this.start());
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private async start(): Promise<void> {
    const Detector = detectorClass();
    if (!Detector) {
      this.error.set('Acest browser nu poate citi coduri QR cu camera.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      this.error.set('Camera nu este disponibilă. Permite accesul la cameră în browser.');
      return;
    }
    if (this.stopped) return this.stop();
    const video = this.video().nativeElement;
    video.srcObject = this.stream;
    await video.play().catch(() => undefined);
    const detector = new Detector({ formats: ['qr_code'] });

    const tick = async () => {
      if (this.stopped) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const codes = await detector.detect(video);
          const code = codes.find((c) => c.rawValue.startsWith(MEMBER_QR_PREFIX))?.rawValue;
          const now = Date.now();
          if (code && (code !== this.last.value || now - this.last.at > REPEAT_AFTER_MS)) {
            this.last = { value: code, at: now };
            this.scanned.emit(code);
          }
        } catch {
          // A frame that can't be analysed; try the next one.
        }
      }
      this.timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
    };
    void tick();
  }

  private stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

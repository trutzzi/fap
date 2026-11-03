import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
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

/** `user`: the tablet's front camera, facing the members; `environment`: the back one. */
export type CameraFacing = 'user' | 'environment';

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
 * Live camera preview (front or back) that reads member QR codes; codes of other apps are
 * ignored.
 * Needs a secure context (HTTPS or localhost) and camera permission, granted once.
 */
@Component({
  selector: 'app-qr-camera',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <video
      #video
      muted
      playsinline
      aria-hidden="true"
      [class.mirrored]="facing() === 'user'"
    ></video>
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
    }
    /* Front camera: mirrored, so members see themselves as in a mirror. */
    video.mirrored {
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
  /** Which camera to use; changing it restarts the preview. */
  readonly facing = input<CameraFacing>('user');
  /** A member QR code read by the camera. */
  readonly scanned = output<string>();
  protected readonly error = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on every stop, so a camera still starting up for an old run gives up. */
  private run = 0;
  private rendered = false;
  private last = { value: '', at: 0 };

  constructor() {
    afterNextRender(() => {
      this.rendered = true;
      void this.start();
    });
    effect(() => {
      this.facing();
      untracked(() => {
        if (!this.rendered) return;
        this.stop();
        void this.start();
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private async start(): Promise<void> {
    const run = this.run;
    this.error.set(null);
    const Detector = detectorClass();
    if (!Detector) {
      this.error.set('Acest browser nu poate citi coduri QR cu camera.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facing(), width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      if (run === this.run) {
        this.error.set('Camera nu este disponibilă. Permite accesul la cameră în browser.');
      }
      return;
    }
    if (run !== this.run) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    const video = this.video().nativeElement;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    const detector = new Detector({ formats: ['qr_code'] });

    const tick = async () => {
      if (run !== this.run) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const codes = await detector.detect(video);
          const code = codes.find((c) => c.rawValue.startsWith(MEMBER_QR_PREFIX))?.rawValue;
          const now = Date.now();
          if (run === this.run && code) {
            if (code !== this.last.value || now - this.last.at > REPEAT_AFTER_MS) {
              this.last = { value: code, at: now };
              this.scanned.emit(code);
            }
          }
        } catch {
          // A frame that can't be analysed; try the next one.
        }
      }
      if (run === this.run) this.timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
    };
    void tick();
  }

  private stop(): void {
    this.run++;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

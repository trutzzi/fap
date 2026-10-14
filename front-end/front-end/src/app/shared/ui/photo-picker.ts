import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { squareJpeg } from '../../core/util/image';
import { MemberAvatar } from './member-avatar';

/**
 * Take a photo with the device camera (e.g. the reception tablet) or upload one. The image is
 * cropped to a square and shrunk in the browser; `photo` emits it (or `null` when cleared).
 * Saving is up to the parent.
 */
@Component({
  selector: 'app-photo-picker',
  imports: [MemberAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as message) {
      <div class="form-error" role="alert">{{ message }}</div>
    }
    <div class="stage">
      @switch (mode()) {
        @case ('choose') {
          @if (currentUrl()) {
            <app-member-avatar
              class="frame"
              [initials]="initials()"
              [photoUrl]="currentUrl()"
              [size]="size()"
              label="Fotografia actuală"
            />
          }
          <div class="choices">
            <button type="button" class="btn btn-primary" (click)="startCamera()">
              Fă o fotografie
            </button>
            <label class="btn">
              Încarcă o imagine
              <input
                #file
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="visually-hidden"
                (change)="onFile(file)"
              />
            </label>
          </div>
        }
        @case ('camera') {
          <video
            #video
            autoplay
            playsinline
            muted
            aria-label="Previzualizare cameră"
            [style.width.px]="size()"
          ></video>
          <div class="choices">
            <button type="button" class="btn btn-primary" (click)="capture()">Fotografiază</button>
            <button type="button" class="btn btn-ghost" (click)="reset()">Înapoi</button>
          </div>
        }
        @case ('preview') {
          @if (preview(); as p) {
            <img class="frame" [src]="p.url" alt="Fotografia nouă" [style.width.px]="size()" />
          }
          <div class="choices">
            <button type="button" class="btn btn-ghost" (click)="reset()">Alege alta</button>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .stage {
      display: grid;
      place-items: center;
      gap: 12px;
    }
    .frame,
    video {
      max-width: 100%;
      aspect-ratio: 1;
      border-radius: var(--radius-lg);
      object-fit: cover;
      background: var(--bg);
      border: 1px solid var(--border-strong);
    }
    video {
      transform: scaleX(-1); /* mirror the selfie preview; the photo itself is not mirrored */
    }
    .choices {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
    }
  `,
})
export class PhotoPicker {
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  /** The member's current photo, shown until a new one is chosen. */
  readonly currentUrl = input<string | null>(null);
  readonly initials = input('');
  readonly size = input(280);
  readonly photo = output<Blob | null>();

  protected readonly mode = signal<'choose' | 'camera' | 'preview'>('choose');
  protected readonly preview = signal<{ blob: Blob; url: string } | null>(null);
  protected readonly error = signal<string | null>(null);
  private stream: MediaStream | null = null;

  constructor() {
    // Attach the camera once the <video> for camera mode has been rendered.
    effect(() => {
      const video = this.video()?.nativeElement;
      if (video && this.stream && video.srcObject !== this.stream) {
        video.srcObject = this.stream;
        void video.play();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopCamera();
      this.clearPreview();
    });
  }

  protected async onFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error.set('Alege o imagine (JPEG, PNG sau WebP).');
      return;
    }
    await this.prepare(() => squareJpeg(file));
  }

  protected async startCamera(): Promise<void> {
    this.error.set(null);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } },
        audio: false,
      });
      this.mode.set('camera');
    } catch {
      this.error.set(
        'Camera nu este disponibilă. Verifică permisiunea browserului sau încarcă un fișier.',
      );
    }
  }

  protected async capture(): Promise<void> {
    const video = this.video()?.nativeElement;
    if (!video) return;
    await this.prepare(() => squareJpeg(video));
    this.stopCamera();
  }

  /** Back to the start: forget the new photo and stop the camera. */
  reset(): void {
    this.stopCamera();
    this.clearPreview();
    this.mode.set('choose');
    this.photo.emit(null);
  }

  private async prepare(make: () => Promise<Blob>): Promise<void> {
    this.error.set(null);
    try {
      const blob = await make();
      this.clearPreview();
      this.preview.set({ blob, url: URL.createObjectURL(blob) });
      this.mode.set('preview');
      this.photo.emit(blob);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Imaginea nu poate fi citită.');
    }
  }

  private stopCamera(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private clearPreview(): void {
    const current = this.preview();
    if (current) URL.revokeObjectURL(current.url);
    this.preview.set(null);
  }
}

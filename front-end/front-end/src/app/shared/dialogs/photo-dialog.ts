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
import { finalize } from 'rxjs';
import { MembersService } from '../../core/api/members.service';
import { MemberSummary } from '../../core/api/models';
import { errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { squareJpeg } from '../../core/util/image';
import { MemberAvatar } from '../ui/member-avatar';
import { Modal } from '../ui/modal';

/**
 * Upload a photo or take one with the device camera. Images are cropped to a square and
 * shrunk in the browser before upload. Requires the member's photo consent.
 */
@Component({
  selector: 'app-photo-dialog',
  imports: [Modal, MemberAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './photo-dialog.html',
  styles: `
    .stage {
      display: grid;
      place-items: center;
      gap: 16px;
    }
    .frame,
    video {
      width: min(320px, 100%);
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
export class PhotoDialog {
  private readonly members = inject(MembersService);
  private readonly toast = inject(ToastService);
  protected readonly modal = viewChild.required(Modal);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly member = input.required<MemberSummary>();
  readonly saved = output<MemberSummary>();
  readonly closed = output<void>();

  protected readonly mode = signal<'choose' | 'camera' | 'preview'>('choose');
  protected readonly preview = signal<{ blob: Blob; url: string } | null>(null);
  protected readonly busy = signal(false);
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

  protected retake(): void {
    this.clearPreview();
    this.mode.set('choose');
  }

  protected save(): void {
    const photo = this.preview();
    if (!photo || this.busy()) return;
    this.run(this.members.uploadPhoto(this.member().id, photo.blob), 'Fotografia a fost salvată.');
  }

  protected remove(): void {
    if (this.busy()) return;
    this.run(this.members.deletePhoto(this.member().id), 'Fotografia a fost ștearsă.');
  }

  private async prepare(make: () => Promise<Blob>): Promise<void> {
    this.error.set(null);
    try {
      const blob = await make();
      this.clearPreview();
      this.preview.set({ blob, url: URL.createObjectURL(blob) });
      this.mode.set('preview');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Imaginea nu poate fi citită.');
    }
  }

  private run(request: ReturnType<MembersService['deletePhoto']>, success: string): void {
    this.busy.set(true);
    this.error.set(null);
    request.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: (member) => {
        this.toast.success(success);
        this.saved.emit(member);
        this.modal().close();
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
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

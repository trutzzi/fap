import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, of } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { AnnouncementsService } from '../../core/api/announcements.service';
import { SmsService } from '../../core/api/sms.service';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  Announcement,
  AnnouncementAudience,
  MemberSummary,
} from '../../core/api/models';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { onInterval } from '../../core/util/interval';
import { ConfirmDialog } from '../../shared/dialogs/confirm-dialog';
import { MemberMultiPickerDialog } from '../../shared/dialogs/member-multi-picker-dialog';
import { SmsCreditInfo } from '../../shared/ui/sms-credit';

type AudienceKind = AnnouncementAudience['kind'];

const SMS_PROGRESS_MS = 3000;

/** Messages to members, shown in their portal (`/cont`), and the history of sent ones. */
@Component({
  selector: 'app-announcements-page',
  imports: [DatePipe, ReactiveFormsModule, ConfirmDialog, MemberMultiPickerDialog, SmsCreditInfo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './announcements-page.html',
  styleUrl: './announcements-page.css',
})
export class AnnouncementsPage {
  private readonly api = inject(AnnouncementsService);
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  private readonly sms = inject(SmsService);

  protected readonly titleMax = ANNOUNCEMENT_TITLE_MAX;
  protected readonly bodyMax = ANNOUNCEMENT_BODY_MAX;
  protected readonly announcements = createQuery(
    () => null,
    () => this.api.list(),
  );
  protected readonly courses = createQuery(
    () => null,
    () => this.academy.courses(),
  );

  protected readonly form = inject(NonNullableFormBuilder).group({
    title: ['', [Validators.required, Validators.maxLength(ANNOUNCEMENT_TITLE_MAX)]],
    body: ['', [Validators.required, Validators.maxLength(ANNOUNCEMENT_BODY_MAX)]],
    kind: ['all' as AudienceKind],
    courseId: [''],
    sms: [false],
  });
  /** Hand-picked recipients (audience `members`). */
  protected readonly chosen = signal<MemberSummary[]>([]);
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  /** The chosen audience, or `null` while incomplete. */
  private readonly audience = computed<AnnouncementAudience | null>(() => {
    const { kind, courseId } = this.formValue();
    if (kind === 'course') return courseId ? { kind, courseId } : null;
    if (kind === 'members') {
      const ids = this.chosen().map((m) => m.id);
      return ids.length ? { kind, memberIds: ids } : null;
    }
    return kind === 'all' || kind === 'active' ? { kind } : null;
  });
  /** SMS a send would use (only asked while "also by SMS" is ticked). */
  protected readonly preview = createQuery(
    () => (this.formValue().sms ? this.audience() : null),
    (audience) =>
      audience ? this.sms.previewAnnouncement(audience) : of({ recipients: 0, smsCount: 0 }),
  );
  protected readonly picking = signal(false);
  protected readonly sending = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly withdrawing = signal<Announcement | null>(null);

  protected readonly withdrawAction = () => this.api.delete(this.withdrawing()!.id);

  constructor() {
    // While SMS are being sent in the background, refresh the list to show the progress.
    onInterval(SMS_PROGRESS_MS, () => {
      const pending = this.announcements
        .value()
        ?.some((a) => a.sms && a.sms.sent + a.sms.failed < a.sms.recipients);
      if (pending) this.announcements.reload();
    });
  }

  protected invalid(name: 'title' | 'body'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected removeMember(id: string): void {
    this.chosen.update((list) => list.filter((m) => m.id !== id));
  }

  protected send(): void {
    this.submitted.set(true);
    const { title, body, kind, courseId, sms } = this.form.getRawValue();
    const audience: AnnouncementAudience | null =
      kind === 'course'
        ? courseId
          ? { kind, courseId }
          : null
        : kind === 'members'
          ? this.chosen().length
            ? { kind, memberIds: this.chosen().map((m) => m.id) }
            : null
          : { kind };
    if (this.form.invalid || this.sending()) return;
    if (!audience) {
      this.error.set(kind === 'course' ? 'Alege un curs.' : 'Alege cel puțin un membru.');
      return;
    }
    this.sending.set(true);
    this.error.set(null);
    this.api
      .send({ title: title.trim(), body: body.trim(), audience, sms })
      .pipe(finalize(() => this.sending.set(false)))
      .subscribe({
        next: (sent) => {
          this.toast.success(
            `Anunțul a fost trimis către ${sent.recipients === 1 ? '1 membru' : sent.recipients + ' membri'}.`,
          );
          this.form.reset({ title: '', body: '', kind: 'all', courseId: '', sms: false });
          this.chosen.set([]);
          this.submitted.set(false);
          this.announcements.reload();
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
  }

  protected onWithdrawn(): void {
    this.toast.success('Anunțul a fost retras.');
    this.announcements.reload();
  }
}

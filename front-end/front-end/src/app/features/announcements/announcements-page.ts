import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { AnnouncementsService } from '../../core/api/announcements.service';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  Announcement,
  AnnouncementAudience,
  MemberSummary,
} from '../../core/api/models';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmDialog } from '../../shared/dialogs/confirm-dialog';
import { MemberPickerDialog } from '../../shared/dialogs/member-picker-dialog';

type AudienceKind = AnnouncementAudience['kind'];

/** Messages to members, shown in their portal (`/cont`), and the history of sent ones. */
@Component({
  selector: 'app-announcements-page',
  imports: [DatePipe, ReactiveFormsModule, ConfirmDialog, MemberPickerDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './announcements-page.html',
  styleUrl: './announcements-page.css',
})
export class AnnouncementsPage {
  private readonly api = inject(AnnouncementsService);
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);

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
  });
  /** Hand-picked recipients (audience `members`). */
  protected readonly chosen = signal<MemberSummary[]>([]);
  protected readonly picking = signal(false);
  protected readonly sending = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly withdrawing = signal<Announcement | null>(null);

  protected readonly withdrawAction = () => this.api.delete(this.withdrawing()!.id);

  protected invalid(name: 'title' | 'body'): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected addMember(member: MemberSummary): void {
    if (!this.chosen().some((m) => m.id === member.id)) {
      this.chosen.update((list) => [...list, member]);
    }
  }

  protected removeMember(id: string): void {
    this.chosen.update((list) => list.filter((m) => m.id !== id));
  }

  protected send(): void {
    this.submitted.set(true);
    const { title, body, kind, courseId } = this.form.getRawValue();
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
      .send({ title: title.trim(), body: body.trim(), audience })
      .pipe(finalize(() => this.sending.set(false)))
      .subscribe({
        next: (sent) => {
          this.toast.success(
            `Anunțul a fost trimis către ${sent.recipients === 1 ? '1 membru' : sent.recipients + ' membri'}.`,
          );
          this.form.reset({ title: '', body: '', kind: 'all', courseId: '' });
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

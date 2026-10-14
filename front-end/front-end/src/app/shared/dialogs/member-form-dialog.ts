import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AcademyService } from '../../core/api/academy.service';
import { MembersService } from '../../core/api/members.service';
import { MemberSummary, PlanId } from '../../core/api/models';
import { createQuery, errorMessage } from '../../core/data/query';
import { ToastService } from '../../core/ui/toast.service';
import { toIsoDate } from '../../core/util/dates';
import { Modal } from '../ui/modal';

export const PHONE_PATTERN = /^[0-9 +().-]{6,20}$/;
export const RFID_PATTERN = /^[0-9a-fA-F·:\s-]{4,30}$/;

/** Create a member (with an optional first subscription) or edit an existing one. */
@Component({
  selector: 'app-member-form-dialog',
  imports: [Modal, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './member-form-dialog.html',
})
export class MemberFormDialog implements OnInit {
  private readonly members = inject(MembersService);
  private readonly academy = inject(AcademyService);
  private readonly toast = inject(ToastService);
  private readonly modal = viewChild.required(Modal);

  /** The member to edit; creates a new member when omitted. */
  readonly member = input<MemberSummary | null>(null);
  readonly saved = output<MemberSummary>();
  readonly closed = output<void>();

  protected readonly courses = createQuery(
    () => null,
    () => this.academy.courses(),
  );
  protected readonly plans = createQuery(
    () => null,
    () => this.academy.plans(),
  );
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group({
    firstName: ['', [Validators.required, Validators.maxLength(40)]],
    lastName: ['', [Validators.required, Validators.maxLength(40)]],
    phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
    email: ['', [Validators.email, Validators.maxLength(120)]],
    courseIds: [[] as string[]],
    rfid: ['', Validators.pattern(RFID_PATTERN)],
    photoConsent: [false],
    planId: ['sessions12' as PlanId | ''],
    startDate: [toIsoDate(new Date()), Validators.required],
  });

  ngOnInit(): void {
    const m = this.member();
    if (m) {
      this.form.patchValue({
        firstName: m.firstName,
        lastName: m.lastName,
        phone: m.phone,
        email: m.email,
        courseIds: m.courses.map((c) => c.id),
        rfid: m.rfid ?? '',
        photoConsent: m.photoConsent,
      });
    }
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    return this.submitted() && this.form.controls[name].invalid;
  }

  protected hasCourse(id: string): boolean {
    return this.form.controls.courseIds.value.includes(id);
  }

  protected toggleCourse(id: string, checked: boolean): void {
    const current = this.form.controls.courseIds.value;
    this.form.controls.courseIds.setValue(
      checked ? [...current, id] : current.filter((c) => c !== id),
    );
  }

  protected submit(): void {
    this.submitted.set(true);
    if (this.form.invalid || this.saving()) return;
    const v = this.form.getRawValue();
    const input = {
      firstName: v.firstName,
      lastName: v.lastName,
      phone: v.phone,
      email: v.email,
      courseIds: v.courseIds,
      rfid: v.rfid.trim() || null,
      photoConsent: v.photoConsent,
    };
    const existing = this.member();
    const request = existing
      ? this.members.update(existing.id, input)
      : this.members.create({
          ...input,
          subscription: v.planId ? { planId: v.planId, startDate: v.startDate } : null,
        });

    this.saving.set(true);
    this.error.set(null);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (member) => {
        this.toast.success(
          existing ? 'Modificările au fost salvate.' : `${member.fullName} a fost adăugat.`,
        );
        this.saved.emit(member);
        this.modal().close();
      },
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  protected cancel(): void {
    this.modal().close();
  }
}

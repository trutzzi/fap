import { ChangeDetectionStrategy, Component, input, output, viewChild } from '@angular/core';
import { MemberAccessResult } from '../../core/api/models';
import { MemberAccessNotice } from '../ui/member-access-notice';
import { Modal } from '../ui/modal';

/** Shows the outcome of sending a member a new portal PIN. */
@Component({
  selector: 'app-member-access-dialog',
  imports: [Modal, MemberAccessNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="Cont membru" (closed)="closed.emit()">
      <div class="form">
        <app-member-access-notice [result]="result()" />
        <div class="form-footer">
          <button type="button" class="btn btn-primary" (click)="modal().close()">Gata</button>
        </div>
      </div>
    </app-modal>
  `,
})
export class MemberAccessDialog {
  protected readonly modal = viewChild.required(Modal);
  readonly result = input.required<MemberAccessResult>();
  readonly closed = output<void>();
}

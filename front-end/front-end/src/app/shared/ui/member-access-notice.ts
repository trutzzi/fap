import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MemberAccessResult } from '../../core/api/models';

/**
 * What reception tells the member after a portal PIN was issued: nothing when the SMS
 * went out, the PIN itself (to hand over in person) when SMS is off or failed.
 */
@Component({
  selector: 'app-member-access-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result().sms === 'sent') {
      <p style="margin: 0">
        Codul PIN pentru contul de membru a fost trimis prin SMS la
        <strong>{{ result().phone }}</strong
        >.
      </p>
    } @else {
      @if (result().sms === 'failed') {
        <div class="form-error" role="alert">
          SMS-ul cu codul PIN nu a putut fi trimis. Comunică-i membrului PIN-ul de mai jos.
        </div>
      } @else {
        <p style="margin: 0">Comunică-i membrului codul PIN pentru contul de membru.</p>
      }
      <p style="margin: 0">
        Cod PIN:
        <strong class="mono" style="font-size: 22px; letter-spacing: 2px">{{
          result().temporaryPin
        }}</strong>
      </p>
      <p class="muted" style="margin: 0">
        Membrul intră pe <strong>{{ portalUrl }}</strong> cu numărul de telefon
        {{ result().phone }} și acest PIN, apoi își poate alege altul din cont.
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
  `,
})
export class MemberAccessNotice {
  readonly result = input.required<MemberAccessResult>();
  protected readonly portalUrl =
    typeof location === 'undefined' ? '/cont' : `${location.host}/cont`;
}

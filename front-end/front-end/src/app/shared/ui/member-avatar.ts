import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';

/**
 * A member's photo, or their initials when there is none (or it fails to load).
 * Decorative by default: the member's name is shown next to it.
 */
@Component({
  selector: 'app-member-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'avatar',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'size() * 0.36',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label()',
  },
  template: `
    @if (photoUrl() && !failed()) {
      <img [src]="photoUrl()" alt="" loading="lazy" decoding="async" (error)="failed.set(true)" />
    } @else {
      {{ initials() }}
    }
  `,
  styles: `
    :host {
      overflow: hidden;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class MemberAvatar {
  readonly initials = input.required<string>();
  readonly photoUrl = input<string | null>(null);
  readonly size = input(38);
  /** Accessible name when the avatar stands alone (e.g. "Fotografia lui Andrei"). */
  readonly label = input<string | null>(null);

  protected readonly failed = linkedSignal({ source: this.photoUrl, computation: () => false });
}

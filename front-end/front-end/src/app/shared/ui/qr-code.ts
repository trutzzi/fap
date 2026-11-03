import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { encodeQr, qrSvgPath } from '../../core/util/qr-code';

/** Quiet zone required around a QR code, in modules. */
const BORDER = 4;

/** A QR code as crisp SVG: dark modules on white, whatever the theme. */
@Component({
  selector: 'app-qr-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      role="img"
      [attr.aria-label]="label()"
      [attr.viewBox]="'0 0 ' + qr().side + ' ' + qr().side"
      shape-rendering="crispEdges"
    >
      <rect [attr.width]="qr().side" [attr.height]="qr().side" fill="#fff" />
      <path [attr.d]="qr().path" fill="#000" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
})
export class QrCode {
  readonly text = input.required<string>();
  readonly label = input.required<string>();

  protected readonly qr = computed(() => {
    const matrix = encodeQr(this.text());
    return { side: matrix.size + BORDER * 2, path: qrSvgPath(matrix, BORDER) };
  });
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Segmented bar showing used sessions out of a limited plan (e.g. 8 of 12). */
@Component({
  selector: 'app-session-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'used() + " din " + limit() + " ședințe folosite"',
    '[style.--count]': 'limit()',
    '[style.--segment-height.px]': 'height()',
    '[style.--filled]': 'color()',
  },
  template: `
    @for (filled of segments(); track $index) {
      <span [class.filled]="filled"></span>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(var(--count), minmax(0, 1fr));
      gap: var(--gap, 6px);
    }
    span {
      height: var(--segment-height);
      border-radius: 4px;
      background: var(--border-strong);
    }
    .filled {
      background: var(--filled);
    }
  `,
})
export class SessionMeter {
  readonly used = input.required<number>();
  readonly limit = input.required<number>();
  readonly height = input(28);
  /** Fill color; defaults to the brand red. */
  readonly tone = input<string | null>(null);

  protected readonly segments = computed(() =>
    Array.from({ length: this.limit() }, (_, i) => i < this.used()),
  );
  protected readonly color = computed(() => this.tone() ?? 'var(--primary)');
}

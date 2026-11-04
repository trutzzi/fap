import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  forwardRef,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { formatDate, isIsoDate, parseIsoDate, toIsoDate } from '../../core/util/dates';
import { Icon } from './icon';

/** "31122026" → "31-12-2026" while typing (digits only, dashes added). */
export function maskDate(typed: string): string {
  const d = typed.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('-');
}

/** "31-12-2026" → "2026-12-31", or `''` while incomplete or invalid. */
export function parseDate(text: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  // isIsoDate accepts 31-02 (Date rolls it over to 3 March): require a real day.
  return iso && isIsoDate(iso) && toIsoDate(parseIsoDate(iso)) === iso ? iso : '';
}

/**
 * Date field that always shows dd-mm-yyyy (a native `type="date"` follows the device's
 * language, e.g. mm/dd/yyyy). The form value stays `YYYY-MM-DD` (`''` when incomplete),
 * and the calendar button opens the device's own date picker.
 */
@Component({
  selector: 'app-date-input',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInput), multi: true },
  ],
  template: `
    <input
      #box
      class="input"
      [id]="inputId()"
      inputmode="numeric"
      autocomplete="off"
      placeholder="zz-ll-aaaa"
      maxlength="10"
      [value]="text()"
      [disabled]="disabled()"
      [attr.aria-invalid]="invalid()"
      (input)="onType(box)"
      (blur)="touched()"
    />
    <button
      type="button"
      class="btn btn-ghost btn-icon pick"
      aria-label="Alege din calendar"
      [disabled]="disabled()"
      (click)="openPicker()"
    >
      <app-icon name="calendar" [size]="18" />
    </button>
    <input
      #native
      class="native"
      type="date"
      tabindex="-1"
      aria-hidden="true"
      [value]="iso()"
      (change)="onPicked(native.value)"
    />
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .input {
      padding-right: 48px;
    }
    .pick {
      position: absolute;
      top: 50%;
      right: 4px;
      transform: translateY(-50%);
    }
    .native {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
  `,
})
export class DateInput implements ControlValueAccessor {
  private readonly native = viewChild.required<ElementRef<HTMLInputElement>>('native');
  readonly inputId = input<string>();
  /** Shown as `aria-invalid`, e.g. from the form's own validation. */
  readonly invalid = input(false);

  protected readonly text = signal('');
  protected readonly iso = signal('');
  protected readonly disabled = signal(false);
  private onChange: (value: string) => void = () => undefined;
  protected touched: () => void = () => undefined;

  writeValue(value: string | null): void {
    const iso = value && isIsoDate(value) ? value : '';
    this.iso.set(iso);
    this.text.set(iso ? formatDate(iso) : '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.touched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  protected onType(box: HTMLInputElement): void {
    const masked = maskDate(box.value);
    if (masked !== box.value) box.value = masked;
    this.text.set(masked);
    this.iso.set(parseDate(masked));
    this.onChange(this.iso());
  }

  protected onPicked(value: string): void {
    this.writeValue(value);
    this.onChange(this.iso());
    this.touched();
  }

  protected openPicker(): void {
    const native = this.native().nativeElement;
    try {
      native.showPicker();
    } catch {
      native.focus();
      native.click();
    }
  }
}

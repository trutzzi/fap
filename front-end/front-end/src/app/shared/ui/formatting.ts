import { Pipe, PipeTransform } from '@angular/core';
import { formatDate } from '../../core/util/dates';

/** "04A391F2" → "04A3·91F2" */
@Pipe({ name: 'rfid' })
export class RfidPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    return value.match(/.{1,4}/g)!.join('·');
  }
}

/** `YYYY-MM-DD` → "31-10-2026". */
@Pipe({ name: 'isoDate' })
export class IsoDatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? formatDate(value) : '—';
  }
}

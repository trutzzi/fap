import type { Response } from 'express';

/** Byte order mark: tells Excel the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/**
 * CSV for Romanian Excel: `;` separators (the comma is the decimal mark there) and a UTF-8
 * BOM so diacritics display correctly. Values that could start a formula are prefixed with
 * a quote (CSV injection).
 */
export function sendCsv(
  res: Response,
  filename: string,
  header: string[],
  rows: (string | number | null)[][],
): void {
  const cell = (value: string | number | null): string => {
    if (value === null) return '';
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
    return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const body = [header, ...rows].map((row) => row.map(cell).join(';')).join('\r\n');
  res
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .send(BOM + body + '\r\n');
}

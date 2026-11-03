/** Member portal PINs: 4–6 digits (generated ones have 6). Same rule as the API. */
export const PIN_PATTERN = /^\d{4,6}$/;

/** Keeps only digits, at most 6: for PIN inputs, so stray characters never reach the form. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

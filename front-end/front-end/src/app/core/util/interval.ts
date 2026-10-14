import { DestroyRef, afterNextRender, inject, signal } from '@angular/core';

/**
 * Runs `fn` every `ms` milliseconds in the browser only (never during SSR),
 * stopping when the calling component is destroyed. Call in an injection context.
 */
export function onInterval(ms: number, fn: () => void): void {
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    const id = setInterval(fn, ms);
    destroyRef.onDestroy(() => clearInterval(id));
  });
}

/** A signal holding the current time, refreshed every `ms` milliseconds. */
export function clock(ms = 1000) {
  const now = signal(new Date());
  onInterval(ms, () => now.set(new Date()));
  return now.asReadonly();
}

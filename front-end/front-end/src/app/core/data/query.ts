import { HttpErrorResponse } from '@angular/common/http';
import { Signal, computed, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  catchError,
  combineLatest,
  switchMap,
  tap,
} from 'rxjs';

export interface Query<T> {
  /** Latest loaded value; kept while a reload is in flight to avoid flicker. */
  readonly value: Signal<T | undefined>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<string | null>;
  reload(): void;
}

/**
 * Loads data reactively: re-runs `load` whenever the signals read in `params` change
 * (cancelling the previous request) or `reload()` is called.
 * Must be created in an injection context (e.g. a component field initializer).
 */
export function createQuery<P, T>(params: () => P, load: (params: P) => Observable<T>): Query<T> {
  const value = signal<T | undefined>(undefined);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const reload$ = new BehaviorSubject<void>(undefined);

  combineLatest([toObservable(computed(params)), reload$])
    .pipe(
      switchMap(([p]) => {
        loading.set(true);
        return load(p).pipe(
          tap((result) => {
            value.set(result);
            error.set(null);
            loading.set(false);
          }),
          catchError((err: unknown) => {
            error.set(errorMessage(err));
            loading.set(false);
            return EMPTY;
          }),
        );
      }),
      takeUntilDestroyed(),
    )
    .subscribe();

  return {
    value: value.asReadonly(),
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    reload: () => reload$.next(),
  };
}

/** User-facing message from an API error (`{ message }` body) or a network failure. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const message = (err.error as { message?: unknown } | null)?.message;
    if (typeof message === 'string') return message;
    if (err.status === 0) return 'Serverul nu poate fi contactat. Verifică conexiunea.';
  }
  return 'A apărut o eroare neașteptată.';
}

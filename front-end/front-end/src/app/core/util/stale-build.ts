import { NavigationError } from '@angular/router';

/** Browsers word a failed `import()` of a lazy page differently. */
const CHUNK_LOAD_FAILED =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;
const RELOADED_AT = 'fa.stale-build-reload';

/**
 * After a deploy, a page opened earlier still references the previous build's lazy files,
 * which no longer exist, so the next navigation fails ("works after a refresh"). Reload the
 * target URL instead to pick up the new build; at most once a minute, so it can't loop.
 */
export function reloadOnStaleBuild(error: NavigationError): void {
  if (typeof location === 'undefined' || !CHUNK_LOAD_FAILED.test(String(error.error))) return;
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    // No storage: reload anyway.
  }
  location.assign(error.url);
}

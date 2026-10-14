/**
 * In-memory fixed-window counter, used to slow down password guessing.
 * Per process: behind several API instances, move this to Postgres or Redis.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when `key` already used up its attempts in the current window. */
  isBlocked(key: string): boolean {
    const entry = this.hits.get(key);
    if (!entry) return false;
    if (entry.resetAt <= this.now()) {
      this.hits.delete(key);
      return false;
    }
    return entry.count >= this.max;
  }

  /** Seconds until `key` may try again. */
  retryAfter(key: string): number {
    const entry = this.hits.get(key);
    return entry ? Math.max(Math.ceil((entry.resetAt - this.now()) / 1000), 1) : 0;
  }

  record(key: string): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= this.now()) {
      this.hits.set(key, { count: 1, resetAt: this.now() + this.windowMs });
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

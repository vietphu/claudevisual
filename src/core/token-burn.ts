/** One point in a session's token-spend sampling ring. */
export interface BurnSample {
  ts: number;
  total: number;
}

/** How long a sample window spans; the rate is measured across it. */
export const BURN_WINDOW_MS = 90_000;
/** Minimum spacing between distinct samples — closer ticks update the newest
 *  sample in place instead of growing the ring, bounding its size. */
export const BURN_MIN_GAP_MS = 15_000;

/**
 * Appends a `(ts, total)` observation to the ring, keeping it bounded:
 * - if the newest sample is younger than `BURN_MIN_GAP_MS`, its value is
 *   refreshed in place (same window, latest total) rather than adding a point;
 * - otherwise a new point is pushed and any point older than `BURN_WINDOW_MS`
 *   (except the immediately-preceding one, needed to measure a rate) is dropped.
 * Pure — returns a new array, never mutates the input.
 */
export function recordBurnSample(ring: readonly BurnSample[], ts: number, total: number): BurnSample[] {
  const last = ring[ring.length - 1];
  if (last && ts - last.ts < BURN_MIN_GAP_MS) {
    return [...ring.slice(0, -1), { ts, total }];
  }
  const next = [...ring, { ts, total }];
  const cutoff = ts - BURN_WINDOW_MS;
  // Keep everything inside the window, plus always the last two points so a
  // rate is still computable right after a long idle gap.
  return next.filter((s, i) => i >= next.length - 2 || s.ts >= cutoff);
}

/**
 * Token burn rate in tokens/minute across the ring, or `undefined` when it
 * can't be computed honestly: fewer than two samples, a non-positive time
 * delta, a decreasing total (session reset), or a stale newest sample (the
 * session has gone idle — no fresh spend to rate).
 */
export function burnRatePerMin(ring: readonly BurnSample[], now: number): number | undefined {
  if (ring.length < 2) {
    return undefined;
  }
  const latest = ring[ring.length - 1];
  const oldest = ring[0];
  if (now - latest.ts > BURN_WINDOW_MS) {
    return undefined;
  }
  const dt = latest.ts - oldest.ts;
  const dTokens = latest.total - oldest.total;
  if (dt <= 0 || dTokens < 0) {
    return undefined;
  }
  return Math.round((dTokens / dt) * 60_000);
}

/**
 * Owns the per-session bounded sample ring so `SessionStateStore` doesn't
 * manage the `Map<string, BurnSample[]>` bookkeeping itself.
 */
export class BurnRateTracker {
  private readonly rings = new Map<string, BurnSample[]>();

  /** Records a fresh `(now, total)` sample for `id` and returns the refreshed rate. */
  sample(id: string, now: number, total: number): number | undefined {
    const ring = recordBurnSample(this.rings.get(id) ?? [], now, total);
    this.rings.set(id, ring);
    return burnRatePerMin(ring, now);
  }

  /** Recomputes `id`'s rate from its existing ring without a new sample — lets a
   *  finished/idle session's rate self-clear to `undefined` once the window lapses. */
  recompute(id: string, now: number): number | undefined {
    return burnRatePerMin(this.rings.get(id) ?? [], now);
  }
}

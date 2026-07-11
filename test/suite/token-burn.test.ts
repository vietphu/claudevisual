import { strict as assert } from "assert";
import {
  BURN_MIN_GAP_MS,
  BURN_WINDOW_MS,
  BurnSample,
  burnRatePerMin,
  recordBurnSample,
} from "../../src/core/token-burn";

describe("token-burn", () => {
  describe("recordBurnSample", () => {
    it("appends a distinct sample once the min gap has elapsed", () => {
      let ring: BurnSample[] = [];
      ring = recordBurnSample(ring, 0, 100);
      ring = recordBurnSample(ring, BURN_MIN_GAP_MS, 200);
      assert.equal(ring.length, 2);
      assert.deepEqual(ring[1], { ts: BURN_MIN_GAP_MS, total: 200 });
    });

    it("refreshes the newest sample in place within the min gap (bounded ring)", () => {
      let ring: BurnSample[] = [];
      ring = recordBurnSample(ring, 0, 100);
      ring = recordBurnSample(ring, 1000, 130);
      ring = recordBurnSample(ring, 2000, 175);
      assert.equal(ring.length, 1);
      assert.deepEqual(ring[0], { ts: 2000, total: 175 });
    });

    it("drops samples older than the window but always keeps the last two", () => {
      let ring: BurnSample[] = [];
      for (let i = 0; i <= 10; i++) {
        ring = recordBurnSample(ring, i * BURN_MIN_GAP_MS, i * 1000);
      }
      const newest = ring[ring.length - 1].ts;
      assert.ok(ring.length >= 2);
      assert.ok(ring.every((s, i) => i >= ring.length - 2 || newest - s.ts <= BURN_WINDOW_MS));
    });
  });

  describe("burnRatePerMin", () => {
    it("is undefined with fewer than two samples", () => {
      assert.equal(burnRatePerMin([], 0), undefined);
      assert.equal(burnRatePerMin([{ ts: 0, total: 100 }], 0), undefined);
    });

    it("computes tokens/min across the window", () => {
      // 60k tokens over 60s -> 60k/min
      const ring: BurnSample[] = [
        { ts: 0, total: 0 },
        { ts: 60_000, total: 60_000 },
      ];
      assert.equal(burnRatePerMin(ring, 60_000), 60_000);
    });

    it("returns undefined when the newest sample is stale (idle session)", () => {
      const ring: BurnSample[] = [
        { ts: 0, total: 0 },
        { ts: 10_000, total: 5_000 },
      ];
      assert.equal(burnRatePerMin(ring, 10_000 + BURN_WINDOW_MS + 1), undefined);
    });

    it("returns undefined on a decreasing total (session reset)", () => {
      const ring: BurnSample[] = [
        { ts: 0, total: 500 },
        { ts: 30_000, total: 200 },
      ];
      assert.equal(burnRatePerMin(ring, 30_000), undefined);
    });
  });
});

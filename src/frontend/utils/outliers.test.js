import { describe, it, expect } from "vitest";
import { detectOutliers, filterOutliers, median, mad } from "./outliers.js";

/* Helper: build a transaction with sensible defaults. */
const tx = (id, category, amount, extra = {}) => ({
  id, category, amount, date: "2026-01-01", description: `Tx ${id}`, ...extra
});

describe("median", () => {
  it("returns 0 for empty", () => {
    expect(median([])).toBe(0);
    expect(median(null)).toBe(0);
    expect(median(undefined)).toBe(0);
  });
  it("handles single value", () => {
    expect(median([42])).toBe(42);
  });
  it("handles odd-length", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([5, 1, 3, 2, 4])).toBe(3); // unsorted input
  });
  it("handles even-length (averages middle two)", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("handles negative and mixed values", () => {
    expect(median([-5, -3, -1, 1, 3])).toBe(-1);
  });
  it("does not mutate input", () => {
    const arr = [3, 1, 2];
    const copy = [...arr];
    median(arr);
    expect(arr).toEqual(copy);
  });
});

describe("mad", () => {
  it("returns 0 for empty", () => {
    expect(mad([])).toBe(0);
  });
  it("returns 0 for identical values", () => {
    expect(mad([5, 5, 5, 5])).toBe(0);
  });
  it("computes median absolute deviation", () => {
    // [1,1,2,2,4,6,9] → median 2 → deviations [1,1,0,0,2,4,7] → median 1
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });
  it("uses provided median when given", () => {
    // values [10,20,30], if we claim median is 0, deviations are [10,20,30] → median 20
    expect(mad([10, 20, 30], 0)).toBe(20);
  });
});

describe("detectOutliers", () => {
  describe("basic cases", () => {
    it("returns empty map for empty input", () => {
      expect(detectOutliers([]).size).toBe(0);
      expect(detectOutliers(null).size).toBe(0);
      expect(detectOutliers(undefined).size).toBe(0);
    });

    it("flags an obvious outlier", () => {
      const txs = [
        tx("a", "Groceries", -50),
        tx("b", "Groceries", -45),
        tx("c", "Groceries", -55),
        tx("d", "Groceries", -48),
        tx("e", "Groceries", -52),
        tx("f", "Groceries", -500), // 10x the typical
      ];
      const map = detectOutliers(txs);
      expect(map.has("f")).toBe(true);
      expect(map.has("a")).toBe(false);
    });

    it("does not flag values just above the median", () => {
      const txs = [
        tx("a", "Coffee", -5),
        tx("b", "Coffee", -5),
        tx("c", "Coffee", -6),
        tx("d", "Coffee", -7),
        tx("e", "Coffee", -8), // slightly higher but not extreme
      ];
      const map = detectOutliers(txs);
      expect(map.size).toBe(0);
    });
  });

  describe("sample size threshold", () => {
    it("skips categories with fewer than minSampleSize transactions", () => {
      const txs = [
        tx("a", "Rare", -10),
        tx("b", "Rare", -10),
        tx("c", "Rare", -1000), // would be an outlier with enough samples
      ];
      const map = detectOutliers(txs);
      expect(map.size).toBe(0);
    });

    it("respects custom minSampleSize", () => {
      const txs = [
        tx("a", "Cat", -10),
        tx("b", "Cat", -10),
        tx("c", "Cat", -10),
        tx("d", "Cat", -1000),
      ];
      // default minSampleSize=5: skipped
      expect(detectOutliers(txs).size).toBe(0);
      // minSampleSize=3: detected (3 baseline + 1 outlier = 4 total, baseline=3)
      // Note: baseline excludes wrong-sign refunds; here all are negative so baseline=4.
      const result = detectOutliers(txs, { minSampleSize: 3 });
      expect(result.has("d")).toBe(true);
    });
  });

  describe("transfer categories are excluded", () => {
    it("skips transactions whose category is in transferCatSet", () => {
      const txs = [
        tx("a", "Transfer", -100),
        tx("b", "Transfer", -100),
        tx("c", "Transfer", -100),
        tx("d", "Transfer", -100),
        tx("e", "Transfer", -100),
        tx("f", "Transfer", -10000), // would otherwise flag
      ];
      const map = detectOutliers(txs, { transferCatSet: new Set(["Transfer"]) });
      expect(map.size).toBe(0);
    });

    it("accepts transferCatSet as plain array too", () => {
      const txs = [
        tx("a", "Xfer", -100), tx("b", "Xfer", -100),
        tx("c", "Xfer", -100), tx("d", "Xfer", -100),
        tx("e", "Xfer", -100), tx("f", "Xfer", -10000),
      ];
      expect(detectOutliers(txs, { transferCatSet: ["Xfer"] }).size).toBe(0);
    });
  });

  describe("split parents are excluded", () => {
    it("does not flag a transaction with non-empty splits", () => {
      const txs = [
        tx("a", "Shopping", -50), tx("b", "Shopping", -55),
        tx("c", "Shopping", -45), tx("d", "Shopping", -50),
        tx("e", "Shopping", -52),
        // Parent has splits — should be skipped entirely.
        tx("f", "Shopping", -2000, { splits: [
          { id: "s1", category: "Shopping", amount: -1000 },
          { id: "s2", category: "Other", amount: -1000 },
        ] }),
      ];
      const map = detectOutliers(txs);
      expect(map.has("f")).toBe(false);
    });
  });

  describe("uncategorized transactions", () => {
    it("ignores transactions with no category", () => {
      const txs = [
        tx("a", "Food", -10), tx("b", "Food", -10),
        tx("c", "Food", -10), tx("d", "Food", -10),
        tx("e", "Food", -10),
        tx("f", null, -10000),
        tx("g", "", -10000),
      ];
      const map = detectOutliers(txs);
      expect(map.has("f")).toBe(false);
      expect(map.has("g")).toBe(false);
    });
  });

  describe("zero / non-finite amounts", () => {
    it("ignores zero-amount transactions", () => {
      const txs = [
        tx("a", "Food", -10), tx("b", "Food", -10),
        tx("c", "Food", -10), tx("d", "Food", -10),
        tx("e", "Food", -10), tx("f", "Food", 0),
      ];
      const map = detectOutliers(txs);
      expect(map.has("f")).toBe(false);
    });

    it("ignores NaN / Infinity amounts", () => {
      const txs = [
        tx("a", "Food", -10), tx("b", "Food", -10),
        tx("c", "Food", -10), tx("d", "Food", -10),
        tx("e", "Food", -10),
        tx("f", "Food", NaN), tx("g", "Food", Infinity),
      ];
      const map = detectOutliers(txs);
      expect(map.has("f")).toBe(false);
      expect(map.has("g")).toBe(false);
    });
  });

  describe("refunds (wrong-sign transactions)", () => {
    it("excludes refunds from the baseline so they don't drag the median to zero", () => {
      // Five normal expenses around -50 plus one big -500 outlier.
      // A small +20 refund should NOT shift the baseline enough to mask -500.
      const txs = [
        tx("a", "Food", -50), tx("b", "Food", -50),
        tx("c", "Food", -55), tx("d", "Food", -45),
        tx("e", "Food", -50),
        tx("refund", "Food", 20), // refund — wrong sign
        tx("big", "Food", -500),
      ];
      const map = detectOutliers(txs);
      expect(map.has("big")).toBe(true);
      expect(map.has("refund")).toBe(false);
    });

    it("never flags refunds even when their magnitude is large", () => {
      const txs = [
        tx("a", "Food", -50), tx("b", "Food", -50),
        tx("c", "Food", -55), tx("d", "Food", -45),
        tx("e", "Food", -50), tx("f", "Food", -52),
        tx("huge_refund", "Food", 5000),
      ];
      const map = detectOutliers(txs);
      expect(map.has("huge_refund")).toBe(false);
    });
  });

  describe("MAD = 0 (perfectly consistent category)", () => {
    it("falls back to a fraction of the median so genuine spikes still flag", () => {
      // Subscription: every charge is exactly -10. One charge is -50.
      const txs = [
        tx("a", "Sub", -10), tx("b", "Sub", -10),
        tx("c", "Sub", -10), tx("d", "Sub", -10),
        tx("e", "Sub", -10), tx("f", "Sub", -50),
      ];
      const map = detectOutliers(txs);
      expect(map.has("f")).toBe(true);
    });

    it("does not flag tiny deviations in a consistent category by default", () => {
      // -10 baseline, k=3.5, MAD floor = 0.05*10 = 0.5
      // Threshold = 10 + 3.5*0.5 = 11.75
      // -11 should NOT flag.
      const txs = [
        tx("a", "Sub", -10), tx("b", "Sub", -10),
        tx("c", "Sub", -10), tx("d", "Sub", -10),
        tx("e", "Sub", -10), tx("f", "Sub", -11),
      ];
      const map = detectOutliers(txs);
      expect(map.has("f")).toBe(false);
    });

    it("respects custom madFloorRatio", () => {
      // With ratio=0, MAD stays 0 → med=0 still triggers no-signal skip
      // when both are zero. With ratio=0.5, threshold becomes 10 + 3.5*5 = 27.5,
      // so -28 should flag.
      const txs = [
        tx("a", "Sub", -10), tx("b", "Sub", -10),
        tx("c", "Sub", -10), tx("d", "Sub", -10),
        tx("e", "Sub", -10), tx("f", "Sub", -28),
      ];
      const result = detectOutliers(txs, { madFloorRatio: 0.5 });
      expect(result.has("f")).toBe(true);
    });

    it("returns no outliers when median and MAD are both zero", () => {
      // Edge: all amounts zero would be filtered out (zero-amount skip),
      // but if somehow a category had only zero-magnitude entries we'd get
      // here. Construct via positive/negative pairs that median to zero
      // is impossible because we use absolute values, so the more realistic
      // case is just empty rows after filtering. Verify nothing crashes
      // when every value is filtered out.
      const txs = [
        tx("a", "Cat", 0), tx("b", "Cat", 0),
        tx("c", "Cat", 0), tx("d", "Cat", 0),
        tx("e", "Cat", 0),
      ];
      expect(() => detectOutliers(txs)).not.toThrow();
      expect(detectOutliers(txs).size).toBe(0);
    });
  });

  describe("multi-category", () => {
    it("flags outliers per category independently", () => {
      const txs = [
        // Coffee: ~$5 baseline
        tx("c1", "Coffee", -5), tx("c2", "Coffee", -5),
        tx("c3", "Coffee", -6), tx("c4", "Coffee", -5),
        tx("c5", "Coffee", -5),
        tx("c_big", "Coffee", -50),
        // Rent: ~$2000 baseline (much larger but consistent)
        tx("r1", "Rent", -2000), tx("r2", "Rent", -2000),
        tx("r3", "Rent", -2000), tx("r4", "Rent", -2000),
        tx("r5", "Rent", -2000),
      ];
      const map = detectOutliers(txs);
      expect(map.has("c_big")).toBe(true);
      // Rent is consistent — no outliers
      expect(map.has("r1")).toBe(false);
      // Most importantly, the big rent payment doesn't flag against
      // the coffee baseline (i.e. cross-category contamination doesn't happen).
    });
  });

  describe("result metadata", () => {
    it("includes useful diagnostic fields on each entry", () => {
      const txs = [
        tx("a", "Food", -50), tx("b", "Food", -50),
        tx("c", "Food", -50), tx("d", "Food", -50),
        tx("e", "Food", -50), tx("big", "Food", -500),
      ];
      const map = detectOutliers(txs);
      const info = map.get("big");
      expect(info).toBeDefined();
      expect(info.amount).toBe(500);
      expect(info.median).toBe(50);
      expect(info.category).toBe("Food");
      expect(info.sampleSize).toBe(6);
      expect(info.threshold).toBeGreaterThan(0);
      expect(info.score).toBeGreaterThan(0);
    });
  });

  describe("filterOutliers convenience", () => {
    it("returns only the outlier transactions", () => {
      const txs = [
        tx("a", "Food", -50), tx("b", "Food", -50),
        tx("c", "Food", -50), tx("d", "Food", -50),
        tx("e", "Food", -50), tx("big", "Food", -500),
      ];
      const result = filterOutliers(txs);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("big");
    });

    it("returns empty array when nothing is flagged", () => {
      const txs = [
        tx("a", "Food", -50), tx("b", "Food", -51),
        tx("c", "Food", -49), tx("d", "Food", -50),
        tx("e", "Food", -50),
      ];
      expect(filterOutliers(txs)).toEqual([]);
    });

    it("preserves original order of the source array", () => {
      const txs = [
        tx("big1", "Food", -500),
        tx("a", "Food", -50), tx("b", "Food", -50),
        tx("c", "Food", -50), tx("d", "Food", -50),
        tx("e", "Food", -50), tx("big2", "Food", -600),
      ];
      const result = filterOutliers(txs);
      expect(result.map(t => t.id)).toEqual(["big1", "big2"]);
    });
  });

  describe("k parameter", () => {
    it("higher k catches fewer outliers", () => {
      const txs = [
        tx("a", "Food", -50), tx("b", "Food", -50),
        tx("c", "Food", -55), tx("d", "Food", -45),
        tx("e", "Food", -50), tx("mod", "Food", -150),
      ];
      // -150 vs median 50, MAD ≈ 2.5. score = (150-50)/2.5 = 40
      // It's flagged at any reasonable k.
      expect(detectOutliers(txs, { k: 3.5 }).has("mod")).toBe(true);
      // With an absurdly high k, even the obvious outlier gets missed.
      expect(detectOutliers(txs, { k: 100 }).has("mod")).toBe(false);
    });
  });

  describe("realistic budget scenarios", () => {
    it("flags an annual fee in a monthly-subscription category", () => {
      const txs = Array.from({ length: 12 }, (_, i) =>
        tx(`m${i}`, "Software", -9.99));
      txs.push(tx("annual", "Software", -99));
      const map = detectOutliers(txs);
      expect(map.has("annual")).toBe(true);
    });

    it("does not flag normal grocery variation", () => {
      const txs = [
        tx("g1", "Groceries", -85),
        tx("g2", "Groceries", -110),
        tx("g3", "Groceries", -65),
        tx("g4", "Groceries", -120),
        tx("g5", "Groceries", -90),
        tx("g6", "Groceries", -75),
        tx("g7", "Groceries", -100),
        tx("g8", "Groceries", -130),
      ];
      const map = detectOutliers(txs);
      expect(map.size).toBe(0);
    });

    it("flags a Costco run amid normal grocery shops", () => {
      const txs = [
        tx("g1", "Groceries", -85), tx("g2", "Groceries", -110),
        tx("g3", "Groceries", -95), tx("g4", "Groceries", -100),
        tx("g5", "Groceries", -90), tx("g6", "Groceries", -105),
        tx("costco", "Groceries", -650),
      ];
      const map = detectOutliers(txs);
      expect(map.has("costco")).toBe(true);
    });
  });
});

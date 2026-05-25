/* Tests for the `signed` opt-in coloring used by Row.
   Bug this pins: a row whose values differ in sign across columns
   (e.g. Remaining to Budget with wk/mo/y48 < 0 but y52 > 0) was painting
   all cells the same row-level color, so the positive y52 displayed red.
   The fix is per-cell signed coloring; cellColor is the pure helper. */
import { describe, it, expect } from "vitest";
import { cellColor, SIGNED_POS, SIGNED_NEG } from "./ui.jsx";

describe("cellColor", () => {
  it("returns fallback when signed is false (preserves existing row behavior)", () => {
    expect(cellColor(false, "#abc", 100)).toBe("#abc");
    expect(cellColor(false, "#abc", -100)).toBe("#abc");
    expect(cellColor(false, "#abc", 0)).toBe("#abc");
    expect(cellColor(undefined, "#abc", -100)).toBe("#abc");
  });

  it("colors positive values green when signed", () => {
    expect(cellColor(true, "#abc", 100)).toBe(SIGNED_POS);
    expect(cellColor(true, "#abc", 1)).toBe(SIGNED_POS);
    expect(cellColor(true, "#abc", 0.01)).toBe(SIGNED_POS);
  });

  it("colors negative values red when signed", () => {
    expect(cellColor(true, "#abc", -100)).toBe(SIGNED_NEG);
    expect(cellColor(true, "#abc", -0.01)).toBe(SIGNED_NEG);
  });

  it("treats zero as positive (≥0 boundary)", () => {
    expect(cellColor(true, "#abc", 0)).toBe(SIGNED_POS);
  });

  it("handles null/undefined values by treating them as zero (positive)", () => {
    // Defensive: undefined would otherwise NaN-compare and pick red, which would
    // be misleading for a row where a value is genuinely absent.
    expect(cellColor(true, "#abc", null)).toBe(SIGNED_POS);
    expect(cellColor(true, "#abc", undefined)).toBe(SIGNED_POS);
  });

  it("regression: the mixed-sign Remaining-to-Budget case picks the right color per cell", () => {
    // The bug: wk=-50, mo=-217, y48=-2400, y52=+1200 (52 weeks - 48 budgeted)
    // pushed into green. All four were rendering in red. Per-cell now does the
    // right thing.
    const wk = -50, mo = -217, y48 = -2400, y52 = 1200;
    expect(cellColor(true, "ignored", wk)).toBe(SIGNED_NEG);
    expect(cellColor(true, "ignored", mo)).toBe(SIGNED_NEG);
    expect(cellColor(true, "ignored", y48)).toBe(SIGNED_NEG);
    expect(cellColor(true, "ignored", y52)).toBe(SIGNED_POS);
  });
});

import { describe, it, expect } from "vitest";
import {
  parseVersion,
  compareVersions,
  isBehind,
  extractVersionFromHtml,
  extractBuildFromHtml,
  isNewerBuild,
  shouldShowVersions,
  shouldRecheck,
  makeCacheEntry,
  normalizeNudgeMinutes,
  isSaveStale,
  formatStaleAge,
  DEFAULT_SAVE_NUDGE_MINUTES,
  UPDATE_CACHE_TTL_MS,
} from "./updateCheck.js";

describe("parseVersion", () => {
  it("parses a full semver string", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, raw: "1.2.3" });
  });
  it("strips a leading v", () => {
    expect(parseVersion("v2.0.1")).toMatchObject({ major: 2, minor: 0, patch: 1 });
  });
  it("defaults missing minor/patch to 0", () => {
    expect(parseVersion("1")).toMatchObject({ major: 1, minor: 0, patch: 0 });
    expect(parseVersion("1.4")).toMatchObject({ major: 1, minor: 4, patch: 0 });
  });
  it("trims whitespace", () => {
    expect(parseVersion("  1.0.0  ")).toMatchObject({ major: 1, minor: 0, patch: 0 });
  });
  it("ignores pre-release/build suffixes for the numeric core", () => {
    expect(parseVersion("1.2.3-beta.1")).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("1.2.3+build.9")).toMatchObject({ major: 1, minor: 2, patch: 3 });
  });
  it("preserves the raw input", () => {
    expect(parseVersion("v1.2.3-rc1").raw).toBe("v1.2.3-rc1");
  });
  it("returns null for garbage / nullish", () => {
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.3.0")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
  });
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });
  it("accepts pre-parsed objects", () => {
    expect(compareVersions(parseVersion("1.0.0"), parseVersion("1.0.1"))).toBe(-1);
  });
  it("treats unparseable input as lowest (0.0.0)", () => {
    expect(compareVersions("garbage", "0.0.1")).toBe(-1);
    expect(compareVersions("1.0.0", "garbage")).toBe(1);
    expect(compareVersions("garbage", "0.0.0")).toBe(0);
  });
});

describe("isBehind", () => {
  it("true when current is strictly older", () => {
    expect(isBehind("1.0.0", "1.0.1")).toBe(true);
    expect(isBehind("1.2.0", "2.0.0")).toBe(true);
  });
  it("false when equal or ahead", () => {
    expect(isBehind("1.2.3", "1.2.3")).toBe(false);
    expect(isBehind("2.0.0", "1.9.9")).toBe(false);
  });
  it("false (no nag) when either version is unparseable", () => {
    expect(isBehind("1.0.0", "not-a-version")).toBe(false);
    expect(isBehind("not-a-version", "1.0.0")).toBe(false);
    expect(isBehind(null, "1.0.0")).toBe(false);
  });
});

describe("extractVersionFromHtml", () => {
  it("pulls the baked version from double-quoted marker", () => {
    const html = `<html><script>window.__APP_VERSION__ = "1.4.2";</script></html>`;
    expect(extractVersionFromHtml(html)).toBe("1.4.2");
  });
  it("pulls from single-quoted marker with tight spacing", () => {
    const html = `window.__APP_VERSION__='2.0.0'`;
    expect(extractVersionFromHtml(html)).toBe("2.0.0");
  });
  it("tolerates extra whitespace around equals", () => {
    const html = `window.__APP_VERSION__   =   "3.1.0"`;
    expect(extractVersionFromHtml(html)).toBe("3.1.0");
  });
  it("returns null when marker absent (older build)", () => {
    expect(extractVersionFromHtml("<html>no version here</html>")).toBeNull();
  });
  it("returns null for non-string / empty", () => {
    expect(extractVersionFromHtml(null)).toBeNull();
    expect(extractVersionFromHtml("")).toBeNull();
    expect(extractVersionFromHtml(42)).toBeNull();
  });
  it("round-trips with a realistic injected snippet", () => {
    const injected = `<!DOCTYPE html><html><head><script>window.__APP_VERSION__ = "1.0.0";</script></head><body></body></html>`;
    const v = extractVersionFromHtml(injected);
    expect(isBehind(v, "1.0.1")).toBe(true);
  });
});

describe("extractBuildFromHtml", () => {
  it("pulls the baked SHA", () => {
    expect(extractBuildFromHtml(`<script>window.__APP_BUILD__ = "2096489abc12";</script>`)).toBe("2096489abc12");
  });
  it("handles single quotes / tight spacing", () => {
    expect(extractBuildFromHtml(`window.__APP_BUILD__='deadbeef'`)).toBe("deadbeef");
  });
  it("null when absent or non-string", () => {
    expect(extractBuildFromHtml("<html>nope</html>")).toBeNull();
    expect(extractBuildFromHtml(null)).toBeNull();
    expect(extractBuildFromHtml("")).toBeNull();
  });
});

describe("isNewerBuild (the trigger)", () => {
  it("true when SHAs differ — every push notifies", () => {
    expect(isNewerBuild("2096489", "b1c4d5f")).toBe(true);
  });
  it("false when equal (case-insensitive) or prefix-equal", () => {
    expect(isNewerBuild("a3f9c2e", "a3f9c2e")).toBe(false);
    expect(isNewerBuild("A3F9C2E", "a3f9c2e")).toBe(false);
    expect(isNewerBuild("a3f9c2e", "a3f9c2e1b2c3")).toBe(false);
    expect(isNewerBuild("a3f9c2e1b2c3", "a3f9c2e")).toBe(false);
  });
  it("false when either missing/empty", () => {
    expect(isNewerBuild(null, "a3f9c2e")).toBe(false);
    expect(isNewerBuild("a3f9c2e", null)).toBe(false);
    expect(isNewerBuild("  ", "a3f9c2e")).toBe(false);
  });
});

describe("shouldShowVersions (the label)", () => {
  it("true when tags parse and differ → banner shows v1.5.0 → v1.6.0", () => {
    expect(shouldShowVersions("v1.5.0", "v1.6.0")).toBe(true);
  });
  it("false when tags are equal → plain 'newer version available', no numbers", () => {
    expect(shouldShowVersions("v1.5.0", "v1.5.0")).toBe(false);
  });
  it("false for untagged commits sharing a base tag (the v1.0.0→v1.0.0 bug)", () => {
    // both describe to the same base tag despite different commit counts
    expect(shouldShowVersions("v1.5.0-3-gabc", "v1.5.0-17-g2096489")).toBe(false);
    expect(shouldShowVersions("1.0.0", "1.0.0")).toBe(false);
  });
  it("false when either is unparseable", () => {
    expect(shouldShowVersions("garbage", "v1.6.0")).toBe(false);
    expect(shouldShowVersions(null, "v1.6.0")).toBe(false);
  });
  it("true even when current is ahead (label just shows both)", () => {
    expect(shouldShowVersions("v1.6.0", "v1.5.0")).toBe(true);
  });
});

describe("trigger + label together (the real scenarios)", () => {
  it("17 untagged commits past v1.5.0: SHA differs → notify, but no version numbers shown", () => {
    expect(isNewerBuild("2096489", "aaa1111")).toBe(true);
    expect(shouldShowVersions("v1.5.0-17-g2096489", "v1.5.0-18-gaaa1111")).toBe(false);
  });
  it("a real tag bump: SHA differs → notify, and version numbers shown", () => {
    expect(isNewerBuild("2096489", "aaa1111")).toBe(true);
    expect(shouldShowVersions("v1.5.0", "v1.6.0")).toBe(true);
  });
  it("same build: no notify at all", () => {
    expect(isNewerBuild("2096489", "2096489")).toBe(false);
  });
});

describe("regression: bare SHA must never render as a version", () => {
  // CI's default shallow checkout has no tags, so `git describe --tags --always`
  // silently fell back to a bare commit SHA and baked __APP_VERSION__="7eb56b9".
  // Fixed two ways: fetch-depth:0 in CI, and dropping --always so the version
  // is empty rather than a fake. This pins the display side of that guard.
  it("a bare SHA does not parse as a version", () => {
    expect(parseVersion("7eb56b9")).toBeNull();
    expect(parseVersion("9b2ce74db365")).toBeNull();
  });
  it("shouldShowVersions is false when either side is a bare SHA", () => {
    expect(shouldShowVersions("7eb56b9", "v1.6.0")).toBe(false);
    expect(shouldShowVersions("v1.5.0", "9b2ce74")).toBe(false);
    expect(shouldShowVersions("7eb56b9", "9b2ce74")).toBe(false);
  });
  it("empty version (no tags reachable) shows no numbers but still allows the SHA trigger", () => {
    expect(shouldShowVersions("", "v1.6.0")).toBe(false);
    // the trigger is independent of the label — update still fires
    expect(isNewerBuild("7eb56b97438b", "9b2ce74db365")).toBe(true);
  });
  it("a real describe string still parses to its base tag", () => {
    expect(parseVersion("v1.5.0-22-g9b2ce74")).toMatchObject({ major: 1, minor: 5, patch: 0 });
    expect(shouldShowVersions("v1.5.0-22-g9b2ce74", "v1.6.0")).toBe(true);
  });
});

describe("regression: a copy predating this feature can't self-detect", () => {
  // Files downloaded before Phase 13A have no __APP_BUILD__ global at all, so
  // CURRENT_BUILD is "". By design we never nag on a missing value — meaning
  // those copies are permanently blind and must be re-downloaded once by hand.
  it("missing current build never triggers", () => {
    expect(isNewerBuild("", "9b2ce74db365")).toBe(false);
  });
});

describe("shouldRecheck", () => {

  const now = 1_000_000_000_000;
  it("true when no cache / missing fields", () => {
    expect(shouldRecheck(null, now)).toBe(true);
    expect(shouldRecheck({ latestBuild: "abc" }, now)).toBe(true);
    expect(shouldRecheck({ checkedAt: now }, now)).toBe(true);
    expect(shouldRecheck({ checkedAt: "bad", latestBuild: "abc" }, now)).toBe(true);
  });
  it("false within TTL, true after", () => {
    const cache = makeCacheEntry("abc", "v1.5.0", now);
    expect(shouldRecheck(cache, now + 1000)).toBe(false);
    expect(shouldRecheck(cache, now + UPDATE_CACHE_TTL_MS)).toBe(true);
  });
  it("respects a custom ttl", () => {
    const cache = makeCacheEntry("abc", "v1.5.0", now);
    expect(shouldRecheck(cache, now + 500, 1000)).toBe(false);
    expect(shouldRecheck(cache, now + 1000, 1000)).toBe(true);
  });
});

describe("makeCacheEntry", () => {
  it("stores trigger + label", () => {
    expect(makeCacheEntry("abc123", "v1.5.0", 42)).toEqual({
      checkedAt: 42, latestBuild: "abc123", latest: "v1.5.0",
    });
  });
  it("coerces to string, preserves null", () => {
    expect(makeCacheEntry(123, null, 42)).toEqual({ checkedAt: 42, latestBuild: "123", latest: null });
    expect(makeCacheEntry(null, null, 42).latestBuild).toBeNull();
  });
});

describe("normalizeNudgeMinutes", () => {
  it("passes through sane values", () => {
    expect(normalizeNudgeMinutes(30)).toBe(30);
    expect(normalizeNudgeMinutes("45")).toBe(45);
  });
  it("rounds fractional input", () => {
    expect(normalizeNudgeMinutes(30.6)).toBe(31);
  });
  it("falls back on garbage / negative", () => {
    expect(normalizeNudgeMinutes("abc")).toBe(DEFAULT_SAVE_NUDGE_MINUTES);
    expect(normalizeNudgeMinutes(null)).toBe(DEFAULT_SAVE_NUDGE_MINUTES);
    expect(normalizeNudgeMinutes(-5)).toBe(DEFAULT_SAVE_NUDGE_MINUTES);
  });
  it("clamps to max 24h", () => {
    expect(normalizeNudgeMinutes(99999)).toBe(1440);
  });
  it("allows 0 (disabled)", () => {
    expect(normalizeNudgeMinutes(0)).toBe(0);
  });
});

describe("isSaveStale", () => {
  const now = 1_000_000_000_000;
  const min = 60 * 1000;
  it("false when not dirty, no matter how old", () => {
    expect(isSaveStale({ dirty: false, lastSavedAt: now - 999 * min, nowMs: now, thresholdMinutes: 30 })).toBe(false);
  });
  it("false when dirty but within threshold", () => {
    expect(isSaveStale({ dirty: true, lastSavedAt: now - 10 * min, nowMs: now, thresholdMinutes: 30 })).toBe(false);
  });
  it("true when dirty and past threshold", () => {
    expect(isSaveStale({ dirty: true, lastSavedAt: now - 31 * min, nowMs: now, thresholdMinutes: 30 })).toBe(true);
  });
  it("true exactly at the threshold boundary", () => {
    expect(isSaveStale({ dirty: true, lastSavedAt: now - 30 * min, nowMs: now, thresholdMinutes: 30 })).toBe(true);
  });
  it("threshold 0 disables the nudge entirely", () => {
    expect(isSaveStale({ dirty: true, lastSavedAt: now - 999 * min, nowMs: now, thresholdMinutes: 0 })).toBe(false);
  });
  it("false when lastSavedAt is unusable", () => {
    expect(isSaveStale({ dirty: true, lastSavedAt: null, nowMs: now, thresholdMinutes: 30 })).toBe(false);
  });
  it("normalizes a garbage threshold to the default", () => {
    // default 30 → 40min elapsed is stale
    expect(isSaveStale({ dirty: true, lastSavedAt: now - 40 * min, nowMs: now, thresholdMinutes: "junk" })).toBe(true);
  });
  it("no-arg call does not throw", () => {
    expect(isSaveStale()).toBe(false);
  });
});

describe("formatStaleAge", () => {
  const min = 60 * 1000;
  it("sub-minute", () => expect(formatStaleAge(5000)).toBe("less than a minute"));
  it("minutes, singular and plural", () => {
    expect(formatStaleAge(1 * min)).toBe("1 minute");
    expect(formatStaleAge(18 * min)).toBe("18 minutes");
  });
  it("hours", () => {
    expect(formatStaleAge(60 * min)).toBe("1 hour");
    expect(formatStaleAge(150 * min)).toBe("2 hours");
  });
  it("days", () => {
    expect(formatStaleAge(24 * 60 * min)).toBe("1 day");
    expect(formatStaleAge(72 * 60 * min)).toBe("3 days");
  });
  it("empty for garbage/negative", () => {
    expect(formatStaleAge(-1)).toBe("");
    expect(formatStaleAge("x")).toBe("");
  });
});

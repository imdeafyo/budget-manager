import { describe, it, expect } from "vitest";
import {
  parseVersion,
  compareVersions,
  isBehind,
  extractVersionFromHtml,
  extractBuildFromHtml,
  isNewerBuild,
  shouldRecheck,
  makeCacheEntry,
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
  it("pulls the baked SHA from double-quoted marker", () => {
    const html = `<script>window.__APP_BUILD__ = "a3f9c2e";</script>`;
    expect(extractBuildFromHtml(html)).toBe("a3f9c2e");
  });
  it("pulls from single-quoted marker with tight spacing", () => {
    expect(extractBuildFromHtml(`window.__APP_BUILD__='deadbeef'`)).toBe("deadbeef");
  });
  it("returns null when marker absent", () => {
    expect(extractBuildFromHtml("<html>no build here</html>")).toBeNull();
  });
  it("returns null for non-string / empty", () => {
    expect(extractBuildFromHtml(null)).toBeNull();
    expect(extractBuildFromHtml("")).toBeNull();
    expect(extractBuildFromHtml(99)).toBeNull();
  });
});

describe("isNewerBuild", () => {
  it("true when SHAs differ", () => {
    expect(isNewerBuild("a3f9c2e", "b1c4d5f")).toBe(true);
  });
  it("false when SHAs equal (case-insensitive)", () => {
    expect(isNewerBuild("a3f9c2e", "a3f9c2e")).toBe(false);
    expect(isNewerBuild("A3F9C2E", "a3f9c2e")).toBe(false);
  });
  it("false when one SHA is a prefix of the other (short vs full)", () => {
    expect(isNewerBuild("a3f9c2e", "a3f9c2e1b2c3d4e5f6")).toBe(false);
    expect(isNewerBuild("a3f9c2e1b2c3d4e5f6", "a3f9c2e")).toBe(false);
  });
  it("false (no nag) when either SHA missing/empty", () => {
    expect(isNewerBuild(null, "a3f9c2e")).toBe(false);
    expect(isNewerBuild("a3f9c2e", null)).toBe(false);
    expect(isNewerBuild("", "a3f9c2e")).toBe(false);
    expect(isNewerBuild("  ", "a3f9c2e")).toBe(false);
  });
  it("tolerates surrounding whitespace", () => {
    expect(isNewerBuild("  a3f9c2e  ", "a3f9c2e")).toBe(false);
    expect(isNewerBuild(" a3f9c2e ", " b1c4d5f ")).toBe(true);
  });
});

describe("shouldRecheck", () => {
  const now = 1_000_000_000_000;
  it("true when no cache", () => {
    expect(shouldRecheck(null, now)).toBe(true);
    expect(shouldRecheck(undefined, now)).toBe(true);
    expect(shouldRecheck("nonsense", now)).toBe(true);
  });
  it("true when cache lacks a usable timestamp or latestBuild", () => {
    expect(shouldRecheck({ latestBuild: "a3f9c2e" }, now)).toBe(true);
    expect(shouldRecheck({ checkedAt: now }, now)).toBe(true);
    expect(shouldRecheck({ checkedAt: "bad", latestBuild: "a3f9c2e" }, now)).toBe(true);
  });
  it("false within TTL", () => {
    const cache = makeCacheEntry("a3f9c2e", "1.0.0", now);
    expect(shouldRecheck(cache, now + 1000)).toBe(false);
    expect(shouldRecheck(cache, now + UPDATE_CACHE_TTL_MS - 1)).toBe(false);
  });
  it("true once TTL elapsed", () => {
    const cache = makeCacheEntry("a3f9c2e", "1.0.0", now);
    expect(shouldRecheck(cache, now + UPDATE_CACHE_TTL_MS)).toBe(true);
    expect(shouldRecheck(cache, now + UPDATE_CACHE_TTL_MS + 5000)).toBe(true);
  });
  it("respects a custom ttl", () => {
    const cache = makeCacheEntry("a3f9c2e", "1.0.0", now);
    expect(shouldRecheck(cache, now + 500, 1000)).toBe(false);
    expect(shouldRecheck(cache, now + 1000, 1000)).toBe(true);
  });
});

describe("makeCacheEntry", () => {
  it("builds a persistable entry with build + version", () => {
    expect(makeCacheEntry("a3f9c2e", "1.2.3", 42)).toEqual({
      checkedAt: 42,
      latestBuild: "a3f9c2e",
      latest: "1.2.3",
    });
  });
  it("coerces to string, preserves null", () => {
    expect(makeCacheEntry(123, null, 42)).toEqual({ checkedAt: 42, latestBuild: "123", latest: null });
    expect(makeCacheEntry(null, null, 42).latestBuild).toBeNull();
  });
});

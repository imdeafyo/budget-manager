/* ══════════════════════════ Update check — Phase 13A (generic only) ══════════════════════════
   The self-contained generic HTML file (budget-manager.html) has no auto-update
   path the way the K8s deploy does — the user downloaded a single file and runs
   it from disk (often file://). This module powers a lightweight "you're behind,
   here's the latest" check for that build.

   How it works:
     - Every generic build bakes its identity into the HTML as globals:
         window.__APP_BUILD__   = "a3f9c2e"   // git commit SHA — the signal
         window.__APP_VERSION__ = "1.2.3"     // package.json — display only
       (injected by scripts/build-generic.mjs; SHA from `git rev-parse`).
     - CI rebuilds budget-manager-generic.html on every push to main, so the
       copy at raw.githubusercontent.com/…/main/budget-manager-generic.html is
       always the newest published build, stamped with that commit's SHA.
     - The running app fetches that raw HTML, extracts its baked SHA with
       extractBuildFromHtml(), and compares to its own __APP_BUILD__.
     - If the SHAs differ, main has moved since this copy was downloaded, so
       the UI shows a banner + a one-tap "download the new version with my data
       baked in" action. The download reuses the same DOMParser+inject machinery
       as the 💾 save button, except the HTML shell comes from the network.

   Why the commit SHA and not a version number:
     A package.json version only changes when someone manually bumps it, so it
     can't detect "main moved" on its own — forget the bump and the banner never
     fires (a silent failure). The git SHA changes on every commit with zero
     manual effort, so latest-SHA ≠ my-SHA reliably means "there's something
     newer." The version string is still baked and shown in the banner when
     present, but it's decoration; the SHA decides whether to show it.

   Why no GitHub releases/tags API:
     The built HTML already lives on main and rebuilds on every push. Keying off
     raw main is simpler and needs no release-tag discipline. It also dodges the
     GitHub API's low unauthenticated rate limit (60/hr/IP), which raw.github
     content is not subject to in the same way.

   This module is pure: no DOM, no fetch, no network. The caller (injected into
   App.jsx by the build script for MODE=generic only) owns fetching and DOM work.
   Everything here is unit-testable in isolation.

   Deploy (K8s) build never uses this — the deploy path updates via container
   image rollout, not a downloaded file.
*/

// Canonical locations. Kept here so both the module and the build script's
// injected UI reference one source of truth for the URLs.
export const REPO_SLUG = "imdeafyo/budget-manager";
export const RAW_HTML_URL =
  "https://raw.githubusercontent.com/imdeafyo/budget-manager/main/budget-manager-generic.html";
export const RELEASES_PAGE_URL = "https://github.com/imdeafyo/budget-manager";

/* parseVersion("1.2.3") → { major:1, minor:2, patch:3, raw:"1.2.3" }
   Tolerant of:
     - a leading "v" ("v1.2.3")
     - missing minor/patch ("1" → 1.0.0, "1.2" → 1.2.0)
     - surrounding whitespace
     - trailing pre-release/build metadata ("1.2.3-beta.1", "1.2.3+build") —
       the numeric core is parsed; the suffix is ignored for ordering purposes
       (a deliberate simplification: this app doesn't ship pre-releases to the
       generic file, so full semver precedence isn't needed).
   Returns null for anything without a parseable numeric major. */
export function parseVersion(input) {
  if (input == null) return null;
  const s = String(input).trim().replace(/^v/i, "");
  // Grab the leading numeric dotted core, ignore any -pre / +build suffix.
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  if (!Number.isFinite(major)) return null;
  const minor = m[2] != null ? Number(m[2]) : 0;
  const patch = m[3] != null ? Number(m[3]) : 0;
  return { major, minor, patch, raw: String(input).trim() };
}

/* compareVersions(a, b): -1 if a<b, 0 if equal, 1 if a>b.
   Accepts strings or parsed objects. Unparseable inputs sort as "lowest"
   (treated as 0.0.0) so a garbage running-version never claims to be ahead
   of a real published one — worst case it prompts an unnecessary update,
   which is safe, rather than suppressing a real one. */
export function compareVersions(a, b) {
  const pa = typeof a === "object" && a ? a : parseVersion(a);
  const pb = typeof b === "object" && b ? b : parseVersion(b);
  const va = pa || { major: 0, minor: 0, patch: 0 };
  const vb = pb || { major: 0, minor: 0, patch: 0 };
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;
  return 0;
}

/* isBehind(current, latest): true iff `current` is strictly older than `latest`.
   Equal or ahead → false (no banner). If either is unparseable, returns false —
   we do NOT nag the user based on a version string we couldn't read, since a
   malformed `latest` (e.g. a fetched error page) would otherwise always trigger. */
export function isBehind(current, latest) {
  const pc = parseVersion(current);
  const pl = parseVersion(latest);
  if (!pc || !pl) return false;
  return compareVersions(pc, pl) < 0;
}

/* extractVersionFromHtml(html): pull the baked version out of a generic HTML
   file's source. Matches the marker the build script writes:
       window.__APP_VERSION__ = "1.2.3";
   Quote style is flexible (single/double), whitespace around `=` is flexible.
   Returns the version string, or null if not found (e.g. an older build that
   predates version baking, or a fetched non-HTML error body). */
export function extractVersionFromHtml(html) {
  if (typeof html !== "string" || !html) return null;
  const m = html.match(/__APP_VERSION__\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

/* ── Build identity (commit SHA) — the actual "is there something newer" signal ──
   Version strings (package.json) only change if someone manually bumps them, so
   they can't tell you "main moved" on their own. The git commit SHA does: CI
   bakes it into the HTML on every push to main, so a difference between the SHA
   in your downloaded copy and the SHA on main means main is genuinely newer —
   zero manual steps, no tags, no version bumps.

   Baked by the build script as:
       window.__APP_BUILD__ = "a3f9c2e";
   The version string is still baked too (window.__APP_VERSION__) but is
   display-only decoration on the banner — the SHA decides whether to show it. */

/* extractBuildFromHtml(html): pull the baked commit SHA out of a generic HTML
   file's source. Returns the SHA string, or null if absent (older build). */
export function extractBuildFromHtml(html) {
  if (typeof html !== "string" || !html) return null;
  const m = html.match(/__APP_BUILD__\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

/* isNewerBuild(currentSha, latestSha): true iff the two SHAs are both present,
   non-empty, and different. SHAs have no ordering — you can't tell which of two
   arbitrary commits is "later" from the hash alone — so "different" is the
   signal: CI only advances main forward, and the running copy's SHA is frozen
   at whenever it was downloaded, so latest≠current ⇒ main moved ⇒ newer.
   Returns false if either SHA is missing (never nag on an unreadable value) or
   if they're equal (you're current). Comparison is case-insensitive and
   length-tolerant so a short SHA (a3f9c2e) and its full form compare equal when
   one is a prefix of the other. */
export function isNewerBuild(currentSha, latestSha) {
  if (!currentSha || !latestSha) return false;
  const a = String(currentSha).trim().toLowerCase();
  const b = String(latestSha).trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return false;
  // Prefix match either direction → same commit, just different SHA length.
  if (a.startsWith(b) || b.startsWith(a)) return false;
  return true;
}

/* Cache helpers for the auto-check. The UI does an auto-check on load but
   shouldn't hammer raw.github on every reload, so it caches the last result
   with a timestamp and only re-fetches once the TTL has elapsed. These helpers
   keep that decision pure and testable; the caller owns the actual storage
   read/write (localStorage in the browser).

   Cache shape: { checkedAt: <ms epoch>, latestBuild: "<sha>", latest: "<version>" }
   latestBuild is the comparison signal; latest is the display version.
   TTL default: 24h. */
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/* shouldRecheck(cache, nowMs, ttlMs): true if there's no usable cached result
   or the cached one is older than the TTL. */
export function shouldRecheck(cache, nowMs = Date.now(), ttlMs = UPDATE_CACHE_TTL_MS) {
  if (!cache || typeof cache !== "object") return true;
  const at = Number(cache.checkedAt);
  if (!Number.isFinite(at)) return true;
  if (!cache.latestBuild) return true;
  return nowMs - at >= ttlMs;
}

/* makeCacheEntry(latestBuild, latestVersion, nowMs): build a cache object to
   persist. latestBuild (SHA) is the signal; latestVersion is display-only. */
export function makeCacheEntry(latestBuild, latestVersion = null, nowMs = Date.now()) {
  return {
    checkedAt: nowMs,
    latestBuild: latestBuild == null ? null : String(latestBuild),
    latest: latestVersion == null ? null : String(latestVersion),
  };
}

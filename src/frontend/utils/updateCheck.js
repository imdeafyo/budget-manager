/* ══════════════════════════ Update check — Phase 13A (generic only) ══════════════════════════
   The self-contained generic HTML file (budget-manager.html) has no auto-update
   path the way the K8s deploy does — the user downloaded a single file and runs
   it from disk (often file://). This module powers a lightweight "you're behind,
   here's the latest" check for that build.

   How it works:
     - Every generic build bakes two things into the HTML:
         window.__APP_BUILD__   = "2096489abc12"  // commit SHA — the TRIGGER
         window.__APP_VERSION__ = "v1.5.0"        // git describe — the LABEL
       (injected by scripts/build-generic.mjs).
     - CI rebuilds budget-manager-generic.html on every push to main, so the
       copy at raw.githubusercontent.com/…/main/budget-manager-generic.html is
       always the newest published build.
     - The running app fetches that raw HTML, extracts both, and compares.

   Trigger vs label — why both:
     TRIGGER (commit SHA): decides *whether* to show the banner. Changes on
       every commit with zero manual effort, so every push to main = update
       available. Never silently fails the way a forgotten tag/version bump
       does. SHAs have no ordering, so "different" is the signal (see
       isNewerBuild).
     LABEL (git tag via `git describe`): decides *what number to show*. When
       you've cut a tag, the banner reads "v1.5.0 → v1.6.0". When you haven't
       (or both sides describe to the same base tag), the versions are equal
       and the banner simply says "a newer version is available" with no
       numbers — which is what prevents the nonsensical "v1.0.0 → v1.0.0".
     This is why untagged commits still notify: the SHA moved even though the
     tag didn't. shouldShowVersions() encodes the label decision.

   Why no GitHub tags/releases API:
     Baking at build time and fetching the raw HTML avoids the GitHub API's
     unauthenticated rate limit (60/hr/IP) — a real problem for a file:// page
     with no auth, where a few refreshes could trip a 403 and silently break
     the check. The raw HTML on main isn't subject to that limit.

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
  // Reject bare commit SHAs. A hex hash like "7eb56b9" would otherwise match
  // the leading-digit rule below and parse as version 7.0.0 — a fake version
  // that renders in the banner as if it were real. Real versions are dotted
  // (1.2.3) or describe strings (1.5.0-22-g9b2ce74); a bare hex blob with no
  // dot before its first non-digit is a SHA, not a version.
  if (/^[0-9a-f]{7,40}$/i.test(s) && !s.includes(".")) return null;
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

/* ── TRIGGER: build identity (commit SHA) ──
   Baked by the build script as window.__APP_BUILD__. Decides whether a newer
   build exists at all. */

/* extractBuildFromHtml(html): pull the baked commit SHA out of a generic HTML
   file's source. Returns the SHA string, or null if absent (older build). */
export function extractBuildFromHtml(html) {
  if (typeof html !== "string" || !html) return null;
  const m = html.match(/__APP_BUILD__\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

/* isNewerBuild(currentSha, latestSha): true iff both SHAs are present and
   different. SHAs have no ordering — you can't tell which of two arbitrary
   commits is "later" from the hash alone — so "different" is the signal: CI
   only advances main forward, and the running copy's SHA is frozen at download
   time, so latest≠current ⇒ main moved ⇒ newer.
   Returns false if either is missing (never nag on an unreadable value), if
   they're equal, or if one is a prefix of the other (short vs full SHA). */
export function isNewerBuild(currentSha, latestSha) {
  if (!currentSha || !latestSha) return false;
  const a = String(currentSha).trim().toLowerCase();
  const b = String(latestSha).trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return false;
  if (a.startsWith(b) || b.startsWith(a)) return false;
  return true;
}

/* ── LABEL: which version numbers (if any) to show in the banner ──
   shouldShowVersions(currentVersion, latestVersion): true only when both tags
   parse AND differ, so the banner can render "v1.5.0 → v1.6.0". When they're
   equal (untagged commits sharing a base tag) or unparseable, returns false and
   the caller shows a plain "a newer version is available" — this is precisely
   what prevents the nonsensical "v1.0.0 is available, you're on v1.0.0". */
export function shouldShowVersions(currentVersion, latestVersion) {
  const pc = parseVersion(currentVersion);
  const pl = parseVersion(latestVersion);
  if (!pc || !pl) return false;
  return compareVersions(pc, pl) !== 0;
}

/* Cache helpers for the auto-check. The UI does an auto-check on load but
   shouldn't hammer raw.github on every reload, so it caches the last result
   with a timestamp and only re-fetches once the TTL has elapsed. These helpers
   keep that decision pure and testable; the caller owns the actual storage
   read/write (localStorage in the browser).

   Cache shape: { checkedAt: <ms epoch>, latestBuild: "<sha>", latest: "<tag>" }
   latestBuild is the trigger; latest is the display label.
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
   persist. latestBuild (SHA) is the trigger; latestVersion (tag) is the label. */
export function makeCacheEntry(latestBuild, latestVersion = null, nowMs = Date.now()) {
  return {
    checkedAt: nowMs,
    latestBuild: latestBuild == null ? null : String(latestBuild),
    latest: latestVersion == null ? null : String(latestVersion),
  };
}

/* ══════════════════════════ Stale-save nudge (generic only) ══════════════════════════
   A browser page cannot write to a file on disk without a user-initiated
   download. So the generic build autosaves to localStorage (600ms debounce)
   but the .html file on disk only updates when the user presses 💾. That means
   the file can silently fall arbitrarily far behind — and if localStorage is
   ever cleared, the stale file is all that's left.

   We can't fix that automatically (browsers forbid it), so instead we surface
   it: track when the user last exported to file, and warn once edits have gone
   unsaved-to-file for longer than a user-configured threshold.

   Pure helpers below; the caller owns timers and storage. */

/* Default nudge threshold, in minutes. */
export const DEFAULT_SAVE_NUDGE_MINUTES = 30;

/* Threshold bounds — keeps a nonsense value out of the pref. 0 = disabled. */
export const SAVE_NUDGE_MIN_MINUTES = 0;
export const SAVE_NUDGE_MAX_MINUTES = 1440; // 24h

/* normalizeNudgeMinutes(v): coerce a user-entered threshold into a sane number.
   Non-numeric / negative → the default. Clamped to [0, 1440]. 0 disables. */
export function normalizeNudgeMinutes(v, fallback = DEFAULT_SAVE_NUDGE_MINUTES) {
  // Guard null/""/booleans explicitly: Number(null) and Number("") are both 0,
  // which would silently read as "0 = nudge disabled" rather than "unset".
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.max(Math.round(n), SAVE_NUDGE_MIN_MINUTES), SAVE_NUDGE_MAX_MINUTES);
}

/* isSaveStale({ dirty, lastSavedAt, nowMs, thresholdMinutes }): should we warn?
   True only when there ARE unsaved-to-file edits (dirty) AND the time since the
   last file export exceeds the threshold. A threshold of 0 disables the nudge
   entirely. If lastSavedAt is null (never exported this session) we measure from
   the moment edits began — the caller passes that as lastSavedAt. */
export function isSaveStale({ dirty, lastSavedAt, nowMs = Date.now(), thresholdMinutes = DEFAULT_SAVE_NUDGE_MINUTES } = {}) {
  if (!dirty) return false;
  const mins = normalizeNudgeMinutes(thresholdMinutes);
  if (mins <= 0) return false;
  // Guard null/undefined/"" explicitly before Number(): Number(null) is 0,
  // which would read as "saved at the epoch" and make everything look stale.
  if (lastSavedAt === null || lastSavedAt === undefined || lastSavedAt === "") return false;
  const at = Number(lastSavedAt);
  if (!Number.isFinite(at)) return false;
  return nowMs - at >= mins * 60 * 1000;
}

/* formatStaleAge(ms): short human string for the nudge ("18 minutes", "2 hours",
   "3 days"). Kept pure + tiny; no Intl dependency for the single-file build. */
export function formatStaleAge(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "";
  const mins = Math.floor(n / 60000);
  if (mins < 1) return "less than a minute";
  if (mins < 60) return mins + (mins === 1 ? " minute" : " minutes");
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? " hour" : " hours");
  const days = Math.floor(hrs / 24);
  return days + (days === 1 ? " day" : " days");
}

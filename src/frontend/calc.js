import { STATE_BRACKETS } from "../data/taxDB.js";

/* ── Formula eval: strips commas, evaluates math, returns number ── */
export function evalF(str) {
  if (typeof str === "number") return str;
  const s = String(str).replace(/,/g, "").trim();
  if (!s) return 0;
  if (/^[\d\s+\-*/().]+$/.test(s)) {
    try { const r = Function('"use strict";return(' + s + ')')(); return typeof r === "number" && isFinite(r) ? r : 0; } catch { return 0; }
  }
  return parseFloat(s) || 0;
}

/* Resolve formula to display value on blur — stores original in 'f' field */
export function resolveFormula(str) {
  if (typeof str === "number") return String(str);
  const s = String(str).replace(/,/g, "").trim();
  if (!s) return "0";
  if (/[+\-*/()]/.test(s) && /^[\d\s+\-*/().]+$/.test(s)) {
    const v = evalF(s);
    return String(Math.round(v * 100) / 100);
  }
  return s;
}

export function calcMatch(empPct, tiers, base) {
  let match = base, remaining = empPct, prev = 0;
  for (const tier of tiers) { const band = tier.upTo - prev; const used = Math.min(Math.max(remaining, 0), band); match += used * tier.rate; remaining -= used; prev = tier.upTo; if (remaining <= 0) break; }
  return match;
}

export function calcFed(ti, br) { let t = 0; for (const [mn, mx, r] of br) { if (ti <= mn) break; t += (Math.min(ti, mx) - mn) * r; } return t; }
export function getMarg(ti, br) { for (let i = br.length - 1; i >= 0; i--) if (ti > br[i][0]) return br[i][2]; return .10; }

export function calcStateTax(taxableIncome, stateAbbr, filing) {
  const st = STATE_BRACKETS[stateAbbr];
  if (!st || !st.single || st.single.length === 0) return 0;
  const br = (filing === "mfj" && st.mfj) || st.single;
  return calcFed(Math.max(0, taxableIncome), br);
}

export function getStateMarg(taxableIncome, stateAbbr, filing) {
  const st = STATE_BRACKETS[stateAbbr];
  if (!st || !st.single || st.single.length === 0) return 0;
  const br = (filing === "mfj" && st.mfj) || st.single;
  return getMarg(Math.max(0, taxableIncome), br);
}

/* ── Period conversion: convert entered value to WEEKLY ── */
export function toWk(val, p) {
  const v = evalF(val);
  if (p === "m") return v * 12 / 48; // monthly to weekly: monthly*12months/48paychecks
  if (p === "y") return v / 48;       // yearly to weekly: yearly/48paychecks
  return v;
}

/* Convert weekly to display period */
export function fromWk(wk, p) {
  if (p === "m") return wk * 48 / 12;
  if (p === "y") return wk * 48;
  return wk;
}

export const fmt = n => (Math.round((n || 0) * 100) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
export const fp = n => `${(n * 100).toFixed(2)}%`;
export const p2 = n => `${(+n).toFixed(2)}%`;
export const pctOf = (part, total) => total > 0 ? `${(part / total * 100).toFixed(1)}%` : "0%";

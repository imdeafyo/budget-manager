import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

/* ── Formula eval: strips commas, evaluates math, returns number ── */
function evalF(str) {
  if (typeof str === "number") return str;
  const s = String(str).replace(/,/g, "").trim();
  if (!s) return 0;
  if (/^[\d\s+\-*/().]+$/.test(s)) {
    try { const r = Function('"use strict";return(' + s + ')')(); return typeof r === "number" && isFinite(r) ? r : 0; } catch { return 0; }
  }
  return parseFloat(s) || 0;
}
/* Resolve formula to display value on blur — stores original in 'f' field */
function resolveFormula(str) {
  if (typeof str === "number") return String(str);
  const s = String(str).replace(/,/g, "").trim();
  if (!s) return "0";
  if (/[+\-*/()]/.test(s) && /^[\d\s+\-*/().]+$/.test(s)) {
    const v = evalF(s);
    return String(Math.round(v * 100) / 100);
  }
  return s;
}

/* ── Tax Rate Database: 1996–2026 ── */
/* Federal brackets [from, to, rate], stdDed, SS, Medicare, 401k, HSA(family) */
const TAX_DB = {
  "1996": { fedSingle:[[0,24000,.15],[24000,58150,.28],[58150,121300,.31],[121300,263750,.36],[263750,9999999,.396]], fedMFJ:[[0,40100,.15],[40100,96900,.28],[96900,147700,.31],[147700,263750,.36],[263750,9999999,.396]], stdSingle:4000, stdMFJ:6700, ssRate:6.2, ssCap:62700, medRate:1.45, k401Lim:9500, hsaLimit:0 },
  "1997": { fedSingle:[[0,24650,.15],[24650,59750,.28],[59750,124650,.31],[124650,271050,.36],[271050,9999999,.396]], fedMFJ:[[0,41200,.15],[41200,99600,.28],[99600,151750,.31],[151750,271050,.36],[271050,9999999,.396]], stdSingle:4150, stdMFJ:6900, ssRate:6.2, ssCap:65400, medRate:1.45, k401Lim:9500, hsaLimit:0 },
  "1998": { fedSingle:[[0,25350,.15],[25350,61400,.28],[61400,128100,.31],[128100,278450,.36],[278450,9999999,.396]], fedMFJ:[[0,42350,.15],[42350,102300,.28],[102300,155950,.31],[155950,278450,.36],[278450,9999999,.396]], stdSingle:4250, stdMFJ:7100, ssRate:6.2, ssCap:68400, medRate:1.45, k401Lim:10000, hsaLimit:0 },
  "1999": { fedSingle:[[0,25750,.15],[25750,62450,.28],[62450,130250,.31],[130250,283150,.36],[283150,9999999,.396]], fedMFJ:[[0,43050,.15],[43050,104050,.28],[104050,158550,.31],[158550,283150,.36],[283150,9999999,.396]], stdSingle:4300, stdMFJ:7200, ssRate:6.2, ssCap:72600, medRate:1.45, k401Lim:10000, hsaLimit:0 },
  "2000": { fedSingle:[[0,26250,.15],[26250,63550,.28],[63550,132600,.31],[132600,288350,.36],[288350,9999999,.396]], fedMFJ:[[0,43850,.15],[43850,105950,.28],[105950,161450,.31],[161450,288350,.36],[288350,9999999,.396]], stdSingle:4400, stdMFJ:7350, ssRate:6.2, ssCap:76200, medRate:1.45, k401Lim:10500, hsaLimit:0 },
  "2001": { fedSingle:[[0,27050,.15],[27050,65550,.28],[65550,136750,.31],[136750,297350,.36],[297350,9999999,.396]], fedMFJ:[[0,45200,.15],[45200,109250,.28],[109250,166500,.31],[166500,297350,.36],[297350,9999999,.396]], stdSingle:4550, stdMFJ:7600, ssRate:6.2, ssCap:80400, medRate:1.45, k401Lim:10500, hsaLimit:0 },
  "2002": { fedSingle:[[0,6000,.10],[6000,27950,.15],[27950,67700,.27],[67700,141250,.30],[141250,307050,.35],[307050,9999999,.386]], fedMFJ:[[0,12000,.10],[12000,46700,.15],[46700,112850,.27],[112850,171950,.30],[171950,307050,.35],[307050,9999999,.386]], stdSingle:4700, stdMFJ:7850, ssRate:6.2, ssCap:84900, medRate:1.45, k401Lim:11000, hsaLimit:0 },
  "2003": { fedSingle:[[0,7000,.10],[7000,28400,.15],[28400,68800,.25],[68800,143500,.28],[143500,311950,.33],[311950,9999999,.35]], fedMFJ:[[0,14000,.10],[14000,56800,.15],[56800,114650,.25],[114650,174700,.28],[174700,311950,.33],[311950,9999999,.35]], stdSingle:4750, stdMFJ:9500, ssRate:6.2, ssCap:87000, medRate:1.45, k401Lim:12000, hsaLimit:0 },
  "2004": { fedSingle:[[0,7150,.10],[7150,29050,.15],[29050,70350,.25],[70350,146750,.28],[146750,319100,.33],[319100,9999999,.35]], fedMFJ:[[0,14300,.10],[14300,58100,.15],[58100,117250,.25],[117250,178650,.28],[178650,319100,.33],[319100,9999999,.35]], stdSingle:4850, stdMFJ:9700, ssRate:6.2, ssCap:87900, medRate:1.45, k401Lim:13000, hsaLimit:5150 },
  "2005": { fedSingle:[[0,7300,.10],[7300,29700,.15],[29700,71950,.25],[71950,150150,.28],[150150,326450,.33],[326450,9999999,.35]], fedMFJ:[[0,14600,.10],[14600,59400,.15],[59400,119950,.25],[119950,182800,.28],[182800,326450,.33],[326450,9999999,.35]], stdSingle:5000, stdMFJ:10000, ssRate:6.2, ssCap:90000, medRate:1.45, k401Lim:14000, hsaLimit:5250 },
  "2006": { fedSingle:[[0,7550,.10],[7550,30650,.15],[30650,74200,.25],[74200,154800,.28],[154800,336550,.33],[336550,9999999,.35]], fedMFJ:[[0,15100,.10],[15100,61300,.15],[61300,123700,.25],[123700,188450,.28],[188450,336550,.33],[336550,9999999,.35]], stdSingle:5150, stdMFJ:10300, ssRate:6.2, ssCap:94200, medRate:1.45, k401Lim:15000, hsaLimit:5450 },
  "2007": { fedSingle:[[0,7825,.10],[7825,31850,.15],[31850,77100,.25],[77100,160850,.28],[160850,349700,.33],[349700,9999999,.35]], fedMFJ:[[0,15650,.10],[15650,63700,.15],[63700,128500,.25],[128500,195850,.28],[195850,349700,.33],[349700,9999999,.35]], stdSingle:5350, stdMFJ:10700, ssRate:6.2, ssCap:97500, medRate:1.45, k401Lim:15500, hsaLimit:5650 },
  "2008": { fedSingle:[[0,8025,.10],[8025,32550,.15],[32550,78850,.25],[78850,164550,.28],[164550,357700,.33],[357700,9999999,.35]], fedMFJ:[[0,16050,.10],[16050,65100,.15],[65100,131450,.25],[131450,200300,.28],[200300,357700,.33],[357700,9999999,.35]], stdSingle:5450, stdMFJ:10900, ssRate:6.2, ssCap:102000, medRate:1.45, k401Lim:15500, hsaLimit:5800 },
  "2009": { fedSingle:[[0,8350,.10],[8350,33950,.15],[33950,82250,.25],[82250,171550,.28],[171550,372950,.33],[372950,9999999,.35]], fedMFJ:[[0,16700,.10],[16700,67900,.15],[67900,137050,.25],[137050,208850,.28],[208850,372950,.33],[372950,9999999,.35]], stdSingle:5700, stdMFJ:11400, ssRate:6.2, ssCap:106800, medRate:1.45, k401Lim:16500, hsaLimit:5950 },
  "2010": { fedSingle:[[0,8375,.10],[8375,34000,.15],[34000,82400,.25],[82400,171850,.28],[171850,373650,.33],[373650,9999999,.35]], fedMFJ:[[0,16750,.10],[16750,68000,.15],[68000,137300,.25],[137300,209250,.28],[209250,373650,.33],[373650,9999999,.35]], stdSingle:5700, stdMFJ:11400, ssRate:6.2, ssCap:106800, medRate:1.45, k401Lim:16500, hsaLimit:6150 },
  "2011": { fedSingle:[[0,8500,.10],[8500,34500,.15],[34500,83600,.25],[83600,174400,.28],[174400,379150,.33],[379150,9999999,.35]], fedMFJ:[[0,17000,.10],[17000,69000,.15],[69000,139350,.25],[139350,212300,.28],[212300,379150,.33],[379150,9999999,.35]], stdSingle:5800, stdMFJ:11600, ssRate:4.2, ssCap:106800, medRate:1.45, k401Lim:16500, hsaLimit:6150 },
  "2012": { fedSingle:[[0,8700,.10],[8700,35350,.15],[35350,85650,.25],[85650,178650,.28],[178650,388350,.33],[388350,9999999,.35]], fedMFJ:[[0,17400,.10],[17400,70700,.15],[70700,142700,.25],[142700,217450,.28],[217450,388350,.33],[388350,9999999,.35]], stdSingle:5950, stdMFJ:11900, ssRate:4.2, ssCap:110100, medRate:1.45, k401Lim:17000, hsaLimit:6250 },
  "2013": { fedSingle:[[0,8925,.10],[8925,36250,.15],[36250,87850,.25],[87850,183250,.28],[183250,398350,.33],[398350,400000,.35],[400000,9999999,.396]], fedMFJ:[[0,17850,.10],[17850,72500,.15],[72500,146400,.25],[146400,223050,.28],[223050,398350,.33],[398350,450000,.35],[450000,9999999,.396]], stdSingle:6100, stdMFJ:12200, ssRate:6.2, ssCap:113700, medRate:1.45, k401Lim:17500, hsaLimit:6450 },
  "2014": { fedSingle:[[0,9075,.10],[9075,36900,.15],[36900,89350,.25],[89350,186350,.28],[186350,405100,.33],[405100,406750,.35],[406750,9999999,.396]], fedMFJ:[[0,18150,.10],[18150,73800,.15],[73800,148850,.25],[148850,226850,.28],[226850,405100,.33],[405100,457600,.35],[457600,9999999,.396]], stdSingle:6200, stdMFJ:12400, ssRate:6.2, ssCap:117000, medRate:1.45, k401Lim:17500, hsaLimit:6550 },
  "2015": { fedSingle:[[0,9225,.10],[9225,37450,.15],[37450,90750,.25],[90750,189300,.28],[189300,411500,.33],[411500,413200,.35],[413200,9999999,.396]], fedMFJ:[[0,18450,.10],[18450,74900,.15],[74900,151200,.25],[151200,230450,.28],[230450,411500,.33],[411500,464850,.35],[464850,9999999,.396]], stdSingle:6300, stdMFJ:12600, ssRate:6.2, ssCap:118500, medRate:1.45, k401Lim:18000, hsaLimit:6650 },
  "2016": { fedSingle:[[0,9275,.10],[9275,37650,.15],[37650,91150,.25],[91150,190150,.28],[190150,413350,.33],[413350,415050,.35],[415050,9999999,.396]], fedMFJ:[[0,18550,.10],[18550,75300,.15],[75300,151900,.25],[151900,231450,.28],[231450,413350,.33],[413350,466950,.35],[466950,9999999,.396]], stdSingle:6300, stdMFJ:12600, ssRate:6.2, ssCap:118500, medRate:1.45, k401Lim:18000, hsaLimit:6750 },
  "2017": { fedSingle:[[0,9325,.10],[9325,37950,.15],[37950,91900,.25],[91900,191650,.28],[191650,416700,.33],[416700,418400,.35],[418400,9999999,.396]], fedMFJ:[[0,18650,.10],[18650,75900,.15],[75900,153100,.25],[153100,233350,.28],[233350,416700,.33],[416700,470700,.35],[470700,9999999,.396]], stdSingle:6350, stdMFJ:12700, ssRate:6.2, ssCap:127200, medRate:1.45, k401Lim:18000, hsaLimit:6750 },
  "2018": { fedSingle:[[0,9525,.10],[9525,38700,.12],[38700,82500,.22],[82500,157500,.24],[157500,200000,.32],[200000,500000,.35],[500000,9999999,.37]], fedMFJ:[[0,19050,.10],[19050,77400,.12],[77400,165000,.22],[165000,315000,.24],[315000,400000,.32],[400000,600000,.35],[600000,9999999,.37]], stdSingle:12000, stdMFJ:24000, ssRate:6.2, ssCap:128400, medRate:1.45, k401Lim:18500, hsaLimit:6900 },
  "2019": { fedSingle:[[0,9700,.10],[9700,39475,.12],[39475,84200,.22],[84200,160725,.24],[160725,204100,.32],[204100,510300,.35],[510300,9999999,.37]], fedMFJ:[[0,19400,.10],[19400,78950,.12],[78950,168400,.22],[168400,321450,.24],[321450,408200,.32],[408200,612350,.35],[612350,9999999,.37]], stdSingle:12200, stdMFJ:24400, ssRate:6.2, ssCap:132900, medRate:1.45, k401Lim:19000, hsaLimit:7000 },
  "2020": { fedSingle:[[0,9875,.10],[9875,40125,.12],[40125,85525,.22],[85525,163300,.24],[163300,207350,.32],[207350,518400,.35],[518400,9999999,.37]], fedMFJ:[[0,19750,.10],[19750,80250,.12],[80250,171050,.22],[171050,326600,.24],[326600,414700,.32],[414700,622050,.35],[622050,9999999,.37]], stdSingle:12400, stdMFJ:24800, ssRate:6.2, ssCap:137700, medRate:1.45, k401Lim:19500, hsaLimit:7100 },
  "2021": { fedSingle:[[0,9950,.10],[9950,40525,.12],[40525,86375,.22],[86375,164925,.24],[164925,209425,.32],[209425,523600,.35],[523600,9999999,.37]], fedMFJ:[[0,19900,.10],[19900,81050,.12],[81050,172750,.22],[172750,329850,.24],[329850,418850,.32],[418850,628300,.35],[628300,9999999,.37]], stdSingle:12550, stdMFJ:25100, ssRate:6.2, ssCap:142800, medRate:1.45, k401Lim:19500, hsaLimit:7200 },
  "2022": { fedSingle:[[0,10275,.10],[10275,41775,.12],[41775,89075,.22],[89075,170050,.24],[170050,215950,.32],[215950,539900,.35],[539900,9999999,.37]], fedMFJ:[[0,20550,.10],[20550,83550,.12],[83550,178150,.22],[178150,340100,.24],[340100,431900,.32],[431900,647850,.35],[647850,9999999,.37]], stdSingle:12950, stdMFJ:25900, ssRate:6.2, ssCap:147000, medRate:1.45, k401Lim:20500, hsaLimit:7300 },
  "2023": { fedSingle:[[0,11000,.10],[11000,44725,.12],[44725,95375,.22],[95375,182100,.24],[182100,231250,.32],[231250,578125,.35],[578125,9999999,.37]], fedMFJ:[[0,22000,.10],[22000,89450,.12],[89450,190750,.22],[190750,364200,.24],[364200,462500,.32],[462500,693750,.35],[693750,9999999,.37]], stdSingle:13850, stdMFJ:27700, ssRate:6.2, ssCap:160200, medRate:1.45, k401Lim:22500, hsaLimit:7750 },
  "2024": { fedSingle:[[0,11600,.10],[11600,47150,.12],[47150,100525,.22],[100525,191950,.24],[191950,243725,.32],[243725,609350,.35],[609350,9999999,.37]], fedMFJ:[[0,23200,.10],[23200,94300,.12],[94300,201050,.22],[201050,383900,.24],[383900,487450,.32],[487450,731200,.35],[731200,9999999,.37]], stdSingle:14600, stdMFJ:29200, ssRate:6.2, ssCap:168600, medRate:1.45, k401Lim:23000, hsaLimit:8300 },
  "2025": { fedSingle:[[0,11925,.10],[11925,48475,.12],[48475,103350,.22],[103350,197300,.24],[197300,250525,.32],[250525,626350,.35],[626350,9999999,.37]], fedMFJ:[[0,23850,.10],[23850,96950,.12],[96950,206700,.22],[206700,394600,.24],[394600,501050,.32],[501050,751600,.35],[751600,9999999,.37]], stdSingle:15000, stdMFJ:30000, ssRate:6.2, ssCap:176100, medRate:1.45, k401Lim:23500, hsaLimit:8550 },
  "2026": { fedSingle:[[0,12400,.10],[12400,50400,.12],[50400,105700,.22],[105700,201775,.24],[201775,256225,.32],[256225,640600,.35],[640600,9999999,.37]], fedMFJ:[[0,24800,.10],[24800,100800,.12],[100800,211400,.22],[211400,403550,.24],[403550,512450,.32],[512450,768700,.35],[768700,9999999,.37]], stdSingle:16100, stdMFJ:32200, ssRate:6.2, ssCap:184500, medRate:1.45, k401Lim:24500, hsaLimit:8300 },
};

const DEF_TAX = {
  year: "2026",
  ...TAX_DB["2026"],
  coRate: 4.4, coFamli: 0.45,
  stateName: "Colorado", stateAbbr: "CO",
  stateTaxes: [
    { name: "State Withholding", rate: 4.4, onTaxable: true },
    { name: "FAMLI", rate: 0.45, onTaxable: false },
  ],
  k401Lim: 24500,
  matchTiers: [{ upTo: 4, rate: 1 }, { upTo: 6, rate: 0.5 }],
  matchBase: 6,
  hsaLimit: 8300, hsaEmployerMatch: 0,
};
const DEF_CATS = ["Automotive","Clothing","Entertainment","Fees","Fun Money","General","Groceries","Healthcare","Housing","Internet","Personal Care","Pet Care","Phone","Restaurants","Student Loans","Taxes","Utilities"];
const DEF_PRE = [{n:"Medical",c:"0",k:"0"},{n:"Dental",c:"0",k:"0"},{n:"Vision",c:"0",k:"0"},{n:"HSA",c:"0",k:"0"}];
const DEF_POST = [{n:"Identity Protection",c:"0",k:"0"},{n:"Legal",c:"0",k:"0"},{n:"Group Life Insurance",c:"0",k:"0"}];

function calcMatch(empPct, tiers, base) {
  let match = base, remaining = empPct, prev = 0;
  for (const tier of tiers) { const band = tier.upTo - prev; const used = Math.min(Math.max(remaining, 0), band); match += used * tier.rate; remaining -= used; prev = tier.upTo; if (remaining <= 0) break; }
  return match;
}
function calcFed(ti, br) { let t = 0; for (const [mn, mx, r] of br) { if (ti <= mn) break; t += (Math.min(ti, mx) - mn) * r; } return t; }
function getMarg(ti, br) { for (let i = br.length - 1; i >= 0; i--) if (ti > br[i][0]) return br[i][2]; return .10; }

/* ── Period conversion: convert entered value to WEEKLY ── */
function toWk(val, p) {
  const v = evalF(val);
  if (p === "m") return v * 12 / 48; // monthly to weekly: monthly*12months/48paychecks
  if (p === "y") return v / 48;       // yearly to weekly: yearly/48paychecks
  return v;
}
/* Convert weekly to display period */
function fromWk(wk, p) {
  if (p === "m") return wk * 48 / 12;
  if (p === "y") return wk * 48;
  return wk;
}

const fmt = n => (Math.round((n || 0) * 100) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fp = n => `${(n * 100).toFixed(2)}%`;
const p2 = n => `${(+n).toFixed(2)}%`;
const pctOf = (part, total) => total > 0 ? `${(part / total * 100).toFixed(1)}%` : "0%";

function useM(bp = 700) { const [m, s] = useState(window.innerWidth < bp); useEffect(() => { const h = () => s(window.innerWidth < bp); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [bp]); return m; }

/* ── Shared UI components (OUTSIDE App to prevent re-mount) ── */
const Card = ({ children, style, dark }) => <div style={{ background: dark ? "linear-gradient(135deg,#1a1a1a,#2d2d2d)" : "var(--card-bg, #fff)", borderRadius: 14, padding: 24, boxShadow: dark ? "none" : "var(--shadow, 0 1px 4px rgba(0,0,0,.06))", color: dark ? "#fff" : "var(--card-color, #222)", ...style }}>{children}</div>;
const SH = ({ children, color }) => <div style={{ fontSize: 11, fontWeight: 700, color: color || "#999", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 24, marginBottom: 8 }}>{children}</div>;
const CSH = ({ children, color, collapsed, onToggle }) => <div onClick={onToggle} style={{ fontSize: 11, fontWeight: 700, color: color || "#999", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 24, marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}><span style={{ fontSize: 14, transition: "transform 0.2s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>{children}</div>;

/* Text input — local state while typing, syncs to parent ONLY on blur to prevent re-render focus loss */
function NI({ value, onChange, prefix, style, onBlurResolve, formula }) {
  const [local, setLocal] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!focused) setLocal(String(value)); }, [value, focused]);
  return (
    <div style={{ display: "flex", alignItems: "center", border: focused ? "2px solid #556FB5" : "2px solid #e0e0e0", borderRadius: 8, overflow: "hidden", background: "var(--input-bg, #fafafa)", position: "relative", ...style }}
      title={formula && formula !== String(value) ? `Formula: ${formula}` : undefined}>
      {prefix && <span style={{ padding: "0 0 0 8px", color: "#999", fontWeight: 600, fontSize: 13 }}>{prefix}</span>}
      <input ref={ref} value={local}
        onFocus={() => setFocused(true)}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          setFocused(false);
          if (onBlurResolve) {
            const raw = local;
            const resolved = resolveFormula(local);
            setLocal(resolved);
            onChange(resolved, raw);
          } else {
            onChange(local, local);
          }
        }}
        onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
        style={{ flex: 1, border: "none", outline: "none", padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "transparent", width: "100%" }} />
      
    </div>
  );
}

function PI({ value, onChange }) {
  const [local, setLocal] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!focused) setLocal(String(value)); }, [value, focused]);
  return (
    <div style={{ display: "flex", alignItems: "center", border: focused ? "2px solid #556FB5" : "2px solid #e0e0e0", borderRadius: 8, overflow: "hidden", background: "#fafafa" }}>
      <input ref={ref} type="number" step="0.01" value={local}
        onFocus={() => setFocused(true)}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { setFocused(false); onChange(local); }}
        onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
        style={{ flex: 1, border: "none", outline: "none", padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "transparent", width: "100%", textAlign: "right" }} />
      <span style={{ padding: "0 8px 0 2px", color: "#999", fontWeight: 600, fontSize: 13 }}>%</span>
    </div>
  );
}

function EditTxt({ value, onChange, color }) {
  const [ed, setEd] = useState(false);
  const [local, setLocal] = useState(value);
  useEffect(() => { if (!ed) setLocal(value); }, [value, ed]);
  return ed
    ? <input autoFocus value={local} onChange={e => setLocal(e.target.value)} onBlur={() => { onChange(local); setEd(false); }} onKeyDown={e => { if (e.key === "Enter") { onChange(local); setEd(false); } }} style={{ flex: 1, border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px", fontSize: 12, fontFamily: "'DM Sans',sans-serif", minWidth: 0 }} />
    : <span onClick={() => setEd(true)} style={{ flex: 1, cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, color: color || "inherit" }} title="Click to rename">{value}</span>;
}

const Row = ({ label, wk, mo, y48, y52, color, bold, border, sub }) => {
  const mob = window.innerWidth < 700;
  return (
  <div style={{ display: "grid", gridTemplateColumns: mob ? "1.8fr 1fr 1fr" : "2.4fr 1fr 1fr 1fr 1fr", gap: mob ? 4 : 6, padding: "6px 0", alignItems: "center", borderTop: border ? "2px solid var(--bdr2, #e0ddd8)" : "none", fontWeight: bold ? 700 : 400 }}>
    <div style={{ fontSize: mob ? 11 : 13, color: color || "var(--tx, #333)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}{sub && <span style={{ fontSize: 10, color: "var(--tx3, #999)", marginLeft: 4 }}>({sub})</span>}</div>
    <div style={{ fontSize: mob ? 11 : 13, textAlign: "right", color: color || "var(--tx, #333)" }}>{fmt(wk)}</div>
    {!mob && <div style={{ fontSize: 13, textAlign: "right", color: color || "var(--tx, #333)" }}>{fmt(mo)}</div>}
    <div style={{ fontSize: mob ? 11 : 13, textAlign: "right", color: color || "var(--tx, #333)" }}>{fmt(y48)}</div>
    {!mob && <div style={{ fontSize: 13, textAlign: "right", color: color || "var(--tx3, #888)" }}>{fmt(y52)}</div>}
  </div>
  );
};

/* ── Expense Row — click any period column to edit in that period ── */
function ExpRowInner({ item, cats, onUpdate, onRemove }) {
  const [eN, sEN] = useState(false);
  const [localName, setLocalName] = useState(item.n);
  const [editPer, setEditPer] = useState(null);
  useEffect(() => { if (!eN) setLocalName(item.n); }, [item.n, eN]);
  const isN = item.t === "N";
  const wk = item.wk;
  const moV = wk * 48 / 12, y48V = wk * 48;
  const valFor = p => p === "w" ? wk : p === "m" ? moV : y48V;
  const saveVal = (v, raw, per) => {
    // Convert entered value in `per` to item's stored period
    const num = evalF(v);
    let toStored;
    const sp = item.p; // stored period - don't change it
    if (per === sp) { toStored = v; }
    else if (per === "w") { toStored = String(Math.round((sp === "m" ? num * 48 / 12 : num * 48) * 100) / 100); }
    else if (per === "m") { toStored = String(Math.round((sp === "w" ? num * 12 / 48 : num * 12) * 100) / 100); }
    else { /* per === "y" */ toStored = String(Math.round((sp === "w" ? num / 48 : num / 12) * 100) / 100); }
    onUpdate({ v: toStored });
    setEditPer(null);
  };
  const mob = window.innerWidth < 700;
  return (
    <div style={{ display: "grid", gridTemplateColumns: mob ? "1.8fr 1fr 1fr 20px" : "2.4fr 1fr 1fr 1fr 1fr 24px", gap: mob ? 4 : 6, padding: "4px 0", alignItems: "center", background: item.hl ? "rgba(232,87,58,0.08)" : "transparent", borderRadius: item.hl ? 4 : 0 }}>
      <div style={{ fontSize: mob ? 11 : 13, color: "var(--tx2, #555)", display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <button onClick={() => onUpdate({ t: isN ? "D" : "N" })} title={isN ? "→ Discretionary" : "→ Necessity"}
          style={{ fontSize: mob ? 8 : 10, color: "#fff", fontWeight: 700, border: "none", borderRadius: 5, padding: mob ? "2px 5px" : "3px 7px", background: isN ? "#556FB5" : "#E8573A", cursor: "pointer", flexShrink: 0 }}>{isN ? "NEC" : "DIS"}</button>
        {eN
          ? <input autoFocus value={localName} onChange={e => setLocalName(e.target.value)} onBlur={() => { onUpdate({ n: localName }); sEN(false); }} onKeyDown={e => { if (e.key === "Enter") { onUpdate({ n: localName }); sEN(false); } }} style={{ flex: 1, border: "1px solid var(--input-border,#ddd)", borderRadius: 4, padding: "2px 4px", fontSize: 11, fontFamily: "'DM Sans',sans-serif", minWidth: 0 }} />
          : <span onClick={() => sEN(true)} style={{ flex: 1, cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, fontSize: mob ? 11 : 13 }} title="Click to rename">{item.n}</span>}
        {!mob && <select className="cat-dd" value={item.c} onChange={e => onUpdate({ c: e.target.value })} style={{ flexShrink: 0, fontSize: 12 }}>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>}
      </div>
      {(mob ? ["w", "y"] : ["w", "m", "y"]).map(per => {
        if (editPer === per) {
          const editVal = per === item.p ? item.v : String(Math.round(valFor(per) * 100) / 100);
          return <div key={per}><NI value={editVal} onChange={(v, raw) => { saveVal(v, raw, per); }} onBlurResolve prefix="$" style={{ height: 28 }} /></div>;
        }
        return <div key={per} onClick={() => setEditPer(per)} style={{ fontSize: mob ? 11 : 12, textAlign: "right", color: "var(--tx2,#555)", cursor: "text", padding: "4px 2px", borderRadius: 4 }}>{fmt(valFor(per))}</div>;
      })}
      {!mob && <div style={{ fontSize: 12, textAlign: "right", color: "var(--tx3,#888)" }}>{fmt(y48V)}</div>}
      <button onClick={onRemove} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--tx3,#ccc)", padding: 0 }}>×</button>
    </div>
  );
}

function SavRowInner({ item, savCats, onUpdate, onRemove }) {
  const [editPer, setEditPer] = useState(null);
  const wk = item.wk;
  const moV = wk * 48 / 12, y48V = wk * 48, y52V = wk * 52;
  const valFor = p => p === "w" ? wk : p === "m" ? moV : y48V;
  const saveVal = (v, raw, per) => {
    const num = evalF(v);
    let toStored;
    const sp = item.p;
    if (per === sp) { toStored = v; }
    else if (per === "w") { toStored = String(Math.round((sp === "m" ? num * 48 / 12 : num * 48) * 100) / 100); }
    else if (per === "m") { toStored = String(Math.round((sp === "w" ? num * 12 / 48 : num * 12) * 100) / 100); }
    else { toStored = String(Math.round((sp === "w" ? num / 48 : num / 12) * 100) / 100); }
    onUpdate({ v: toStored });
    setEditPer(null);
  };
  const mob = window.innerWidth < 700;
  return (
    <div style={{ display: "grid", gridTemplateColumns: mob ? "1.8fr 1fr 1fr 20px" : "2.4fr 1fr 1fr 1fr 1fr 24px", gap: mob ? 4 : 6, padding: "4px 0", alignItems: "center", background: item.hl ? "rgba(46,204,113,0.08)" : "transparent", borderRadius: item.hl ? 4 : 0 }}>
      <div style={{ fontSize: mob ? 11 : 13, color: "#2ECC71", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <EditTxt value={item.n} onChange={n => onUpdate({ n })} color="#2ECC71" />
        {!mob && <select className="cat-dd" value={item.c || ""} onChange={e => onUpdate({ c: e.target.value })} style={{ flexShrink: 0, fontSize: 12 }}>
          {(savCats || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>}
      </div>
      {(mob ? ["w", "y"] : ["w", "m", "y"]).map(per => {
        if (editPer === per) {
          const editVal = per === item.p ? item.v : String(Math.round(valFor(per) * 100) / 100);
          return <div key={per}><NI value={editVal} onChange={(v, raw) => { saveVal(v, raw, per); }} onBlurResolve prefix="$" style={{ height: 28 }} /></div>;
        }
        return <div key={per} onClick={() => setEditPer(per)} style={{ fontSize: mob ? 11 : 12, textAlign: "right", color: "var(--tx2,#555)", cursor: "text", padding: "4px 2px", borderRadius: 4 }}>{fmt(valFor(per))}</div>;
      })}
      {!mob && <div style={{ fontSize: 12, textAlign: "right", color: "var(--tx3,#888)" }}>{fmt(y52V)}</div>}
      <button onClick={onRemove} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--tx3,#ccc)", padding: 0 }}>×</button>
    </div>
  );
}

const DEF_EXP = [
  {n:"Car Insurance",c:"Automotive",t:"N",v:"0",p:"m"},{n:"Gas",c:"Automotive",t:"N",v:"0",p:"m"},
  {n:"Corey Car",c:"Automotive",t:"N",v:"0",p:"m"},{n:"Corey Car Registration",c:"Automotive",t:"N",v:"0",p:"m"},
  {n:"Corey Car Maintenance",c:"Automotive",t:"N",v:"0",p:"m"},{n:"Kelly Car",c:"Automotive",t:"N",v:"0",p:"m"},
  {n:"Kelly Car Registration",c:"Automotive",t:"N",v:"0",p:"m"},{n:"Kelly Car Maintenance",c:"Automotive",t:"N",v:"0",p:"m"},
  {n:"Clothing/Shoes",c:"Clothing",t:"N",v:"0",p:"m"},{n:"Credit Card Fees",c:"Fees",t:"D",v:"0",p:"m"},
  {n:"Netflix",c:"Entertainment",t:"D",v:"0",p:"m"},{n:"Disney+",c:"Entertainment",t:"D",v:"0",p:"m"},
  {n:"Hulu",c:"Entertainment",t:"D",v:"0",p:"m"},{n:"Spotify",c:"Entertainment",t:"D",v:"0",p:"m"},
  {n:"Disney",c:"Entertainment",t:"D",v:"0",p:"m"},{n:"Public Activities",c:"Entertainment",t:"D",v:"0",p:"m"},
  {n:"Audible",c:"Entertainment",t:"D",v:"0",p:"m"},{n:"Corey Fun Money",c:"Fun Money",t:"D",v:"0",p:"m"},
  {n:"Kelly Fun Money",c:"Fun Money",t:"D",v:"0",p:"m"},{n:"Misc",c:"General",t:"D",v:"0",p:"m"},
  {n:"Food/Groceries",c:"Groceries",t:"N",v:"0",p:"m"},{n:"Corey Medical",c:"Healthcare",t:"N",v:"0",p:"m"},
  {n:"Kelly Medical",c:"Healthcare",t:"N",v:"0",p:"m"},{n:"Mortgage P&I",c:"Housing",t:"N",v:"0",p:"m"},
  {n:"HOA Fee",c:"Housing",t:"N",v:"0",p:"m"},{n:"Escrow",c:"Housing",t:"N",v:"0",p:"m"},
  {n:"Quantum Fiber",c:"Internet",t:"N",v:"0",p:"m"},{n:"Corey Gym",c:"Personal Care",t:"D",v:"0",p:"m"},
  {n:"Kelly Gym",c:"Personal Care",t:"D",v:"0",p:"m"},{n:"Kelly Waxes",c:"Personal Care",t:"D",v:"0",p:"m"},
  {n:"Haircuts",c:"Personal Care",t:"N",v:"0",p:"m"},{n:"Pet Care",c:"Pet Care",t:"N",v:"0",p:"m"},
  {n:"AT&T",c:"Phone",t:"N",v:"0",p:"m"},{n:"Apple Fees",c:"Phone",t:"D",v:"0",p:"m"},
  {n:"Eating Out",c:"Restaurants",t:"D",v:"0",p:"m"},{n:"SOFI Loan",c:"Student Loans",t:"N",v:"0",p:"m"},
  {n:"Great Lakes Loan",c:"Student Loans",t:"N",v:"0",p:"m"},{n:"CPA",c:"Taxes",t:"N",v:"0",p:"m"},
  {n:"Core Electric",c:"Utilities",t:"N",v:"0",p:"m"},{n:"Black Hills Energy",c:"Utilities",t:"N",v:"0",p:"m"},
  {n:"Castle Rock Water",c:"Utilities",t:"N",v:"0",p:"m"},
];
const DEF_SAV_CATS = ["Emergency","Short-Term","Long-Term","Retirement","Travel","Home","Education","Other"];
const DEF_SAV = [{n:"House Fund",v:"0",p:"m",c:"Home"},{n:"Emergency Fund",v:"0",p:"m",c:"Emergency"},{n:"Washing Machine",v:"0",p:"m",c:"Home"},{n:"Destination Unknown",v:"0",p:"m",c:"Travel"},{n:"Temporary",v:"0",p:"m",c:"Other"}];

/* ══════════════════════════ MAIN APP ══════════════════════════ */
export default function App() {
  const mob = useM();
  const [tab, setTab] = useState("budget");
  const [darkMode, setDarkMode] = useState(false);
  const [appTitle, setAppTitle] = useState("Budget Manager");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [tax, setTax] = useState(DEF_TAX);
  const upTax = (k, v) => setTax(p => ({ ...p, [k]: v }));
  const [fetchStatus, setFetchStatus] = useState("");
  const [showTaxPaste, setShowTaxPaste] = useState(false);
  const [taxPaste, setTaxPaste] = useState("");
  const [customTaxDB, setCustomTaxDB] = useState({});
  const allTaxDB = { ...TAX_DB, ...customTaxDB };
  const loadTaxYear = (yr) => {
    const rates = allTaxDB[yr];
    if (!rates) { setFetchStatus("❌ No data for " + yr); return; }
    setTax(prev => ({ ...prev, year: yr, ...rates, coRate: prev.coRate, coFamli: prev.coFamli, stateName: prev.stateName, stateAbbr: prev.stateAbbr, stateTaxes: prev.stateTaxes, matchTiers: prev.matchTiers, matchBase: prev.matchBase, hsaEmployerMatch: prev.hsaEmployerMatch }));
    setFetchStatus("✅ Loaded " + yr + " federal rates.");
  };
  const addTaxYear = (json) => {
    try {
      const parsed = JSON.parse(json.replace(/```json|```/g, "").trim());
      if (!parsed.year || !parsed.fedSingle || !parsed.fedMFJ) { setFetchStatus("❌ JSON must include year, fedSingle, fedMFJ."); return; }
      const yr = String(parsed.year);
      const entry = { fedSingle: parsed.fedSingle, fedMFJ: parsed.fedMFJ, stdSingle: parsed.stdSingle, stdMFJ: parsed.stdMFJ, ssRate: parsed.ssRate, ssCap: parsed.ssCap, medRate: parsed.medRate, k401Lim: parsed.k401Lim, hsaLimit: parsed.hsaLimit };
      setCustomTaxDB(prev => ({ ...prev, [yr]: entry }));
      setTax(prev => ({ ...prev, year: yr, ...entry, coRate: prev.coRate, coFamli: prev.coFamli, stateName: prev.stateName, stateAbbr: prev.stateAbbr, stateTaxes: prev.stateTaxes, matchTiers: prev.matchTiers, matchBase: prev.matchBase, hsaEmployerMatch: prev.hsaEmployerMatch }));
      setFetchStatus("✅ Added & loaded " + yr + " rates!");
      setTaxPaste(""); setShowTaxPaste(false);
    } catch (e) { setFetchStatus("❌ Invalid JSON: " + e.message); }
  };
  const [cSal, setCS] = useState("0"); const [kSal, setKS] = useState("0");
  const [p1Name, setP1Name] = useState("Corey"); const [p2Name, setP2Name] = useState("Kelly");
  const [fil, setFil] = useState("mfj");
  const [cEaip, setCE] = useState("8"); const [kEaip, setKE] = useState("5");
  const [preDed, setPreDed] = useState(DEF_PRE);
  const [postDed, setPostDed] = useState(DEF_POST);
  const [c4pre, setC4pre] = useState("8"); const [c4ro, setC4ro] = useState("0");
  const [k4pre, setK4pre] = useState("8"); const [k4ro, setK4ro] = useState("0");
  const [cHsaAnn, setCHsaAnn] = useState("0"); const [kHsaAnn, setKHsaAnn] = useState("0");
  const [exp, setExp] = useState(DEF_EXP);
  const [sav, setSav] = useState(DEF_SAV);
  const [cats, setCats] = useState(DEF_CATS);
  const [savCats, setSavCats] = useState(DEF_SAV_CATS);
  const [newCat, setNewCat] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [sortDir, setSortDir] = useState("desc");
  const [hlThresh, setHlThresh] = useState("200");
  const [hlPeriod, setHlPeriod] = useState("w"); // w, m, y
  const [niN, setNiN] = useState(""); const [niC, setNiC] = useState(DEF_CATS[0]);
  const [niT, setNiT] = useState("N"); const [niS, setNiS] = useState("exp"); const [niP, setNiP] = useState("m"); const [niV, setNiV] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [customIcon, setCustomIcon] = useState(null);
  const [bannerOpen, setBannerOpen] = useState(!window.innerWidth || window.innerWidth >= 700);
  const [showPerPerson, setShowPerPerson] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapLabel, setSnapLabel] = useState("");
  const [editSnapIdx, setEditSnapIdx] = useState(null);
  const [restoreConfirm, setRestoreConfirm] = useState(null);
  const [itemHistoryName, setItemHistoryName] = useState("");
  const [viewingSnap, setViewingSnap] = useState(null); // snapshot index being viewed
  const [savRateBase, setSavRateBase] = useState("net"); // "net" or "gross"
  const [collapsed, setCollapsed] = useState({});
  const toggleSec = s => setCollapsed(p => ({ ...p, [s]: !p[s] }));
  const allExpanded = !collapsed.nec && !collapsed.dis && !collapsed.sav && !collapsed.preTax && !collapsed.postTax && !collapsed.fedTax && !collapsed.stTax && !collapsed.preSav && !collapsed.eaip && !collapsed.eaipTax;
  const toggleAll = () => { const v = allExpanded; setCollapsed({ nec: v, dis: v, sav: v, preTax: v, postTax: v, fedTax: v, stTax: v, preSav: v, eaip: v, eaipTax: v }); };
  const [includeEaip, setIncludeEaip] = useState(false);

  // Load
  useEffect(() => { (async () => { try { const r = await fetch("/api/state").then(r => r.json()); if (r?.state) { const d = r.state; const m = { cSal:setCS,kSal:setKS,fil:setFil,cEaip:setCE,kEaip:setKE,preDed:setPreDed,postDed:setPostDed,c4pre:setC4pre,c4ro:setC4ro,k4pre:setK4pre,k4ro:setK4ro,cHsaAnn:setCHsaAnn,kHsaAnn:setKHsaAnn,exp:setExp,sav:setSav,cats:setCats,savCats:setSavCats,tax:setTax,sortBy:setSortBy,sortDir:setSortDir,hlThresh:setHlThresh,appTitle:setAppTitle,darkMode:setDarkMode,customIcon:setCustomIcon,customTaxDB:setCustomTaxDB,snapshots:setSnapshots }; Object.entries(d).forEach(([k,v])=>{if(m[k])m[k](v)}); } } catch(e){} setLoaded(true); })(); }, []);
  const st = useMemo(() => ({cSal,kSal,fil,cEaip,kEaip,preDed,postDed,c4pre,c4ro,k4pre,k4ro,cHsaAnn,kHsaAnn,exp,sav,cats,savCats,tax,sortBy,sortDir,hlThresh,appTitle,darkMode,customIcon,customTaxDB,snapshots}), [cSal,kSal,fil,cEaip,kEaip,preDed,postDed,c4pre,c4ro,k4pre,k4ro,cHsaAnn,kHsaAnn,exp,sav,cats,savCats,tax,sortBy,sortDir,hlThresh,appTitle,darkMode,customIcon,customTaxDB,snapshots]);
  useEffect(() => { const t = setTimeout(async () => { try { await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: st }) }); } catch(e){} }, 600); return () => clearTimeout(t); }, [st]);

  // HSA: auto-populate the HSA pre-tax deduction from annual amounts — ONLY if annual is non-zero
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded) return; // don't run until persistence has loaded
    const cAnn = evalF(cHsaAnn);
    const kAnn = evalF(kHsaAnn);
    if (cAnn === 0 && kAnn === 0) return; // don't overwrite manual entries with zeros
    const cW = cAnn / 52;
    const kW = kAnn / 52;
    const hsaIdx = preDed.findIndex(d => d.n.toLowerCase().includes("hsa"));
    if (hsaIdx >= 0) {
      const n = [...preDed]; n[hsaIdx] = { ...n[hsaIdx], c: String(Math.round(cW * 100) / 100), k: String(Math.round(kW * 100) / 100) }; setPreDed(n);
    }
  }, [cHsaAnn, kHsaAnn, loaded]);

  /* ── Tax calculations ── */
  const C = useMemo(() => {
    const cs = evalF(cSal), ks = evalF(kSal), cw = cs / 52, kw = ks / 52;
    const cPreW = preDed.reduce((s, d) => s + evalF(d.c), 0);
    const kPreW = preDed.reduce((s, d) => s + evalF(d.k), 0);
    const cPrePct = Math.min(evalF(c4pre) / 100, tax.k401Lim / Math.max(cs, 1));
    const cRoPct = Math.min(evalF(c4ro) / 100, (tax.k401Lim - cs * cPrePct) / Math.max(cs, 1));
    const kPrePct = Math.min(evalF(k4pre) / 100, tax.k401Lim / Math.max(ks, 1));
    const kRoPct = Math.min(evalF(k4ro) / 100, (tax.k401Lim - ks * kPrePct) / Math.max(ks, 1));
    const c4preW = cs * cPrePct / 52, c4roW = cs * cRoPct / 52;
    const k4preW = ks * kPrePct / 52, k4roW = ks * kRoPct / 52;
    const c4w = c4preW + c4roW, k4w = k4preW + k4roW;
    const cTxW = cw - cPreW - c4preW, kTxW = kw - kPreW - k4preW;
    const combTxA = (cTxW + kTxW) * 52;
    const br = fil === "mfj" ? tax.fedMFJ : tax.fedSingle;
    const sd = fil === "mfj" ? tax.stdMFJ : tax.stdSingle;
    const fTax = fil === "mfj" ? calcFed(Math.max(0, combTxA - sd), br) : calcFed(Math.max(0, cTxW * 52 - tax.stdSingle), tax.fedSingle) + calcFed(Math.max(0, kTxW * 52 - tax.stdSingle), tax.fedSingle);
    const mr = getMarg(Math.max(0, combTxA - sd), br);
    const tot = cTxW + kTxW, cr = tot > 0 ? cTxW / tot : .5;
    const cFed = (fTax / 52) * cr, kFed = (fTax / 52) * (1 - cr);
    const ssR = tax.ssRate / 100, medR = tax.medRate / 100, coR = tax.coRate / 100, flR = tax.coFamli / 100;
    const cSS = Math.min(cw, tax.ssCap / 52) * ssR, kSS = Math.min(kw, tax.ssCap / 52) * ssR;
    const cMc = cw * medR, kMc = kw * medR;
    const cCO = cTxW * coR, kCO = kTxW * coR;
    const cFL = cw * flR, kFL = kw * flR;
    const cTx = cFed + cSS + cMc + cCO + cFL, kTx = kFed + kSS + kMc + kCO + kFL;
    const cPostW = c4roW + postDed.reduce((s, d) => s + evalF(d.c), 0);
    const kPostW = k4roW + postDed.reduce((s, d) => s + evalF(d.k), 0);
    const cNet = cw - cPreW - c4w - cTx - postDed.reduce((s, d) => s + evalF(d.c), 0);
    const kNet = kw - kPreW - k4w - kTx - postDed.reduce((s, d) => s + evalF(d.k), 0);
    const cTotalPct = evalF(c4pre) + evalF(c4ro), kTotalPct = evalF(k4pre) + evalF(k4ro);
    const cMP = calcMatch(cTotalPct, tax.matchTiers || [], tax.matchBase || 0);
    const kMP = calcMatch(kTotalPct, tax.matchTiers || [], tax.matchBase || 0);
    // EAIP — annual bonus, taxed at marginal rates
    const cEaipGross = cs * (evalF(cEaip) / 100);
    const kEaipGross = ks * (evalF(kEaip) / 100);
    const eaipGross = cEaipGross + kEaipGross;
    // EAIP taxes: fed marginal, SS (if under cap), Medicare, state, FAMLI
    const cEaipFed = cEaipGross * mr;
    const kEaipFed = kEaipGross * mr;
    const cEaipSS = Math.max(0, Math.min(cEaipGross, Math.max(0, tax.ssCap - cs))) * ssR;
    const kEaipSS = Math.max(0, Math.min(kEaipGross, Math.max(0, tax.ssCap - ks))) * ssR;
    const cEaipMc = cEaipGross * medR, kEaipMc = kEaipGross * medR;
    const cEaipSt = cEaipGross * coR, kEaipSt = kEaipGross * coR;
    const cEaipFL = cEaipGross * flR, kEaipFL = kEaipGross * flR;
    const cEaipTax = cEaipFed + cEaipSS + cEaipMc + cEaipSt + cEaipFL;
    const kEaipTax = kEaipFed + kEaipSS + kEaipMc + kEaipSt + kEaipFL;
    const cEaipNet = cEaipGross - cEaipTax, kEaipNet = kEaipGross - kEaipTax;
    const eaipNet = cEaipNet + kEaipNet;
    return { cs, ks, cw, kw, cPreW, kPreW, c4w, k4w, c4preW, k4preW, c4roW, k4roW, cTxW, kTxW, fTax, mr, sd, cFed, kFed, cSS, kSS, cMc, kMc, cCO, kCO, cFL, kFL, cTx, kTx, cPostW, kPostW, cNet, kNet, net: cNet + kNet, cMP, kMP, ssR, medR, coR, flR, eaipGross, eaipNet, cEaipGross, kEaipGross, cEaipNet, kEaipNet, cEaipTax, kEaipTax, cEaipFed, kEaipFed, cEaipSS, kEaipSS, cEaipMc, kEaipMc, cEaipSt, kEaipSt, cEaipFL, kEaipFL };
  }, [cSal, kSal, fil, preDed, postDed, c4pre, c4ro, k4pre, k4ro, tax, cEaip, kEaip]);

  const moC = v => v * 48 / 12, y4 = v => v * 48, y5 = v => v * 52;
  const hlW = evalF(hlThresh);
  const hlWk = hlPeriod === "m" ? hlW * 12 / 48 : hlPeriod === "y" ? hlW / 48 : hlW; // convert threshold to weekly for comparison

  const applySort = items => {
    const s = [...items];
    if (sortBy === "amount") s.sort((a, b) => sortDir === "desc" ? b.wk - a.wk : a.wk - b.wk);
    else if (sortBy === "category") s.sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n));
    return s;
  };
  const ewk = useMemo(() => exp.map((e, i) => ({ ...e, idx: i, wk: toWk(e.v, e.p), hl: toWk(e.v, e.p) > hlWk && hlWk > 0 })), [exp, hlW]);
  const necI = useMemo(() => applySort(ewk.filter(e => e.t === "N")), [ewk, sortBy, sortDir]);
  const disI = useMemo(() => applySort(ewk.filter(e => e.t === "D")), [ewk, sortBy, sortDir]);
  const savSorted = useMemo(() => { const items = sav.map((s, i) => ({ ...s, idx: i, wk: toWk(s.v, s.p), hl: toWk(s.v, s.p) > hlWk && hlWk > 0 })); if (sortBy === "amount") items.sort((a, b) => sortDir === "desc" ? b.wk - a.wk : a.wk - b.wk); return items; }, [sav, sortBy, sortDir, hlW]);

  const tNW = necI.reduce((s, e) => s + e.wk, 0), tDW = disI.reduce((s, e) => s + e.wk, 0);
  const tExpW = tNW + tDW, tSavW = savSorted.reduce((s, e) => s + e.wk, 0);
  const remW = C.net - tExpW - tSavW;
  const remY48 = C.net * 48 - tExpW * 48 - tSavW * 48;
  const remY52 = C.net * 52 - tExpW * 48 - tSavW * 52; // expenses stay at 48-wk annual, income & savings get 52
  const totalSavPlusRemW = tSavW + Math.max(0, remW); // remaining adds to savings

  const budgetTotal = (savRateBase === "gross" ? (C.cw + C.kw) * 48 : C.net * 48) + (includeEaip ? (savRateBase === "gross" ? C.eaipGross : C.eaipNet) : 0);
  const allocatedTotal = (tExpW + tSavW) * 48;
  const unallocatedPct = budgetTotal > 0 ? ((budgetTotal - allocatedTotal) / budgetTotal * 100).toFixed(1) : "0";

  const catTot = useMemo(() => { const m = {}; ewk.forEach(e => { if (e.wk > 0) m[e.c] = (m[e.c] || 0) + e.wk * 48; }); return Object.entries(m).map(([k, v], i) => ({ name: k, value: Math.round(v), _allValues: [budgetTotal], _base: budgetTotal, color: ["#E8573A", "#F2A93B", "#4ECDC4", "#556FB5", "#9B59B6", "#1ABC9C", "#E67E22", "#2ECC71", "#95A5A6", "#D35400", "#C0392B", "#3498DB"][i % 12] })); }, [ewk, budgetTotal]);

  const typTot = useMemo(() => {
    let n = 0, d = 0, s = 0;
    ewk.forEach(e => { e.t === "N" ? n += e.wk * 48 : d += e.wk * 48; });
    savSorted.forEach(e => s += e.wk * 48);
    s += Math.max(0, remW) * 48; // add remaining to savings
    if (includeEaip) s += C.eaipNet; // add EAIP to savings
    const base = savRateBase === "gross" ? (C.cw + C.kw) * 48 + (includeEaip ? C.eaipGross : 0) : C.net * 48 + (includeEaip ? C.eaipNet : 0);
    const vals = [n, d, s, Math.max(0, base - n - d - s)];
    return [
      { name: "Necessity", value: Math.round(n), _allValues: vals, color: "#556FB5" },
      { name: "Discretionary", value: Math.round(d), _allValues: vals, color: "#E8573A" },
      { name: "Savings" + (includeEaip ? " + EAIP" : ""), value: Math.round(s), _allValues: vals, color: "#2ECC71" },
    ].filter(x => x.value > 0);
  }, [ewk, savSorted, savRateBase, C, includeEaip, remW]);

  const updExp = useCallback((idx, updates) => { setExp(prev => { const n = [...prev]; n[idx] = { ...n[idx], ...updates }; return n; }); }, []);
  const updSav = useCallback((idx, updates) => { setSav(prev => { const n = [...prev]; n[idx] = { ...n[idx], ...updates }; return n; }); }, []);
  const rmExp = useCallback(idx => { setExp(prev => prev.filter((_, j) => j !== idx)); }, []);
  const rmSav = useCallback(idx => { setSav(prev => prev.filter((_, j) => j !== idx)); }, []);

  const BrEd = ({ brackets, onChange }) => (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px 20px", gap: 4, fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>From</span><span>To</span><span>Rate %</span><span /></div>
      {brackets.map((b, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px 20px", gap: 4, marginBottom: 2 }}>
          <input type="number" value={b[0]} onChange={e => { const n = [...brackets]; n[i] = [+e.target.value, n[i][1], n[i][2]]; onChange(n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }} />
          <input type="number" value={b[1] >= 9999999 ? "" : b[1]} placeholder="∞" onChange={e => { const n = [...brackets]; n[i] = [n[i][0], e.target.value === "" ? 9999999 : +e.target.value, n[i][2]]; onChange(n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }} />
          <input type="number" step="0.01" value={(b[2] * 100).toFixed(2)} onChange={e => { const n = [...brackets]; n[i] = [n[i][0], n[i][1], +e.target.value / 100]; onChange(n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }} />
          <button onClick={() => onChange(brackets.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
        </div>
      ))}
      <button onClick={() => { const l = brackets[brackets.length - 1]; onChange([...brackets, [l ? l[1] : 0, 9999999, .37]]); }} style={{ marginTop: 4, padding: "4px 12px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Bracket</button>
    </div>
  );

  const DedEditor = ({ items, setItems, label }) => (
    <Card>
      <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>{label} <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(weekly $)</span></h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 24px", gap: "6px 10px", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999" }}>Name</div>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>Corey</div>
        <div style={{ fontWeight: 700, fontSize: 11, color: "#999", textAlign: "center" }}>Kelly</div><div />
        {items.map((d, i) => [
          <div key={i + "n"}><EditTxt value={d.n} onChange={v => { const n = [...items]; n[i] = { ...n[i], n: v }; setItems(n); }} /></div>,
          <NI key={i + "c"} value={d.c} onChange={v => { const n = [...items]; n[i] = { ...n[i], c: v }; setItems(n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
          <NI key={i + "k"} value={d.k} onChange={v => { const n = [...items]; n[i] = { ...n[i], k: v }; setItems(n); }} onBlurResolve prefix="$" style={{ height: 32 }} />,
          <button key={i + "x"} onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
        ])}
      </div>
      <button onClick={() => setItems([...items, { n: "New Item", c: "0", k: "0" }])} style={{ marginTop: 8, padding: "5px 14px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Row</button>
    </Card>
  );

  /* Custom tooltip for pie charts showing amount + % */
  const PieTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0];
    const base = d.payload?._base;
    const allEntries = d.payload?._allValues;
    const sum = base || (allEntries ? allEntries.reduce((s, v) => s + v, 0) : d.value);
    const pct = sum > 0 ? (d.value / sum * 100).toFixed(1) : "0";
    return <div style={{ background: "var(--card-bg, #fff)", padding: "8px 12px", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.1)", fontSize: 12 }}><strong>{d.name}</strong>: {fmt(d.value)} ({pct}%)</div>;
  };

  const dk = darkMode === "dark" || darkMode === true;
  const waf = darkMode === "waf";
  const cycleTheme = () => setDarkMode(p => p === "light" || p === false ? "dark" : p === "dark" || p === true ? "waf" : "light");
  const bg = dk ? "#1e1e1e" : waf ? "#d5d0cb" : "linear-gradient(145deg,#f5f0eb 0%,#ede7e0 50%,#e8e2db 100%)";
  const headerBg = dk ? "#1a1a1a" : waf ? "#486b50" : "#1a1a1a";
  const tx = dk ? "#e8e8e8" : "#333";
  const tabAccent = waf ? "#c96b70" : "#E8573A";
  const ts = a => ({ padding: "10px 14px", border: "none", borderBottom: a ? `3px solid ${tabAccent}` : "3px solid transparent", background: "none", color: a ? tabAccent : "#aaa", fontFamily: "'DM Sans',sans-serif", fontWeight: a ? 700 : 500, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" });

  useEffect(() => {
    const r = document.documentElement;
    if (dk) {
      r.style.setProperty("--card-bg", "#2a2a2a"); r.style.setProperty("--card-color", "#e8e8e8");
      r.style.setProperty("--input-bg", "#333"); r.style.setProperty("--input-color", "#e8e8e8"); r.style.setProperty("--input-border", "#555");
      r.style.setProperty("--shadow", "none");
      r.style.setProperty("--tx", "#e8e8e8"); r.style.setProperty("--tx2", "#ccc"); r.style.setProperty("--tx3", "#999");
      r.style.setProperty("--bdr", "#444"); r.style.setProperty("--bdr2", "#3a3a3a");
      r.style.setProperty("--c-pretax", "#e07060"); r.style.setProperty("--c-presav", "#4DE8B8");
      r.style.setProperty("--c-fedtax", "#6CA6E0"); r.style.setProperty("--c-fedtax2", "#8AC0F0");
      r.style.setProperty("--c-sttax", "#D4A050"); r.style.setProperty("--c-sttax2", "#E0BB70");
      r.style.setProperty("--c-totaltax", "#F07060"); r.style.setProperty("--c-posttax", "#C89FE0");
      r.style.setProperty("--c-posttax2", "#D8B8F0");
      r.style.setProperty("--c-taxable", "#8CA8E0");
      r.style.setProperty("--c-nec", "#8CA8E0"); r.style.setProperty("--c-dis", "#F07060"); r.style.setProperty("--c-sav", "#50E898");
      r.style.setProperty("--c-eaip", "#C89FE0"); r.style.setProperty("--c-eaiptax", "#F07060");
    } else if (waf) {
      r.style.setProperty("--card-bg", "#e8e3de"); r.style.setProperty("--card-color", "#2d2d2d");
      r.style.setProperty("--input-bg", "#ddd8d3"); r.style.setProperty("--input-color", "#2d2d2d"); r.style.setProperty("--input-border", "#e0d5d0");
      r.style.setProperty("--shadow", "0 1px 4px rgba(80,60,50,.1),0 4px 12px rgba(80,60,50,.06)");
      r.style.setProperty("--tx", "#3d3d3d"); r.style.setProperty("--tx2", "#6b5c55"); r.style.setProperty("--tx3", "#a89890");
      r.style.setProperty("--bdr", "#e8ddd8"); r.style.setProperty("--bdr2", "#e0d5d0");
      r.style.setProperty("--c-pretax", "#c96b70"); r.style.setProperty("--c-presav", "#5a9e6f");
      r.style.setProperty("--c-fedtax", "#7b8fa8"); r.style.setProperty("--c-fedtax2", "#98adc0");
      r.style.setProperty("--c-sttax", "#b08860"); r.style.setProperty("--c-sttax2", "#c8a070");
      r.style.setProperty("--c-totaltax", "#c96b70"); r.style.setProperty("--c-posttax", "#9b7bb0");
      r.style.setProperty("--c-posttax2", "#b898c8");
      r.style.setProperty("--c-taxable", "#7b8fa8");
      r.style.setProperty("--c-nec", "#7b8fa8"); r.style.setProperty("--c-dis", "#c96b70"); r.style.setProperty("--c-sav", "#5a9e6f");
      r.style.setProperty("--c-eaip", "#9b7bb0"); r.style.setProperty("--c-eaiptax", "#c96b70");
    } else {
      r.style.setProperty("--card-bg", "#fff"); r.style.setProperty("--card-color", "#222");
      r.style.setProperty("--input-bg", "#fafafa"); r.style.setProperty("--input-color", "#222"); r.style.setProperty("--input-border", "#e0e0e0");
      r.style.setProperty("--shadow", "0 1px 4px rgba(0,0,0,.06),0 6px 20px rgba(0,0,0,.03)");
      r.style.setProperty("--tx", "#333"); r.style.setProperty("--tx2", "#555"); r.style.setProperty("--tx3", "#999");
      r.style.setProperty("--bdr", "#e0e0e0"); r.style.setProperty("--bdr2", "#e0ddd8");
      r.style.setProperty("--c-pretax", "#c0392b"); r.style.setProperty("--c-presav", "#1ABC9C");
      r.style.setProperty("--c-fedtax", "#1a5276"); r.style.setProperty("--c-fedtax2", "#3a7abf");
      r.style.setProperty("--c-sttax", "#8B4513"); r.style.setProperty("--c-sttax2", "#B8860B");
      r.style.setProperty("--c-totaltax", "#E8573A"); r.style.setProperty("--c-posttax", "#9B59B6");
      r.style.setProperty("--c-posttax2", "#C39BD3");
      r.style.setProperty("--c-taxable", "#556FB5");
      r.style.setProperty("--c-nec", "#556FB5"); r.style.setProperty("--c-dis", "#E8573A"); r.style.setProperty("--c-sav", "#2ECC71");
      r.style.setProperty("--c-eaip", "#9B59B6"); r.style.setProperty("--c-eaiptax", "#E8573A");
    }
  }, [dk, waf]);

  const iconRef = useRef(null);

  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "'DM Sans',sans-serif", color: tx }}>
      <style>{`
        html, body { overflow-x: hidden; max-width: 100vw; }
        :root { --card-bg:#fff; --card-color:#222; --input-bg:#fafafa; --input-color:#222; --input-border:#e0e0e0; --tx:#333; --tx2:#555; --tx3:#999; --bdr:#e0e0e0; --bdr2:#e0ddd8; --shadow:0 1px 4px rgba(0,0,0,.06),0 6px 20px rgba(0,0,0,.03); }
        input, textarea { background: var(--input-bg) !important; color: var(--input-color) !important; border-color: var(--input-border) !important; }
        select { color: var(--input-color) !important; border-color: var(--input-border) !important; }
        select:not(.cat-dd) { background: var(--input-bg) !important; }
        .cat-dd { background: transparent; border: none; font-size: 13px; padding: 1px 4px; color: var(--tx2, #555); cursor: pointer; max-width: 120px; outline: none; }
        .cat-dd:hover, .cat-dd:focus { background: var(--input-bg, #f5f5f5) !important; border-radius: 4px; }
        input::placeholder { color: var(--tx3); }
        .recharts-default-tooltip { background: var(--card-bg) !important; color: var(--card-color) !important; border: none !important; }
        .recharts-legend-item-text { color: var(--card-color) !important; }
      `}</style>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Fraunces:wght@400;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: headerBg, color: "#fff", padding: mob ? "6px 0 0" : "12px 0 0" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: mob ? 8 : 12, marginBottom: mob ? 4 : 8 }}>
            <label style={{ cursor: "pointer", flexShrink: 0 }} title="Click to upload custom icon">
              {customIcon
                ? <img src={customIcon} style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover" }} />
                : <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg,#E8573A,#F2A93B)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>💰</div>}
              <input ref={iconRef} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => setCustomIcon(ev.target.result); r.readAsDataURL(f); } }} style={{ display: "none" }} />
            </label>
            <div style={{ flex: 1 }}>
              {editingTitle
                ? <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
                    onBlur={() => { setAppTitle(titleDraft.trim() || appTitle); setEditingTitle(false); }}
                    onKeyDown={e => { if (e.key === "Enter") { setAppTitle(titleDraft.trim() || appTitle); setEditingTitle(false); } if (e.key === "Escape") setEditingTitle(false); }}
                    style={{ margin: 0, fontSize: 22, fontFamily: "'Fraunces',serif", fontWeight: 800, background: "transparent", border: "none", borderBottom: "2px solid #E8573A", color: "#fff", outline: "none", width: "100%" }} />
                : <h1 onClick={() => { setTitleDraft(appTitle); setEditingTitle(true); }} style={{ margin: 0, fontSize: 22, fontFamily: "'Fraunces',serif", fontWeight: 800, cursor: "text" }} title="Click to rename">{appTitle}</h1>}
              <p style={{ margin: 0, fontSize: 11, color: "#888", letterSpacing: 1, textTransform: "uppercase" }}>{tax.year} Tax Year • {tax.stateName || "State"}</p></div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setDarkMode("light")} style={{ padding: "5px 10px", background: !dk && !waf ? "#E8573A" : "rgba(255,255,255,0.1)", color: !dk && !waf ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>☀️</button>
              <button onClick={() => setDarkMode("dark")} style={{ padding: "5px 10px", background: dk ? "#F2A93B" : "rgba(255,255,255,0.1)", color: dk ? "#1a1a1a" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🌙</button>
              <button onClick={() => setDarkMode("waf")} style={{ padding: "5px 10px", background: waf ? "#c96b70" : "rgba(255,255,255,0.1)", color: waf ? "#fff" : "#888", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🌸</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #333", overflowX: "auto" }}>
            <button style={ts(tab === "taxes")} onClick={() => setTab("taxes")}>Tax Rates</button>
            <button style={ts(tab === "settings")} onClick={() => setTab("settings")}>Income</button>
            <button style={ts(tab === "budget")} onClick={() => setTab("budget")}>Budget</button>
            <button style={ts(tab === "cats")} onClick={() => setTab("cats")}>Categories</button>
            <button style={ts(tab === "charts")} onClick={() => setTab("charts")}>Charts</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: mob ? "12px 10px 60px" : "24px 20px 60px", overflowX: "hidden" }}>

        {/* ═══ TAX RATES ═══ */}
        {tab === "taxes" && (
          <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20, overflowX: "hidden" }}>
            <Card>
              <h3 style={{ margin: "0 0 4px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Payroll & State Rates</h3>
              <p style={{ fontSize: 12, color: "#999", margin: "0 0 16px" }}>Update when rates change each year.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Tax Year</label><input value={tax.year} onChange={e => upTax("year", e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>401(k) Limit</label><NI value={tax.k401Lim} onChange={v => upTax("k401Lim", +v || 0)} prefix="$" /></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>State Name</label><input value={tax.stateName || ""} onChange={e => upTax("stateName", e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>State Abbreviation</label><input value={tax.stateAbbr || ""} onChange={e => upTax("stateAbbr", e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                {[["OASDI %", "ssRate"], ["SS Wage Cap", "ssCap"], ["Medicare %", "medRate"], ["State Income %", "coRate"], ["State FAMLI EE %", "coFamli"]].map(([l, k]) => (
                  <div key={k}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>{l}</label>{k === "ssCap" ? <NI value={tax[k]} onChange={v => upTax(k, +v || 0)} prefix="$" /> : <PI value={tax[k]} onChange={v => upTax(k, +v || 0)} />}</div>
                ))}
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Std Ded (Single)</label><NI value={tax.stdSingle} onChange={v => upTax("stdSingle", +v || 0)} prefix="$" /></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Std Ded (MFJ)</label><NI value={tax.stdMFJ} onChange={v => upTax("stdMFJ", +v || 0)} prefix="$" /></div>
              </div>
              <h4 style={{ margin: "16px 0 8px", fontSize: 14, fontWeight: 700 }}>401(k) Employer Match Tiers</h4>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>Base: <input type="number" value={tax.matchBase} onChange={e => upTax("matchBase", +e.target.value || 0)} style={{ width: 40, border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px", fontSize: 12, textAlign: "center" }} />%</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, fontSize: 11, fontWeight: 700, color: "#999", marginBottom: 4 }}><span>Up to EE %</span><span>Match rate</span><span /></div>
              {(tax.matchTiers || []).map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4, marginBottom: 2 }}>
                  <input type="number" value={t.upTo} onChange={e => { const n = [...(tax.matchTiers || [])]; n[i] = { ...n[i], upTo: +e.target.value }; upTax("matchTiers", n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                  <input type="number" step="0.1" value={t.rate} onChange={e => { const n = [...(tax.matchTiers || [])]; n[i] = { ...n[i], rate: +e.target.value }; upTax("matchTiers", n); }} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "4px 6px", fontSize: 12 }} />
                  <button onClick={() => upTax("matchTiers", (tax.matchTiers || []).filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#ccc" }}>×</button>
                </div>
              ))}
              <button onClick={() => upTax("matchTiers", [...(tax.matchTiers || []), { upTo: 10, rate: 0.5 }])} style={{ marginTop: 4, padding: "4px 12px", fontSize: 11, border: "1px dashed #ccc", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--tx3,#888)" }}>+ Add Tier</button>
              <h4 style={{ margin: "16px 0 8px", fontSize: 14, fontWeight: 700 }}>HSA</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Annual Limit</label><NI value={tax.hsaLimit} onChange={v => upTax("hsaLimit", +v || 0)} prefix="$" /></div>
                <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Employer Annual Match</label><NI value={tax.hsaEmployerMatch} onChange={v => upTax("hsaEmployerMatch", +v || 0)} prefix="$" /></div>
              </div>
              <div style={{ marginTop: 20, padding: 16, background: "var(--input-bg, #f8f8f8)", borderRadius: 10 }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>Load Tax Year</h4>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <select value={tax.year} onChange={e => loadTaxYear(e.target.value)} style={{ border: "2px solid var(--input-border, #e0e0e0)", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", cursor: "pointer", minWidth: 90 }}>
                    {Object.keys(allTaxDB).sort((a, b) => b - a).map(yr => <option key={yr} value={yr}>{yr}</option>)}
                  </select>
                  <button onClick={() => setShowTaxPaste(p => !p)} style={{ padding: "8px 16px", fontSize: 12, border: "none", borderRadius: 8, background: "#556FB5", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                    + Add New Year
                  </button>
                  <button onClick={() => setTax(prev => ({ ...DEF_TAX, year: prev.year, stateName: prev.stateName, stateAbbr: prev.stateAbbr, coRate: prev.coRate, coFamli: prev.coFamli, stateTaxes: prev.stateTaxes, matchTiers: prev.matchTiers, matchBase: prev.matchBase, hsaEmployerMatch: prev.hsaEmployerMatch }))} style={{ padding: "8px 16px", fontSize: 12, border: "2px solid #E8573A", borderRadius: 8, background: "none", color: "#E8573A", fontWeight: 600, cursor: "pointer" }}>Reset {tax.year}</button>
                </div>
                <div style={{ fontSize: 11, color: "var(--tx3, #999)" }}>
                  {Object.keys(allTaxDB).length} years available (1996–{Object.keys(allTaxDB).sort((a, b) => b - a)[0]}). State rates are always preserved when switching years.
                </div>
                {showTaxPaste && <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--input-border, #ddd)", borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Add a new tax year</div>
                  <div style={{ fontSize: 11, color: "var(--tx3, #999)", marginBottom: 8 }}>
                    Paste JSON from Claude. Use the prompt below to get the right format.
                  </div>
                  <textarea value={taxPaste} onChange={e => setTaxPaste(e.target.value)} placeholder='{"year":"2027","fedSingle":[[0,12500,0.10],...], ...}' rows={5} style={{ width: "100%", border: "1px solid var(--input-border, #ddd)", borderRadius: 6, padding: 8, fontSize: 11, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button onClick={() => addTaxYear(taxPaste)} disabled={!taxPaste.trim()} style={{ padding: "6px 14px", fontSize: 12, border: "none", borderRadius: 6, background: taxPaste.trim() ? "#2ECC71" : "#ccc", color: "#fff", fontWeight: 700, cursor: taxPaste.trim() ? "pointer" : "default" }}>Add & Load</button>
                    <button onClick={() => { setShowTaxPaste(false); setTaxPaste(""); }} style={{ padding: "6px 14px", fontSize: 12, border: "1px solid #ddd", borderRadius: 6, background: "none", color: "#888", cursor: "pointer" }}>Cancel</button>
                    <button onClick={() => { navigator.clipboard.writeText('Give me the US federal tax rates for tax year [YEAR] formatted exactly like this JSON (replace all values, keep the structure, return ONLY the JSON):\n\n{"year":"[YEAR]","fedSingle":[[0,11925,0.10],[11925,48475,0.12],[48475,103350,0.22],[103350,197300,0.24],[197300,250525,0.32],[250525,626350,0.35],[626350,9999999,0.37]],"fedMFJ":[[0,23850,0.10],[23850,96950,0.12],[96950,206700,0.22],[206700,394600,0.24],[394600,501050,0.32],[501050,751600,0.35],[751600,9999999,0.37]],"stdSingle":15000,"stdMFJ":30000,"ssRate":6.2,"ssCap":176100,"medRate":1.45,"k401Lim":23500,"hsaLimit":8550}'); setFetchStatus("📋 Prompt copied! Paste it in a new Claude chat, replace [YEAR], and paste the result back here."); }} style={{ padding: "6px 14px", fontSize: 12, border: "1px solid #556FB5", borderRadius: 6, background: "none", color: "#556FB5", fontWeight: 600, cursor: "pointer" }}>Copy Prompt</button>
                  </div>
                </div>}
                {fetchStatus && <div style={{ fontSize: 12, marginTop: 8, color: fetchStatus.startsWith("✅") ? "#2ECC71" : fetchStatus.startsWith("❌") ? "#E8573A" : "#556FB5", wordBreak: "break-word" }}>{fetchStatus}</div>}
              </div>
            </Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <Card><h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Federal — Single / MFS</h3><BrEd brackets={tax.fedSingle} onChange={v => upTax("fedSingle", v)} /></Card>
              <Card><h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Federal — MFJ</h3><BrEd brackets={tax.fedMFJ} onChange={v => upTax("fedMFJ", v)} /></Card>
            </div>
            <Card dark style={{ gridColumn: mob ? "1" : "1/-1" }}>
              <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Active Summary</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, fontSize: 13 }}>
                {[["Fed Marginal", fp(C.mr)], ["Std Deduction", fmt(C.sd)], ["OASDI", `${p2(tax.ssRate)} to ${fmt(tax.ssCap)}`], ["Medicare", p2(tax.medRate)], [`${tax.stateAbbr || "ST"} State`, p2(tax.coRate)], [`${tax.stateAbbr || "ST"} FAMLI`, p2(tax.coFamli)], ["401(k) Limit", fmt(tax.k401Lim)], ["HSA Limit", fmt(tax.hsaLimit)]].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                    <span style={{ color: "#aaa" }}>{l}</span><span style={{ color: "#4ECDC4", fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ═══ INCOME ═══ */}
        {tab === "settings" && (
          <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Income</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Corey Salary</label><NI value={cSal} onChange={setCS} prefix="$" /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Kelly Salary</label><NI value={kSal} onChange={setKS} prefix="$" /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Corey EAIP %</label><PI value={cEaip} onChange={setCE} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Kelly EAIP %</label><PI value={kEaip} onChange={setKE} /></div>
                </div>
                <div style={{ marginTop: 12 }}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Filing Status</label>
                  <select value={fil} onChange={e => setFil(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa" }}><option value="mfj">Married Filing Jointly</option><option value="single">Single / MFS</option></select></div>
              </Card>
              <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>401(k) Contributions</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div /><div />
                  <div style={{ gridColumn: "1/-1", borderBottom: "1px solid #eee", paddingBottom: 4 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#556FB5" }}>Pre-Tax 401(k)</span></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Corey %</label><PI value={c4pre} onChange={setC4pre} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Kelly %</label><PI value={k4pre} onChange={setK4pre} /></div>
                  <div style={{ gridColumn: "1/-1", borderBottom: "1px solid #eee", paddingBottom: 4, marginTop: 8 }}><span style={{ fontSize: 12, fontWeight: 700, color: "#E8573A" }}>Roth 401(k)</span></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Corey %</label><PI value={c4ro} onChange={setC4ro} /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Kelly %</label><PI value={k4ro} onChange={setK4ro} /></div>
                </div>
                <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--input-bg, #f8f8f8)", borderRadius: 8, fontSize: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div><span style={{ color: "#999" }}>Corey total:</span> <strong>{evalF(c4pre) + evalF(c4ro)}%</strong> ({fmt(C.c4w * 52)}/yr)</div>
                    <div><span style={{ color: "#999" }}>Kelly total:</span> <strong>{evalF(k4pre) + evalF(k4ro)}%</strong> ({fmt(C.k4w * 52)}/yr)</div>
                    <div><span style={{ color: "#999" }}>Corey employer:</span> <strong>{C.cMP.toFixed(2)}%</strong> ({fmt(C.cs * C.cMP / 100)}/yr)</div>
                    <div><span style={{ color: "#999" }}>Kelly employer:</span> <strong>{C.kMP.toFixed(2)}%</strong> ({fmt(C.ks * C.kMP / 100)}/yr)</div>
                  </div>
                </div>
              </Card>
              <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>HSA (Annual)</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Corey Annual</label><NI value={cHsaAnn} onChange={setCHsaAnn} prefix="$" /></div>
                  <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Kelly Annual</label><NI value={kHsaAnn} onChange={setKHsaAnn} prefix="$" /></div>
                </div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>Limit: {fmt(tax.hsaLimit)}/yr. Employer match: {fmt(tax.hsaEmployerMatch)}/yr. This auto-populates the HSA row in pre-tax deductions ({fmt(evalF(cHsaAnn) / 52)}/wk + {fmt(evalF(kHsaAnn) / 52)}/wk).</div>
              </Card>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <DedEditor items={preDed} setItems={setPreDed} label="Pre-Tax Deductions" />
              <DedEditor items={postDed} setItems={setPostDed} label="Post-Tax Deductions" />
            </div>
          </div>
        )}

        {/* ═══ CATEGORIES ═══ */}
        {tab === "cats" && (
          <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20 }}>
            <Card>
              <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#E8573A" }}>Expense Categories</h3>
              {cats.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <input value={c} onChange={e => { const n = [...cats]; n[i] = e.target.value; setCats(n); }} style={{ flex: 1, border: "2px solid #f5d5ce", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#fef5f2" }} />
                  <button onClick={() => setCats(cats.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New expense category..." onKeyDown={e => { if (e.key === "Enter" && newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(""); } }} style={{ flex: 1, border: "2px solid #f5d5ce", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#fef5f2" }} />
                <button onClick={() => { if (newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(""); } }} style={{ padding: "8px 18px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
              </div>
            </Card>
            <Card>
              <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800, color: "#2ECC71" }}>Savings Categories</h3>
              {savCats.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <input value={c} onChange={e => { const n = [...savCats]; n[i] = e.target.value; setSavCats(n); }} style={{ flex: 1, border: "2px solid #d5f5e3", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#f0faf5" }} />
                  <button onClick={() => setSavCats(savCats.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#ccc" }}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input id="newSavCat" placeholder="New savings category..." onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) { setSavCats([...savCats, e.target.value.trim()]); e.target.value = ""; } }} style={{ flex: 1, border: "2px solid #d5f5e3", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: "'DM Sans',sans-serif", background: "#f0faf5" }} />
                <button onClick={() => { const el = document.getElementById("newSavCat"); if (el?.value.trim()) { setSavCats([...savCats, el.value.trim()]); el.value = ""; } }} style={{ padding: "8px 18px", background: "#2ECC71", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>+ Add</button>
              </div>
            </Card>
          </div>
        )}

        {/* ═══ BUDGET ═══ */}
        {tab === "budget" && viewingSnap !== null && snapshots[viewingSnap] && (() => {
          const snap = snapshots[viewingSnap];
          const items = snap.items || {};
          const necItems = Object.entries(items).filter(([, d]) => d.t === "N").sort((a, b) => a[0].localeCompare(b[0]));
          const disItems = Object.entries(items).filter(([, d]) => d.t === "D").sort((a, b) => a[0].localeCompare(b[0]));
          const savItems = Object.entries(items).filter(([, d]) => d.t === "S").sort((a, b) => a[0].localeCompare(b[0]));
          const necT = necItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const disT = disItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const savT = savItems.reduce((s, [, d]) => s + (d.v || 0), 0);
          const expT = necT + disT;
          const netY = (snap.netW || 0) * 48;
          const remY = netY - expT - savT;
          const cNetY = (snap.cNetW || 0) * 48, kNetY = (snap.kNetW || 0) * 48;
          const renameSnapItem = (oldName, newName) => { if (oldName === newName || !newName.trim()) return; const n = [...snapshots]; const it = { ...(n[viewingSnap].items || {}) }; it[newName.trim()] = it[oldName]; delete it[oldName]; n[viewingSnap] = { ...n[viewingSnap], items: it }; setSnapshots(n); };
          const upSnapItem = (name, field, val) => { const n = [...snapshots]; const it = { ...(n[viewingSnap].items || {}) }; it[name] = { ...it[name], [field]: val }; n[viewingSnap] = { ...n[viewingSnap], items: it }; let nec = 0, dis = 0, sv = 0; Object.values(it).forEach(x => { if (x.t === "N") nec += x.v || 0; else if (x.t === "D") dis += x.v || 0; else sv += x.v || 0; }); n[viewingSnap].necW = nec / 48; n[viewingSnap].disW = dis / 48; n[viewingSnap].expW = (nec + dis) / 48; n[viewingSnap].savW = sv / 48; setSnapshots(n); };
          const upSnapVal = (name, rawVal, period) => {
            let yearly = +rawVal || 0;
            if (period === "w") yearly = yearly * 48;
            else if (period === "m") yearly = yearly * 12;
            upSnapItem(name, "v", Math.round(yearly * 100) / 100);
          };
          const SnapItemRow = ({ name, data }) => {
            const yr = data.v || 0, wk = yr / 48, mo = yr / 12;
            const ep = data.ep || "y"; // edit period: w, m, y
            const editVal = ep === "w" ? wk : ep === "m" ? mo : yr;
            const allCats = [...cats, ...savCats.filter(sc => !cats.includes(sc))];
            return (
              <div style={{ display: "grid", gridTemplateColumns: "50px 1.6fr 90px 40px 1fr 1fr 1fr 1fr", gap: 4, padding: "3px 0", alignItems: "center", fontSize: 12 }}>
                <select value={data.t || "N"} onChange={e => upSnapItem(name, "t", e.target.value)} style={{ fontSize: 9, color: "#fff", fontWeight: 700, border: "none", borderRadius: 5, padding: "3px 4px", background: data.t === "N" ? "#556FB5" : data.t === "D" ? "#E8573A" : "#2ECC71", cursor: "pointer" }}>
                  <option value="N">NEC</option><option value="D">DIS</option><option value="S">SAV</option>
                </select>
                <EditTxt value={name} onChange={v => renameSnapItem(name, v)} />
                <select value={data.c || ""} onChange={e => upSnapItem(name, "c", e.target.value)} style={{ fontSize: 10, border: "1px solid #ddd", borderRadius: 4, padding: "2px 3px" }}>
                  <option value="">—</option>
                  {allCats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={ep} onChange={e => upSnapItem(name, "ep", e.target.value)} style={{ fontSize: 9, border: "1px solid #ddd", borderRadius: 4, padding: "1px", color: "#556FB5", fontWeight: 600, cursor: "pointer" }}>
                  <option value="w">wk</option><option value="m">mo</option><option value="y">yr</option>
                </select>
                {ep === "w" ? <input type="number" step="0.01" value={Math.round(wk * 100) / 100} onChange={e => upSnapVal(name, e.target.value, "w")} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px", fontSize: 11, textAlign: "right" }} /> : <div style={{ textAlign: "right", color: "#888", fontSize: 11 }}>{fmt(wk)}</div>}
                {ep === "m" ? <input type="number" step="0.01" value={Math.round(mo * 100) / 100} onChange={e => upSnapVal(name, e.target.value, "m")} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px", fontSize: 11, textAlign: "right" }} /> : <div style={{ textAlign: "right", color: "#888", fontSize: 11 }}>{fmt(mo)}</div>}
                {ep === "y" ? <input type="number" step="0.01" value={Math.round(yr * 100) / 100} onChange={e => upSnapVal(name, e.target.value, "y")} style={{ border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px", fontSize: 11, textAlign: "right" }} /> : <div style={{ textAlign: "right", color: "#888", fontSize: 11 }}>{fmt(yr)}</div>}
                <div style={{ textAlign: "right", color: "#888", fontSize: 11 }}>{fmt(yr)}</div>
              </div>
            );
          };
          return (
            <div>
              <div style={{ background: "#556FB5", color: "#fff", padding: "12px 20px", borderRadius: 12, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div><span style={{ fontWeight: 800, fontFamily: "'Fraunces',serif" }}>Viewing Snapshot:</span> {snap.label} <span style={{ opacity: 0.7 }}>({snap.date})</span></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setRestoreConfirm(viewingSnap)} style={{ padding: "6px 14px", background: "rgba(255,255,255,0.2)", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Restore This</button>
                  <button onClick={() => setViewingSnap(null)} style={{ padding: "6px 14px", background: "#fff", color: "#556FB5", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>← Back to Current</button>
                </div>
              </div>
              <Card dark style={{ marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12, textAlign: "center" }}>
                  {[["Net Income (yr)", fmt(netY), "#4ECDC4"], ["Necessity (yr)", fmt(necT), "#556FB5"], ["Discretionary (yr)", fmt(disT), "#E8573A"], ["Savings (yr)", fmt(savT), "#2ECC71"], ["Remaining (yr)", fmt(remY), remY >= 0 ? "#2ECC71" : "#E74C3C"]].map(([l, v, c]) => (
                    <div key={l}><div style={{ fontSize: 9, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{l}</div><div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: "'Fraunces',serif" }}>{v}</div></div>
                  ))}
                </div>
                {(cNetY > 0 || kNetY > 0) && <div style={{ marginTop: 8, fontSize: 12, color: "#aaa", textAlign: "center" }}>Corey: {fmt(cNetY)}/yr • Kelly: {fmt(kNetY)}/yr</div>}
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>Combined Net (weekly)</label>
                    <input type="number" value={Math.round((snap.netW || 0) * 100) / 100} onChange={e => { const n = [...snapshots]; n[viewingSnap] = { ...n[viewingSnap], netW: +e.target.value || 0 }; setSnapshots(n); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>Corey Net (weekly)</label>
                    <input type="number" value={Math.round((snap.cNetW || 0) * 100) / 100} onChange={e => { const n = [...snapshots]; n[viewingSnap] = { ...n[viewingSnap], cNetW: +e.target.value || 0 }; setSnapshots(n); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /></div>
                  <div><label style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3,#888)" }}>Kelly Net (weekly)</label>
                    <input type="number" value={Math.round((snap.kNetW || 0) * 100) / 100} onChange={e => { const n = [...snapshots]; n[viewingSnap] = { ...n[viewingSnap], kNetW: +e.target.value || 0 }; setSnapshots(n); }} style={{ width: "100%", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "rgba(255,255,255,0.1)", color: "#fff", boxSizing: "border-box" }} /></div>
                </div>
              </Card>
              <Card>
                <div style={{ display: "grid", gridTemplateColumns: "50px 1.6fr 90px 40px 1fr 1fr 1fr 1fr", gap: 4, padding: "6px 0", borderBottom: "2px solid #d0cdc8", fontSize: 9, fontWeight: 700, color: "#999", textTransform: "uppercase" }}>
                  <span>Type</span><span>Name</span><span>Category</span><span>Per</span><span style={{ textAlign: "right" }}>Weekly</span><span style={{ textAlign: "right" }}>Monthly</span><span style={{ textAlign: "right" }}>Yearly (48)</span><span style={{ textAlign: "right" }}>Yearly (52)</span>
                </div>
                {necItems.length > 0 && <SH color="var(--c-taxable, #556FB5)">Necessity</SH>}
                {necItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {necItems.length > 0 && <Row label="Subtotal — Necessity" wk={necT / 48} mo={necT / 12} y48={necT} y52={necT} bold border color="var(--c-taxable, #556FB5)" />}
                {disItems.length > 0 && <SH color="var(--c-totaltax, #E8573A)">Discretionary</SH>}
                {disItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {disItems.length > 0 && <Row label="Subtotal — Discretionary" wk={disT / 48} mo={disT / 12} y48={disT} y52={disT} bold border color="var(--c-totaltax, #E8573A)" />}
                <Row label="Total Expenses" wk={expT / 48} mo={expT / 12} y48={expT} y52={expT} bold border />
                {savItems.length > 0 && <SH color="#2ECC71">Savings</SH>}
                {savItems.map(([name, data]) => <SnapItemRow key={name} name={name} data={data} />)}
                {savItems.length > 0 && <Row label="Total Savings" wk={savT / 48} mo={savT / 12} y48={savT} y52={savT * 52 / 48} bold border color="#2ECC71" />}
                <div style={{ marginTop: 8, padding: "10px 8px", background: remY >= 0 ? "#f0faf5" : "#fef0ed", borderRadius: 8 }}>
                  <Row label="Remaining" wk={remY / 48} mo={remY / 12} y48={remY} y52={remY * 52 / 48} bold color={remY >= 0 ? "#2ECC71" : "#E74C3C"} />
                </div>
              </Card>
            </div>
          );
        })()}

        {tab === "budget" && viewingSnap === null && (
          <div>
            <div style={{ position: "sticky", top: mob ? 52 : 82, zIndex: 10, paddingTop: 4, paddingBottom: 4, background: dk ? "#1e1e1e" : waf ? "#d0ccc7" : "#ede7e0" }}>
            <div onClick={() => mob && setBannerOpen(p => !p)} style={{ cursor: mob ? "pointer" : "default" }}>
            <Card dark style={{ marginBottom: 8, padding: bannerOpen ? undefined : "8px 16px" }}>
              {bannerOpen ? <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(7, 1fr)", gap: 8, textAlign: "center" }}>
                {[["Net / Week", fmt(C.net), "#4ECDC4"], ["Net / Month", fmt(moC(C.net)), "#F2A93B"], ["Net / Year (48)", fmt(y4(C.net)), "#4ECDC4"], ["Net / Year (52)", fmt(y5(C.net)), "#888"], ["Bonus (net)", fmt(C.eaipNet), "#9B59B6"], ["Savings / Year", fmt(y5(tSavW) + Math.max(0, remY52)), "#2ECC71"], ["Savings + Bonus", fmt(y5(tSavW) + Math.max(0, remY52) + C.eaipNet), "#1ABC9C"]].map(([l, v, c]) => (
                  <div key={l}><div style={{ fontSize: 8, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{l}</div><div style={{ fontSize: mob ? 13 : 15, fontWeight: 800, color: c, fontFamily: "'Fraunces',serif" }}>{v}</div></div>
                ))}
              </div> : <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#4ECDC4" }}>Net: {fmt(C.net)}/wk</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#2ECC71" }}>Savings: {fmt(y5(tSavW) + Math.max(0, remY52))}/yr</span>
                <span style={{ fontSize: 10, color: "#888" }}>tap to expand ▾</span>
              </div>}
            </Card>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4, alignItems: "center", padding: "6px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase" }}>Sort:</span>
                {[["default", "Default"], ["amount", "Amount"], ["category", "Category"]].map(([v, l]) => (
                  <button key={v} onClick={() => { if (sortBy === v && v === "amount") setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortBy(v); if (v === "amount") setSortDir("desc"); } }}
                    style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: sortBy === v ? "2px solid #556FB5" : "2px solid #ddd", borderRadius: 6, background: sortBy === v ? "#EEF1FA" : "#fafafa", color: sortBy === v ? "#556FB5" : "#888", cursor: "pointer" }}>
                    {l}{sortBy === v && v === "amount" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Highlight &gt;</span>
                <NI value={hlThresh} onChange={v => setHlThresh(v)} prefix="$" style={{ width: 90, height: 30 }} />
                <select value={hlPeriod} onChange={e => setHlPeriod(e.target.value)} style={{ fontSize: 11, border: "2px solid #ddd", borderRadius: 6, padding: "4px 6px", background: "#fafafa", cursor: "pointer" }}>
                  <option value="w">/wk</option><option value="m">/mo</option><option value="y">/yr</option>
                </select>
              </div>
              <button onClick={() => setShowPerPerson(p => !p)} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: showPerPerson ? "2px solid #4ECDC4" : "2px solid #ddd", borderRadius: 6, background: showPerPerson ? "#E8F8F5" : "#fafafa", color: showPerPerson ? "#4ECDC4" : "#888", cursor: "pointer" }}>
                {showPerPerson ? "Hide" : "Show"} Per-Person
              </button>
              <button onClick={toggleAll} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid #ddd", borderRadius: 6, background: "#fafafa", color: "#888", cursor: "pointer" }}>
                {allExpanded ? "Collapse All" : "Expand All"}
              </button>
              <button onClick={() => setShowAddItem(true)} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "2px solid #E8573A", borderRadius: 6, background: "#fef5f2", color: "#E8573A", cursor: "pointer" }}>
                + Add Item
              </button>
            </div>
            </div>

            <Card style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: mob ? "1.8fr 1fr 1fr" : "2.4fr 1fr 1fr 1fr 1fr", gap: mob ? 4 : 6, padding: "6px 0", borderBottom: "2px solid var(--bdr2, #d0cdc8)", position: "sticky", top: 0, background: "var(--card-bg, #fff)", zIndex: 2 }}>
                {(mob ? ["", "Weekly", "Yearly (48)"] : ["", "Weekly", "Monthly", "Yearly (48)", "Yearly (52)"]).map(h => <div key={h} style={{ fontSize: mob ? 9 : 10, fontWeight: 700, color: "var(--tx3, #999)", textTransform: "uppercase", letterSpacing: 1, textAlign: h === "" ? "left" : "right" }}>{h}</div>)}
              </div>

              <SH>Income</SH>
              <Row label="Corey Salary" wk={C.cw} mo={moC(C.cw)} y48={y4(C.cw)} y52={y5(C.cw)} bold />
              <Row label="Kelly Salary" wk={C.kw} mo={moC(C.kw)} y48={y4(C.kw)} y52={y5(C.kw)} bold />
              <Row label="Combined Gross" wk={C.cw + C.kw} mo={moC(C.cw + C.kw)} y48={y4(C.cw + C.kw)} y52={y5(C.cw + C.kw)} bold border />

              <CSH color="var(--c-pretax, #c0392b)" collapsed={collapsed.preTax} onToggle={() => toggleSec("preTax")}>Pre-Tax Deductions</CSH>
              {!collapsed.preTax && <>{preDed.filter(d => !d.n.toLowerCase().includes("hsa")).map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k), v = cv + kv; return <div key={i}><Row label={d.n} wk={-v} mo={-moC(v)} y48={-y4(v)} y52={-y5(v)} color="var(--c-pretax, #c0392b)" />{showPerPerson && (cv > 0 || kv > 0) && <><Row label={`  ↳ Corey`} wk={-cv} mo={-moC(cv)} y48={-y4(cv)} y52={-y5(cv)} color="var(--c-pretax, #d98880)" /><Row label={`  ↳ Kelly`} wk={-kv} mo={-moC(kv)} y48={-y4(kv)} y52={-y5(kv)} color="var(--c-pretax, #d98880)" /></>}</div>; })}</>}
              {(() => { const t = preDed.filter(d => !d.n.toLowerCase().includes("hsa")).reduce((s, d) => s + evalF(d.c) + evalF(d.k), 0); return t > 0 ? <Row label="Total Pre-Tax Deductions" wk={-t} mo={-moC(t)} y48={-y4(t)} y52={-y5(t)} bold border color="var(--c-pretax, #c0392b)" /> : null; })()}

              {/* Pre-Tax Savings */}
              <CSH color="var(--c-presav, #1ABC9C)" collapsed={collapsed.preSav} onToggle={() => toggleSec("preSav")}>Pre-Tax Savings (not in take-home)</CSH>
              {!collapsed.preSav && <>{preDed.filter(d => d.n.toLowerCase().includes("hsa")).map((d, i) => { const v = evalF(d.c) + evalF(d.k); return <Row key={"hs" + i} label={"💰 " + d.n + (tax.hsaEmployerMatch > 0 ? ` (+ ${fmt(tax.hsaEmployerMatch)}/yr employer)` : "")} wk={v} mo={moC(v)} y48={y4(v)} y52={y5(v)} color="var(--c-presav, #1ABC9C)" />; })}
              {showPerPerson && preDed.filter(d => d.n.toLowerCase().includes("hsa")).map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k); return (cv > 0 || kv > 0) ? <div key={"hsp" + i}><Row label={`  ↳ Corey HSA`} wk={cv} mo={moC(cv)} y48={y4(cv)} y52={y5(cv)} color="var(--c-presav, #48C9B0)" /><Row label={`  ↳ Kelly HSA`} wk={kv} mo={moC(kv)} y48={y4(kv)} y52={y5(kv)} color="var(--c-presav, #48C9B0)" /></div> : null; })}
              {C.c4preW + C.k4preW > 0 && <Row label="💰 401(k) Pre-Tax" wk={C.c4preW + C.k4preW} mo={moC(C.c4preW + C.k4preW)} y48={y4(C.c4preW + C.k4preW)} y52={y5(C.c4preW + C.k4preW)} color="var(--c-presav, #1ABC9C)" />}
              {showPerPerson && C.c4preW > 0 && <Row label="  ↳ Corey Pre-Tax" wk={C.c4preW} mo={moC(C.c4preW)} y48={y4(C.c4preW)} y52={y5(C.c4preW)} color="var(--c-presav, #48C9B0)" />}
              {showPerPerson && C.k4preW > 0 && <Row label="  ↳ Kelly Pre-Tax" wk={C.k4preW} mo={moC(C.k4preW)} y48={y4(C.k4preW)} y52={y5(C.k4preW)} color="var(--c-presav, #48C9B0)" />}</>}
              {(() => { const hsaW = preDed.filter(d => d.n.toLowerCase().includes("hsa")).reduce((s, d) => s + evalF(d.c) + evalF(d.k), 0); const preTax401 = C.c4preW + C.k4preW; const total = hsaW + preTax401; return total > 0 ? <Row label="Total Pre-Tax Savings" wk={total} mo={moC(total)} y48={y4(total)} y52={y5(total)} bold border color="var(--c-presav, #1ABC9C)" /> : null; })()}

              <SH>Taxable Pay</SH>
              <Row label="Combined Taxable" wk={C.cTxW + C.kTxW} mo={moC(C.cTxW + C.kTxW)} y48={y4(C.cTxW + C.kTxW)} y52={y5(C.cTxW + C.kTxW)} bold color="var(--c-taxable, #556FB5)" />

              <CSH color="var(--c-fedtax, #1a5276)" collapsed={collapsed.fedTax} onToggle={() => toggleSec("fedTax")}>Federal Taxes</CSH>
              {!collapsed.fedTax && <><Row label="Fed Withholding" sub={fp(C.mr)} wk={-(C.cFed + C.kFed)} mo={-moC(C.cFed + C.kFed)} y48={-y4(C.cFed + C.kFed)} y52={-y5(C.cFed + C.kFed)} color="var(--c-fedtax, #1a5276)" />
              {showPerPerson && <><Row label="  ↳ Corey" wk={-C.cFed} mo={-moC(C.cFed)} y48={-y4(C.cFed)} y52={-y5(C.cFed)} color="var(--c-fedtax2, #3a7abf)" /><Row label="  ↳ Kelly" wk={-C.kFed} mo={-moC(C.kFed)} y48={-y4(C.kFed)} y52={-y5(C.kFed)} color="var(--c-fedtax2, #3a7abf)" /></>}
              <Row label="OASDI (SS)" sub={p2(tax.ssRate)} wk={-(C.cSS + C.kSS)} mo={-moC(C.cSS + C.kSS)} y48={-y4(C.cSS + C.kSS)} y52={-y5(C.cSS + C.kSS)} color="var(--c-fedtax, #1a5276)" />
              {showPerPerson && <><Row label="  ↳ Corey" wk={-C.cSS} mo={-moC(C.cSS)} y48={-y4(C.cSS)} y52={-y5(C.cSS)} color="var(--c-fedtax2, #3a7abf)" /><Row label="  ↳ Kelly" wk={-C.kSS} mo={-moC(C.kSS)} y48={-y4(C.kSS)} y52={-y5(C.kSS)} color="var(--c-fedtax2, #3a7abf)" /></>}
              <Row label="Medicare" sub={p2(tax.medRate)} wk={-(C.cMc + C.kMc)} mo={-moC(C.cMc + C.kMc)} y48={-y4(C.cMc + C.kMc)} y52={-y5(C.cMc + C.kMc)} color="var(--c-fedtax, #1a5276)" />
              {showPerPerson && <><Row label="  ↳ Corey" wk={-C.cMc} mo={-moC(C.cMc)} y48={-y4(C.cMc)} y52={-y5(C.cMc)} color="var(--c-fedtax2, #3a7abf)" /><Row label="  ↳ Kelly" wk={-C.kMc} mo={-moC(C.kMc)} y48={-y4(C.kMc)} y52={-y5(C.kMc)} color="var(--c-fedtax2, #3a7abf)" /></>}</>}

              <CSH color="var(--c-sttax, #8B4513)" collapsed={collapsed.stTax} onToggle={() => toggleSec("stTax")}>State Taxes ({tax.stateName || "State"})</CSH>
              {!collapsed.stTax && <><Row label={`${tax.stateAbbr || "ST"} Withholding`} sub={p2(tax.coRate)} wk={-(C.cCO + C.kCO)} mo={-moC(C.cCO + C.kCO)} y48={-y4(C.cCO + C.kCO)} y52={-y5(C.cCO + C.kCO)} color="var(--c-sttax, #8B4513)" />
              {showPerPerson && <><Row label="  ↳ Corey" wk={-C.cCO} mo={-moC(C.cCO)} y48={-y4(C.cCO)} y52={-y5(C.cCO)} color="var(--c-sttax2, #B8860B)" /><Row label="  ↳ Kelly" wk={-C.kCO} mo={-moC(C.kCO)} y48={-y4(C.kCO)} y52={-y5(C.kCO)} color="var(--c-sttax2, #B8860B)" /></>}
              <Row label={`${tax.stateAbbr || "ST"} FAMLI`} sub={p2(tax.coFamli)} wk={-(C.cFL + C.kFL)} mo={-moC(C.cFL + C.kFL)} y48={-y4(C.cFL + C.kFL)} y52={-y5(C.cFL + C.kFL)} color="var(--c-sttax, #8B4513)" />
              {showPerPerson && <><Row label="  ↳ Corey" wk={-C.cFL} mo={-moC(C.cFL)} y48={-y4(C.cFL)} y52={-y5(C.cFL)} color="var(--c-sttax2, #B8860B)" /><Row label="  ↳ Kelly" wk={-C.kFL} mo={-moC(C.kFL)} y48={-y4(C.kFL)} y52={-y5(C.kFL)} color="var(--c-sttax2, #B8860B)" /></>}</>}

              {(() => { const t = C.cTx + C.kTx; return <Row label="Total Taxes" wk={-t} mo={-moC(t)} y48={-y4(t)} y52={-y5(t)} bold border color="var(--c-totaltax, #E8573A)" />; })()}
              {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>Corey total tax: {fmt(C.cTx)}/wk ({fmt(C.cTx * 52)}/yr) • Kelly total tax: {fmt(C.kTx)}/wk ({fmt(C.kTx * 52)}/yr)</div>}

              {(C.cPostW + C.kPostW > 0) && <><CSH color="var(--c-posttax, #9B59B6)" collapsed={collapsed.postTax} onToggle={() => toggleSec("postTax")}>Post-Tax Deductions</CSH>
                {!collapsed.postTax && <>{C.c4roW + C.k4roW > 0 && <><Row label="Roth 401(k)" wk={-(C.c4roW + C.k4roW)} mo={-moC(C.c4roW + C.k4roW)} y48={-y4(C.c4roW + C.k4roW)} y52={-y5(C.c4roW + C.k4roW)} color="var(--c-posttax, #9B59B6)" />{showPerPerson && <><Row label="  ↳ Corey" wk={-C.c4roW} mo={-moC(C.c4roW)} y48={-y4(C.c4roW)} y52={-y5(C.c4roW)} color="var(--c-posttax2, #C39BD3)" /><Row label="  ↳ Kelly" wk={-C.k4roW} mo={-moC(C.k4roW)} y48={-y4(C.k4roW)} y52={-y5(C.k4roW)} color="var(--c-posttax2, #C39BD3)" /></>}</>}
                {postDed.map((d, i) => { const cv = evalF(d.c), kv = evalF(d.k), v = cv + kv; return v > 0 ? <div key={i}><Row label={d.n} wk={-v} mo={-moC(v)} y48={-y4(v)} y52={-y5(v)} color="var(--c-posttax, #9B59B6)" />{showPerPerson && <><Row label="  ↳ Corey" wk={-cv} mo={-moC(cv)} y48={-y4(cv)} y52={-y5(cv)} color="var(--c-posttax2, #C39BD3)" /><Row label="  ↳ Kelly" wk={-kv} mo={-moC(kv)} y48={-y4(kv)} y52={-y5(kv)} color="var(--c-posttax2, #C39BD3)" /></>}</div> : null; })}</>}
                <Row label="Total Post-Tax Deductions" wk={-(C.cPostW + C.kPostW)} mo={-moC(C.cPostW + C.kPostW)} y48={-y4(C.cPostW + C.kPostW)} y52={-y5(C.cPostW + C.kPostW)} bold border color="var(--c-posttax, #9B59B6)" />
              </>}

              <div style={{ marginTop: 8, padding: "10px 0", borderTop: "3px solid #1a1a1a", borderBottom: "3px solid #1a1a1a" }}>
                <Row label="✦ Combined Net Paycheck" wk={C.net} mo={moC(C.net)} y48={y4(C.net)} y52={y5(C.net)} bold />
                {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>Corey: {fmt(C.cNet)}/wk ({fmt(C.cNet * 52)}/yr) • Kelly: {fmt(C.kNet)}/wk ({fmt(C.kNet * 52)}/yr)</div>}
              </div>

              <CSH color="var(--c-taxable, #556FB5)" collapsed={collapsed.nec} onToggle={() => toggleSec("nec")}>Necessity Expenses</CSH>
              {!collapsed.nec && necI.map(item => <ExpRowInner key={item.idx} item={item} cats={cats} onUpdate={u => updExp(item.idx, u)} onRemove={() => rmExp(item.idx)} />)}
              <Row label="Subtotal — Necessity" wk={-tNW} mo={-moC(tNW)} y48={-y4(tNW)} y52={-y4(tNW)} bold border color="var(--c-taxable, #556FB5)" />

              <CSH color="var(--c-totaltax, #E8573A)" collapsed={collapsed.dis} onToggle={() => toggleSec("dis")}>Discretionary Expenses</CSH>
              {!collapsed.dis && disI.map(item => <ExpRowInner key={item.idx} item={item} cats={cats} onUpdate={u => updExp(item.idx, u)} onRemove={() => rmExp(item.idx)} />)}
              <Row label="Subtotal — Discretionary" wk={-tDW} mo={-moC(tDW)} y48={-y4(tDW)} y52={-y4(tDW)} bold border color="var(--c-totaltax, #E8573A)" />
              <Row label="Total All Expenses" wk={-tExpW} mo={-moC(tExpW)} y48={-y4(tExpW)} y52={-y4(tExpW)} bold border />

              <CSH color="#2ECC71" collapsed={collapsed.sav} onToggle={() => toggleSec("sav")}>Savings Goals</CSH>
              {!collapsed.sav && savSorted.map(item => <SavRowInner key={item.idx} item={item} savCats={savCats} onUpdate={u => updSav(item.idx, u)} onRemove={() => rmSav(item.idx)} />)}
              <Row label="Total Savings" wk={-tSavW} mo={-moC(tSavW)} y48={-y4(tSavW)} y52={-y5(tSavW)} bold border color="#2ECC71" />

              <div style={{ marginTop: 8, padding: "10px 8px", background: remW >= 0 ? "#f0faf5" : "#fef0ed", borderRadius: 8 }}>
                <Row label="Remaining to Budget" wk={remW} mo={moC(remW)} y48={remY48} y52={remY52} bold color={remW >= 0 ? "#2ECC71" : "#E74C3C"} />
              </div>
              <div style={{ marginTop: 4, padding: "6px 8px", background: "#f0faf5", borderRadius: 8 }}>
                <Row label="Total Savings + Remaining" wk={totalSavPlusRemW} mo={moC(totalSavPlusRemW)} y48={y4(totalSavPlusRemW)} y52={y5(tSavW) + Math.max(0, remY52)} bold color="#2ECC71" />
              </div>

              {/* EAIP Section */}
              {C.eaipGross > 0 && <>
                <CSH color="var(--c-posttax, #9B59B6)" collapsed={collapsed.eaip} onToggle={() => toggleSec("eaip")}>EAIP — Annual Bonus</CSH>
                {!collapsed.eaip && <>
                <Row label="Corey EAIP Gross" wk={0} mo={0} y48={C.cEaipGross} y52={C.cEaipGross} color="var(--c-posttax, #9B59B6)" />
                <Row label="Kelly EAIP Gross" wk={0} mo={0} y48={C.kEaipGross} y52={C.kEaipGross} color="var(--c-posttax, #9B59B6)" />
                <Row label="Combined EAIP Gross" wk={0} mo={0} y48={C.eaipGross} y52={C.eaipGross} bold border color="var(--c-posttax, #9B59B6)" />

                <CSH color="var(--c-fedtax, #1a5276)" collapsed={collapsed.eaipTax} onToggle={() => toggleSec("eaipTax")}>EAIP Taxes</CSH>
                {!collapsed.eaipTax && <>
                <Row label="Fed Withholding" sub={fp(C.mr)} wk={0} mo={0} y48={-(C.cEaipFed + C.kEaipFed)} y52={-(C.cEaipFed + C.kEaipFed)} color="var(--c-fedtax, #1a5276)" />
                {showPerPerson && <><Row label="  ↳ Corey" wk={0} mo={0} y48={-C.cEaipFed} y52={-C.cEaipFed} color="var(--c-fedtax2, #3a7abf)" /><Row label="  ↳ Kelly" wk={0} mo={0} y48={-C.kEaipFed} y52={-C.kEaipFed} color="var(--c-fedtax2, #3a7abf)" /></>}
                <Row label="OASDI (SS)" wk={0} mo={0} y48={-(C.cEaipSS + C.kEaipSS)} y52={-(C.cEaipSS + C.kEaipSS)} color="var(--c-fedtax, #1a5276)" />
                {showPerPerson && <><Row label="  ↳ Corey" wk={0} mo={0} y48={-C.cEaipSS} y52={-C.cEaipSS} color="var(--c-fedtax2, #3a7abf)" /><Row label="  ↳ Kelly" wk={0} mo={0} y48={-C.kEaipSS} y52={-C.kEaipSS} color="var(--c-fedtax2, #3a7abf)" /></>}
                <Row label="Medicare" wk={0} mo={0} y48={-(C.cEaipMc + C.kEaipMc)} y52={-(C.cEaipMc + C.kEaipMc)} color="var(--c-fedtax, #1a5276)" />
                {showPerPerson && <><Row label="  ↳ Corey" wk={0} mo={0} y48={-C.cEaipMc} y52={-C.cEaipMc} color="var(--c-fedtax2, #3a7abf)" /><Row label="  ↳ Kelly" wk={0} mo={0} y48={-C.kEaipMc} y52={-C.kEaipMc} color="var(--c-fedtax2, #3a7abf)" /></>}
                <Row label={`${tax.stateAbbr || "ST"} Withholding`} wk={0} mo={0} y48={-(C.cEaipSt + C.kEaipSt)} y52={-(C.cEaipSt + C.kEaipSt)} color="var(--c-sttax, #8B4513)" />
                {showPerPerson && <><Row label="  ↳ Corey" wk={0} mo={0} y48={-C.cEaipSt} y52={-C.cEaipSt} color="var(--c-sttax2, #B8860B)" /><Row label="  ↳ Kelly" wk={0} mo={0} y48={-C.kEaipSt} y52={-C.kEaipSt} color="var(--c-sttax2, #B8860B)" /></>}
                <Row label={`${tax.stateAbbr || "ST"} FAMLI`} wk={0} mo={0} y48={-(C.cEaipFL + C.kEaipFL)} y52={-(C.cEaipFL + C.kEaipFL)} color="var(--c-sttax, #8B4513)" />
                {showPerPerson && <><Row label="  ↳ Corey" wk={0} mo={0} y48={-C.cEaipFL} y52={-C.cEaipFL} color="var(--c-sttax2, #B8860B)" /><Row label="  ↳ Kelly" wk={0} mo={0} y48={-C.kEaipFL} y52={-C.kEaipFL} color="var(--c-sttax2, #B8860B)" /></>}
                </>}
                <Row label="Total EAIP Taxes" wk={0} mo={0} y48={-(C.cEaipTax + C.kEaipTax)} y52={-(C.cEaipTax + C.kEaipTax)} bold border color="var(--c-totaltax, #E8573A)" />
                {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>Corey tax: {fmt(C.cEaipTax)} • Kelly tax: {fmt(C.kEaipTax)}</div>}
                </>}

                <div style={{ marginTop: 4, padding: "8px", background: "#F3E8FF", borderRadius: 8 }}>
                  <Row label="EAIP Net (take-home)" wk={0} mo={0} y48={C.eaipNet} y52={C.eaipNet} bold color="var(--c-posttax, #9B59B6)" />
                  {showPerPerson && <div style={{ padding: "4px 0", fontSize: 12, color: "var(--tx3,#888)" }}>Corey: {fmt(C.cEaipNet)} • Kelly: {fmt(C.kEaipNet)}</div>}
                </div>
                <div style={{ marginTop: 4, padding: "8px", background: "#f0faf5", borderRadius: 8 }}>
                  <Row label="Total Savings + Remaining + EAIP" wk={totalSavPlusRemW} mo={moC(totalSavPlusRemW)} y48={y4(totalSavPlusRemW) + C.eaipNet} y52={y5(tSavW) + Math.max(0, remY52) + C.eaipNet} bold color="#2ECC71" />
                </div>
              </>}

            </Card>

            {/* Add item popup */}
            {showAddItem && (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowAddItem(false)}>
                <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 28, maxWidth: 500, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                  <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Add Budget Item</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Name</label>
                      <input value={niN} onChange={e => setNiN(e.target.value)} placeholder="Item name..." style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Section</label>
                        <select value={niS} onChange={e => setNiS(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="exp">Expense</option><option value="sav">Savings</option></select></div>
                      {niS === "exp" ? <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Type</label>
                        <select value={niT} onChange={e => setNiT(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="N">Necessity</option><option value="D">Discretionary</option></select></div> : <div />}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Category</label>
                        <select value={niC} onChange={e => setNiC(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}>{(niS === "sav" ? savCats : cats).map(c => <option key={c}>{c}</option>)}</select></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Period</label>
                        <select value={niP} onChange={e => setNiP(e.target.value)} style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, background: "#fafafa" }}><option value="w">Weekly</option><option value="m">Monthly</option><option value="y">Yearly</option></select></div>
                    </div>
                    <div><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Amount</label>
                      <NI value={niV} onChange={setNiV} prefix="$" /></div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                      <button onClick={() => setShowAddItem(false)} style={{ padding: "9px 18px", border: "2px solid #ddd", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                      <button onClick={() => { if (!niN.trim()) return; if (niS === "exp") setExp([...exp, { n: niN.trim(), c: niC || cats[0], t: niT, v: niV || "0", p: niP }]); else setSav([...sav, { n: niN.trim(), c: niC || savCats[0], v: niV || "0", p: niP }]); setNiN(""); setNiV(""); setShowAddItem(false); }}
                        style={{ padding: "9px 18px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ Add</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ CHARTS ═══ */}
        {tab === "charts" && (
          <div>
            <Card style={{ marginBottom: 20 }}>
              <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Save Budget Snapshot</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}><label style={{ fontSize: 11, fontWeight: 700, color: "#999" }}>Label</label>
                  <input value={snapLabel} onChange={e => setSnapLabel(e.target.value)} placeholder="What changed?" style={{ width: "100%", border: "2px solid #e0e0e0", borderRadius: 8, padding: 8, fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa", boxSizing: "border-box" }} /></div>
                <button onClick={() => {
                  // Build per-item snapshot data
                  const itemSnaps = {};
                  ewk.forEach(e => { itemSnaps[e.n] = { v: Math.round(e.wk * 48 * 100) / 100, t: e.t, c: e.c, f: e.f || "" }; });
                  savSorted.forEach(s => { itemSnaps[s.n] = { v: Math.round(s.wk * 48 * 100) / 100, t: "S", f: s.f || "" }; });
                  setSnapshots(prev => [...prev, {
                    id: Date.now(), date: new Date().toISOString().slice(0, 10), label: snapLabel || "Snapshot",
                    grossW: C.cw + C.kw, netW: C.net, necW: tNW, disW: tDW, expW: tExpW, savW: tSavW,
                    remW, savRate: C.net > 0 ? (totalSavPlusRemW / C.net * 100) : 0,
                    savRateGross: (C.cw + C.kw) > 0 ? (totalSavPlusRemW / (C.cw + C.kw) * 100) : 0,
                    cNetW: C.cNet, kNetW: C.kNet, cGrossW: C.cw, kGrossW: C.kw,
                    eaipNet: C.eaipNet, eaipGross: C.eaipGross, cEaipNet: C.cEaipNet, kEaipNet: C.kEaipNet,
                    items: itemSnaps,
                    fullState: { cSal, kSal, fil, cEaip, kEaip, preDed, postDed, c4pre, c4ro, k4pre, k4ro, cHsaAnn, kHsaAnn, exp, sav, cats, tax },
                  }]);
                  setSnapLabel("");
                }} style={{ padding: "9px 20px", background: "#556FB5", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>📸 Save</button>
              </div>
            </Card>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#999" }}>Show as % of:</span>
              <button onClick={() => setSavRateBase("net")} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: savRateBase === "net" ? "2px solid #4ECDC4" : "2px solid #ddd", borderRadius: 6, background: savRateBase === "net" ? "#E8F8F5" : "#fafafa", color: savRateBase === "net" ? "#4ECDC4" : "#888", cursor: "pointer" }}>Net Income</button>
              <button onClick={() => setSavRateBase("gross")} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: savRateBase === "gross" ? "2px solid #F2A93B" : "2px solid #ddd", borderRadius: 6, background: savRateBase === "gross" ? "#FEF5E7" : "#fafafa", color: savRateBase === "gross" ? "#F2A93B" : "#888", cursor: "pointer" }}>Gross Income</button>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#999", marginLeft: 8 }}>EAIP:</span>
              <button onClick={() => setIncludeEaip(p => !p)} style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, border: includeEaip ? "2px solid #9B59B6" : "2px solid #ddd", borderRadius: 6, background: includeEaip ? "#F3E8FF" : "#fafafa", color: includeEaip ? "#9B59B6" : "#888", cursor: "pointer" }}>
                {includeEaip ? "Included" : "Excluded"}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 20 }}>
              <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>By Category <span style={{ fontSize: 12, fontWeight: 500, color: "var(--tx3,#999)" }}>(% of {savRateBase} income)</span></h3>
                <div style={{ width: "100%", minHeight: 280 }}><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={catTot} cx="50%" cy="50%" outerRadius={95} innerRadius={48} paddingAngle={2} dataKey="value" stroke="none">{catTot.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip content={<PieTooltip />} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div>
              </Card>
              <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Necessity vs Discretionary <span style={{ fontSize: 12, fontWeight: 500, color: "#999" }}>(% of {savRateBase} income)</span></h3>
                <div style={{ width: "100%", minHeight: 280 }}><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={typTot} cx="50%" cy="50%" outerRadius={95} innerRadius={48} paddingAngle={3} dataKey="value" stroke="none">{typTot.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip content={<PieTooltip />} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div>
              </Card>
            </div>

            {snapshots.length > 0 && (() => {
              const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
              const curEaipNet = C.eaipNet, curEaipGross = C.eaipGross;
              const curCEaipNet = C.cEaipNet, curKEaipNet = C.kEaipNet;
              const trendData = sorted.map(s => {
                const snapEaipNet = s.eaipNet !== undefined ? s.eaipNet : curEaipNet;
                const snapEaipGross = s.eaipGross !== undefined ? s.eaipGross : curEaipGross;
                const eaip = includeEaip ? snapEaipNet : 0;
                const eaipG = includeEaip ? snapEaipGross : 0;
                const netInc = (s.netW || 0) * 48 + eaip;
                const grossInc = (s.grossW || 0) * 48 + eaipG;
                const savAmt = (s.savW || 0) * 48 + (s.remW || 0) * 48 + eaip;
                const snapCEaip = s.cEaipNet !== undefined ? s.cEaipNet : curCEaipNet;
                const snapKEaip = s.kEaipNet !== undefined ? s.kEaipNet : curKEaipNet;
                return {
                  date: s.date, label: s.label,
                  Expenses: Math.round((s.expW || 0) * 48),
                  Necessity: Math.round((s.necW || 0) * 48),
                  Discretionary: Math.round((s.disW || 0) * 48),
                  "Net Income": Math.round(netInc),
                  "Corey Net": Math.round(((s.cNetW || 0) * 48) + (includeEaip ? snapCEaip : 0)),
                  "Kelly Net": Math.round(((s.kNetW || 0) * 48) + (includeEaip ? snapKEaip : 0)),
                  "Gross Income": Math.round(grossInc),
                  "Savings Rate (Net)": netInc > 0 ? Math.round(savAmt / netInc * 1000) / 10 : 0,
                  "Savings Rate (Gross)": grossInc > 0 ? Math.round(savAmt / grossInc * 1000) / 10 : 0,
                };
              });
              const cs = { borderRadius: 10, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,.1)" };
              const hasPerPerson = sorted.some(s => s.cNetW && s.kNetW);
              return (
                <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 20, marginBottom: 20 }}>
                  <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Total Expenses (Yearly)</h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Line type="monotone" dataKey="Expenses" stroke="#E8573A" strokeWidth={2.5} dot={{ r: 4, fill: "#E8573A" }} /></LineChart></ResponsiveContainer></div></Card>
                  <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Necessity vs Discretionary</h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Necessity" stroke="#556FB5" strokeWidth={2.5} dot={{ r: 4, fill: "#556FB5" }} /><Line type="monotone" dataKey="Discretionary" stroke="#E8573A" strokeWidth={2.5} dot={{ r: 4, fill: "#E8573A" }} /></LineChart></ResponsiveContainer></div></Card>
                  <Card><h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Net Income (Yearly){includeEaip && <span style={{ fontSize: 12, fontWeight: 500, color: "#9B59B6" }}> + EAIP</span>}</h3><div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip formatter={v => fmt(v)} contentStyle={cs} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="Net Income" stroke="#4ECDC4" strokeWidth={2.5} dot={{ r: 4, fill: "#4ECDC4" }} name={includeEaip ? "Net Income + EAIP" : "Net Income"} />{hasPerPerson && <Line type="monotone" dataKey="Corey Net" stroke="#556FB5" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#556FB5" }} />}{hasPerPerson && <Line type="monotone" dataKey="Kelly Net" stroke="#E8573A" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 3, fill: "#E8573A" }} />}</LineChart></ResponsiveContainer></div></Card>
                  <Card>
                    <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Savings Rate (% of {savRateBase}){includeEaip && <span style={{ fontSize: 12, fontWeight: 500, color: "#9B59B6" }}> + EAIP</span>}</h3>
                    <div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}><LineChart data={trendData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} domain={[0, 'auto']} /><Tooltip formatter={v => `${v}%`} contentStyle={cs} /><Line type="monotone" dataKey={savRateBase === "gross" ? "Savings Rate (Gross)" : "Savings Rate (Net)"} stroke="#2ECC71" strokeWidth={2.5} dot={{ r: 4, fill: "#2ECC71" }} name={`Savings Rate (${savRateBase}${includeEaip ? " + EAIP" : ""})`} /></LineChart></ResponsiveContainer></div>
                  </Card>
                </div>
              );
            })()}

            {/* Item history chart */}
            {snapshots.length > 1 && (() => {
              const allItemNames = new Set();
              snapshots.forEach(s => { if (s.items) Object.keys(s.items).forEach(k => allItemNames.add(k)); });
              const names = [...allItemNames].sort();
              const selName = itemHistoryName || names[0] || "";
              const itemData = [...snapshots].sort((a, b) => a.date.localeCompare(b.date)).map(s => ({
                date: s.date, label: s.label, value: s.items?.[selName]?.v || 0,
              })).filter(d => d.value > 0 || true);
              return names.length > 0 ? (
                <Card style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Item History</h3>
                    <select value={selName} onChange={e => setItemHistoryName(e.target.value)} style={{ border: "2px solid #e0e0e0", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif", background: "#fafafa" }}>
                      {names.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div style={{ width: "100%", minHeight: 250 }}><ResponsiveContainer width="100%" height={250}>
                    <LineChart data={itemData}><XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => fmt(v)} /><Tooltip formatter={v => fmt(v)} contentStyle={{ borderRadius: 10, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,.1)" }} /><Line type="monotone" dataKey="value" stroke="#556FB5" strokeWidth={2.5} dot={{ r: 4, fill: "#556FB5" }} name={selName} /></LineChart>
                  </ResponsiveContainer></div>
                </Card>
              ) : null;
            })()}

            {snapshots.length > 0 && (
              <Card>
                <h3 style={{ margin: "0 0 16px", fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 800 }}>Snapshot History</h3>
                <div style={{ overflowX: "auto" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "80px 1.3fr 1fr 1fr 1fr 1fr 1fr 1fr 100px", gap: 4, fontSize: 9, fontWeight: 700, color: "#999", marginBottom: 6, minWidth: 850 }}>
                    <span>Date</span><span>Label</span><span style={{ textAlign: "right" }}>Net Income</span><span style={{ textAlign: "right" }}>Expenses</span><span style={{ textAlign: "right" }}>Savings</span><span style={{ textAlign: "right" }}>EAIP</span><span style={{ textAlign: "right" }}>Sav. Rate</span><span style={{ textAlign: "right" }}>Remaining</span><span />
                  </div>
                  {[...snapshots].sort((a, b) => b.date.localeCompare(a.date)).map(s => {
                    const ri = snapshots.findIndex(x => x.id === s.id);
                    return (
                      <div key={s.id} style={{ display: "grid", gridTemplateColumns: "80px 1.3fr 1fr 1fr 1fr 1fr 1fr 1fr 100px", gap: 4, padding: "5px 0", alignItems: "center", borderTop: "1px solid var(--bdr,#f0f0f0)", fontSize: 11, minWidth: 850 }}>
                        <span style={{ color: "var(--tx3,#888)" }}>{s.date}</span>
                        <span style={{ fontWeight: 600, color: "var(--tx,#333)" }}>{s.label}</span>
                        <span style={{ textAlign: "right", color: "#4ECDC4" }}>{fmt((s.netW || 0) * 48)}</span>
                        <span style={{ textAlign: "right", color: "#E8573A" }}>{fmt((s.expW || 0) * 48)}</span>
                        <span style={{ textAlign: "right", color: "#2ECC71" }}>{fmt((s.savW || 0) * 48)}</span>
                        <span style={{ textAlign: "right", color: "#9B59B6" }}>{fmt(s.eaipNet || 0)}</span>
                        <span style={{ textAlign: "right", color: "#556FB5" }}>{(s.savRate || 0).toFixed(1)}%</span>
                        <span style={{ textAlign: "right", color: (s.remW || 0) >= 0 ? "#2ECC71" : "#E74C3C" }}>{fmt((s.remW || 0) * 48)}</span>
                        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          <button onClick={() => { setViewingSnap(ri); setTab("budget"); }} style={{ padding: "3px 8px", background: "#556FB5", color: "#fff", border: "none", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>View</button>
                          {s.fullState && <button onClick={() => setRestoreConfirm(ri)} style={{ padding: "3px 6px", background: "none", border: "1px solid #F2A93B", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer", color: "#F2A93B" }}>↩</button>}
                          <button onClick={() => setSnapshots(snapshots.filter((_, j) => j !== ri))} style={{ padding: "3px 6px", background: "none", border: "1px solid #ddd", borderRadius: 4, fontSize: 10, cursor: "pointer", color: "#ccc" }}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {restoreConfirm !== null && (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setRestoreConfirm(null)}>
                <div onClick={e => e.stopPropagation()} style={{ background: "var(--card-bg, #fff)", borderRadius: 16, padding: 32, maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
                  <h3 style={{ margin: "0 0 12px", fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 800 }}>Restore Snapshot?</h3>
                  <p style={{ fontSize: 14, color: "var(--tx2,#555)", margin: "0 0 8px" }}>This will replace your <strong>entire current budget</strong> with:</p>
                  <div style={{ padding: "10px 14px", background: "var(--input-bg, #f8f8f8)", borderRadius: 8, marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, color: "var(--tx,#333)" }}>{snapshots[restoreConfirm]?.label}</div>
                    <div style={{ fontSize: 12, color: "var(--tx3,#888)" }}>{snapshots[restoreConfirm]?.date}</div>
                  </div>
                  <p style={{ fontSize: 13, color: "#E8573A", margin: "0 0 20px" }}>Consider saving a snapshot of your current budget first.</p>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button onClick={() => setRestoreConfirm(null)} style={{ padding: "9px 20px", border: "2px solid #ddd", borderRadius: 8, background: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--tx3,#888)" }}>Cancel</button>
                    <button onClick={() => {
                      const fs = snapshots[restoreConfirm]?.fullState;
                      if (fs) {
                        if (fs.cSal !== undefined) setCS(fs.cSal); if (fs.kSal !== undefined) setKS(fs.kSal);
                        if (fs.fil) setFil(fs.fil); if (fs.cEaip !== undefined) setCE(fs.cEaip); if (fs.kEaip !== undefined) setKE(fs.kEaip);
                        if (fs.preDed) setPreDed(fs.preDed); if (fs.postDed) setPostDed(fs.postDed);
                        if (fs.c4pre !== undefined) setC4pre(fs.c4pre); if (fs.c4ro !== undefined) setC4ro(fs.c4ro);
                        if (fs.k4pre !== undefined) setK4pre(fs.k4pre); if (fs.k4ro !== undefined) setK4ro(fs.k4ro);
                        if (fs.cHsaAnn !== undefined) setCHsaAnn(fs.cHsaAnn); if (fs.kHsaAnn !== undefined) setKHsaAnn(fs.kHsaAnn);
                        if (fs.exp) setExp(fs.exp); if (fs.sav) setSav(fs.sav);
                        if (fs.cats) setCats(fs.cats); if (fs.tax) setTax(fs.tax);
                      }
                      setRestoreConfirm(null); setTab("budget");
                    }} style={{ padding: "9px 20px", background: "#E8573A", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Restore</button>
                  </div>
                </div>
              </div>
            )}

            {snapshots.length === 0 && <Card style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 14, color: "#999" }}>No snapshots yet. Save your first above to start tracking trends.</div></Card>}
          </div>
        )}
      </div>
    </div>
  );
}

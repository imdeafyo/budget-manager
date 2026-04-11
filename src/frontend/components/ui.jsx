import { useState, useEffect, useRef, createContext, useContext } from "react";
import { evalF, resolveFormula, fmt } from "../utils/calc.js";

export function useM(bp = 700) { const [m, s] = useState(window.innerWidth < bp); useEffect(() => { const h = () => s(window.innerWidth < bp); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, [bp]); return m; }

/* ── Shared UI components (OUTSIDE App to prevent re-mount) ── */
export const Card = ({ children, style, dark }) => { const m = window.innerWidth < 700; return <div style={{ background: dark ? "linear-gradient(135deg,#1a1a1a,#2d2d2d)" : "var(--card-bg, #fff)", borderRadius: 14, padding: m ? 14 : 24, boxShadow: dark ? "none" : "var(--shadow, 0 1px 4px rgba(0,0,0,.06))", color: dark ? "#fff" : "var(--card-color, #222)", overflow: "hidden", maxWidth: "100%", ...style }}>{children}</div>; };
export const SH = ({ children, color }) => <div style={{ fontSize: 11, fontWeight: 700, color: color || "#999", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 24, marginBottom: 8 }}>{children}</div>;
export const CSH = ({ children, color, collapsed, onToggle }) => <div onClick={onToggle} style={{ fontSize: 11, fontWeight: 700, color: color || "#999", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 24, marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}><span style={{ fontSize: 14, transition: "transform 0.2s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>{children}</div>;

/* Text input — local state while typing, syncs to parent ONLY on blur to prevent re-render focus loss */
export function NI({ value, onChange, prefix, style, onBlurResolve, formula, autoFocus: af }) {
  const [local, setLocal] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!focused) setLocal(String(value)); }, [value, focused]);
  useEffect(() => { if (af && ref.current) { ref.current.focus(); ref.current.select(); } }, []);
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

export function PI({ value, onChange }) {
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

export function EditTxt({ value, onChange, color }) {
  const [ed, setEd] = useState(false);
  const [local, setLocal] = useState(value);
  useEffect(() => { if (!ed) setLocal(value); }, [value, ed]);
  return ed
    ? <input autoFocus value={local} onChange={e => setLocal(e.target.value)} onBlur={() => { onChange(local); setEd(false); }} onKeyDown={e => { if (e.key === "Enter") { onChange(local); setEd(false); } }} style={{ flex: 1, border: "1px solid #ddd", borderRadius: 4, padding: "2px 4px", fontSize: 12, fontFamily: "'DM Sans',sans-serif", minWidth: 0 }} />
    : <span onClick={() => setEd(true)} style={{ flex: 1, cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, color: color || "inherit" }} title="Click to rename">{value}</span>;
}

export const VisColsCtx = createContext({ wk: true, mo: true, y48: true, y52: true });
export const Row = ({ label, wk, mo, y48, y52, color, bold, border, sub }) => {
  const vc = useContext(VisColsCtx);
  const cols = ["1.8fr", vc.wk && "1fr", vc.mo && "1fr", vc.y48 && "1fr", vc.y52 && "1fr"].filter(Boolean).join(" ");
  return (
  <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, padding: "6px 0", alignItems: "center", borderTop: border ? "2px solid var(--bdr2, #e0ddd8)" : "none", fontWeight: bold ? 700 : 400 }}>
    <div style={{ fontSize: 12, color: color || "var(--tx, #333)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}{sub && <span style={{ fontSize: 10, color: "var(--tx3, #999)", marginLeft: 4 }}>({sub})</span>}</div>
    {vc.wk && <div style={{ fontSize: 12, textAlign: "right", color: color || "var(--tx, #333)" }}>{fmt(wk)}</div>}
    {vc.mo && <div style={{ fontSize: 12, textAlign: "right", color: color || "var(--tx, #333)" }}>{fmt(mo)}</div>}
    {vc.y48 && <div style={{ fontSize: 12, textAlign: "right", color: color || "var(--tx, #333)" }}>{fmt(y48)}</div>}
    {vc.y52 && <div style={{ fontSize: 12, textAlign: "right", color: color || "var(--tx3, #888)" }}>{fmt(y52)}</div>}
  </div>
  );
};

/* ── Expense Row — click any period column to edit in that period ── */
export function ExpRowInner({ item, cats, onUpdate, onRemove }) {
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
  const vc = useContext(VisColsCtx);
  const cols = ["1.8fr", vc.wk && "1fr", vc.mo && "1fr", vc.y48 && "1fr", vc.y52 && "1fr", "20px"].filter(Boolean).join(" ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, padding: "4px 0", alignItems: "center", background: item.hl ? "rgba(232,87,58,0.08)" : "transparent", borderRadius: item.hl ? 4 : 0 }}>
      <div style={{ fontSize: 12, color: "var(--tx2, #555)", display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <button onClick={() => onUpdate({ t: isN ? "D" : "N" })} title={isN ? "→ Discretionary" : "→ Necessity"}
          style={{ fontSize: 9, color: "#fff", fontWeight: 700, border: "none", borderRadius: 5, padding: "2px 6px", background: isN ? "#556FB5" : "#E8573A", cursor: "pointer", flexShrink: 0 }}>{isN ? "NEC" : "DIS"}</button>
        {eN
          ? <input autoFocus value={localName} onChange={e => setLocalName(e.target.value)} onBlur={() => { onUpdate({ n: localName }); sEN(false); }} onKeyDown={e => { if (e.key === "Enter") { onUpdate({ n: localName }); sEN(false); } }} style={{ flex: 1, border: "1px solid var(--input-border,#ddd)", borderRadius: 4, padding: "2px 4px", fontSize: 11, fontFamily: "'DM Sans',sans-serif", minWidth: 0 }} />
          : <span onClick={() => sEN(true)} style={{ flex: 1, cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, fontSize: 12 }} title="Click to rename">{item.n}</span>}
        <select className="cat-dd" value={item.c} onChange={e => onUpdate({ c: e.target.value })} style={{ flexShrink: 0, fontSize: 11 }}>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {(vc.wk ? ["w"] : []).concat(vc.mo ? ["m"] : []).concat(vc.y48 ? ["y"] : []).map(per => {
        if (editPer === per) {
          const editVal = per === item.p ? item.v : String(Math.round(valFor(per) * 100) / 100);
          return <div key={per} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setEditPer(null); }}><NI value={editVal} onChange={(v, raw) => { saveVal(v, raw, per); }} autoFocus onBlurResolve prefix="$" style={{ height: 28 }} /></div>;
        }
        return <div key={per} onClick={() => setEditPer(per)} style={{ fontSize: 12, textAlign: "right", color: "var(--tx2,#555)", cursor: "text", padding: "4px 2px", borderRadius: 4 }}>{fmt(valFor(per))}</div>;
      })}
      {vc.y52 && <div style={{ fontSize: 12, textAlign: "right", color: "var(--tx3,#888)" }}>{fmt(y48V)}</div>}
      <button onClick={onRemove} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--tx3,#ccc)", padding: 0 }}>×</button>
    </div>
  );
}

export function SavRowInner({ item, savCats, onUpdate, onRemove }) {
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
  const vc = useContext(VisColsCtx);
  const cols = ["1.8fr", vc.wk && "1fr", vc.mo && "1fr", vc.y48 && "1fr", vc.y52 && "1fr", "20px"].filter(Boolean).join(" ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, padding: "4px 0", alignItems: "center", background: item.hl ? "rgba(46,204,113,0.08)" : "transparent", borderRadius: item.hl ? 4 : 0 }}>
      <div style={{ fontSize: 12, color: "#2ECC71", fontWeight: 500, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
        <EditTxt value={item.n} onChange={n => onUpdate({ n })} color="#2ECC71" />
        <select className="cat-dd" value={item.c || ""} onChange={e => onUpdate({ c: e.target.value })} style={{ flexShrink: 0, fontSize: 11 }}>
          {(savCats || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {(vc.wk ? ["w"] : []).concat(vc.mo ? ["m"] : []).concat(vc.y48 ? ["y"] : []).map(per => {
        if (editPer === per) {
          const editVal = per === item.p ? item.v : String(Math.round(valFor(per) * 100) / 100);
          return <div key={per} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setEditPer(null); }}><NI value={editVal} onChange={(v, raw) => { saveVal(v, raw, per); }} autoFocus onBlurResolve prefix="$" style={{ height: 28 }} /></div>;
        }
        return <div key={per} onClick={() => setEditPer(per)} style={{ fontSize: 12, textAlign: "right", color: "var(--tx2,#555)", cursor: "text", padding: "4px 2px", borderRadius: 4 }}>{fmt(valFor(per))}</div>;
      })}
      {vc.y52 && <div style={{ fontSize: 12, textAlign: "right", color: "var(--tx3,#888)" }}>{fmt(y52V)}</div>}
      <button onClick={onRemove} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "var(--tx3,#ccc)", padding: 0 }}>×</button>
    </div>
  );
}

import { useState, useMemo, useRef } from "react";
import { parseCSV, headerSignature } from "../utils/csv.js";
import {
  parseDate, COMMON_DATE_FORMATS,
  buildTransactionFromRow, flagDuplicates,
  findProfileByHeaders, guessMapping, guessDateFormat,
} from "../utils/importPipeline.js";
import { newId } from "../utils/transactions.js";
import { fmt } from "../utils/calc.js";

/* ══════════════════════════ IMPORT MODAL ══════════════════════════
   Four steps:
     1. upload     — pick a CSV file, we parse headers and auto-match a profile
     2. mapping    — configure column mapping, date format, amount convention, account, alias toggles
     3. preview    — show up to 200 rows with error/duplicate/ok status; toggle-keep per dupe
     4. committing — add rows + save/update profile (just a spinner state)

   Props:
     existingTransactions, addTransactions, importProfiles, setImportProfiles,
     transactionColumns, budgetCategories (combined cats+savCats), onClose
*/

const STEP_UPLOAD = "upload";
const STEP_MAPPING = "mapping";
const STEP_PREVIEW = "preview";
const STEP_COMMITTING = "committing";

const AMOUNT_CONVENTIONS = [
  { id: "signed",           label: "Signed amount (negative = money out)" },
  { id: "negate-for-debit", label: "Positive amount — treat all as expenses (negate)" },
  { id: "separate",         label: "Separate Debit / Credit columns" },
  { id: "type-column",      label: "Amount + type column (Debit / Credit)" },
];

export default function ImportModal(props) {
  const {
    existingTransactions,
    addTransactions,
    importProfiles = [],
    setImportProfiles,
    transactionColumns = [],
    budgetCategories = [],
    onClose,
  } = props;

  const [step, setStep] = useState(STEP_UPLOAD);
  const [fileName, setFileName] = useState("");
  const [parsedHeaders, setParsedHeaders] = useState([]);
  const [parsedRows, setParsedRows] = useState([]);
  const [parseError, setParseError] = useState("");

  // Profile (either a brand-new blank one or a matched existing one being tweaked)
  const [profile, setProfile] = useState(blankProfile());
  const [matchedProfileId, setMatchedProfileId] = useState(null); // set if auto-matched

  // Preview state
  const [preview, setPreview] = useState([]);          // flagDuplicates() result
  const [skipSet, setSkipSet] = useState(new Set());   // indices to exclude
  const [committing, setCommitting] = useState(false);

  // Profile saving at commit time
  const [profileName, setProfileName] = useState("");
  const [saveProfile, setSaveProfile] = useState(true);

  /* ── Step 1: file pick ── */
  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0) {
        setParseError("The file appears to be empty.");
        return;
      }
      if (rows.length === 0) {
        setParseError("The file has headers but no data rows.");
        return;
      }
      setParsedHeaders(headers);
      setParsedRows(rows);

      // Auto-match against saved profiles
      const sig = headerSignature(headers);
      const match = findProfileByHeaders(importProfiles, sig);

      if (match) {
        setProfile({ ...match });
        setMatchedProfileId(match.id);
        setProfileName(match.name);
      } else {
        // Build a best-guess starter profile
        const guess = guessMapping(headers);
        // Try to guess date format from samples
        const dateCol = guess.mapping.date;
        let dateFormat = "MM/DD/YYYY";
        if (dateCol) {
          const samples = rows.slice(0, 20).map(r => r[dateCol]);
          const g = guessDateFormat(samples);
          if (g) dateFormat = g;
        }
        setProfile({
          ...blankProfile(),
          mapping: guess.mapping,
          amountConvention: guess.amountConvention,
          typeColumn: guess.typeColumn,
          dateFormat,
          headerSig: sig,
          defaultAccount: file.name.replace(/\.csv$/i, ""),
        });
        setProfileName(file.name.replace(/\.csv$/i, ""));
        setMatchedProfileId(null);
      }

      setStep(STEP_MAPPING);
    } catch (e) {
      setParseError("Couldn't read this file: " + (e?.message || String(e)));
    }
  };

  /* ── Step 2 → 3: build preview ── */
  const buildPreview = () => {
    const batchId = "pending-" + newId();
    const candidates = parsedRows.map(row => buildTransactionFromRow(row, profile, batchId));
    const flagged = flagDuplicates(candidates, existingTransactions || []);
    // Pre-skip everything flagged as duplicate by default; errors are always skipped.
    const initialSkip = new Set();
    flagged.forEach((r, i) => { if (r.status === "duplicate") initialSkip.add(i); });
    setPreview(flagged);
    setSkipSet(initialSkip);
    setStep(STEP_PREVIEW);
  };

  /* ── Step 3 → 4: commit ── */
  const commit = async () => {
    setCommitting(true);
    setStep(STEP_COMMITTING);
    const batchId = newId();
    const rowsToAdd = [];
    preview.forEach((p, i) => {
      if (skipSet.has(i)) return;
      if (p.status === "error") return;
      // Strip internal-only fields before adding
      const { _errors, _warnings, ...clean } = p.candidate;
      rowsToAdd.push({ ...clean, import_batch_id: batchId });
    });

    if (rowsToAdd.length) {
      try { await addTransactions(rowsToAdd); } catch (e) {
        alert("Failed to add transactions: " + (e?.message || String(e)));
        setCommitting(false);
        setStep(STEP_PREVIEW);
        return;
      }
    }

    // Save / update profile
    if (saveProfile && profileName.trim()) {
      const now = new Date().toISOString();
      const sig = headerSignature(parsedHeaders);
      if (matchedProfileId) {
        setImportProfiles(prev => prev.map(p => p.id === matchedProfileId
          ? { ...p, ...profile, id: matchedProfileId, name: profileName.trim(), headerSig: sig, updatedAt: now }
          : p));
      } else {
        // Check for name collision
        const existingByName = importProfiles.find(p => p.name === profileName.trim());
        if (existingByName) {
          if (confirm(`A profile named "${profileName}" already exists. Replace it?`)) {
            setImportProfiles(prev => prev.map(p => p.name === profileName.trim()
              ? { ...p, ...profile, id: p.id, name: profileName.trim(), headerSig: sig, updatedAt: now }
              : p));
          }
        } else {
          const newProfile = {
            ...profile,
            id: newId(),
            name: profileName.trim(),
            headerSig: sig,
            createdAt: now,
            updatedAt: now,
          };
          setImportProfiles(prev => [...prev, newProfile]);
        }
      }
    }

    onClose({ added: rowsToAdd.length, batchId: rowsToAdd.length ? batchId : null });
  };

  /* ── Render ── */
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !committing) onClose(null); }}
      style={overlay}>
      <div style={modal}>
        <Header step={step} fileName={fileName} onClose={onClose} committing={committing} />

        {step === STEP_UPLOAD && (
          <UploadStep onFile={handleFile} parseError={parseError} importProfiles={importProfiles} />
        )}

        {step === STEP_MAPPING && (
          <MappingStep
            headers={parsedHeaders}
            rows={parsedRows}
            profile={profile}
            setProfile={setProfile}
            transactionColumns={transactionColumns}
            budgetCategories={budgetCategories}
            matchedProfileId={matchedProfileId}
            onBack={() => setStep(STEP_UPLOAD)}
            onNext={buildPreview}
          />
        )}

        {step === STEP_PREVIEW && (
          <PreviewStep
            preview={preview}
            skipSet={skipSet}
            setSkipSet={setSkipSet}
            profile={profile}
            profileName={profileName}
            setProfileName={setProfileName}
            saveProfile={saveProfile}
            setSaveProfile={setSaveProfile}
            matchedProfileId={matchedProfileId}
            onBack={() => setStep(STEP_MAPPING)}
            onCommit={commit}
          />
        )}

        {step === STEP_COMMITTING && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--tx2, #555)" }}>
            Importing transactions…
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════ Header bar ════════════════════════════════ */
function Header({ step, fileName, onClose, committing }) {
  const stepLabel = {
    [STEP_UPLOAD]: "1. Upload",
    [STEP_MAPPING]: "2. Column mapping",
    [STEP_PREVIEW]: "3. Preview & commit",
    [STEP_COMMITTING]: "4. Importing",
  }[step];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--bdr2, #eee)" }}>
      <div>
        <div style={{ fontSize: 11, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>{stepLabel}</div>
        <h3 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontWeight: 800, fontSize: 20, color: "var(--tx, #333)" }}>
          Import transactions{fileName ? ` — ${fileName}` : ""}
        </h3>
      </div>
      {!committing && (
        <button onClick={() => onClose(null)} style={{ background: "none", border: "none", color: "var(--tx3, #888)", fontSize: 22, cursor: "pointer", padding: 4 }}>×</button>
      )}
    </div>
  );
}

/* ════════════════════════════════ Step 1: Upload ════════════════════════════════ */
function UploadStep({ onFile, parseError, importProfiles }) {
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div style={{ padding: 20 }}>
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        style={{
          border: `2px dashed ${dragOver ? "#556FB5" : "var(--bdr, #ccc)"}`,
          borderRadius: 12,
          padding: 40,
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "rgba(85, 111, 181, 0.06)" : "var(--input-bg, #fafafa)",
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>📥</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--tx, #333)", marginBottom: 4 }}>
          Drop a CSV here or click to choose
        </div>
        <div style={{ fontSize: 12, color: "var(--tx3, #888)" }}>
          UTF-8, RFC 4180 format. Most bank exports work out of the box.
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          style={{ display: "none" }} />
      </div>

      {parseError && (
        <div style={{ marginTop: 12, padding: 10, background: "rgba(232, 87, 58, 0.12)", borderLeft: "4px solid #E8573A", borderRadius: 4, fontSize: 13, color: "var(--tx, #333)" }}>
          {parseError}
        </div>
      )}

      {importProfiles.length > 0 && (
        <div style={{ marginTop: 20, padding: 12, background: "var(--input-bg, #fafafa)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            Saved profiles ({importProfiles.length})
          </div>
          <div style={{ fontSize: 12, color: "var(--tx2, #555)", lineHeight: 1.5 }}>
            We'll auto-match an existing profile if the CSV's headers match one you've saved.
            Current profiles: {importProfiles.map(p => p.name).join(", ")}.
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════ Step 2: Mapping ════════════════════════════════ */
function MappingStep({ headers, rows, profile, setProfile, transactionColumns, budgetCategories, matchedProfileId, onBack, onNext }) {
  const up = (patch) => setProfile(p => ({ ...p, ...patch }));
  const upMap = (key, val) => setProfile(p => ({ ...p, mapping: { ...p.mapping, [key]: val || null } }));
  const upCustomMap = (colId, val) => setProfile(p => ({ ...p, customMapping: { ...p.customMapping, [colId]: val || null } }));

  // Live-validate: check date samples parse under current dateFormat
  const dateCol = profile.mapping?.date;
  const dateSamples = useMemo(() => {
    if (!dateCol) return [];
    return rows.slice(0, 10).map(r => r[dateCol]).filter(Boolean);
  }, [rows, dateCol]);
  const dateValidation = useMemo(() => {
    if (!dateCol || !profile.dateFormat) return null;
    const total = dateSamples.length;
    if (!total) return null;
    const ok = dateSamples.filter(s => parseDate(s, profile.dateFormat) !== null).length;
    return { ok, total };
  }, [dateSamples, profile.dateFormat]);

  const canProceed = !!profile.mapping?.date
    && (profile.amountConvention === "separate"
        ? (profile.mapping?.debit || profile.mapping?.credit)
        : profile.mapping?.amount);

  const headerOptions = [{ value: "", label: "— not mapped —" }, ...headers.map(h => ({ value: h, label: h }))];

  const SelectHeader = ({ value, onChange, placeholder }) => (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...inp(), width: "100%" }}>
      {headerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  const hiddenBuiltins = []; // reserve for future use

  return (
    <div style={{ padding: 20, display: "grid", gap: 20, maxHeight: "calc(90vh - 160px)", overflowY: "auto" }}>
      {matchedProfileId && (
        <div style={{ padding: 10, background: "rgba(46, 204, 113, 0.10)", borderLeft: "4px solid #2ECC71", borderRadius: 4, fontSize: 13, color: "var(--tx, #333)" }}>
          Matched saved profile <strong>{profile.name}</strong>. Edits here update that profile on commit.
        </div>
      )}

      {/* Date */}
      <div>
        <SH>Date</SH>
        <div style={grid2}>
          <div>
            <Label>Source column</Label>
            <SelectHeader value={profile.mapping?.date} onChange={(v) => upMap("date", v)} />
          </div>
          <div>
            <Label>Date format</Label>
            <select value={profile.dateFormat || ""} onChange={(e) => up({ dateFormat: e.target.value })} style={{ ...inp(), width: "100%" }}>
              {COMMON_DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
        {dateValidation && (
          <div style={{ fontSize: 12, marginTop: 4, color: dateValidation.ok === dateValidation.total ? "#2ECC71" : "#E8573A" }}>
            {dateValidation.ok}/{dateValidation.total} sample dates parse correctly.
            {dateValidation.ok < dateValidation.total && dateSamples.length > 0 && (
              <> Example: <code style={{ fontFamily: "monospace", background: "var(--input-bg, #f5f5f5)", padding: "1px 4px", borderRadius: 3 }}>{dateSamples[0]}</code></>
            )}
          </div>
        )}
      </div>

      {/* Amount */}
      <div>
        <SH>Amount</SH>
        <Label>Convention</Label>
        <select value={profile.amountConvention} onChange={(e) => up({ amountConvention: e.target.value })} style={{ ...inp(), width: "100%", marginBottom: 8 }}>
          {AMOUNT_CONVENTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>

        {profile.amountConvention === "separate" ? (
          <div style={grid2}>
            <div>
              <Label>Debit column (money out)</Label>
              <SelectHeader value={profile.mapping?.debit} onChange={(v) => upMap("debit", v)} />
            </div>
            <div>
              <Label>Credit column (money in)</Label>
              <SelectHeader value={profile.mapping?.credit} onChange={(v) => upMap("credit", v)} />
            </div>
          </div>
        ) : (
          <div style={grid2}>
            <div>
              <Label>Amount column</Label>
              <SelectHeader value={profile.mapping?.amount} onChange={(v) => upMap("amount", v)} />
            </div>
            {profile.amountConvention === "type-column" && (
              <div>
                <Label>Type column (Debit/Credit indicator)</Label>
                <SelectHeader value={profile.typeColumn || ""} onChange={(v) => up({ typeColumn: v })} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Description / Category / Account / Notes */}
      <div>
        <SH>Other fields</SH>
        <div style={grid2}>
          <div>
            <Label>Description</Label>
            <SelectHeader value={profile.mapping?.description} onChange={(v) => upMap("description", v)} />
          </div>
          <div>
            <Label>Category</Label>
            <SelectHeader value={profile.mapping?.category} onChange={(v) => upMap("category", v)} />
          </div>
          <div>
            <Label>Account column (optional)</Label>
            <SelectHeader value={profile.mapping?.account} onChange={(v) => upMap("account", v)} />
          </div>
          <div>
            <Label>Default account (fallback)</Label>
            <input type="text" value={profile.defaultAccount || ""} onChange={(e) => up({ defaultAccount: e.target.value })}
              placeholder="e.g. Chase Checking" style={{ ...inp(), width: "100%" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Label>Notes (optional)</Label>
            <SelectHeader value={profile.mapping?.notes} onChange={(v) => upMap("notes", v)} />
          </div>
        </div>
      </div>

      {/* Category handling */}
      {profile.mapping?.category && (
        <div>
          <SH>Category handling</SH>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tx, #333)", marginBottom: 8 }}>
            <input type="checkbox" checked={!!profile.trustCategories}
              onChange={(e) => up({ trustCategories: e.target.checked })} />
            Trust source categories — use the imported category value directly
          </label>
          <div style={{ fontSize: 12, color: "var(--tx3, #888)", lineHeight: 1.5, marginBottom: 8 }}>
            {profile.trustCategories
              ? "Imported categories are used as-is, applied only through the alias map below if matched."
              : "Imported category column is ignored unless an alias below translates it to one of your budget categories. All other rows will be uncategorized."}
          </div>

          <CategoryAliasEditor
            aliases={profile.categoryAliases || {}}
            setAliases={(a) => up({ categoryAliases: a })}
            budgetCategories={budgetCategories}
            sampleValues={collectSampleCategories(rows, profile.mapping.category)}
          />
        </div>
      )}

      {/* Custom column mapping */}
      {transactionColumns.length > 0 && (
        <div>
          <SH>Custom columns</SH>
          <div style={{ fontSize: 12, color: "var(--tx3, #888)", marginBottom: 8 }}>
            Map source CSV columns to your custom transaction columns.
          </div>
          <div style={grid2}>
            {transactionColumns.map(col => (
              <div key={col.id}>
                <Label>{col.name} <span style={{ color: "var(--tx3, #aaa)", fontWeight: 400 }}>({col.type})</span></Label>
                <SelectHeader
                  value={profile.customMapping?.[col.id]}
                  onChange={(v) => upCustomMap(col.id, v)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid var(--bdr2, #eee)" }}>
        <button onClick={onBack} style={btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)")}>← Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!canProceed && (
            <span style={{ fontSize: 12, color: "#E8573A" }}>
              Date and amount mapping required.
            </span>
          )}
          <button onClick={onNext} disabled={!canProceed} style={{ ...btn("#556FB5", "#fff"), opacity: canProceed ? 1 : 0.5, cursor: canProceed ? "pointer" : "not-allowed" }}>
            Preview →
          </button>
        </div>
      </div>
    </div>
  );
}

/* Collect up to 20 distinct raw category values from the CSV for the alias editor suggestions. */
function collectSampleCategories(rows, colName) {
  if (!colName) return [];
  const s = new Set();
  for (const r of rows) {
    const v = r[colName];
    if (v && typeof v === "string") s.add(v.trim());
    if (s.size >= 20) break;
  }
  return [...s];
}

/* ── Category alias editor ── */
function CategoryAliasEditor({ aliases, setAliases, budgetCategories, sampleValues }) {
  const [newRaw, setNewRaw] = useState("");
  const [newMapped, setNewMapped] = useState("");

  const add = () => {
    const key = newRaw.trim();
    if (!key) return;
    setAliases({ ...aliases, [key]: newMapped });
    setNewRaw("");
    setNewMapped("");
  };

  const remove = (key) => {
    const copy = { ...aliases };
    delete copy[key];
    setAliases(copy);
  };

  const update = (key, val) => setAliases({ ...aliases, [key]: val });

  const existingKeys = Object.keys(aliases);
  const unmappedSamples = sampleValues.filter(s => !existingKeys.includes(s)).slice(0, 12);

  return (
    <div style={{ padding: 12, background: "var(--input-bg, #fafafa)", borderRadius: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        Category aliases ({existingKeys.length})
      </div>

      {existingKeys.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--tx3, #aaa)", fontStyle: "italic", marginBottom: 8 }}>
          No aliases yet. Add one below to translate an imported category into a budget category.
        </div>
      )}

      {existingKeys.map(k => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 6, alignItems: "center", marginBottom: 4 }}>
          <input value={k} readOnly style={{ ...inp(), background: "var(--card-bg, #fff)" }} />
          <span style={{ color: "var(--tx3, #888)" }}>→</span>
          <select value={aliases[k] || ""} onChange={(e) => update(k, e.target.value)} style={inp()}>
            <option value="">— uncategorized —</option>
            {budgetCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => remove(k)} style={{ border: "none", background: "none", color: "#E8573A", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input value={newRaw} onChange={(e) => setNewRaw(e.target.value)} placeholder="Imported name" style={inp()} />
        <span style={{ color: "var(--tx3, #888)" }}>→</span>
        <select value={newMapped} onChange={(e) => setNewMapped(e.target.value)} style={inp()}>
          <option value="">— uncategorized —</option>
          {budgetCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={add} disabled={!newRaw.trim()} style={{ ...btn("#2ECC71", "#fff"), opacity: newRaw.trim() ? 1 : 0.5 }}>Add</button>
      </div>

      {unmappedSamples.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: "var(--tx3, #888)" }}>
          <div style={{ marginBottom: 4 }}>Unmapped values from this file:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {unmappedSamples.map(s => (
              <button key={s} onClick={() => setNewRaw(s)}
                style={{ padding: "2px 8px", fontSize: 11, background: "var(--card-bg, #fff)", border: "1px solid var(--bdr, #ddd)", borderRadius: 4, cursor: "pointer", color: "var(--tx2, #555)" }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════ Step 3: Preview ════════════════════════════════ */
function PreviewStep({ preview, skipSet, setSkipSet, profile, profileName, setProfileName, saveProfile, setSaveProfile, matchedProfileId, onBack, onCommit }) {
  const counts = useMemo(() => {
    let ok = 0, dup = 0, err = 0;
    preview.forEach(p => {
      if (p.status === "ok") ok++;
      else if (p.status === "duplicate") dup++;
      else err++;
    });
    return { ok, dup, err, total: preview.length, willAdd: preview.filter((p, i) => !skipSet.has(i) && p.status !== "error").length };
  }, [preview, skipSet]);

  const toggleSkip = (i) => {
    const next = new Set(skipSet);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSkipSet(next);
  };

  const keepAllDupes = () => {
    const next = new Set(skipSet);
    preview.forEach((p, i) => { if (p.status === "duplicate") next.delete(i); });
    setSkipSet(next);
  };

  const skipAllDupes = () => {
    const next = new Set(skipSet);
    preview.forEach((p, i) => { if (p.status === "duplicate") next.add(i); });
    setSkipSet(next);
  };

  // Limit preview rendering for perf — show first 200
  const renderLimit = 200;
  const truncated = preview.length > renderLimit;

  return (
    <div style={{ padding: 20, display: "grid", gap: 16, maxHeight: "calc(90vh - 160px)", overflowY: "auto" }}>
      {/* Summary strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Stat label="Total rows" value={counts.total} color="var(--tx, #333)" />
        <Stat label="OK" value={counts.ok} color="#2ECC71" />
        <Stat label="Duplicates" value={counts.dup} color="#F2A93B" />
        <Stat label="Errors" value={counts.err} color="#E8573A" />
        <Stat label="Will add" value={counts.willAdd} color="#556FB5" />
      </div>

      {counts.dup > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, background: "rgba(242, 169, 59, 0.10)", borderLeft: "4px solid #F2A93B", borderRadius: 4 }}>
          <span style={{ fontSize: 13, color: "var(--tx, #333)", flex: 1 }}>
            {counts.dup} row{counts.dup === 1 ? "" : "s"} look like duplicates. Pre-skipped.
          </span>
          <button onClick={keepAllDupes} style={btn("var(--card-bg, #fff)", "var(--tx, #333)")}>Keep all</button>
          <button onClick={skipAllDupes} style={btn("var(--card-bg, #fff)", "var(--tx, #333)")}>Skip all</button>
        </div>
      )}

      {/* Preview table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--bdr2, #eee)", borderRadius: 8 }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead style={{ background: "var(--input-bg, #fafafa)", position: "sticky", top: 0 }}>
            <tr>
              <th style={{ ...th, width: 30 }}></th>
              <th style={th}>Status</th>
              <th style={th}>Date</th>
              <th style={th}>Description</th>
              <th style={{ ...th, textAlign: "right" }}>Amount</th>
              <th style={th}>Category</th>
              <th style={th}>Account</th>
            </tr>
          </thead>
          <tbody>
            {preview.slice(0, renderLimit).map((p, i) => {
              const isSkipped = skipSet.has(i);
              const isError = p.status === "error";
              const isDup = p.status === "duplicate";
              const rowBg = isError ? "rgba(232, 87, 58, 0.06)"
                : isDup ? "rgba(242, 169, 59, 0.06)"
                : "transparent";
              const rowOpacity = isSkipped ? 0.5 : 1;
              return (
                <tr key={i} style={{ background: rowBg, opacity: rowOpacity, borderTop: "1px solid var(--bdr2, #eee)" }}>
                  <td style={td}>
                    {!isError && (
                      <input type="checkbox" checked={!isSkipped} onChange={() => toggleSkip(i)} />
                    )}
                  </td>
                  <td style={td}>
                    {p.status === "ok" && <StatusBadge color="#2ECC71">OK</StatusBadge>}
                    {p.status === "duplicate" && <StatusBadge color="#F2A93B" title={`Dupe of existing row from ${p.existingMatch?.date}: ${p.existingMatch?.description}`}>Dupe</StatusBadge>}
                    {p.status === "error" && <StatusBadge color="#E8573A" title={(p.candidate._errors || []).join("; ")}>Error</StatusBadge>}
                  </td>
                  <td style={td}>{p.candidate.date || <em style={{ color: "#E8573A" }}>?</em>}</td>
                  <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.candidate.description}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: p.candidate.amount < 0 ? "#E8573A" : "#2ECC71" }}>
                    {fmt(p.candidate.amount)}
                  </td>
                  <td style={td}>{p.candidate.category || <span style={{ color: "var(--tx3, #aaa)", fontStyle: "italic" }}>—</span>}</td>
                  <td style={td}>{p.candidate.account}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {truncated && (
          <div style={{ padding: 8, textAlign: "center", fontSize: 12, color: "var(--tx3, #888)", background: "var(--input-bg, #fafafa)" }}>
            Showing first {renderLimit} of {preview.length} rows — the rest will commit based on their status.
          </div>
        )}
      </div>

      {/* Save profile */}
      <div style={{ padding: 12, background: "var(--input-bg, #fafafa)", borderRadius: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tx, #333)", marginBottom: 8 }}>
          <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
          {matchedProfileId ? "Update this saved profile" : "Save as a profile for next time"}
        </label>
        {saveProfile && (
          <input value={profileName} onChange={(e) => setProfileName(e.target.value)}
            placeholder="Profile name (e.g. Chase Checking)"
            style={{ ...inp(), width: "100%" }} />
        )}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid var(--bdr2, #eee)" }}>
        <button onClick={onBack} style={btn("var(--input-bg, #f5f5f5)", "var(--tx, #333)")}>← Back</button>
        <button onClick={onCommit} disabled={counts.willAdd === 0} style={{ ...btn("#2ECC71", "#fff"), opacity: counts.willAdd === 0 ? 0.5 : 1, cursor: counts.willAdd === 0 ? "not-allowed" : "pointer" }}>
          Import {counts.willAdd} transaction{counts.willAdd === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ padding: "8px 14px", background: "var(--input-bg, #fafafa)", borderRadius: 8, minWidth: 80 }}>
      <div style={{ fontSize: 10, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "'Fraunces',serif" }}>{value}</div>
    </div>
  );
}

function StatusBadge({ color, children, title }) {
  return (
    <span title={title} style={{ display: "inline-block", padding: "1px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, background: `${color}22`, color, borderRadius: 3 }}>
      {children}
    </span>
  );
}

/* ════════════════════════════════ shared ════════════════════════════════ */
function blankProfile() {
  return {
    id: null,
    name: "",
    headerSig: "",
    mapping: {},
    dateFormat: "MM/DD/YYYY",
    amountConvention: "signed",
    typeColumn: null,
    debitValues: ["debit", "dr", "withdrawal"],
    defaultAccount: "",
    trustCategories: false,
    categoryAliases: {},
    customMapping: {},
  };
}

function SH({ children }) {
  return (
    <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 1 }}>
      {children}
    </h4>
  );
}

function Label({ children }) {
  return (
    <label style={{ display: "block", fontSize: 11, color: "var(--tx3, #888)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
      {children}
    </label>
  );
}

const overlay = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 200, padding: 20,
};
const modal = {
  background: "var(--card-bg, #fff)",
  borderRadius: 12,
  maxWidth: 900, width: "100%",
  maxHeight: "90vh",
  display: "flex", flexDirection: "column",
  color: "var(--tx, #333)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  overflow: "hidden",
};
const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const inp = () => ({ padding: 6, fontSize: 13, borderRadius: 6, border: "1px solid var(--input-border, #e0e0e0)", background: "var(--input-bg, #fafafa)", color: "var(--input-color, #333)", fontFamily: "'DM Sans',sans-serif", boxSizing: "border-box" });
const btn = (bg, color) => ({ padding: "6px 14px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "none", background: bg, color, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" });
const th = { padding: "8px 10px", textAlign: "left", fontSize: 10, color: "var(--tx3, #888)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 };
const td = { padding: "6px 10px", verticalAlign: "middle" };

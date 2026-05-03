/* ══════════════════════════ CSV parser — RFC 4180 ══════════════════════════
   Pure, dependency-free CSV parser. Handles:
     - CRLF and LF line endings (mixed within a file OK)
     - Quoted fields with embedded commas, newlines, and escaped quotes ("")
     - UTF-8 BOM at start of file (stripped silently)
     - Trailing newline (produces no empty row)
     - Empty lines in the middle of the file (produces empty-string row)
     - Windows / classic Mac line endings

   Returns { headers, rows }:
     headers: string[] — first row of the file, trimmed
     rows:    Array<Record<string,string>> — each row keyed by header name

   If `raw` is passed, returns Array<Array<string>> instead (rows of cells
   without header interpretation). Used internally and exposed for preview UIs.
*/

export function parseCSV(text, opts = {}) {
  const cells = parseCSVRaw(text);
  if (opts.raw) return cells;
  if (cells.length === 0) return { headers: [], rows: [] };
  const headers = cells[0].map(h => String(h || "").trim());
  const rows = [];
  for (let i = 1; i < cells.length; i++) {
    const row = cells[i];
    // Skip fully-empty rows (common at end of file)
    if (row.length === 1 && row[0] === "") continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] !== undefined ? row[j] : "";
    }
    rows.push(obj);
  }
  return { headers, rows };
}

/* Low-level: parses CSV text into a 2D array of strings. */
export function parseCSVRaw(text) {
  if (text == null) return [];
  // Strip UTF-8 BOM
  let s = String(text);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const len = s.length;

  for (let i = 0; i < len; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        // Lookahead for escaped quote
        if (i + 1 < len && s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\r") {
      // Treat \r\n or bare \r as end-of-row
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (i + 1 < len && s[i + 1] === "\n") i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }

  // Trailing field / row
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ── Header signature ──
   Stable hash of a header row used to auto-match CSVs to saved import profiles.
   Normalization: trim, lowercase, collapse whitespace, sort alphabetically so
   column order changes don't break the signature. Joined with | delimiter. */
export function headerSignature(headers) {
  if (!Array.isArray(headers)) return "";
  const normalized = headers
    .map(h => String(h || "").trim().toLowerCase().replace(/\s+/g, " "))
    .filter(h => h.length > 0)
    .sort();
  return normalized.join("|");
}

/* ── CSV writer (RFC 4180) ──
   Inverse of parseCSV. Quotes any field containing a comma, double-quote,
   newline, or carriage return; doubles internal quotes. CRLF line endings
   for max spreadsheet compatibility (Excel on Windows is the common round-trip
   target — Numbers/Sheets handle both fine). Null/undefined become empty
   string; non-strings get String()'d.

   `headers` is the column order. `rows` is an array of row objects keyed by
   header name. Headers missing from a row produce empty cells. Extra fields
   on rows (not in headers) are ignored. */
export function escapeCsvField(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCSV(headers, rows) {
  if (!Array.isArray(headers) || !Array.isArray(rows)) return "";
  const lines = [];
  lines.push(headers.map(escapeCsvField).join(","));
  for (const row of rows) {
    const cells = headers.map(h => escapeCsvField(row?.[h]));
    lines.push(cells.join(","));
  }
  // CRLF — what Excel and most CSV-aware tools expect.
  return lines.join("\r\n") + "\r\n";
}

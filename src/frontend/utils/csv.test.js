import { describe, it, expect } from "vitest";
import { parseCSV, parseCSVRaw, headerSignature } from "./csv.js";

describe("parseCSV — basics", () => {
  it("parses a simple header+row file", () => {
    const { headers, rows } = parseCSV("date,amount,desc\n2026-01-01,12.34,Coffee");
    expect(headers).toEqual(["date", "amount", "desc"]);
    expect(rows).toEqual([{ date: "2026-01-01", amount: "12.34", desc: "Coffee" }]);
  });

  it("returns empty result for empty input", () => {
    expect(parseCSV("")).toEqual({ headers: [], rows: [] });
    expect(parseCSV(null)).toEqual({ headers: [], rows: [] });
  });

  it("parses multiple rows", () => {
    const { rows } = parseCSV("a,b\n1,2\n3,4\n5,6");
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({ a: "5", b: "6" });
  });
});

describe("parseCSV — RFC 4180 quoting", () => {
  it("handles quoted fields with embedded commas", () => {
    const { rows } = parseCSV(`a,b\n"Smith, John",42`);
    expect(rows[0]).toEqual({ a: "Smith, John", b: "42" });
  });

  it("handles escaped double-quotes inside quoted fields", () => {
    const { rows } = parseCSV(`a,b\n"She said ""hi""",1`);
    expect(rows[0].a).toBe('She said "hi"');
  });

  it("handles quoted fields with embedded newlines", () => {
    const { rows } = parseCSV(`a,b\n"line1\nline2",x`);
    expect(rows[0]).toEqual({ a: "line1\nline2", b: "x" });
  });

  it("handles fields that are just empty quotes", () => {
    const { rows } = parseCSV(`a,b,c\n1,"",3`);
    expect(rows[0]).toEqual({ a: "1", b: "", c: "3" });
  });

  it("handles a quoted field at end of row", () => {
    const { rows } = parseCSV(`a,b\n1,"last, field"`);
    expect(rows[0]).toEqual({ a: "1", b: "last, field" });
  });
});

describe("parseCSV — line endings & BOM", () => {
  it("handles CRLF line endings", () => {
    const { rows } = parseCSV("a,b\r\n1,2\r\n3,4");
    expect(rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("handles mixed LF and CRLF", () => {
    const { rows } = parseCSV("a,b\n1,2\r\n3,4\n5,6");
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({ a: "5", b: "6" });
  });

  it("strips UTF-8 BOM", () => {
    const bom = "\uFEFF";
    const { headers } = parseCSV(bom + "date,amount\n2026-01-01,5");
    expect(headers).toEqual(["date", "amount"]);
  });

  it("ignores trailing newline (no phantom empty row)", () => {
    const { rows } = parseCSV("a,b\n1,2\n");
    expect(rows).toHaveLength(1);
  });

  it("trims headers", () => {
    const { headers } = parseCSV("  date  , amount  \n1,2");
    expect(headers).toEqual(["date", "amount"]);
  });
});

describe("parseCSV — raw mode", () => {
  it("returns 2D array when opts.raw is true", () => {
    const cells = parseCSV("a,b\n1,2", { raw: true });
    expect(cells).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("parseCSVRaw direct export works", () => {
    expect(parseCSVRaw("x,y\n1,2")).toEqual([["x", "y"], ["1", "2"]]);
  });
});

describe("parseCSV — short rows", () => {
  it("fills missing trailing cells with empty strings", () => {
    const { rows } = parseCSV("a,b,c\n1,2");
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });
});

describe("headerSignature", () => {
  it("returns a stable string for the same headers", () => {
    const sig1 = headerSignature(["Date", "Amount", "Description"]);
    const sig2 = headerSignature(["Date", "Amount", "Description"]);
    expect(sig1).toBe(sig2);
    expect(sig1.length).toBeGreaterThan(0);
  });

  it("is order-independent", () => {
    const a = headerSignature(["Date", "Amount", "Description"]);
    const b = headerSignature(["Amount", "Description", "Date"]);
    expect(a).toBe(b);
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    const a = headerSignature(["Date", "Amount"]);
    const b = headerSignature(["  DATE  ", "amount"]);
    expect(a).toBe(b);
  });

  it("distinguishes different header sets", () => {
    const a = headerSignature(["Date", "Amount"]);
    const b = headerSignature(["Date", "Value"]);
    expect(a).not.toBe(b);
  });

  it("returns empty string for empty or invalid input", () => {
    expect(headerSignature([])).toBe("");
    expect(headerSignature(null)).toBe("");
    expect(headerSignature(undefined)).toBe("");
  });
});

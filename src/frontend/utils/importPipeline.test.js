import { describe, it, expect } from "vitest";
import {
  parseDate, COMMON_DATE_FORMATS,
  parseAmount, normalizeAmount,
  applyCategoryAlias,
  buildTransactionFromRow,
  flagDuplicates,
  findProfileByHeaders,
  guessMapping,
  guessDateFormat,
} from "./importPipeline.js";

describe("parseDate", () => {
  it("parses MM/DD/YYYY", () => {
    expect(parseDate("01/15/2026", "MM/DD/YYYY")).toBe("2026-01-15");
  });
  it("parses YYYY-MM-DD", () => {
    expect(parseDate("2026-03-07", "YYYY-MM-DD")).toBe("2026-03-07");
  });
  it("parses DD/MM/YYYY", () => {
    expect(parseDate("07/03/2026", "DD/MM/YYYY")).toBe("2026-03-07");
  });
  it("parses DD-MMM-YY with 2-digit year (pivot: <50 → 2000s)", () => {
    expect(parseDate("07-Mar-26", "DD-MMM-YY")).toBe("2026-03-07");
    expect(parseDate("07-Mar-99", "DD-MMM-YY")).toBe("1999-03-07");
  });
  it("parses DD-MMM-YYYY", () => {
    expect(parseDate("15-Jan-2026", "DD-MMM-YYYY")).toBe("2026-01-15");
  });
  it("parses MMM DD, YYYY", () => {
    expect(parseDate("Jan 15, 2026", "MMM DD, YYYY")).toBe("2026-01-15");
  });
  it("parses single-digit M/D/YYYY", () => {
    expect(parseDate("3/7/2026", "M/D/YYYY")).toBe("2026-03-07");
  });
  it("parses YYYYMMDD with no separators", () => {
    expect(parseDate("20260115", "YYYYMMDD")).toBe("2026-01-15");
  });
  it("returns null for unparseable input", () => {
    expect(parseDate("not a date", "MM/DD/YYYY")).toBe(null);
    expect(parseDate("", "MM/DD/YYYY")).toBe(null);
    expect(parseDate("01/15/2026", "YYYY-MM-DD")).toBe(null);
  });
  it("rejects invalid calendar dates (Feb 30)", () => {
    expect(parseDate("02/30/2026", "MM/DD/YYYY")).toBe(null);
    expect(parseDate("13/01/2026", "MM/DD/YYYY")).toBe(null);
    expect(parseDate("01/32/2026", "MM/DD/YYYY")).toBe(null);
  });
  it("handles leap years correctly", () => {
    expect(parseDate("02/29/2024", "MM/DD/YYYY")).toBe("2024-02-29");
    expect(parseDate("02/29/2026", "MM/DD/YYYY")).toBe(null); // not a leap year
  });
  it("rejects bad MMM abbreviations", () => {
    expect(parseDate("07-Xyz-26", "DD-MMM-YY")).toBe(null);
  });
  it("has all common formats documented", () => {
    expect(COMMON_DATE_FORMATS).toContain("MM/DD/YYYY");
    expect(COMMON_DATE_FORMATS).toContain("YYYY-MM-DD");
    expect(COMMON_DATE_FORMATS).toContain("DD-MMM-YY");
  });
});

describe("parseAmount", () => {
  it("parses plain numbers", () => {
    expect(parseAmount("12.34")).toBe(12.34);
    expect(parseAmount("0")).toBe(0);
  });
  it("parses already-negative numbers", () => {
    expect(parseAmount("-12.34")).toBe(-12.34);
  });
  it("parses accounting-style parentheses as negative", () => {
    expect(parseAmount("(123.45)")).toBe(-123.45);
  });
  it("parses trailing-minus as negative", () => {
    expect(parseAmount("12.34-")).toBe(-12.34);
  });
  it("strips currency symbols", () => {
    expect(parseAmount("$1234.56")).toBe(1234.56);
    expect(parseAmount("€99.00")).toBe(99);
  });
  it("strips thousands separators", () => {
    expect(parseAmount("1,234,567.89")).toBe(1234567.89);
  });
  it("handles whitespace", () => {
    expect(parseAmount("  12.34  ")).toBe(12.34);
  });
  it("returns 0 for empty/invalid", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount("not a number")).toBe(0);
  });
});

describe("normalizeAmount — signed convention", () => {
  it("passes through signed amounts", () => {
    expect(normalizeAmount({ amt: "-12.34" }, { amountConvention: "signed", amountColumn: "amt" })).toBe(-12.34);
    expect(normalizeAmount({ amt: "50" }, { amountConvention: "signed", amountColumn: "amt" })).toBe(50);
  });
});

describe("normalizeAmount — negate-for-debit convention", () => {
  it("always returns negative", () => {
    expect(normalizeAmount({ amt: "12.34" }, { amountConvention: "negate-for-debit", amountColumn: "amt" })).toBe(-12.34);
    expect(normalizeAmount({ amt: "-12.34" }, { amountConvention: "negate-for-debit", amountColumn: "amt" })).toBe(-12.34);
  });
});

describe("normalizeAmount — separate debit/credit columns", () => {
  const spec = { amountConvention: "separate", debitColumn: "debit", creditColumn: "credit" };
  it("treats debit as negative, credit as positive", () => {
    expect(normalizeAmount({ debit: "12.34", credit: "" }, spec)).toBe(-12.34);
    expect(normalizeAmount({ debit: "", credit: "50" }, spec)).toBe(50);
  });
  it("returns 0 when both columns empty", () => {
    expect(normalizeAmount({ debit: "", credit: "" }, spec)).toBe(0);
  });
  it("nets debit against credit when both present", () => {
    expect(normalizeAmount({ debit: "100", credit: "30" }, spec)).toBe(-70);
  });
});

describe("normalizeAmount — type-column convention", () => {
  const spec = {
    amountConvention: "type-column",
    amountColumn: "amt",
    typeColumn: "type",
    debitValues: ["DEBIT", "DR"],
  };
  it("negates when type matches debit values", () => {
    expect(normalizeAmount({ amt: "12.34", type: "DEBIT" }, spec)).toBe(-12.34);
    expect(normalizeAmount({ amt: "12.34", type: "dr" }, spec)).toBe(-12.34);
  });
  it("keeps positive when type is credit", () => {
    expect(normalizeAmount({ amt: "50", type: "CREDIT" }, spec)).toBe(50);
  });
  it("default debitValues include common terms", () => {
    const defaultSpec = { amountConvention: "type-column", amountColumn: "amt", typeColumn: "type" };
    expect(normalizeAmount({ amt: "10", type: "debit" }, defaultSpec)).toBe(-10);
    expect(normalizeAmount({ amt: "10", type: "withdrawal" }, defaultSpec)).toBe(-10);
  });
});

describe("applyCategoryAlias", () => {
  const map = { "Food & Drink": "Dining", "Gas": "Transport" };
  it("applies alias when raw matches a key", () => {
    expect(applyCategoryAlias("Food & Drink", map, false)).toBe("Dining");
  });
  it("is case-insensitive", () => {
    expect(applyCategoryAlias("food & drink", map, false)).toBe("Dining");
  });
  it("collapses whitespace", () => {
    expect(applyCategoryAlias("Food  &  Drink", map, false)).toBe("Dining");
  });
  it("returns null when no alias and trustCategories=false", () => {
    expect(applyCategoryAlias("Unknown", map, false)).toBe(null);
  });
  it("returns raw string when no alias and trustCategories=true", () => {
    expect(applyCategoryAlias("Unknown", map, true)).toBe("Unknown");
  });
  it("returns null for empty input", () => {
    expect(applyCategoryAlias("", map, true)).toBe(null);
    expect(applyCategoryAlias(null, map, true)).toBe(null);
  });
});

describe("buildTransactionFromRow", () => {
  const profile = {
    name: "Chase Checking",
    mapping: { date: "Date", amount: "Amount", description: "Desc", category: "Cat", account: "Acct", notes: "Memo" },
    dateFormat: "MM/DD/YYYY",
    amountConvention: "signed",
    trustCategories: true,
    categoryAliases: { "Food & Drink": "Dining" },
    customMapping: {},
    defaultAccount: "Chase",
  };

  it("builds a valid transaction", () => {
    const row = { Date: "01/15/2026", Amount: "-12.34", Desc: "Coffee", Cat: "Food & Drink", Acct: "Chase", Memo: "morning" };
    const tx = buildTransactionFromRow(row, profile, "batch-1");
    expect(tx.date).toBe("2026-01-15");
    expect(tx.amount).toBe(-12.34);
    expect(tx.description).toBe("Coffee");
    expect(tx.category).toBe("Dining"); // via alias
    expect(tx.account).toBe("Chase");
    expect(tx.notes).toBe("morning");
    expect(tx.import_batch_id).toBe("batch-1");
    expect(tx.import_source).toBe("Chase Checking");
    expect(tx._errors).toEqual([]);
  });

  it("flags unparseable date as error", () => {
    const row = { Date: "not-a-date", Amount: "-12.34", Desc: "x", Cat: "", Acct: "", Memo: "" };
    const tx = buildTransactionFromRow(row, profile, "b");
    expect(tx._errors.length).toBeGreaterThan(0);
    expect(tx._errors[0]).toMatch(/date/i);
  });

  it("warns on zero amount", () => {
    const row = { Date: "01/15/2026", Amount: "0", Desc: "x", Cat: "", Acct: "", Memo: "" };
    const tx = buildTransactionFromRow(row, profile, "b");
    expect(tx._warnings).toContain("Zero amount");
  });

  it("falls back to profile defaultAccount when account column is empty", () => {
    const row = { Date: "01/15/2026", Amount: "5", Desc: "x", Cat: "", Acct: "", Memo: "" };
    const tx = buildTransactionFromRow(row, profile, "b");
    expect(tx.account).toBe("Chase");
  });

  it("falls back to profile name when defaultAccount missing", () => {
    const p2 = { ...profile, defaultAccount: "" };
    const row = { Date: "01/15/2026", Amount: "5", Desc: "x", Cat: "", Acct: "", Memo: "" };
    const tx = buildTransactionFromRow(row, p2, "b");
    expect(tx.account).toBe("Chase Checking");
  });

  it("ignores imported category when trustCategories=false and no alias", () => {
    const p2 = { ...profile, trustCategories: false };
    const row = { Date: "01/15/2026", Amount: "5", Desc: "x", Cat: "Unknown Bucket", Acct: "", Memo: "" };
    const tx = buildTransactionFromRow(row, p2, "b");
    expect(tx.category).toBe(null);
  });

  it("populates custom_fields from customMapping", () => {
    const p2 = { ...profile, customMapping: { "merchant-id": "MerchantID" } };
    const row = { Date: "01/15/2026", Amount: "5", Desc: "x", Cat: "", Acct: "", Memo: "", MerchantID: "M-42" };
    const tx = buildTransactionFromRow(row, p2, "b");
    expect(tx.custom_fields["merchant-id"]).toBe("M-42");
  });
});

describe("flagDuplicates", () => {
  it("flags exact matches against existing", () => {
    const existing = [{ date: "2026-01-15", amount: -12.34, description: "Coffee", account: "Chase" }];
    const candidates = [
      { date: "2026-01-15", amount: -12.34, description: "Coffee", account: "Chase", _errors: [] },
      { date: "2026-01-16", amount: -5,    description: "Tea",    account: "Chase", _errors: [] },
    ];
    const result = flagDuplicates(candidates, existing);
    expect(result[0].status).toBe("duplicate");
    expect(result[1].status).toBe("ok");
  });

  it("dedupes within the incoming batch", () => {
    const candidates = [
      { date: "2026-01-15", amount: -5, description: "x", account: "A", _errors: [] },
      { date: "2026-01-15", amount: -5, description: "x", account: "A", _errors: [] }, // dupe of first
    ];
    const result = flagDuplicates(candidates, []);
    expect(result[0].status).toBe("ok");
    expect(result[1].status).toBe("duplicate");
  });

  it("marks rows with _errors as error, not duplicate", () => {
    const candidates = [{ _errors: ["bad date"], date: "", amount: 0, description: "", account: "" }];
    const result = flagDuplicates(candidates, []);
    expect(result[0].status).toBe("error");
  });

  it("ignores casing and whitespace in description for hash", () => {
    const existing = [{ date: "2026-01-15", amount: -5, description: "Starbucks  ", account: "chase" }];
    const candidates = [{ date: "2026-01-15", amount: -5, description: "STARBUCKS", account: "Chase", _errors: [] }];
    const result = flagDuplicates(candidates, existing);
    expect(result[0].status).toBe("duplicate");
  });
});

describe("findProfileByHeaders", () => {
  const profiles = [
    { id: "1", name: "Chase", headerSig: "amount|date|description" },
    { id: "2", name: "Amex",  headerSig: "amount|date|merchant" },
  ];
  it("returns matching profile", () => {
    const p = findProfileByHeaders(profiles, "amount|date|description");
    expect(p?.name).toBe("Chase");
  });
  it("returns null when no match", () => {
    expect(findProfileByHeaders(profiles, "foo|bar")).toBe(null);
  });
  it("handles empty inputs gracefully", () => {
    expect(findProfileByHeaders([], "x")).toBe(null);
    expect(findProfileByHeaders(null, "x")).toBe(null);
    expect(findProfileByHeaders(profiles, "")).toBe(null);
  });
});

describe("guessMapping", () => {
  it("maps common column names for single-amount CSVs", () => {
    const { mapping, amountConvention } = guessMapping(["Date", "Description", "Amount", "Category"]);
    expect(mapping.date).toBe("Date");
    expect(mapping.description).toBe("Description");
    expect(mapping.amount).toBe("Amount");
    expect(mapping.category).toBe("Category");
    expect(amountConvention).toBe("signed");
  });

  it("detects separate debit/credit columns", () => {
    const { mapping, amountConvention } = guessMapping(["Date", "Description", "Debit", "Credit"]);
    expect(mapping.debit).toBe("Debit");
    expect(mapping.credit).toBe("Credit");
    expect(amountConvention).toBe("separate");
  });

  it("detects type-column convention", () => {
    const { mapping, amountConvention, typeColumn } = guessMapping(["Date", "Description", "Amount", "Type"]);
    expect(mapping.amount).toBe("Amount");
    expect(typeColumn).toBe("Type");
    expect(amountConvention).toBe("type-column");
  });

  it("is case-insensitive on header names", () => {
    const { mapping } = guessMapping(["DATE", "descr", "AMT"]);
    expect(mapping.date).toBe("DATE");
    expect(mapping.description).toBe("descr");
    expect(mapping.amount).toBe("AMT");
  });

  it("returns empty mapping when nothing matches", () => {
    const { mapping } = guessMapping(["foo", "bar"]);
    expect(mapping.date).toBeUndefined();
  });
});

describe("guessDateFormat", () => {
  it("picks MM/DD/YYYY when all samples match", () => {
    expect(guessDateFormat(["01/15/2026", "03/07/2026", "12/31/2025"])).toBe("MM/DD/YYYY");
  });
  it("picks YYYY-MM-DD when all samples match", () => {
    expect(guessDateFormat(["2026-01-15", "2026-03-07"])).toBe("YYYY-MM-DD");
  });
  it("returns null when formats are inconsistent", () => {
    expect(guessDateFormat(["01/15/2026", "2026-03-07"])).toBe(null);
  });
  it("ignores empty samples", () => {
    expect(guessDateFormat(["", "01/15/2026", ""])).toBe("MM/DD/YYYY");
  });
  it("returns null for empty input", () => {
    expect(guessDateFormat([])).toBe(null);
    expect(guessDateFormat(null)).toBe(null);
  });
});

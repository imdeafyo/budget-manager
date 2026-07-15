/* ══════════════════════════ genericPersistence — save/load round trip ══════════════════════════
   WHY THIS FILE EXISTS

   The generic build replaces the apiFetch import in useAppState.jsx with a
   localStorage-backed shim (see scripts/build-generic.mjs). That shim has to
   honour a contract with the surrounding code that is easy to get subtly wrong:

       SAVE:  useAppState PUTs   JSON.stringify({ state: st })   ← WRAPPED
       LOAD:  useAppState reads  (await res.json()).state        ← expects wrapped

   ...while the ON-DISK format (the <textarea id="budget-data"> the 💾 button
   writes, and that the update-download bakes) is the BARE state object.

   So the shim must unwrap on write and re-wrap on read. The first shipped
   version did neither — it stored opts.body verbatim ({state:{...}}) and then
   re-wrapped on read, producing {state:{state:{...}}}. useAppState read r.state,
   got {state:{...}} instead of the actual fields, every value came back
   undefined, and the app silently fell back to defaults. Saves *looked* fine;
   every reload showed a blank budget, in every browser.

   The reason that shipped: every test asserted a piece of the logic in
   isolation (does the marker parse? does precedence pick the right source?) and
   none asserted the only thing that matters — WRITE THEN READ RETURNS WHAT YOU
   WROTE. These tests do exactly that, against a transcription of the real shim.

   If the shim in build-generic.mjs changes, change the transcription below to
   match. A drift here is a real signal, not test friction.
*/
import { describe, it, expect, beforeEach } from "vitest";

/* Transcription of the shim injected by scripts/build-generic.mjs.
   Kept deliberately literal so it can be diffed against the build script. */
function createShim({ durable = true, textarea = null } = {}) {
  const store = {};
  const attrs = {};
  const ls = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => {
      if (!durable) return; // non-durable store: writes vanish (memory-only sim)
      store[k] = String(v);
    },
  };
  const ta = textarea === null ? null : {
    textContent: textarea.text ?? "",
    getAttribute: k => attrs[k] ?? (textarea.fresh && k === "data-fresh" ? "1" : null),
    removeAttribute: k => { attrs[k] = null; textarea.fresh = false; },
  };
  const doc = { getElementById: () => ta };

  const apiFetch = async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (method === "PUT") {
      try {
        let body = opts.body;
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed === "object" && parsed.state !== undefined) {
            body = JSON.stringify(parsed.state);
          }
        } catch {}
        ls.setItem("budget-data", body);
      } catch {}
      return { ok: true, status: 200, reqId: null, json: async () => ({}) };
    }
    let raw = null;
    const t = doc.getElementById("budget-data");
    const taText = t && t.textContent && t.textContent.trim();
    const fresh = t && t.getAttribute("data-fresh") === "1" && taText;
    if (fresh) {
      raw = taText;
      ls.setItem("budget-data", raw);
      t.removeAttribute("data-fresh");
    } else {
      raw = ls.getItem("budget-data");
      if (!raw && taText) raw = taText;
    }
    return {
      ok: true, status: 200, reqId: null,
      json: async () => {
        if (!raw) return {};
        try { return { state: JSON.parse(raw) }; } catch { return {}; }
      },
    };
  };
  return { apiFetch, store };
}

/* Mirrors how useAppState actually saves and loads. */
const save = (shim, st) => shim.apiFetch("/api/state", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ state: st }),
});
const load = async (shim) => {
  const res = await shim.apiFetch("/api/state");
  const r = await res.json();
  return r?.state ?? null; // exactly what useAppState reads
};

const SAMPLE = {
  cSal: 100000,
  exp: [{ n: "Rent", a: 2000 }, { n: "Groceries", a: 600 }],
  tax: { fil: "mfj" },
  forecast: { accounts: [{ id: "a1", nickname: "401k" }] },
};

describe("THE BUG: save → load round trip", () => {
  let shim;
  beforeEach(() => { shim = createShim(); });

  it("returns exactly what was written (no double-wrap)", async () => {
    await save(shim, SAMPLE);
    expect(await load(shim)).toEqual(SAMPLE);
  });

  it("individual fields are readable, not buried a level deep", async () => {
    await save(shim, SAMPLE);
    const st = await load(shim);
    // The precise failure: these were all undefined because state was nested.
    expect(st.cSal).toBe(100000);
    expect(st.exp).toHaveLength(2);
    expect(st.exp[0].n).toBe("Rent");
    expect(st.tax.fil).toBe("mfj");
    expect(st.forecast.accounts[0].nickname).toBe("401k");
  });

  it("stores the BARE state, matching the textarea/💾 on-disk format", async () => {
    await save(shim, SAMPLE);
    const stored = JSON.parse(shim.store["budget-data"]);
    expect(stored.state).toBeUndefined(); // must NOT be {state:{...}}
    expect(stored.cSal).toBe(100000);
  });

  it("survives repeated save/load cycles", async () => {
    await save(shim, SAMPLE);
    let st = await load(shim);
    st = { ...st, cSal: 120000 };
    await save(shim, st);
    expect((await load(shim)).cSal).toBe(120000);
    await save(shim, { ...st, cSal: 130000 });
    expect((await load(shim)).cSal).toBe(130000);
  });

  it("tolerates an already-bare payload (defensive)", async () => {
    await shim.apiFetch("/api/state", { method: "PUT", body: JSON.stringify(SAMPLE) });
    expect((await load(shim)).cSal).toBe(100000);
  });
});

describe("load sources", () => {
  it("empty storage and no textarea → null, no crash", async () => {
    expect(await load(createShim())).toBeNull();
  });

  it("first open: reads the file's textarea when storage is empty", async () => {
    const shim = createShim({ textarea: { text: JSON.stringify(SAMPLE) } });
    expect((await load(shim)).cSal).toBe(100000);
  });

  it("storage wins over a stale textarea (unsaved edits survive reload)", async () => {
    const shim = createShim({ textarea: { text: JSON.stringify({ cSal: 1 }) } });
    await save(shim, SAMPLE);
    expect((await load(shim)).cSal).toBe(100000); // not 1
  });

  it("downloaded update: data-fresh marker beats stale storage", async () => {
    const fresh = { cSal: 999, exp: [] };
    const shim = createShim({ textarea: { text: JSON.stringify(fresh), fresh: true } });
    await save(shim, SAMPLE); // storage holds the OLD copy
    expect((await load(shim)).cSal).toBe(999);
  });

  it("data-fresh reseeds storage, and is consumed once", async () => {
    const fresh = { cSal: 999 };
    const shim = createShim({ textarea: { text: JSON.stringify(fresh), fresh: true } });
    await load(shim);
    expect(JSON.parse(shim.store["budget-data"]).cSal).toBe(999);
    await save(shim, { cSal: 555 });
    expect((await load(shim)).cSal).toBe(555); // not back to 999
  });

  it("corrupt JSON → null rather than a crash", async () => {
    const shim = createShim();
    shim.store["budget-data"] = "{not json";
    expect(await load(shim)).toBeNull();
  });
});

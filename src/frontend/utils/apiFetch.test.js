/* utils/apiFetch.test.js — verifies the request-id correlation wrapper.

   Mocks global fetch via vitest.fn(). Each test resets state via beforeEach.
   Tests focus on the contract: header injection, echo capture, caller-override,
   network-error path, and graceful fallback when crypto.randomUUID is missing.
*/

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// log.js is imported by apiFetch.js. We don't need to mock it — its calls are
// side-effecting but harmless in tests. _resetForTests keeps the buffer clean.
import { _resetForTests as resetLog } from "./log.js";

import apiFetch from "./apiFetch.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

describe("apiFetch", () => {
  beforeEach(() => {
    resetLog();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects X-Request-Id when caller didn't provide one", async () => {
    global.fetch.mockResolvedValue(jsonResponse({ ok: 1 }));
    await apiFetch("/api/state");
    const call = global.fetch.mock.calls[0];
    const headers = call[1].headers;
    expect(headers.get("X-Request-Id")).toBeTruthy();
    expect(headers.get("X-Request-Id").length).toBeGreaterThan(8);
  });

  it("generates a different X-Request-Id on each call", async () => {
    global.fetch.mockResolvedValue(jsonResponse({}));
    await apiFetch("/api/state");
    await apiFetch("/api/state");
    const id1 = global.fetch.mock.calls[0][1].headers.get("X-Request-Id");
    const id2 = global.fetch.mock.calls[1][1].headers.get("X-Request-Id");
    expect(id1).not.toBe(id2);
  });

  it("respects a caller-supplied X-Request-Id", async () => {
    global.fetch.mockResolvedValue(jsonResponse({}));
    await apiFetch("/api/state", { headers: { "X-Request-Id": "caller-id-123" } });
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.get("X-Request-Id")).toBe("caller-id-123");
  });

  it("preserves other caller headers", async () => {
    global.fetch.mockResolvedValue(jsonResponse({}));
    await apiFetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Custom": "foo" },
      body: "{}",
    });
    const opts = global.fetch.mock.calls[0][1];
    expect(opts.method).toBe("PUT");
    expect(opts.headers.get("Content-Type")).toBe("application/json");
    expect(opts.headers.get("X-Custom")).toBe("foo");
    expect(opts.headers.get("X-Request-Id")).toBeTruthy();
    expect(opts.body).toBe("{}");
  });

  it("attaches reqId from response echo to the returned Response", async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({}, { headers: { "X-Request-Id": "server-echoed-xyz" } })
    );
    const res = await apiFetch("/api/state");
    expect(res.reqId).toBe("server-echoed-xyz");
  });

  it("falls back to client-generated id when server doesn't echo", async () => {
    global.fetch.mockResolvedValue(jsonResponse({})); // no X-Request-Id header
    const res = await apiFetch("/api/state");
    expect(res.reqId).toBeTruthy();
    // Should match the one we sent
    const sentId = global.fetch.mock.calls[0][1].headers.get("X-Request-Id");
    expect(res.reqId).toBe(sentId);
  });

  it("trusts server's echoed id even when client supplied one", async () => {
    global.fetch.mockResolvedValue(
      jsonResponse({}, { headers: { "X-Request-Id": "server-said-this" } })
    );
    const res = await apiFetch("/api/state", { headers: { "X-Request-Id": "client-said-that" } });
    expect(res.reqId).toBe("server-said-this");
  });

  it("re-throws network errors", async () => {
    global.fetch.mockRejectedValue(new Error("network down"));
    await expect(apiFetch("/api/state")).rejects.toThrow("network down");
  });

  it("returns the Response unmodified for callers that don't care about reqId", async () => {
    const body = { transactions: [{ id: "x" }] };
    global.fetch.mockResolvedValue(jsonResponse(body));
    const res = await apiFetch("/api/transactions");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const parsed = await res.json();
    expect(parsed).toEqual(body);
  });

  it("falls back to a non-crypto id when crypto.randomUUID is unavailable", async () => {
    // Save and remove crypto.randomUUID
    const origCrypto = global.crypto;
    // Make crypto.randomUUID throw to exercise the fallback path
    Object.defineProperty(global, "crypto", {
      value: { randomUUID: () => { throw new Error("not available"); } },
      configurable: true,
    });
    global.fetch.mockResolvedValue(jsonResponse({}));
    await apiFetch("/api/state");
    const id = global.fetch.mock.calls[0][1].headers.get("X-Request-Id");
    expect(id).toMatch(/^cli-\d+-[a-z0-9]+$/);
    // Restore
    Object.defineProperty(global, "crypto", { value: origCrypto, configurable: true });
  });

  it("passes through GET requests with no options", async () => {
    global.fetch.mockResolvedValue(jsonResponse({}));
    const res = await apiFetch("/api/transactions");
    expect(res.ok).toBe(true);
    // Method defaults to GET when not specified, but apiFetch doesn't force it —
    // it just passes options through. The browser/fetch decides the default.
    const opts = global.fetch.mock.calls[0][1];
    expect(opts.headers.get("X-Request-Id")).toBeTruthy();
  });
});

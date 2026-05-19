import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiFetch } from "./apiFetch.js";

describe("apiFetch", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function fakeRes(echoId, status = 200) {
    return {
      status,
      headers: { get: (k) => (k === "X-Request-Id" ? echoId : null) },
    };
  }

  it("injects X-Request-Id header on outgoing request", async () => {
    let capturedInit;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedInit = init;
      return fakeRes(init.headers.get("X-Request-Id"));
    });
    await apiFetch("/api/state");
    const sent = capturedInit.headers.get("X-Request-Id");
    expect(sent).toBeTruthy();
    expect(sent).toMatch(/^[a-f0-9-]{36}$/i);
  });

  it("does not overwrite a caller-supplied X-Request-Id", async () => {
    let capturedInit;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedInit = init;
      return fakeRes(init.headers.get("X-Request-Id"));
    });
    await apiFetch("/api/state", { headers: { "X-Request-Id": "client-fixed-id" } });
    expect(capturedInit.headers.get("X-Request-Id")).toBe("client-fixed-id");
  });

  it("captures echoed X-Request-Id onto response", async () => {
    globalThis.fetch = vi.fn(async () => fakeRes("server-echoed-id"));
    const res = await apiFetch("/api/state");
    expect(res.reqId).toBe("server-echoed-id");
  });

  it("falls back to local id when server echoes nothing", async () => {
    let local;
    globalThis.fetch = vi.fn(async (_url, init) => {
      local = init.headers.get("X-Request-Id");
      return fakeRes(null);
    });
    const res = await apiFetch("/api/state");
    expect(res.reqId).toBe(local);
  });

  it("normalizes various header input shapes", async () => {
    let captured;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = init;
      return fakeRes(init.headers.get("X-Request-Id"));
    });

    await apiFetch("/api/state", { headers: { "Content-Type": "application/json" } });
    expect(captured.headers.get("Content-Type")).toBe("application/json");
    expect(captured.headers.get("X-Request-Id")).toBeTruthy();

    await apiFetch("/api/state", { headers: [["Accept", "application/json"]] });
    expect(captured.headers.get("Accept")).toBe("application/json");
    expect(captured.headers.get("X-Request-Id")).toBeTruthy();

    const h = new Headers({ "X-Custom": "yes" });
    await apiFetch("/api/state", { headers: h });
    expect(captured.headers.get("X-Custom")).toBe("yes");
    expect(captured.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("preserves request body / method", async () => {
    let captured;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = init;
      return fakeRes(init.headers.get("X-Request-Id"));
    });
    await apiFetch("/api/state", { method: "PUT", body: JSON.stringify({ a: 1 }) });
    expect(captured.method).toBe("PUT");
    expect(captured.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("attaches reqId to thrown network errors", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("offline"); });
    await expect(apiFetch("/api/state")).rejects.toMatchObject({
      message: "offline",
      reqId: expect.stringMatching(/^[a-f0-9-]{36}$/i),
    });
  });

  it("generates a different id on each call", async () => {
    const seen = new Set();
    globalThis.fetch = vi.fn(async (_url, init) => {
      seen.add(init.headers.get("X-Request-Id"));
      return fakeRes(init.headers.get("X-Request-Id"));
    });
    await apiFetch("/api/state");
    await apiFetch("/api/state");
    await apiFetch("/api/state");
    expect(seen.size).toBe(3);
  });

  it("trusts server echo over local id if they differ", async () => {
    globalThis.fetch = vi.fn(async () => fakeRes("server-rewrote-it"));
    const res = await apiFetch("/api/state");
    expect(res.reqId).toBe("server-rewrote-it");
  });
});

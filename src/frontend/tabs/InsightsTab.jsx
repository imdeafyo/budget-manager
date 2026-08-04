import { useState, useRef, useEffect, useCallback } from "react";
import { Card } from "../components/ui.jsx";
import { apiFetch } from "../utils/apiFetch.js";

/* ── InsightsTab ──
   Free-form financial-insights chat. Talks to POST /api/insights, which runs
   a provider (Claude today) behind a server-side adapter and can query the
   real transaction history via tools. The API key lives only on the server;
   this component never sees it.

   Ephemeral in this slice: conversation lives in component state and is sent
   back as `history` on each turn so the model has context. Nothing persists
   across reloads yet (that's a follow-up). Deploy-only — this tab is not
   rendered in the generic build.

   `history` shape sent to the server is neutral role/content:
     { role: 'user'|'assistant', content: string }
   We keep only plain user/assistant text turns in history (tool round-trips
   happen server-side and are not surfaced here). */

export default function InsightsTab({ mob }) {
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(null); // null = unknown/checking
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  // Probe whether the server has a provider key wired. Shows a friendly hint
  // instead of a failed send when it's not.
  useEffect(() => {
    let alive = true;
    apiFetch("/api/insights/status")
      .then(r => r.ok ? r.json() : { configured: false })
      .then(d => { if (alive) setConfigured(!!d.configured); })
      .catch(() => { if (alive) setConfigured(false); });
    return () => { alive = false; };
  }, []);

  // Autoscroll to newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || busy) return;
    setError("");
    const nextMessages = [...messages, { role: "user", content: q }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    try {
      // History = everything before this new question, in neutral shape.
      const res = await apiFetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: messages }),
      });
      if (!res.ok) {
        let msg = "Something went wrong reaching the insights service.";
        try {
          const d = await res.json();
          if (d && d.code === "NOT_CONFIGURED") { setConfigured(false); msg = ""; }
          else if (d && d.error) msg = d.error;
        } catch { /* non-JSON error body */ }
        if (msg) setError(msg);
        return;
      }
      const d = await res.json();
      setMessages(m => [...m, { role: "assistant", content: d.answer || "(no answer)" }]);
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages]);

  const onKeyDown = (e) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const bubbleBase = {
    padding: "10px 14px",
    borderRadius: 14,
    maxWidth: "85%",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    lineHeight: 1.45,
    fontSize: 14,
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <Card style={{ display: "flex", flexDirection: "column", height: mob ? "68vh" : "72vh", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--card-border, rgba(0,0,0,0.08))" }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Financial Insights</div>
          <div style={{ fontSize: 12, color: "var(--muted, #777)", marginTop: 2 }}>
            Ask about your spending, budget, or FIRE goals. Answers are grounded in your real transactions.
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {configured === false && (
            <div style={{ ...bubbleBase, alignSelf: "center", background: "rgba(232,169,59,0.15)", color: "var(--tx, #222)", maxWidth: "100%", textAlign: "center" }}>
              Insights isn't configured on the server yet. An admin needs to set the <code>INSIGHTS_API_KEY</code> environment variable.
            </div>
          )}

          {messages.length === 0 && configured !== false && (
            <div style={{ color: "var(--muted, #888)", fontSize: 13, margin: "auto", textAlign: "center", maxWidth: 420 }}>
              Try: “What did I spend on groceries last month?” · “Any unusual charges recently?” ·
              “How am I tracking toward my FIRE target?”
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                ...bubbleBase,
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user"
                  ? "var(--accent, #2f6f4f)"
                  : "var(--card-bg-alt, rgba(0,0,0,0.05))",
                color: m.role === "user" ? "#fff" : "var(--tx, #222)",
              }}
            >
              {m.content}
            </div>
          ))}

          {busy && (
            <div style={{ ...bubbleBase, alignSelf: "flex-start", background: "var(--card-bg-alt, rgba(0,0,0,0.05))", color: "var(--muted, #888)" }}>
              Thinking…
            </div>
          )}

          {error && (
            <div style={{ ...bubbleBase, alignSelf: "center", background: "rgba(232,87,58,0.15)", color: "#E8573A", maxWidth: "100%", textAlign: "center" }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--card-border, rgba(0,0,0,0.08))" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={configured === false ? "Insights unavailable" : "Ask a question…"}
            disabled={busy || configured === false}
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              border: "2px solid var(--input-border, rgba(0,0,0,0.15))",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              background: "var(--input-bg, #fff)",
              color: "var(--input-color, #222)",
              maxHeight: 120,
            }}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim() || configured === false}
            style={{
              padding: "0 20px",
              borderRadius: 10,
              border: "none",
              fontWeight: 700,
              fontSize: 14,
              cursor: busy || !input.trim() ? "default" : "pointer",
              background: busy || !input.trim() || configured === false ? "rgba(0,0,0,0.15)" : "var(--accent, #2f6f4f)",
              color: "#fff",
            }}
          >
            Send
          </button>
        </div>
      </Card>
    </div>
  );
}

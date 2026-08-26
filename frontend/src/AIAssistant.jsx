import { useState, useRef, useEffect } from "react";
import { C, mono } from "./theme";
import { Btn } from "./components";
import api from "./services/api";

// ── AI Assistant ──────────────────────────────────────────────────────────
// Floating button (bottom-right, visible on every screen) that opens a chat
// panel. Available to every authenticated user — no role check, matching
// how api.js already attaches the logged-in user's JWT to every request.
// Talks to POST /api/assistant/chat: { message, history } -> { reply }.

const STORAGE_KEY = null; // no localStorage — conversation resets on refresh, by design (see note below)

export default function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! Ask me about vehicles, bookings, customers, availability, or revenue." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  // Auto-scroll to the latest message whenever the list changes or the panel opens.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setLoading(true);

    try {
      // History sent to the backend excludes the initial greeting (not a
      // real turn) and is capped the same way the backend trims it, so we
      // just send everything and let the backend slice the last few.
      const history = nextMessages
        .filter((m, i) => !(i === 0 && m.role === "assistant"))
        .map((m) => ({ role: m.role, content: m.content }));

      const data = await api.post("/assistant/chat", { message: text, history });
      const reply = (data && data.reply) || "Sorry, I couldn't generate a reply.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setError("Something went wrong reaching the assistant. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open AI Assistant"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: C.teal,
          color: "#fff",
          border: "none",
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          cursor: "pointer",
          fontSize: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 300,
          transition: "transform 0.15s",
        }}
      >
        {open ? "✕" : "💬"}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 88,
            right: 24,
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            height: 480,
            maxHeight: "calc(100vh - 120px)",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 300,
          }}
        >
          {/* Header */}
          <div
            style={{
              background: C.navy,
              color: "#fff",
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>FleetOpz Assistant</div>
              <div style={{ fontSize: 10.5, color: C.tealLight }}>Ask about fleet, bookings, revenue</div>
            </div>
            <div onClick={() => setOpen(false)} style={{ cursor: "pointer", fontSize: 16, opacity: 0.8 }}>
              ✕
            </div>
          </div>

          {/* Message list */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              background: C.bg,
            }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background: m.role === "user" ? C.teal : C.surface,
                  color: m.role === "user" ? "#fff" : C.textPri,
                  border: m.role === "user" ? "none" : `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 12.5,
                  color: C.textMuted,
                }}
              >
                Thinking…
              </div>
            )}
            {error && (
              <div style={{ alignSelf: "center", fontSize: 11, color: C.red, textAlign: "center" }}>
                {error}
              </div>
            )}
          </div>

          {/* Input row */}
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: 10,
              borderTop: `1px solid ${C.border}`,
              background: C.surface,
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question…"
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 12.5,
                fontFamily: "inherit",
                outline: "none",
                maxHeight: 80,
              }}
            />
            <Btn primary small onClick={send} disabled={loading || !input.trim()}>
              Send
            </Btn>
          </div>
        </div>
      )}
    </>
  );
}
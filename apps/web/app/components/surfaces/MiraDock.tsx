"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Import real Brain action types so this surface stays in sync with the schema
// and never drifts from what the server actually returns.
import type { BrainClientAction } from "@stylique/ai";

// Shape of /api/chat response — uses the shared BrainClientAction type so
// any new action kind added to the Brain automatically surfaces here.
type ChatResponse = {
  reply: string;
  combos: Array<{
    name: string;
    reasoning: string;
    products: Array<{
      id: string;
      handle: string;
      title: string;
      imageUrl: string | null;
    }>;
  }>;
  actions: BrainClientAction[];
};

type Bubble =
  | {
      role: "mira";
      text: string;
      combos?: ChatResponse["combos"];
    }
  | { role: "you"; text: string };

// Mira's scripted opener — fires once on mount so the tour always has a
// guaranteed first impression. After this plays, the input becomes active
// and the real Brain takes over for the rest of the conversation.
const opener: Array<{ role: "mira" | "you"; text: string; delay: number }> = [
  { role: "mira", text: "Hi — I'm Mira. What's the occasion?", delay: 600 },
  { role: "you", text: "Dinner Thursday. Low-lit place.", delay: 1600 },
  {
    role: "mira",
    text: "The Onyx Silk Slip with the cashmere V over it. I'll lay it out.",
    delay: 2400,
  },
];

function newSessionId(): string {
  try {
    const stored = sessionStorage.getItem("sq.mira.session");
    if (stored) return stored;
    const fresh = `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    sessionStorage.setItem("sq.mira.session", fresh);
    return fresh;
  } catch {
    return `s_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export default function MiraDock({
  onClose,
  onAction,
}: {
  onClose?: () => void;
  // onAction lets the parent (Tour) respond to Brain actions — open try-on,
  // open studio, navigate — without MiraDock having to know about those surfaces.
  // This is how the two apps stay connected: MiraDock delegates; Tour orchestrates.
  onAction?: (action: BrainClientAction) => void;
}) {
  const router = useRouter();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [openerShown, setOpenerShown] = useState(0);
  const [openerDone, setOpenerDone] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId] = useState<string>(() =>
    typeof window === "undefined" ? "ssr" : newSessionId(),
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Play the scripted opener once on mount.
  useEffect(() => {
    const timers = opener.map((m, i) =>
      window.setTimeout(() => {
        setOpenerShown((s) => Math.max(s, i + 1));
        if (i === opener.length - 1) setOpenerDone(true);
      }, m.delay),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [bubbles, openerShown, sending]);

  // Combined message stream for rendering + for sending to Brain.
  const visibleBubbles = useMemo<Bubble[]>(() => {
    const fromOpener: Bubble[] = opener
      .slice(0, openerShown)
      .map((m) => ({ role: m.role === "mira" ? "mira" : "you", text: m.text }));
    return [...fromOpener, ...bubbles];
  }, [openerShown, bubbles]);

  // ─── Send a real user message to the Brain ──────────────────────────
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const nextBubbles: Bubble[] = [...bubbles, { role: "you", text: trimmed }];
      setBubbles(nextBubbles);
      setInput("");
      setSending(true);

      // Build the history to send: opener (whatever's visible) + everything
      // the user has typed since. Mira sees the full context.
      const openerForHistory = opener
        .slice(0, openerShown)
        .map((m) => ({
          role: m.role === "mira" ? ("model" as const) : ("user" as const),
          text: m.text,
        }));
      const userBubblesForHistory = nextBubbles.map((b) => ({
        role: b.role === "mira" ? ("model" as const) : ("user" as const),
        text: b.text,
      }));
      const fullHistory = [...openerForHistory, ...userBubblesForHistory];

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, messages: fullHistory }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ChatResponse = await res.json();
        setBubbles((prev) => [
          ...prev,
          { role: "mira", text: data.reply, combos: data.combos },
        ]);
        // Forward every Brain action to the parent. Tour handles the surfaces
        // (TryOnPanel, StudioModal). MiraDock handles navigation locally.
        // This is the cross-surface connection: real Brain → real surfaces.
        for (const action of data.actions) {
          if (action.kind === "navigate") {
            router.push(`/product/${action.handle}`);
          } else if (onAction) {
            // open_tryon → Tour opens TryOnPanel
            // open_studio → Tour opens StudioModal
            // add_to_cart_request, show_signup_card → Tour can display them
            onAction(action);
          }
        }
      } catch {
        setBubbles((prev) => [
          ...prev,
          {
            role: "mira",
            text: "I lost the thread for a second — try that again?",
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [bubbles, onAction, openerShown, router, sending, sessionId],
  );

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        width: "min(380px, calc(100vw - 24px))",
        maxHeight: "min(580px, calc(100dvh - 24px))",
        background: "rgba(20,17,26,0.96)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 20,
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        animation: "sqDockIn 380ms cubic-bezier(.2,.8,.2,1)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "18px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "var(--grad)",
              boxShadow: "0 0 14px rgba(139,92,246,0.4)",
            }}
          />
          <div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 18, color: "#F4F2EE" }}>
              Mira
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 9,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "var(--mute)",
              }}
            >
              {openerDone ? "Live · ask anything" : "Your stylist"}
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--mute)",
              cursor: "pointer",
              fontSize: 18,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Chat thread */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflowY: "auto",
        }}
      >
        {visibleBubbles.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "mira" ? "flex-start" : "flex-end",
              maxWidth: "85%",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              animation: "sqDockMsg 320ms cubic-bezier(.2,.8,.2,1)",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                background:
                  m.role === "mira"
                    ? "rgba(139,92,246,0.12)"
                    : "rgba(255,255,255,0.06)",
                color: "#F4F2EE",
                fontFamily: "var(--sans)",
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {m.text}
            </div>
            {m.role === "mira" && m.combos && m.combos.length > 0 && (
              <ComboCards combos={m.combos} onPick={(h) => router.push(`/product/${h}`)} />
            )}
          </div>
        ))}
        {sending && (
          <div style={{ alignSelf: "flex-start", display: "flex", gap: 4, padding: "6px 4px" }}>
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.5)",
                  animation: `sqDockTyping 1s ${d * 0.15}s infinite`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{
          padding: 14,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          gap: 8,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={openerDone ? "Ask Mira anything…" : "Mira's introducing herself…"}
          disabled={!openerDone || sending}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.05)",
            color: "#F4F2EE",
            fontFamily: "var(--sans)",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!openerDone || sending || !input.trim()}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "none",
            background: input.trim() && openerDone ? "var(--grad)" : "rgba(255,255,255,0.08)",
            color: input.trim() && openerDone ? "#0E0A14" : "var(--mute)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            cursor: input.trim() && openerDone && !sending ? "pointer" : "default",
            fontWeight: 700,
          }}
        >
          Send
        </button>
      </form>

      <style>{`
        @keyframes sqDockIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes sqDockMsg { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes sqDockTyping { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }
      `}</style>
    </div>
  );
}

function ComboCards({
  combos,
  onPick,
}: {
  combos: ChatResponse["combos"];
  onPick: (handle: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {combos.map((c, i) => (
        <div
          key={i}
          style={{
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            padding: 10,
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 15,
              color: "#F4F2EE",
              marginBottom: 8,
            }}
          >
            {c.name}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {c.products.slice(0, 3).map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p.handle)}
                title={p.title}
                style={{
                  flex: 1,
                  aspectRatio: "3 / 4",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: p.imageUrl
                    ? `url(${p.imageUrl}) center/cover`
                    : "rgba(255,255,255,0.04)",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

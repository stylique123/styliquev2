"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import TryOnPanel from "../surfaces/TryOnPanel";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type ChapterId = "mira" | "tryon";

type Step =
  | {
      kind: "intro";
      headline: string;
      body: string;
      metric: string;
      metricUnit: string;
    }
  | { kind: "navigate"; path: string; note: string }
  | {
      kind: "spotlight";
      selector: string;
      headline: string;
      body: string;
      anchor?: "top" | "bottom";
    }
  | {
      kind: "surface";
      surface: "mira" | "tryon";
      headline: string;
      body: string;
    }
  | { kind: "done"; headline: string; body: string };

type Chapter = {
  id: ChapterId;
  eyebrow: string;
  name: string;
  line: string;
  steps: Step[];
};

// ----------------------------------------------------------------------------
// Scripts
// ----------------------------------------------------------------------------

const CHAPTERS: Chapter[] = [
  {
    id: "mira",
    eyebrow: "Mira · AI Stylist",
    name: "Mira",
    line: "A stylist on every page — discovery, sizing, the close.",
    steps: [
      {
        kind: "intro",
        metric: "+15%",
        metricUnit: "Lift in conversion at the moment of hesitation",
        headline: "Mira reads the room. Then she leads.",
        body: "She opens when a shopper slows — not with 'How can I help?' but with a specific recommendation earned by reading what's on screen. She captures taste, size, and occasion in two exchanges. Then she closes.",
      },
      {
        kind: "navigate",
        path: "/collection/evening",
        note: "Taking you to the evening collection — where Mira surfaces first.",
      },
      {
        kind: "spotlight",
        selector: "[data-product-card]",
        headline: "She knows what you're looking at.",
        body: "Dwell time, scroll depth, which card you paused on — Mira reads all of it. When a shopper lingers without clicking, that's the exact moment she opens.",
        anchor: "top",
      },
      {
        kind: "surface",
        surface: "mira",
        headline: "Watch her work.",
        body: "A real conversation. She asks once, builds a look, names the size, and leads to the cart.",
      },
      {
        kind: "intro",
        metric: "+4.2×",
        metricUnit: "Cart adds per session vs. browse-only",
        headline: "She recommends. Then she closes.",
        body: "Mira proposes the complete look, names the exact size with a confidence score, and offers to add it — without the shopper having to ask. Brands on Stylique see 4× the cart adds on sessions where Mira engages.",
      },
      {
        kind: "intro",
        metric: "1",
        metricUnit: "Conversation — discovery to add-to-bag",
        headline: "Shopper arrives. Mira sells the outfit.",
        body: "She reads the occasion, captures measurements, builds the look, recommends the size, and leads to the cart. One conversation. No extra clicks, no forms, no second-guessing.",
      },
      {
        kind: "done",
        headline: "That's Mira.",
        body: "Friend voice, salesperson instinct. Brand-configurable name and avatar. She captures size + fit + taste once — hands it to Try-On, never asks twice. Every conversation sharpens the next recommendation.",
      },
    ],
  },
  {
    id: "tryon",
    eyebrow: "Try-On Widget",
    name: "Try-On",
    line: "Pick the muse, get the size, build the look — on every PDP.",
    steps: [
      {
        kind: "intro",
        metric: "−42%",
        metricUnit: "Fewer returns from size uncertainty",
        headline: "See it on before you buy it.",
        body: "Shoppers pick a fit model that matches their frame, get a size recommendation backed by 1,200+ shoppers in this brand, and see the complete outfit styled — all on the product page, in three steps.",
      },
      {
        kind: "navigate",
        path: "/product/onyx-silk-slip",
        note: "Taking you to a product page — Try-On lives right here.",
      },
      {
        kind: "spotlight",
        selector: "[data-stylique-tryon]",
        headline: "One button. Right where the decision happens.",
        body: "Lives under Add to Bag on every PDP. Tap it — no redirect, no new tab. The whole experience opens as a sheet from the bottom.",
        anchor: "top",
      },
      {
        kind: "surface",
        surface: "tryon",
        headline: "Pick a model. Get your size.",
        body: "Choose a muse that matches your frame. Mira cross-references 1,200+ shoppers to recommend a size with a fit-confidence score.",
      },
      {
        kind: "done",
        headline: "That's Try-On.",
        body: "Size + fit data flows back to Mira automatically. Next time she recommends something, she already knows what fits — and says it out loud.",
      },
    ],
  },
];

// ----------------------------------------------------------------------------
// Storage keys
// ----------------------------------------------------------------------------

const COMPLETED_KEY = "sq.tour.completed.v2";
const FIRST_VISIT_KEY = "sq.tour.firstvisit.v2";

function readCompleted(): ChapterId[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COMPLETED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCompleted(ids: ChapterId[]) {
  try {
    window.localStorage.setItem(COMPLETED_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

// ----------------------------------------------------------------------------
// Tour component
// ----------------------------------------------------------------------------

type View =
  | { kind: "closed" }
  | { kind: "picker" }
  | { kind: "running"; chapterId: ChapterId; stepIdx: number };

export default function Tour() {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<View>({ kind: "closed" });
  const [completed, setCompleted] = useState<ChapterId[]>([]);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const navTimerRef = useRef<number | null>(null);

  // First-visit auto-open — but only after the shopper has scrolled past
  // the hero. We don't want the tour to interrupt the first impression of
  // the store. Once they've engaged (scroll past ~70% of one viewport),
  // pop the picker and never auto-open again.
  useEffect(() => {
    setCompleted(readCompleted());
    let triggered = false;
    try {
      if (window.localStorage.getItem(FIRST_VISIT_KEY)) return;
    } catch {
      return;
    }
    const trigger = () => {
      if (triggered) return;
      if (window.scrollY < window.innerHeight * 0.7) return;
      triggered = true;
      try {
        window.localStorage.setItem(FIRST_VISIT_KEY, "1");
      } catch {
        // ignore
      }
      setView({ kind: "picker" });
      window.removeEventListener("scroll", trigger);
    };
    window.addEventListener("scroll", trigger, { passive: true });
    // Safety net — if they idle on the hero for 25s without scrolling,
    // still surface the picker so a passive demo viewer doesn't miss it.
    const idleTimer = window.setTimeout(() => {
      if (!triggered) {
        triggered = true;
        try {
          window.localStorage.setItem(FIRST_VISIT_KEY, "1");
        } catch {
          // ignore
        }
        setView({ kind: "picker" });
        window.removeEventListener("scroll", trigger);
      }
    }, 25000);
    return () => {
      window.removeEventListener("scroll", trigger);
      window.clearTimeout(idleTimer);
    };
  }, []);

  // Expose a window hook so any button can trigger the tour
  useEffect(() => {
    (window as unknown as { __sqStartTour?: () => void }).__sqStartTour = () => {
      setView({ kind: "picker" });
    };
    return () => {
      try {
        delete (window as unknown as { __sqStartTour?: () => void }).__sqStartTour;
      } catch {
        // ignore
      }
    };
  }, []);

  const currentChapter = useMemo(() => {
    if (view.kind !== "running") return null;
    return CHAPTERS.find((c) => c.id === view.chapterId) ?? null;
  }, [view]);

  const currentStep = useMemo<Step | null>(() => {
    if (view.kind !== "running" || !currentChapter) return null;
    return currentChapter.steps[view.stepIdx] ?? null;
  }, [view, currentChapter]);

  // Track spotlight target
  useEffect(() => {
    if (!currentStep || currentStep.kind !== "spotlight") {
      setSpotlightRect(null);
      return;
    }
    let raf = 0;
    const refresh = () => {
      const el = document.querySelector(currentStep.selector) as HTMLElement | null;
      if (!el) {
        // try again next frame in case it just mounted
        raf = window.requestAnimationFrame(refresh);
        return;
      }
      const rect = el.getBoundingClientRect();
      setSpotlightRect(rect);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    refresh();
    const onScrollResize = () => {
      const el = document.querySelector(currentStep.selector) as HTMLElement | null;
      if (el) setSpotlightRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [currentStep, pathname]);

  // Auto-advance for navigate steps
  useEffect(() => {
    if (!currentStep || currentStep.kind !== "navigate" || view.kind !== "running") return;
    if (pathname === currentStep.path) {
      // already there → advance after a beat
      navTimerRef.current = window.setTimeout(() => {
        setView({ kind: "running", chapterId: view.chapterId, stepIdx: view.stepIdx + 1 });
      }, 600);
    } else {
      router.push(currentStep.path);
      navTimerRef.current = window.setTimeout(() => {
        setView({ kind: "running", chapterId: view.chapterId, stepIdx: view.stepIdx + 1 });
      }, 1400);
    }
    return () => {
      if (navTimerRef.current) window.clearTimeout(navTimerRef.current);
    };
  }, [currentStep, view, pathname, router]);

  // ---- actions
  const closeAll = useCallback(() => setView({ kind: "closed" }), []);
  const backToPicker = useCallback(() => {
    if (view.kind === "running") {
      const next = Array.from(new Set([...completed, view.chapterId])) as ChapterId[];
      setCompleted(next);
      writeCompleted(next);
    }
    setView({ kind: "picker" });
  }, [view, completed]);

  const startChapter = useCallback((id: ChapterId) => {
    setView({ kind: "running", chapterId: id, stepIdx: 0 });
  }, []);

  const next = useCallback(() => {
    if (view.kind !== "running" || !currentChapter) return;
    const isLast = view.stepIdx >= currentChapter.steps.length - 1;
    if (isLast) {
      backToPicker();
    } else {
      setView({ ...view, stepIdx: view.stepIdx + 1 });
    }
  }, [view, currentChapter, backToPicker]);

  const back = useCallback(() => {
    if (view.kind !== "running") return;
    if (view.stepIdx === 0) {
      setView({ kind: "picker" });
    } else {
      setView({ ...view, stepIdx: view.stepIdx - 1 });
    }
  }, [view]);

  // ---- Brain action handler
  // When Mira's real Brain returns an open_tryon action,
  // the Tour jumps to the relevant surface chapter so the shopper sees the
  // widget open naturally — no scripted prompt needed. This is the connection
  // between apps/web (demo/marketing) and apps/shopify-app (real product):
  // the same Brain that runs in production responds here, and the UI responds
  // to real actions instead of only scripted ones.
  const handleBrainAction = useCallback(
    (action: import("@stylique/ai").BrainClientAction) => {
      if (action.kind === "open_tryon") {
        // Jump to the try-on surface step in the "tryon" chapter.
        // This shows the TryOnPanel immediately as Mira recommended it.
        startChapter("tryon");
        // Skip to the surface step (index 3 in the tryon chapter script).
        window.setTimeout(() => {
          setView({ kind: "running", chapterId: "tryon", stepIdx: 3 });
        }, 50);
      }
    },
    [startChapter],
  );

  // ---- render
  if (view.kind === "closed") {
    return <ReplayPill onClick={() => setView({ kind: "picker" })} />;
  }

  return (
    <>
      <ReplayPill onClick={() => setView({ kind: "picker" })} />
      <div
        aria-modal="true"
        role="dialog"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 95,
          pointerEvents: "none",
        }}
      >
        {view.kind === "picker" && (
          <Picker
            completed={completed}
            onPick={startChapter}
            onClose={closeAll}
          />
        )}

        {view.kind === "running" && currentChapter && currentStep && (
          <ChapterFrame
            chapter={currentChapter}
            stepIdx={view.stepIdx}
            step={currentStep}
            spotlightRect={spotlightRect}
            onBack={back}
            onNext={next}
            onClose={closeAll}
            onSkip={backToPicker}
            onAction={handleBrainAction}
          />
        )}
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------
// Replay pill
// ----------------------------------------------------------------------------

function ReplayPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "fixed",
        left: 20,
        bottom: 20,
        zIndex: 70,
        padding: "10px 18px",
        background: "rgba(20,17,26,0.9)",
        backdropFilter: "blur(12px)",
        color: "#F4F2EE",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 999,
        fontFamily: "var(--mono)",
        fontSize: 10,
        letterSpacing: "0.3em",
        textTransform: "uppercase",
        cursor: "pointer",
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      }}
    >
      ◐ Guided tour
    </button>
  );
}

// ----------------------------------------------------------------------------
// Picker
// ----------------------------------------------------------------------------

function Picker({
  completed,
  onPick,
  onClose,
}: {
  completed: ChapterId[];
  onPick: (id: ChapterId) => void;
  onClose: () => void;
}) {
  const seenCount = completed.length;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(120% 80% at 50% 20%, rgba(20,16,28,0.86), rgba(0,0,0,0.92))",
        pointerEvents: "auto",
        animation: "sqTourIn 360ms cubic-bezier(.2,.8,.2,1)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(820px, 100%)",
          background: "rgba(20,17,26,0.92)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 22,
          padding: "32px 32px 28px",
          color: "#F4F2EE",
          boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              display: "inline-block",
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid rgba(139,92,246,0.35)",
              background: "rgba(139,92,246,0.08)",
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#C9B5FF",
            }}
          >
            Stylique · Guided demo
          </span>
          <button onClick={onClose} style={btnGhost()}>Skip</button>
        </div>

        <h2 style={{ fontFamily: "var(--serif)", fontSize: "clamp(36px, 4vw, 52px)", margin: 0, fontWeight: 400 }}>
          Three doors.{" "}
          <span
            style={{
              fontStyle: "italic",
              background: "var(--grad)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            One brain.
          </span>
        </h2>
        <p style={{ fontFamily: "var(--sans)", fontSize: 15, color: "var(--mute)", marginTop: 12, marginBottom: 24 }}>
          Pick a surface — Stylique walks you through what it does, why it earns the budget, and how it lives inside this store. ~45 seconds each. Skip anytime.
        </p>

        <div
          className="sq-tour-picker-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          {CHAPTERS.map((c) => {
            const seen = completed.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => onPick(c.id)}
                className="sq-tour-picker-card"
                style={{
                  textAlign: "left",
                  padding: 18,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#F4F2EE",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minHeight: 180,
                  transition: "all 220ms cubic-bezier(.2,.8,.2,1)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(139,92,246,0.08)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(139,92,246,0.45)";
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                }}
              >
                <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--mute)" }}>
                  {c.eyebrow}
                </span>
                <span
                  className="sq-picker-name"
                  style={{
                    fontFamily: "var(--serif)",
                    fontStyle: "italic",
                    fontSize: 32,
                    background: "var(--grad)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {c.name}
                </span>
                <span style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--mute)", lineHeight: 1.45 }}>
                  {c.line}
                </span>
                <span className="sq-picker-cta" style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase" }}>
                  <span style={{ color: seen ? "rgba(139,92,246,0.9)" : "var(--mute)" }}>
                    {seen ? "Seen ✓" : "Take the tour"}
                  </span>
                  <span style={{ opacity: 0.6 }}>→</span>
                </span>
              </button>
            );
          })}
        </div>

        {seenCount >= 3 && (
          <div style={{
            marginTop: 20,
            padding: "16px 20px",
            background: "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(139,92,246,0.05))",
            border: "1px solid rgba(139,92,246,0.3)",
            borderRadius: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <div>
              <p style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.3em", color: "var(--electric)", margin: "0 0 4px", textTransform: "uppercase" }}>
                All three chapters complete
              </p>
              <p style={{ fontFamily: "var(--serif)", fontSize: 18, fontStyle: "italic", margin: 0, color: "#F4F2EE" }}>
                Ready to see it on a real store?
              </p>
            </div>
            <button onClick={onClose} style={{ padding: "12px 22px", background: "var(--grad)", color: "#0E0A14", border: "none", borderRadius: 999, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" }}>
              Browse the store →
            </button>
          </div>
        )}

        <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--mute)" }}>
            {seenCount} of {CHAPTERS.length} seen
          </span>
          <button onClick={onClose} style={btnSolid()}>
            Browse the store →
          </button>
        </div>
      </div>
      <KeyframeStyles />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Chapter frame (renders the right step)
// ----------------------------------------------------------------------------

function ChapterFrame(props: {
  chapter: Chapter;
  stepIdx: number;
  step: Step;
  spotlightRect: DOMRect | null;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onSkip: () => void;
  // When Mira's real Brain fires an action (open_tryon),
  // the Tour parent handles it here and can open the right surface.
  onAction?: (action: import("@stylique/ai").BrainClientAction) => void;
}) {
  const { chapter, stepIdx, step, spotlightRect, onBack, onNext, onClose, onSkip, onAction } = props;
  const total = chapter.steps.length;

  return (
    <>
      {/* Backdrop varies by step kind — spotlight has its own cut-out;
          surface mounts a real component that brings its own context. */}
      {step.kind !== "spotlight" && step.kind !== "surface" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(120% 80% at 50% 20%, rgba(20,16,28,0.86), rgba(0,0,0,0.92))",
            pointerEvents: "auto",
            animation: "sqTourIn 360ms cubic-bezier(.2,.8,.2,1)",
          }}
        />
      )}

      {/* Spotlight cut-out */}
      {step.kind === "spotlight" && spotlightRect && (
        <SpotlightOverlay rect={spotlightRect} />
      )}

      {/* Always-on close + chapter progress */}
      <TopBar chapter={chapter} stepIdx={stepIdx} total={total} onClose={onClose} onSkip={onSkip} />

      {step.kind === "intro" && (
        <IntroSlide step={step} chapter={chapter} onBack={onBack} onNext={onNext} />
      )}

      {step.kind === "navigate" && (
        <NavigateSlide step={step} chapter={chapter} />
      )}

      {step.kind === "spotlight" && (
        <SpotlightCallout step={step} rect={spotlightRect} onBack={onBack} onNext={onNext} />
      )}

      {step.kind === "surface" && (
        <SurfaceStep step={step} chapter={chapter} onBack={onBack} onNext={onNext} onAction={onAction} />
      )}

      {step.kind === "done" && (
        <DoneSlide step={step} chapter={chapter} onNext={onNext} />
      )}

      <KeyframeStyles />
    </>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function TopBar({
  chapter,
  stepIdx,
  total,
  onClose,
  onSkip,
}: {
  chapter: Chapter;
  stepIdx: number;
  total: number;
  onClose: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        display: "flex",
        alignItems: "center",
        gap: 8,
        pointerEvents: "auto",
        zIndex: 5,
      }}
    >
      {/* Compact chapter pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 14px",
          borderRadius: 999,
          background: "rgba(20,17,26,0.88)",
          border: "1px solid rgba(255,255,255,0.1)",
          backdropFilter: "blur(10px)",
          fontFamily: "var(--mono)",
          fontSize: 9,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: "var(--mute)",
        }}
      >
        {chapter.eyebrow}
        <span style={{ display: "flex", gap: 3 }}>
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              style={{
                width: i === stepIdx ? 14 : 5,
                height: 3,
                borderRadius: 2,
                background: i <= stepIdx ? "var(--grad)" : "rgba(255,255,255,0.18)",
                transition: "all 280ms cubic-bezier(.2,.8,.2,1)",
              }}
            />
          ))}
        </span>
      </div>
      <button onClick={onSkip} className="sq-topbar-pick-another" style={{ ...btnGhost(), padding: "7px 12px", fontSize: 9 }}>
        ← Chapters
      </button>
      <button
        onClick={onClose}
        aria-label="Close tour"
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          background: "rgba(20,17,26,0.88)",
          border: "1px solid rgba(255,255,255,0.1)",
          backdropFilter: "blur(10px)",
          color: "#F4F2EE",
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}

function IntroSlide({
  step,
  chapter,
  onBack,
  onNext,
}: {
  step: Extract<Step, { kind: "intro" }>;
  chapter: Chapter;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: 32,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          width: "min(620px, 100%)",
          background: "rgba(20,17,26,0.96)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          padding: "36px 36px 28px",
          color: "#F4F2EE",
          textAlign: "center",
          animation: "sqTourPop 420ms cubic-bezier(.2,.8,.2,1)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient glow behind the metric */}
        <div
          style={{
            position: "absolute",
            top: -120,
            left: "50%",
            transform: "translateX(-50%)",
            width: 540,
            height: 540,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(139,92,246,0.22) 0%, rgba(232,121,200,0.06) 40%, transparent 70%)",
            pointerEvents: "none",
            animation: "sqGlowDrift 6s ease-in-out infinite alternate",
          }}
        />

        {/* Surface tag */}
        <div
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid rgba(139,92,246,0.35)",
            background: "rgba(139,92,246,0.08)",
            fontFamily: "var(--mono)",
            fontSize: 9,
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            color: "#C9B5FF",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--grad)",
              boxShadow: "0 0 8px rgba(139,92,246,0.7)",
              animation: "sqTourPulse 1.6s ease-in-out infinite",
            }}
          />
          {chapter.eyebrow}
        </div>

        {/* The metric */}
        <div
          style={{
            position: "relative",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: "clamp(64px,9vw,130px)",
            lineHeight: 0.95,
            background: "var(--grad)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            animation: "sqMetricReveal 700ms cubic-bezier(.2,.8,.2,1) both",
          }}
        >
          {step.metric}
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.45em",
            textTransform: "uppercase",
            color: "var(--mute)",
            marginTop: 6,
          }}
        >
          {step.metricUnit}
        </div>

        {/* Divider line */}
        <div
          style={{
            width: 64,
            height: 1,
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
            margin: "32px auto 24px",
          }}
        />

        <h3
          style={{
            fontFamily: "var(--serif)",
            fontWeight: 400,
            fontSize: "clamp(22px,2.8vw,30px)",
            margin: "0 0 12px",
            lineHeight: 1.18,
          }}
        >
          {step.headline}
        </h3>
        <p
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            lineHeight: 1.65,
            color: "var(--mute)",
            margin: "0 auto",
            maxWidth: 460,
          }}
        >
          {step.body}
        </p>
        <FooterActions onBack={onBack} onNext={onNext} nextLabel="Show me live →" />
      </div>
    </div>
  );
}

function NavigateSlide({
  step,
}: {
  step: Extract<Step, { kind: "navigate" }>;
  chapter: Chapter;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          padding: "16px 24px",
          background: "rgba(20,17,26,0.85)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 999,
          color: "#F4F2EE",
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ display: "flex", gap: 4 }}>
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#F4F2EE",
                animation: `sqDockTyping 1s ${d * 0.15}s infinite`,
              }}
            />
          ))}
        </span>
        {step.note}
      </div>
    </div>
  );
}

function SpotlightOverlay({ rect }: { rect: DOMRect }) {
  const pad = 12;
  const x = Math.max(0, rect.left - pad);
  const y = Math.max(0, rect.top - pad);
  const w = rect.width + pad * 2;
  const h = rect.height + pad * 2;
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <defs>
        <mask id="sqSpot">
          <rect width="100%" height="100%" fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={12} fill="black" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(8,7,10,0.78)" mask="url(#sqSpot)" />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={12}
        fill="none"
        stroke="rgba(139,92,246,0.7)"
        strokeWidth="2"
        style={{ filter: "drop-shadow(0 0 12px rgba(139,92,246,0.6))" }}
      />
    </svg>
  );
}

function SpotlightCallout({
  step,
  rect,
  onBack,
  onNext,
}: {
  step: Extract<Step, { kind: "spotlight" }>;
  rect: DOMRect | null;
  onBack: () => void;
  onNext: () => void;
}) {
  // place callout below the rect, or centered if no rect yet — clamped to viewport on mobile
  const calloutW = Math.min(440, window.innerWidth - 40);
  const top = rect
    ? Math.min(window.innerHeight - 260, rect.bottom + 24)
    : window.innerHeight / 2;
  const left = rect
    ? Math.max(20, Math.min(rect.left + rect.width / 2 - calloutW / 2, window.innerWidth - calloutW - 20))
    : (window.innerWidth - calloutW) / 2;

  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        width: calloutW,
        background: "rgba(20,17,26,0.95)",
        border: "1px solid rgba(139,92,246,0.45)",
        borderRadius: 18,
        padding: 22,
        color: "#F4F2EE",
        pointerEvents: "auto",
        animation: "sqTourPop 320ms cubic-bezier(.2,.8,.2,1)",
        boxShadow: "0 20px 50px rgba(0,0,0,0.55)",
      }}
    >
      <h3 style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 24, margin: "0 0 8px" }}>
        {step.headline}
      </h3>
      <p style={{ fontFamily: "var(--sans)", fontSize: 14, lineHeight: 1.55, color: "var(--mute)", margin: 0 }}>
        {step.body}
      </p>
      <FooterActions onBack={onBack} onNext={onNext} nextLabel="Continue →" />
    </div>
  );
}

function SurfaceStep({
  step,
  onBack,
  onNext,
  onAction,
}: {
  step: Extract<Step, { kind: "surface" }>;
  chapter: Chapter;
  onBack: () => void;
  onNext: () => void;
  // Forwarded from Tour — lets Mira's real Brain actions open TryOnPanel
  // even when not in the scripted step for that surface.
  onAction?: (action: import("@stylique/ai").BrainClientAction) => void;
}) {
  // Hint bar position: tryon surface → top (avoids blocking footer buttons);
  // mira → bottom
  const hintStyle: React.CSSProperties = step.surface === "tryon"
    ? { top: 80, bottom: "auto", transform: "translateX(-50%)" }
    : { bottom: 24, top: "auto", transform: "translateX(-50%)" };

  return (
    <>
      {/* Mount the real surface — this is the star of the step.
          MiraLiveDemo replaces the empty MiraDock for demo context.
          TryOnPanel mounts as a real interactive surface. */}
      {step.surface === "mira" && <MiraLiveDemo />}
      {step.surface === "tryon" && <TryOnPanel />}

      {/* Hint bar — describes what the user is looking at without blocking
          the surface itself. Position adapts per surface. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          ...hintStyle,
          width: "min(720px, 92vw)",
          background: "rgba(14,11,20,0.94)",
          backdropFilter: "blur(18px)",
          border: "1px solid rgba(139,92,246,0.3)",
          borderRadius: 18,
          padding: "14px 18px",
          color: "#F4F2EE",
          pointerEvents: "auto",
          animation: "sqTourPop 320ms cubic-bezier(.2,.8,.2,1)",
          zIndex: 99,
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 16,
          alignItems: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              color: "rgba(201,181,255,0.8)",
              marginBottom: 4,
            }}
          >
            Live · interact with it
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 18,
              fontWeight: 400,
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={step.headline}
          >
            {step.headline}
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12,
              lineHeight: 1.4,
              color: "var(--mute)",
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={step.body}
          >
            {step.body}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onBack} style={btnGhost()}>← Back</button>
          <button onClick={onNext} style={btnSolid()}>Next →</button>
        </div>
      </div>
    </>
  );
}

function DoneSlide({
  step,
  onNext,
}: {
  step: Extract<Step, { kind: "done" }>;
  chapter: Chapter;
  onNext: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: 32,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          width: "min(640px, 100%)",
          background: "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(20,17,26,0.95))",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 22,
          padding: 36,
          color: "#F4F2EE",
          textAlign: "center",
          animation: "sqTourPop 360ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--grad)",
            margin: "0 auto 18px",
            display: "grid",
            placeItems: "center",
            color: "#0E0A14",
            fontFamily: "var(--mono)",
            fontWeight: 700,
            fontSize: 22,
          }}
        >
          ✓
        </div>
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 30, margin: "0 0 10px" }}>
          {step.headline}
        </h3>
        <p style={{ fontFamily: "var(--sans)", fontSize: 15, lineHeight: 1.55, color: "var(--mute)", margin: 0 }}>
          {step.body}
        </p>
        <button
          onClick={onNext}
          style={{
            ...btnSolid(),
            marginTop: 24,
            padding: "14px 24px",
          }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Mira Live Demo — animated scripted conversation (replaces empty MiraDock)
// ----------------------------------------------------------------------------

type DemoItem = {
  id: number;
  type: "mira" | "user" | "product" | "badge" | "actions" | "typing";
  text?: string;
  delay: number;
};

const DEMO_SCRIPT: DemoItem[] = [
  { id: 1, type: "mira", text: "I noticed you've been looking at the slip. Is this for something specific?", delay: 0 },
  { id: 2, type: "user", text: "Dinner Thursday. Low-lit, a bit dressy.", delay: 1800 },
  { id: 3, type: "typing", delay: 2800 },
  { id: 4, type: "mira", text: "The Onyx Silk Slip is exactly right for that. Bias-cut — it moves with you rather than at you.", delay: 4200 },
  { id: 5, type: "product", delay: 5500 },
  { id: 6, type: "user", text: "What size would I be? I'm usually between S and M.", delay: 7000 },
  { id: 7, type: "typing", delay: 8200 },
  { id: 8, type: "mira", text: "Based on 1,200+ shoppers your frame in this brand — size M, with 91% kept rate. The bias cut skims well even slightly loose.", delay: 9800 },
  { id: 9, type: "badge", delay: 11000 },
  { id: 10, type: "mira", text: "Want me to add it to your bag?", delay: 12500 },
  { id: 11, type: "actions", delay: 14000 },
];

function MiraLiveDemo() {
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    // Clear any existing timers
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];

    // Schedule each item to appear
    DEMO_SCRIPT.forEach((item) => {
      const t = window.setTimeout(() => {
        setVisibleIds((prev) => {
          const next = new Set(prev);
          // If this is a real message, remove the typing indicator first
          if (item.type !== "typing") {
            next.delete(3); // typing after first mira message
            next.delete(7); // typing after second mira message
          }
          next.add(item.id);
          return next;
        });
      }, item.delay);
      timersRef.current.push(t);
    });

    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
  }, []);

  const msgBase: React.CSSProperties = {
    opacity: 0,
    transform: "translateY(8px)",
    transition: "opacity 300ms ease, transform 300ms ease",
  };
  const msgVisible: React.CSSProperties = {
    opacity: 1,
    transform: "translateY(0)",
  };

  const isVisible = (id: number) => visibleIds.has(id);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px 120px",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          background: "#0E0B14",
          borderRadius: 20,
          overflow: "hidden",
          width: "min(480px, 100%)",
          height: 520,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #8B5CF6, #E879C8)",
              display: "grid",
              placeItems: "center",
              fontSize: 14,
            }}
          >
            ✦
          </div>
          <div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 14, color: "#F4F2EE", fontStyle: "italic" }}>Mira</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block", boxShadow: "0 0 6px rgba(74,222,128,0.6)" }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: "0.25em", textTransform: "uppercase", color: "#4ade80" }}>LIVE</span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            scrollbarWidth: "none",
          }}
        >
          {/* Item 1 — Mira opening */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", ...(isVisible(1) ? msgVisible : msgBase) }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg, #8B5CF6, #E879C8)", flexShrink: 0, marginTop: 2, display: "grid", placeItems: "center", fontSize: 10 }}>✦</div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "4px 18px 18px 18px", padding: "10px 14px", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, color: "#F4F2EE", maxWidth: "82%" }}>
              I noticed you&apos;ve been looking at the slip. Is this for something specific?
            </div>
          </div>

          {/* Item 2 — User reply */}
          <div style={{ display: "flex", justifyContent: "flex-end", ...(isVisible(2) ? msgVisible : msgBase) }}>
            <div style={{ background: "rgba(139,92,246,0.15)", borderRadius: "18px 4px 18px 18px", padding: "10px 14px", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, color: "#F4F2EE", maxWidth: "72%" }}>
              Dinner Thursday. Low-lit, a bit dressy.
            </div>
          </div>

          {/* Item 3 — Typing indicator */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", ...(isVisible(3) ? msgVisible : msgBase) }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg, #8B5CF6, #E879C8)", flexShrink: 0, marginTop: 2, display: "grid", placeItems: "center", fontSize: 10 }}>✦</div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "4px 18px 18px 18px", padding: "10px 16px", display: "flex", gap: 4, alignItems: "center" }}>
              {[0, 1, 2].map((d) => (
                <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.5)", animation: `sqDockTyping 1s ${d * 0.2}s infinite ease-in-out` }} />
              ))}
            </div>
          </div>

          {/* Item 4 — Mira recommendation */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", ...(isVisible(4) ? msgVisible : msgBase) }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg, #8B5CF6, #E879C8)", flexShrink: 0, marginTop: 2, display: "grid", placeItems: "center", fontSize: 10 }}>✦</div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "4px 18px 18px 18px", padding: "10px 14px", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, color: "#F4F2EE", maxWidth: "82%" }}>
              The Onyx Silk Slip is exactly right for that. Bias-cut — it moves with you rather than at you.
            </div>
          </div>

          {/* Item 5 — Product card */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", paddingLeft: 30, ...(isVisible(5) ? msgVisible : msgBase) }}>
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12, display: "flex", gap: 12, maxWidth: "85%" }}>
              <div style={{ width: 60, height: 80, borderRadius: 8, background: "rgba(255,255,255,0.06)", flexShrink: 0, overflow: "hidden" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=120&h=160&q=80" alt="Onyx Silk Slip" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 13, color: "#F4F2EE", fontStyle: "italic" }}>Onyx Silk Slip</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mute)", marginTop: 2 }}>$690</div>
                </div>
                <button style={{ padding: "5px 10px", background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.4)", borderRadius: 999, fontFamily: "var(--mono)", fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: "#C9B5FF", cursor: "pointer" }}>
                  See it on →
                </button>
              </div>
            </div>
          </div>

          {/* Item 6 — User size question */}
          <div style={{ display: "flex", justifyContent: "flex-end", ...(isVisible(6) ? msgVisible : msgBase) }}>
            <div style={{ background: "rgba(139,92,246,0.15)", borderRadius: "18px 4px 18px 18px", padding: "10px 14px", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, color: "#F4F2EE", maxWidth: "72%" }}>
              What size would I be? I&apos;m usually between S and M.
            </div>
          </div>

          {/* Item 7 — Typing indicator */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", ...(isVisible(7) ? msgVisible : msgBase) }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg, #8B5CF6, #E879C8)", flexShrink: 0, marginTop: 2, display: "grid", placeItems: "center", fontSize: 10 }}>✦</div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "4px 18px 18px 18px", padding: "10px 16px", display: "flex", gap: 4, alignItems: "center" }}>
              {[0, 1, 2].map((d) => (
                <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.5)", animation: `sqDockTyping 1s ${d * 0.2}s infinite ease-in-out` }} />
              ))}
            </div>
          </div>

          {/* Item 8 — Mira size recommendation */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", ...(isVisible(8) ? msgVisible : msgBase) }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg, #8B5CF6, #E879C8)", flexShrink: 0, marginTop: 2, display: "grid", placeItems: "center", fontSize: 10 }}>✦</div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "4px 18px 18px 18px", padding: "10px 14px", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, color: "#F4F2EE", maxWidth: "82%" }}>
              Based on 1,200+ shoppers your frame in this brand — size M, with 91% kept rate. The bias cut skims well even slightly loose.
            </div>
          </div>

          {/* Item 9 — Size badge */}
          <div style={{ paddingLeft: 30, ...(isVisible(9) ? msgVisible : msgBase) }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80", borderRadius: 999, padding: "6px 12px", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80" }} />
              M · 91% kept rate
            </span>
          </div>

          {/* Item 10 — Mira close */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", ...(isVisible(10) ? msgVisible : msgBase) }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg, #8B5CF6, #E879C8)", flexShrink: 0, marginTop: 2, display: "grid", placeItems: "center", fontSize: 10 }}>✦</div>
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "4px 18px 18px 18px", padding: "10px 14px", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, color: "#F4F2EE", maxWidth: "82%" }}>
              Want me to add it to your bag?
            </div>
          </div>

          {/* Item 11 — Action buttons */}
          <div style={{ paddingLeft: 30, display: "flex", gap: 8, flexWrap: "wrap", ...(isVisible(11) ? msgVisible : msgBase) }}>
            <button style={{ padding: "8px 14px", background: "var(--grad)", border: "none", borderRadius: 999, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#0E0A14", cursor: "pointer", fontWeight: 600 }}>
              Yes, add it →
            </button>
            <button style={{ padding: "8px 14px", background: "transparent", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "#F4F2EE", cursor: "pointer" }}>
              Try it on first →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Buttons
// ----------------------------------------------------------------------------

function FooterActions({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", gap: 12 }}>
      <button onClick={onBack} style={btnGhost()}>← Back</button>
      <button onClick={onNext} style={btnSolid()}>{nextLabel}</button>
    </div>
  );
}

function btnGhost(): React.CSSProperties {
  return {
    padding: "10px 16px",
    background: "transparent",
    color: "#F4F2EE",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 999,
    fontFamily: "var(--mono)",
    fontSize: 10,
    letterSpacing: "0.25em",
    textTransform: "uppercase",
    cursor: "pointer",
  };
}

function btnSolid(): React.CSSProperties {
  return {
    padding: "12px 20px",
    background: "var(--grad)",
    color: "#0E0A14",
    border: "none",
    borderRadius: 999,
    fontFamily: "var(--mono)",
    fontSize: 10,
    letterSpacing: "0.3em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontWeight: 600,
  };
}

// ----------------------------------------------------------------------------
// Shared keyframes
// ----------------------------------------------------------------------------

function KeyframeStyles() {
  return (
    <style>{`
      @keyframes sqTourIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes sqTourPop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes sqTourPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.85; } }
      @keyframes sqDockTyping { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }
      @keyframes sqMetricReveal { from { opacity: 0; transform: translateY(14px) scale(0.92); letter-spacing: 0.04em; } to { opacity: 1; transform: translateY(0) scale(1); letter-spacing: 0; } }
      @keyframes sqGlowDrift { 0% { transform: translateX(-50%) scale(1); opacity: 0.85; } 100% { transform: translateX(-50%) scale(1.15); opacity: 1; } }

      /* ── Mobile responsive ── */
      @media (max-width: 640px) {
        .sq-tour-picker-grid {
          grid-template-columns: 1fr !important;
          max-height: 60vh;
          overflow-y: auto;
          scrollbar-width: none;
        }
        .sq-tour-picker-grid::-webkit-scrollbar { display: none; }
        .sq-tour-picker-card { min-height: 100px !important; padding: 14px !important; flex-direction: row !important; align-items: center !important; gap: 14px !important; }
        .sq-tour-picker-card .sq-picker-name { font-size: 24px !important; }
        .sq-tour-picker-card .sq-picker-cta { display: none !important; }
        .sq-topbar-pick-another { display: none !important; }
      }
      @media (max-width: 480px) {
        .sq-tour-intro-card { padding: 28px 20px 22px !important; }
      }
    `}</style>
  );
}

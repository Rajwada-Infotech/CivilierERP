import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

// Lightweight CSS signal-bars icon — a full Lottie animation engine (~300KB)
// is too heavy to ship to users who are, by definition, on a slow connection.
// Drawn on the sheet: square ink bars, the tallest one hatched while it waits.
function SignalLottie() {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "2px",
        width: 18,
        height: 16,
        flexShrink: 0,
      }}
    >
      {[6, 11, 16].map((h, i) => (
        <div
          key={i}
          className="scb-bar"
          style={{
            width: "4px",
            height: `${h}px`,
            border: "1px solid hsl(var(--foreground))",
            background:
              i === 2
                ? "repeating-linear-gradient(135deg, hsl(var(--foreground)) 0, hsl(var(--foreground)) 1px, transparent 1px, transparent 3px)"
                : "hsl(var(--foreground))",
            animation: `scb-bar 1s ease-in-out ${i * 0.15}s infinite`,
            transformOrigin: "bottom",
          }}
        />
      ))}
    </div>
  );
}

// ─── slow-connection hook ─────────────────────────────────────────────────────

const SLOW_THRESHOLD_MS = 4000;
const LINGER_MS = 2500;

function useSlowConnection() {
  const isFetching = useIsFetching();
  const [slow, setSlow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowRef = useRef(false);

  useEffect(() => {
    if (isFetching > 0) {
      if (lingerRef.current) {
        clearTimeout(lingerRef.current);
        lingerRef.current = null;
      }
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          slowRef.current = true;
          setSlow(true);
        }, SLOW_THRESHOLD_MS);
      }
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (slowRef.current && !lingerRef.current) {
        lingerRef.current = setTimeout(() => {
          lingerRef.current = null;
          slowRef.current = false;
          setSlow(false);
        }, LINGER_MS);
      }
    }
  }, [isFetching]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (lingerRef.current) clearTimeout(lingerRef.current);
    },
    [],
  );

  return slow;
}

// ─── banner ──────────────────────────────────────────────────────────────────

export default function SlowConnectionBanner() {
  const slow = useSlowConnection();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (slow) {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setExiting(false);
      setVisible(true);
    } else if (visible) {
      setExiting(true);
      exitTimer.current = setTimeout(() => {
        setVisible(false);
        setExiting(false);
        exitTimer.current = null;
      }, 500);
    }
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [slow]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        animation: exiting
          ? "scb-out 0.45s cubic-bezier(0.4,0,1,1) forwards"
          : "scb-in 0.45s cubic-bezier(0,0,0.2,1) forwards",
        pointerEvents: "none",
      }}
    >
      <style>{`
        @keyframes scb-in {
          from { opacity:0; transform:translateX(-50%) translateY(16px) scale(0.95); }
          to   { opacity:1; transform:translateX(-50%) translateY(0)    scale(1);    }
        }
        @keyframes scb-out {
          from { opacity:1; transform:translateX(-50%) translateY(0)    scale(1);    }
          to   { opacity:0; transform:translateX(-50%) translateY(12px) scale(0.96); }
        }
        @keyframes scb-dot {
          0%,100% { opacity:1; }
          50%      { opacity:0.35; }
        }
        @keyframes scb-bar {
          0%,100% { transform: scaleY(0.5); opacity:0.5; }
          50%      { transform: scaleY(1);   opacity:1;   }
        }
        @media (prefers-reduced-motion: reduce) {
          .scb-bar, .scb-dot { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* On the drawing sheet: a square card in the theme's own colours, ruled in ink with the sheet's offset
          outline, a lettered label and a plain line under it. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "10px 16px 10px 14px",
          background: "hsl(var(--card))",
          color: "hsl(var(--foreground))",
          border: "1.5px solid hsl(var(--foreground))",
          outline: "1px solid hsl(var(--border))",
          outlineOffset: "4px",
          boxShadow: "0 8px 24px hsl(var(--foreground) / 0.12)",
          fontFamily: "'DM Sans',system-ui,sans-serif",
          maxWidth: "calc(100vw - 32px)",
          userSelect: "none",
        }}
      >
        <SignalLottie />

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: "'Sora',sans-serif",
              fontWeight: 600,
              fontSize: "10px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Slow or spotty connection
            <span style={{ display: "inline-flex", alignItems: "center", gap: "2px" }} aria-hidden="true">
              {["0s", "0.2s", "0.4s"].map((delay, i) => (
                <span
                  key={i}
                  className="scb-dot"
                  style={{
                    width: "3px",
                    height: "3px",
                    background: "hsl(var(--foreground))",
                    animation: `scb-dot 1.2s ease-in-out ${delay} infinite`,
                  }}
                />
              ))}
            </span>
          </div>
          <div style={{ marginTop: "3px", fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
            Hang in there
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

// How long (ms) a fetch must be in-flight before we show the banner
const SLOW_THRESHOLD_MS = 4000;
// How long to keep the banner visible after fetches complete
const LINGER_MS = 2500;

function useSlowConnection() {
  const isFetching = useIsFetching();
  const [slow, setSlow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isFetching > 0) {
      // Clear any linger timer — fetching is still happening
      if (lingerRef.current) clearTimeout(lingerRef.current);

      // Start slow timer if not already running
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          setSlow(true);
          timerRef.current = null;
        }, SLOW_THRESHOLD_MS);
      }
    } else {
      // Fetching done — clear slow timer if it hasn't fired
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      // If banner is showing, linger a bit before hiding
      if (slow) {
        lingerRef.current = setTimeout(() => {
          setSlow(false);
          lingerRef.current = null;
        }, LINGER_MS);
      }
    }

    return () => {
      // cleanup on unmount only — don't clear on every effect run
    };
  }, [isFetching, slow]);

  return slow;
}

export default function SlowConnectionBanner() {
  const slow = useSlowConnection();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (slow) {
      setExiting(false);
      setVisible(true);
    } else if (visible) {
      setExiting(true);
      const t = setTimeout(() => {
        setVisible(false);
        setExiting(false);
      }, 500);
      return () => clearTimeout(t);
    }
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
          from { opacity: 0; transform: translateX(-50%) translateY(16px) scale(0.95); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1);    }
        }
        @keyframes scb-out {
          from { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1);    }
          to   { opacity: 0; transform: translateX(-50%) translateY(12px) scale(0.96); }
        }
        @keyframes scb-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
        @keyframes scb-dot1 { 0%,80%,100% { transform:scaleY(0.4); } 40% { transform:scaleY(1); } }
        @keyframes scb-dot2 { 0%,80%,100% { transform:scaleY(0.4); } 40% { transform:scaleY(1); } }
        @keyframes scb-dot3 { 0%,80%,100% { transform:scaleY(0.4); } 40% { transform:scaleY(1); } }
      `}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 18px 10px 14px",
          borderRadius: "12px",
          background: "rgba(15, 15, 20, 0.92)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 180, 0, 0.25)",
          boxShadow:
            "0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,180,0,0.08)",
          color: "#fff",
          fontFamily: "'DM Sans', 'Geist', system-ui, sans-serif",
          fontSize: "13px",
          fontWeight: 500,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          userSelect: "none",
        }}
      >
        {/* Signal icon with animated bars */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "2px",
            height: "16px",
          }}
        >
          {[
            { h: 6, delay: "0s", dim: true },
            { h: 10, delay: "0.15s", dim: true },
            { h: 14, delay: "0.3s", dim: false },
            { h: 16, delay: "0.45s", dim: false },
          ].map((bar, i) => (
            <div
              key={i}
              style={{
                width: "3px",
                height: `${bar.h}px`,
                borderRadius: "2px",
                background: bar.dim ? "rgba(255, 180, 0, 0.35)" : "#FFB400",
                animation: bar.dim
                  ? `scb-pulse 1.4s ease-in-out ${bar.delay} infinite`
                  : "none",
                transformOrigin: "bottom",
              }}
            />
          ))}
        </div>

        {/* Text */}
        <span style={{ color: "rgba(255,255,255,0.85)" }}>
          Slow or spotty connection
        </span>

        {/* Animated ellipsis dots */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "2px",
            marginLeft: "2px",
          }}
        >
          {["0s", "0.2s", "0.4s"].map((delay, i) => (
            <div
              key={i}
              style={{
                width: "3px",
                height: "3px",
                borderRadius: "50%",
                background: "rgba(255,180,0,0.7)",
                animation: `scb-pulse 1.2s ease-in-out ${delay} infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

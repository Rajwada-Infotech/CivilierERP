import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import Lottie from "lottie-react";

// Free wifi-signal animation from LottieFiles (lottie.host CDN)
const WIFI_LOTTIE_URL =
  "https://lottie.host/4db68bbd-31f6-4cd8-84eb-189de081159a/IGmMCqhzpt.lottie";

// Fallback: simple pulsing wifi SVG if Lottie fails to load
function WifiFallback() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <style>{`
        @keyframes wf { 0%,100%{opacity:.25} 50%{opacity:1} }
        .wa{animation:wf 1.4s ease-in-out infinite}
        .wb{animation:wf 1.4s ease-in-out .25s infinite}
        .wc{animation:wf 1.4s ease-in-out .5s infinite}
      `}</style>
      <path
        className="wa"
        d="M2.05 7.95a11.31 11.31 0 0 1 15.9 0"
        stroke="#FFB400"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        className="wb"
        d="M5.05 10.95a7.07 7.07 0 0 1 9.9 0"
        stroke="#FFB400"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        className="wc"
        d="M8.18 13.82a2.6 2.6 0 0 1 3.64 0"
        stroke="#FFB400"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="10" cy="17" r="1.5" fill="#FFB400" />
    </svg>
  );
}

function WifiLottie() {
  const [animationData, setAnimationData] = useState<object | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(WIFI_LOTTIE_URL)
      .then((r) => r.json())
      .then(setAnimationData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <WifiFallback />;
  if (!animationData) return <div style={{ width: 22, height: 22 }} />;

  return (
    <Lottie
      animationData={animationData}
      loop
      autoplay
      style={{ width: 22, height: 22, flexShrink: 0 }}
    />
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
      `}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 18px 10px 14px",
          borderRadius: "12px",
          background: "rgba(15,15,20,0.92)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(255,180,0,0.25)",
          boxShadow:
            "0 4px 24px rgba(0,0,0,0.4),0 0 0 1px rgba(255,180,0,0.08)",
          color: "#fff",
          fontFamily: "'DM Sans','Geist',system-ui,sans-serif",
          fontSize: "13px",
          fontWeight: 500,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          userSelect: "none",
        }}
      >
        <WifiLottie />

        <span style={{ color: "rgba(255,255,255,0.85)" }}>
          Slow or spotty connection
        </span>

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
                animation: `scb-dot 1.2s ease-in-out ${delay} infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Left of the sign-in page: the headline, what the product covers and the company's figures, over the site drawing.
import React, { useEffect, useState } from "react";
import { CivilScene } from "./CivilScene";
import type { PublicStats } from "./config";

// Types a rotating tagline one letter at a time.
function useTypewriter(words: string[], speed = 60, pause = 2400) {
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const word = words[wordIdx % words.length];
    let t: ReturnType<typeof setTimeout>;
    if (!deleting && charIdx < word.length) t = setTimeout(() => setCharIdx((c) => c + 1), speed);
    else if (!deleting && charIdx === word.length) t = setTimeout(() => setDeleting(true), pause);
    else if (deleting && charIdx > 0) t = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
    else {
      setDeleting(false);
      setWordIdx((i) => i + 1);
    }
    return () => clearTimeout(t);
  }, [charIdx, deleting, wordIdx, words, speed, pause]);
  return words[wordIdx % words.length].slice(0, charIdx);
}

const TAGLINES = ["Built for Civil Contractors", "Project Insights at a Glance", "One Platform. Total Control."];
const num = (n: number | undefined) => (n ?? 0).toLocaleString("en-IN");

export function LoginHero({ stats }: { stats: PublicStats | null }) {
  const tagline = useTypewriter(TAGLINES);
  const cells: { label: string; value: number | undefined }[] = [
    { label: "Projects", value: stats?.projects },
    { label: "Active suppliers", value: stats?.activeSuppliers },
    { label: "GRNs received", value: stats?.grns },
    { label: "Quotations", value: stats?.quotations },
    { label: "Work orders", value: stats?.workOrders },
  ];
  const pct = Math.min(100, Math.max(0, stats?.workOrderCompletionPct ?? 0));

  return (
    <div className="hidden lg:flex flex-col justify-between relative overflow-hidden p-10 min-h-[560px]">
      {/* The drawing sits behind the text, faded at the top so it never competes with the headline. */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute bottom-0 left-0 right-0" style={{ height: "105%", opacity: 0.5 }}>
          <CivilScene />
        </div>
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(13,10,26,0.9) 0%, rgba(13,10,26,0.35) 45%, rgba(13,10,26,0.2) 70%, rgba(13,10,26,0.75) 100%)" }} />
      </div>

      <div className="relative z-10 ls-in">
        <p className="label">CivilierERP · Construction ERP</p>
        <h1 className="font-heading font-bold tracking-tight mt-4" style={{ fontSize: "clamp(34px, 3.6vw, 52px)", lineHeight: 1.08, color: "var(--ink)" }}>
          CivilierERP —{" "}
          <span style={{ color: "var(--violet-soft)" }}>Manage Smarter,</span>
          <br />
          Build Better.
        </h1>
        <p className="mt-4 flex items-center gap-2.5 text-sm h-5" style={{ color: "var(--ink-2)" }} aria-live="off">
          <span className="inline-block w-1.5 h-1.5 shrink-0" style={{ background: "var(--violet)" }} />
          <span className="whitespace-nowrap">{tagline}</span>
          <span className="inline-block w-px h-4 animate-pulse" style={{ background: "var(--violet-soft)" }} />
        </p>
        <p className="mt-5 text-sm leading-relaxed max-w-md" style={{ color: "var(--graphite)" }}>
          From procurement and material tracking to contractor management and live project dashboards — CivilierERP gives your team total visibility and control.
        </p>
      </div>

      <div className="relative z-10 mt-10" style={{ border: "1px solid var(--rule)", background: "rgba(20,16,42,0.82)" }}>
        <div className="grid grid-cols-3" style={{ gap: 1, background: "var(--rule-soft)" }}>
          {cells.map((c) => (
            <div key={c.label} className="px-4 py-3.5" style={{ background: "rgba(20,16,42,0.96)" }}>
              <p className="label">{c.label}</p>
              {stats ? (
                <p className="figure mt-2.5" style={{ fontSize: 24 }}>{num(c.value)}</p>
              ) : (
                <div className="mt-2.5 h-6 w-12 animate-pulse" style={{ background: "var(--rule-soft)" }} />
              )}
            </div>
          ))}
          <div className="px-4 py-3.5" style={{ background: "rgba(20,16,42,0.96)" }}>
            <p className="label">Work completed</p>
            {stats ? (
              <>
                <p className="figure mt-2.5" style={{ fontSize: 24 }}>{pct}%</p>
                <div className="mt-2 h-1" style={{ background: "var(--rule-soft)" }}>
                  <div className="h-full" style={{ width: `${pct}%`, background: "var(--violet)" }} />
                </div>
              </>
            ) : (
              <div className="mt-2.5 h-6 w-12 animate-pulse" style={{ background: "var(--rule-soft)" }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

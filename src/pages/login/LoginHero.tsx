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
    <div className="hidden lg:flex flex-col relative overflow-hidden px-12 xl:px-20 min-h-screen" style={{ paddingTop: "min(3.5rem, 6vh)", paddingBottom: "min(3rem, 5vh)" }}>
      {/* Eyebrow on a rule that runs to the panel */}
      <div className="relative z-10 flex items-center gap-4 ls-in">
        <p className="label shrink-0" style={{ color: "var(--violet-soft)" }}>CivilierERP · Construction ERP</p>
        <span className="h-px flex-1" style={{ background: "var(--rule-soft)" }} />
      </div>

      <div className="relative z-10 ls-in" style={{ animationDelay: "60ms", marginTop: "min(3.5rem, 5vh)" }}>
        <h1 className="font-heading font-bold" style={{ letterSpacing: "-0.035em", lineHeight: 0.98, color: "var(--ink)", textWrap: "balance" }}>
          <span className="block" style={{ fontSize: "clamp(20px, 1.7vw, 28px)", letterSpacing: "-0.01em", color: "var(--graphite)", fontWeight: 600, marginBottom: "0.55em" }}>
            CivilierERP —
          </span>
          <span className="block" style={{ fontSize: "clamp(40px, min(5vw, 8.5vh), 84px)", color: "var(--violet-soft)" }}>Manage Smarter,</span>
          <span className="block" style={{ fontSize: "clamp(40px, min(5vw, 8.5vh), 84px)" }}>Build Better.</span>
        </h1>

        <div className="grid gap-4 max-w-xl" style={{ gridTemplateColumns: "2px minmax(0,1fr)", marginTop: "min(2rem, 3.5vh)" }}>
          <span style={{ background: "var(--violet)" }} />
          <div>
            <p className="flex items-center gap-2 text-[15px] font-medium h-6" style={{ color: "var(--ink)" }} aria-live="off">
              <span className="whitespace-nowrap">{tagline}</span>
              <span className="inline-block w-px h-4 animate-pulse" style={{ background: "var(--violet-soft)" }} />
            </p>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--graphite)", maxWidth: "52ch" }}>
              From procurement and material tracking to contractor management and live project dashboards — CivilierERP gives your team total visibility and control.
            </p>
          </div>
        </div>
      </div>

      {/* The drawing takes whatever height is left between the words and the figures, so it never runs into the text;
          it stands on the figures' top rule. */}
      <div className="relative flex-1 min-h-[90px] pointer-events-none" style={{ marginTop: "min(2rem, 3vh)" }} aria-hidden="true">
        <div className="absolute inset-0" style={{ opacity: 0.75 }}>
          <CivilScene />
        </div>
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, var(--ground) 0%, rgba(13,10,26,0) 25%)" }} />
      </div>

      {/* Figures: one ruled strip along the foot of the sheet */}
      <div className="relative z-10 ls-in" style={{ animationDelay: "140ms" }}>
        <div className="grid grid-cols-3 min-[1800px]:grid-cols-6" style={{ gap: 1, background: "var(--rule-soft)", border: "1px solid var(--rule)" }}>
          {cells.map((c) => (
            <div key={c.label} className="px-5 py-3.5" style={{ background: "rgba(16,12,34,0.94)" }}>
              <p className="label">{c.label}</p>
              {stats ? (
                <p className="figure mt-3" style={{ fontSize: "clamp(24px, 2vw, 32px)" }}>{num(c.value)}</p>
              ) : (
                <div className="mt-3 h-7 w-14 animate-pulse" style={{ background: "var(--rule-soft)" }} />
              )}
            </div>
          ))}
          <div className="px-5 py-3.5" style={{ background: "rgba(16,12,34,0.94)" }}>
            <p className="label">Work completed</p>
            {stats ? (
              <>
                <p className="figure mt-3" style={{ fontSize: "clamp(24px, 2vw, 32px)" }}>{pct}%</p>
                <div className="mt-2.5 h-1" style={{ background: "var(--rule-soft)" }}>
                  <div className="h-full" style={{ width: `${pct}%`, background: "var(--violet)" }} />
                </div>
              </>
            ) : (
              <div className="mt-3 h-7 w-14 animate-pulse" style={{ background: "var(--rule-soft)" }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

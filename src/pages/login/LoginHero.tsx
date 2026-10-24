// Left of the sign-in page: the site hoarding. The headline, what the product covers and the company's figures on a
// charcoal board with a hazard stripe down its edge. On a phone it shrinks to a band above the form.
import React, { useEffect, useState } from "react";
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

/** The hoarding on a phone: the name and the headline in a band, the stripe along its foot. */
export function LoginBand() {
  return (
    <div className="lg:hidden relative" style={{ background: "var(--board)", color: "var(--chalk)" }}>
      <div className="px-6 pt-6 pb-7">
        <p className="eyebrow" style={{ color: "var(--hivis)" }}>CivilierERP · Construction ERP</p>
        <p className="display mt-3" style={{ fontSize: 34 }}>
          Manage <span style={{ color: "var(--hivis)" }}>smarter</span>,<br />build better.
        </p>
      </div>
      <div className="hazard h-2.5" />
    </div>
  );
}

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
    <div className="hidden lg:flex relative min-h-screen" style={{ background: "var(--board)", color: "var(--chalk)" }}>
      <div className="flex-1 flex flex-col min-w-0 px-12 xl:px-20" style={{ paddingTop: "min(3.5rem, 6vh)", paddingBottom: "min(3rem, 5vh)" }}>
        {/* Name plate */}
        <div className="flex items-center justify-between gap-4 ls-in">
          <p className="font-heading font-bold text-lg tracking-tight">CivilierERP</p>
          <p className="eyebrow" style={{ color: "var(--chalk-2)" }}>Construction ERP</p>
        </div>

        {/* The headline is the page */}
        <div className="my-auto" style={{ paddingBlock: "min(2.5rem, 4vh)" }}>
          <p className="eyebrow ls-in" style={{ color: "var(--hivis)", animationDelay: "60ms" }}>CivilierERP —</p>
          <h1 className="display mt-5 ls-in" style={{ fontSize: "clamp(40px, min(4.8vw, 9.5vh), 104px)", animationDelay: "120ms" }}>
            <span className="block whitespace-nowrap">Manage <span style={{ color: "var(--hivis)" }}>smarter</span>,</span>
            <span className="block whitespace-nowrap">build better.</span>
          </h1>
          <div className="flex items-center gap-3 ls-in" style={{ animationDelay: "200ms", marginTop: "min(2.25rem, 4vh)" }} aria-live="off">
            <span className="w-2.5 h-2.5 shrink-0" style={{ background: "var(--hivis)" }} />
            <span className="font-heading font-semibold text-lg whitespace-nowrap">{tagline}</span>
            <span className="inline-block w-[2px] h-5 animate-pulse" style={{ background: "var(--hivis)" }} />
          </div>
          <p className="mt-4 text-[17px] leading-relaxed ls-in" style={{ color: "var(--chalk-2)", maxWidth: "46ch", animationDelay: "240ms" }}>
            From procurement and material tracking to contractor management and live project dashboards — CivilierERP gives your team total visibility and control.
          </p>
        </div>

        {/* Figures: big numbers on hairline rules */}
        <div className="grid grid-cols-3 ls-in" style={{ borderTop: "1px solid var(--chalk-rule)", animationDelay: "300ms" }}>
          {cells.map((c, i) => (
            <div key={c.label} className="pr-4" style={{ paddingBlock: "min(1.25rem, 2.2vh)", borderBottom: i < 3 ? "1px solid var(--chalk-rule)" : undefined, borderLeft: i % 3 ? "1px solid var(--chalk-rule)" : undefined, paddingLeft: i % 3 ? 20 : 0 }}>
              {stats ? (
                <p className="num" style={{ fontSize: "clamp(30px, min(2.8vw, 5vh), 46px)" }}>{num(c.value)}</p>
              ) : (
                <div className="h-9 w-16 animate-pulse rounded" style={{ background: "var(--chalk-rule)" }} />
              )}
              <p className="mt-2 text-[13px]" style={{ color: "var(--chalk-2)" }}>{c.label}</p>
            </div>
          ))}
          <div className="pr-4" style={{ paddingBlock: "min(1.25rem, 2.2vh)", borderLeft: "1px solid var(--chalk-rule)", paddingLeft: 20 }}>
            {stats ? (
              <p className="num" style={{ fontSize: "clamp(30px, min(2.8vw, 5vh), 46px)" }}>
                {pct}<span style={{ color: "var(--hivis)" }}>%</span>
              </p>
            ) : (
              <div className="h-9 w-16 animate-pulse rounded" style={{ background: "var(--chalk-rule)" }} />
            )}
            <p className="mt-2 text-[13px]" style={{ color: "var(--chalk-2)" }}>Work completed</p>
            <div className="mt-2.5 h-[3px] max-w-[160px]" style={{ background: "var(--chalk-rule)" }}>
              <div className="h-full" style={{ width: `${pct}%`, background: "var(--hivis)" }} />
            </div>
          </div>
        </div>
      </div>

      {/* The hazard stripe down the board's edge */}
      <div className="hazard w-4 shrink-0" aria-hidden="true" />
    </div>
  );
}

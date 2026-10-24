// Right of the sign-in page: the site photo with notched corners, the line over it and the company's figures on a
// frosted card. Until public/login-photo.jpg exists it shows a deep green with a faint grid instead.
import React, { useState } from "react";
import { LOGIN_PHOTO, type PublicStats } from "./config";

const num = (n: number | undefined) => (n ?? 0).toLocaleString("en-IN");

export function LoginPhoto({ stats }: { stats: PublicStats | null }) {
  const [hasPhoto, setHasPhoto] = useState(true);
  const figures: [string, string][] = stats
    ? [
        [num(stats.projects), "Projects"],
        [num(stats.activeSuppliers), "Suppliers"],
        [num(stats.workOrders), "Work orders"],
        [`${Math.min(100, Math.max(0, stats.workOrderCompletionPct ?? 0))}%`, "Work completed"],
      ]
    : [];

  return (
    <div className="ls-photo h-full min-h-[520px]" style={{ background: "linear-gradient(160deg, #24603f 0%, #163d2a 55%, #0e2a1c 100%)" }}>
      {hasPhoto ? (
        <img src={LOGIN_PHOTO} alt="" onError={() => setHasPhoto(false)} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(70% 60% at 75% 30%, rgba(132,204,22,0.18), transparent 70%), linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "auto, 40px 40px, 40px 40px",
          }}
        />
      )}
      {/* Shade at the top and bottom so the words read over any photo */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.42) 100%)" }} />

      <span className="ls-bite tl" />
      <span className="ls-corner tl-a" />
      <span className="ls-corner tl-b" />
      <span className="ls-bite br" />
      <span className="ls-corner br-a" />
      <span className="ls-corner br-b" />

      <p className="absolute z-[3] text-right font-heading font-semibold text-white ls-in"
        style={{ top: "6%", right: "6%", left: "40%", fontSize: "clamp(18px, 1.6vw, 24px)", lineHeight: 1.3, textWrap: "balance", animationDelay: "120ms" }}>
        Manage smarter, build better. Built for civil contractors.
      </p>

      {figures.length > 0 && (
        <div className="absolute z-[3] grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 rounded-2xl ls-in"
          style={{ left: "5%", bottom: "5%", maxWidth: "62%", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.22)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", animationDelay: "180ms" }}>
          {figures.map(([v, label]) => (
            <div key={label} className="text-white">
              <p className="font-heading font-semibold tabular-nums" style={{ fontSize: "clamp(20px, 1.6vw, 26px)", lineHeight: 1 }}>{v}</p>
              <p className="text-[12px] mt-1 opacity-80">{label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

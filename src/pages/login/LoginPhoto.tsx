// Right of the sign-in page: the building (a cut-out, public/login-photo.webp) standing at the foot of a soft sky in a
// panel with notched corners, with the line and the company's figures in the sky above it.
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
    <div className="ls-photo h-full min-h-[520px]" style={{ background: "linear-gradient(180deg, #cfdfe6 0%, #e6ebe6 38%, #f3e8da 72%, #ead7c0 100%)" }}>
      {/* A low sun behind the buildings */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(55% 40% at 70% 78%, rgba(255,214,160,0.55), transparent 70%)" }} />

      {hasPhoto && (
        <img
          src={LOGIN_PHOTO}
          alt=""
          onError={() => setHasPhoto(false)}
          className="absolute select-none pointer-events-none"
          style={{ left: "46%", bottom: "-2%", width: "142%", maxWidth: "none", transform: "translateX(-50%)" }}
          draggable={false}
        />
      )}

      <span className="ls-bite tl" />
      <span className="ls-corner tl-a" />
      <span className="ls-corner tl-b" />
      <span className="ls-bite br" />
      <span className="ls-corner br-a" />
      <span className="ls-corner br-b" />

      {/* The line and the figures, in the sky to the right of the top notch */}
      <div className="absolute z-[3] text-right ls-in" style={{ top: "6%", right: "6%", left: "40%", animationDelay: "120ms" }}>
        <p className="font-heading font-semibold" style={{ fontSize: "clamp(18px, 1.6vw, 25px)", lineHeight: 1.3, color: "#1d2a24", textWrap: "balance" }}>
          Manage smarter, build better. Built for civil contractors.
        </p>
        {figures.length > 0 && (
          <div className="mt-5 inline-flex flex-wrap justify-end gap-x-6 gap-y-3 px-5 py-3.5 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.8)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}>
            {figures.map(([v, label]) => (
              <div key={label} className="text-left">
                <p className="font-heading font-semibold tabular-nums" style={{ fontSize: "clamp(18px, 1.4vw, 23px)", lineHeight: 1, color: "var(--brand)" }}>{v}</p>
                <p className="text-[11.5px] mt-1" style={{ color: "#55625b" }}>{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

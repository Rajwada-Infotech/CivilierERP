import React from "react";
import type { ReportDef } from "@/pages/reports/types";

// ── Report tile ───────────────────────────────────────────────────────────────
// A square tile on the sheet: the report's square mark in its colour, its name and what it shows. The open one is
// outlined in ink and underlined in its colour.

export const ReportTile: React.FC<{
  report: ReportDef;
  active: boolean;
  onClick: () => void;
}> = ({ report, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`rp-tile ${active ? "on" : ""}`}
    style={{ ["--rp-c" as string]: report.color } as React.CSSProperties}
  >
    <span className="rp-mark" style={{ color: report.color }}>
      <report.icon size={15} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="rp-tile-name">{report.label}</span>
      <span className="rp-tile-desc">{report.description}</span>
    </span>
  </button>
);

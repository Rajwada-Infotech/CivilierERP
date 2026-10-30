import React from "react";
import { CheckCircle2, Circle, CircleDot, Clock, Lock, RotateCcw, SkipForward } from "lucide-react";
import { LEGAL_ACCENT } from "@/components/legal/LegalShell";
import type { PipelineStep, StepStatus } from "@/api/legalLandApi";

// The land property's 31-step pipeline: number, name, status, who last moved it and when.

export const STATUS_STYLE: Record<StepStatus, string> = {
  "Not Started": "border-border text-muted-foreground",
  "In Progress": "border-sky-500/40 bg-sky-500/10 text-sky-600",
  "Pending Verification": "border-amber-500/40 bg-amber-500/10 text-amber-600",
  "Correction Required": "border-rose-500/40 bg-rose-500/10 text-rose-600",
  Completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  Skipped: "border-border bg-muted text-muted-foreground",
};

export const StatusBadge: React.FC<{ status: StepStatus }> = ({ status }) => (
  <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] ${STATUS_STYLE[status]}`}>{status}</span>
);

const icon = (s: PipelineStep) => {
  if (s.status === "Completed") return <CheckCircle2 size={15} className="text-emerald-600" />;
  if (s.status === "Skipped") return <SkipForward size={15} className="text-muted-foreground" />;
  if (s.status === "Correction Required") return <RotateCcw size={15} className="text-rose-600" />;
  if (s.status === "Pending Verification") return <Clock size={15} className="text-amber-600" />;
  if (s.status === "In Progress") return <CircleDot size={15} className="text-sky-600" />;
  if (!s.live || s.locked) return <Lock size={14} className="text-muted-foreground/60" />;
  return <Circle size={15} className="text-muted-foreground" />;
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "");

export const LandPipelineSidebar: React.FC<{
  steps: PipelineStep[];
  selected: string;
  onSelect: (code: string) => void;
}> = ({ steps, selected, onSelect }) => {
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll ? steps : steps.filter((s) => s.live || s.status !== "Not Started");
  return (
    <nav className="space-y-0.5">
      {shown.map((s) => {
        const active = s.code === selected;
        return (
          <button
            key={s.code}
            onClick={() => onSelect(s.code)}
            className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? "bg-muted" : "hover:bg-muted/50"}`}
            style={active ? { boxShadow: `inset 3px 0 0 ${LEGAL_ACCENT}` } : undefined}
          >
            <span className="mt-0.5">{icon(s)}</span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm leading-snug ${s.live ? "text-foreground" : "text-muted-foreground"}`}>
                <span className="tabular-nums text-muted-foreground">{s.stepNo}.</span> {s.name}
              </span>
              <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground truncate">
                {s.live
                  ? s.status === "Not Started" ? (s.missing.length ? `${s.missing.length} item(s) pending` : "Ready") : `${s.status}${s.updatedBy ? ` · ${s.updatedBy}` : ""}${s.updatedAt ? ` · ${fmt(s.updatedAt)}` : ""}`
                  : `Phase ${s.phase}`}
              </span>
            </span>
          </button>
        );
      })}
      <button onClick={() => setShowAll((v) => !v)} className="w-full px-2.5 py-2 text-left text-xs text-muted-foreground hover:text-foreground">
        {showAll ? "Hide later-phase steps" : `Show all ${steps.length} steps`}
      </button>
    </nav>
  );
};

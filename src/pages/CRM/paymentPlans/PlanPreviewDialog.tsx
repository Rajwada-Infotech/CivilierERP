// A plan, read-only: its split, the milestones in order, and the projects it's tagged to. Built from the list row, so
// it opens with nothing to load.
import React, { useMemo } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import {
  KEY_INK, KEY_LINE, LBL, MilestoneBar, NUM, RULE, RULE_SOFT, parseMilestones, parseTaggedProjects, segmentColor,
  type Company, type Project,
} from "./config";

export const PlanPreviewDialog: React.FC<{
  plan: any | null; onClose: () => void;
  companies: Company[]; projects: Project[];
  canEdit: boolean; canDelete: boolean; deleting: boolean;
  onEdit: (id: number) => void; onDelete: (plan: any) => void;
}> = ({ plan, onClose, companies, projects, canEdit, canDelete, deleting, onEdit, onDelete }) => {
  const milestones = useMemo(() => parseMilestones(plan?.MilestonesJson), [plan]);
  const afterBooking = Math.round(milestones.slice(1).reduce((s, m) => s + m.pct, 0) * 100) / 100;
  const tagged = useMemo(() => parseTaggedProjects(plan?.ProjectsJson).map((row) => {
    const p = projects.find((x) => x.id === row.ProjectId);
    const company = p ? companies.find((c) => c.id === p.company_id) : undefined;
    return { id: row.ProjectId, name: p?.name ?? row.ProjectName, companyName: company?.name ?? "" };
  }), [plan, projects, companies]);

  return (
    <Dialog open={!!plan} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto thin-scroll rounded-none p-5 gap-4" style={{ border: RULE }}>
        {plan && (
          <>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Payment plan</p>
              <DialogTitle className="mt-1 flex flex-wrap items-center gap-3 font-heading text-lg font-bold tracking-tight">
                {plan.PlanName}
                <SheetMark text={plan.IsActive ? "Active" : "Inactive"} tone={plan.IsActive ? "done" : "draft"} />
              </DialogTitle>
              {plan.Description && <p className="mt-1 text-xs text-muted-foreground">{plan.Description}</p>}
            </div>

            {/* Dialogs render outside the sheet frame, so its figure classes don't reach here. */}
            <div className="grid grid-cols-3">
              {([
                ["Booking", fmtRupees(Number(plan.BookingAmount || 0)), false],
                ["Milestones", String(milestones.length), false],
                ["After booking", `${afterBooking}%`, afterBooking !== 100],
              ] as const).map(([label, value, red], i) => (
                <div key={label} className={`min-w-0 ${i ? "pl-4 border-l border-foreground/15" : ""}`}>
                  <p className={LBL}>{label}</p>
                  <p className={`mt-1.5 text-xl font-semibold ${NUM} ${red ? "text-destructive" : "text-foreground"}`}>{value}</p>
                </div>
              ))}
            </div>
            <MilestoneBar milestones={milestones} height={10} />

            <div className="grid sm:grid-cols-[1.4fr_1fr] gap-4">
              <div className="bg-card max-h-[42vh] overflow-y-auto thin-scroll" style={{ border: RULE }}>
                {milestones.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 text-sm" style={{ borderBottom: RULE_SOFT }}>
                    <span className="h-3 w-3 shrink-0 border border-foreground/40" style={{ background: i === 0 ? "transparent" : segmentColor(i) }} />
                    <span className={`${NUM} text-xs text-muted-foreground w-4`}>{i + 1}</span>
                    <span className="flex-1 min-w-0 break-words font-medium">{m.name}</span>
                    <span className={`${NUM} shrink-0 font-semibold`}>{i === 0 ? fmtRupees(Number(plan.BookingAmount || 0)) : `${m.pct}%`}</span>
                  </div>
                ))}
              </div>
              <div className="bg-card p-3 self-start" style={{ border: RULE }}>
                <p className={`${LBL} mb-2.5`}>Tagged projects</p>
                {tagged.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {tagged.map((p) => (
                      <span key={p.id} className="inline-flex items-center h-7 px-2.5 text-xs border border-foreground/40">
                        {p.name}{p.companyName && <span className="text-muted-foreground"> · {p.companyName}</span>}
                      </span>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">Not tagged — offered everywhere as a fallback.</p>}
                <p className="mt-3 text-xs text-muted-foreground">Created {plan.CreatedAt ? new Date(plan.CreatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
              {canDelete && (
                <button onClick={() => onDelete(plan)} disabled={deleting} className={`${KEY_LINE} h-9 px-4 mr-auto !text-destructive !border-destructive`}>
                  <Trash2 size={13} /> {deleting ? "Deleting…" : "Delete"}
                </button>
              )}
              <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Close</button>
              {canEdit && <button onClick={() => onEdit(plan.Id)} className={`${KEY_INK} h-9 px-4`}><Pencil size={13} /> Edit plan</button>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Camera, Loader2, CheckCircle2, RotateCcw } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { QcBadge, AttemptBadge } from "@/components/civilworkdpr/QcBadge";
import { usePageRights } from "@/hooks/usePageRights";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getCompletedAssignments,
  getRungAssignment,
  getQcHistory,
  getActivityPhotos,
  uploadActivityPhoto,
  submitQcDecision,
  type ReportedAssignment,
  type QcRating,
} from "@/api/dependencyActivityAssignmentApi";

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

type Verdict = { rating: QcRating | null; note: string };

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

const RATING_OPTIONS: Array<{ value: QcRating; label: string }> = [
  { value: "POOR", label: "Poor" },
  { value: "GOOD", label: "Good" },
  { value: "EXCELLENT", label: "Excellent" },
];

function InspectDialog({
  row,
  canEdit,
  onClose,
}: {
  row: ReportedAssignment;
  canEdit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [remarks, setRemarks] = useState("");

  const { data: detail, isLoading } = useQuery({
    queryKey: ["qc-rung", row.rungId],
    queryFn: () => getRungAssignment(row.rungId),
  });
  const { data: history = [] } = useQuery({
    queryKey: ["qc-history", row.rungId],
    queryFn: () => getQcHistory(row.rungId),
  });
  const { data: photos } = useQuery({
    queryKey: ["activity-photos", row.rungId],
    queryFn: () => getActivityPhotos(row.rungId),
  });

  const checkpoints = (detail?.assignment?.checkpoints ?? []).filter((c) => c.id != null);
  const photoCount = (photos?.before.length ?? 0) + (photos?.after.length ?? 0);

  const setVerdict = (id: number, patch: Partial<Verdict>) =>
    setVerdicts((v) => ({ ...v, [id]: { rating: null, note: "", ...v[id], ...patch } }));

  // The decision isn't a separate manual choice any more — it's derived
  // live from the ratings. Any single checkpoint marked Poor forces the
  // whole activity back for Rework; otherwise, once every checkpoint has
  // been rated, it's ready to Approve.
  const allRated = checkpoints.length > 0 && checkpoints.every((c) => !!verdicts[c.id as number]?.rating);
  const anyPoor = checkpoints.some((c) => verdicts[c.id as number]?.rating === "POOR");
  const decision: "APPROVED" | "REWORK" = anyPoor ? "REWORK" : "APPROVED";

  const upload = useMutation({
    mutationFn: (file: File) => uploadActivityPhoto(row.rungId, "after", file, "QC inspection"),
    onSuccess: () => {
      toast.success("Photo added.");
      qc.invalidateQueries({ queryKey: ["activity-photos", row.rungId] });
    },
    onError: (e: any) => toast.error(e?.message || "Photo upload failed."),
  });

  const decide = useMutation({
    mutationFn: () =>
      submitQcDecision(row.rungId, {
        decision,
        remarks: remarks.trim() || undefined,
        checks: checkpoints.map((c) => ({
          checkpointId: c.id as number,
          rating: (verdicts[c.id as number]?.rating ?? "GOOD") as QcRating,
          note: verdicts[c.id as number]?.note || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success(decision === "APPROVED" ? "Activity approved." : "Sent back for rework as a new attempt.");
      qc.invalidateQueries({ queryKey: ["qc-queue"] });
      qc.invalidateQueries({ queryKey: ["civilworkdpr-activity-reporting"] });
      qc.invalidateQueries({ queryKey: ["civilworkdpr-work-done-saved-flow"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || "Failed to save the QC decision."),
  });

  const hasCheckpoints = checkpoints.length > 0;
  const remarksMissing = decision === "REWORK" && remarks.trim().length < 3;
  const submitBlocked = (hasCheckpoints && !allRated) || remarksMissing;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sheet-frame max-w-3xl max-h-[90vh] overflow-y-auto" style={{ margin: 0 }}>
        <DialogHeader>
          <div className="pb-3" style={{ borderBottom: RULE }}>
            <p className={LBL}>Quality check · step {row.sequenceNo}</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">{row.activityName}</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {row.projectName ? `${row.projectName} > ` : ""}{row.scopePath}
            </p>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
          {[
            ["Chain", row.alias],
            ["Engineer", row.engineerNames || "—"],
            ["Start", fmtDate(row.startDate)],
            ["End", fmtDate(row.endDate)],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <p className={LBL}>{k}</p>
              <p className="text-[0.8125rem] font-medium text-foreground mt-1 break-words">{v}</p>
            </div>
          ))}
        </div>

        {history.length > 0 && (
          <div className="px-3 py-2.5 text-xs space-y-1.5" style={{ border: "1px dashed hsl(var(--foreground) / 0.5)" }}>
            <p className={LBL}>Previous quality checks</p>
            {history.slice(0, 3).map((h) => (
              <p key={h.id} className="text-foreground">
                <span className={`font-semibold ${h.decision === "APPROVED" ? "" : "text-destructive"}`}>{h.decision === "APPROVED" ? "Approved" : "Rework"}</span>
                <span className="text-muted-foreground tabular-nums">{" · "}{fmtDate(h.qcAt)}{h.qcBy ? ` · ${h.qcBy}` : ""}</span>
                {h.remarks ? `: ${h.remarks}` : ""}
              </p>
            ))}
          </div>
        )}

        <div>
          <p className={`${LBL} mb-2`}>Checklist sign-off · {checkpoints.length}</p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : checkpoints.length === 0 ? (
            <p className="text-xs text-muted-foreground">This activity has no checkpoints, so it can be approved directly.</p>
          ) : (
            <div className="divide-y divide-border/70" style={{ border: RULE }}>
              {checkpoints.map((c) => {
                const id = c.id as number;
                const v = verdicts[id];
                const isPoor = v?.rating === "POOR";
                return (
                  <div key={id} className="px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 min-w-0 text-sm font-medium text-foreground">{c.fieldName}</span>
                      {c.isChecked && <span className={`${LBL} shrink-0`}>Engineer ticked</span>}
                      <select
                        value={v?.rating ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setVerdict(id, { rating: (e.target.value || null) as QcRating | null })}
                        aria-label={`Rating for ${c.fieldName}`}
                        className={`shrink-0 text-xs font-semibold px-2.5 py-1.5 bg-card border focus:outline-none ${
                          isPoor
                            ? "border-destructive text-destructive"
                            : v?.rating
                              ? "border-foreground text-foreground"
                              : "border-dashed border-foreground/50 text-muted-foreground"
                        }`}
                      >
                        <option value="">Rate…</option>
                        {RATING_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    {isPoor && (
                      <input
                        className="w-full px-2.5 py-1.5 border border-destructive/60 focus:border-destructive bg-card text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                        placeholder="What's wrong? (optional note)"
                        value={v?.note ?? ""}
                        onChange={(e) => setVerdict(id, { note: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={!canEdit || upload.isPending}
            onClick={() => fileRef.current?.click()}
            className={`${KEY} px-3 py-2 border border-foreground text-foreground hover:bg-primary/10`}
          >
            {upload.isPending ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Attach photo
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">{photoCount} photo{photoCount === 1 ? "" : "s"} on this activity</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
        </div>

        <div>
          <p className={`${LBL} mb-1.5`} style={remarksMissing ? { color: "hsl(var(--destructive))" } : undefined}>
            Remarks{decision === "REWORK" ? " · required for rework" : ""}
          </p>
          <textarea
            rows={3}
            value={remarks}
            maxLength={1000}
            disabled={!canEdit}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Required when sending back for rework"
            className={`w-full px-3 py-2 border bg-card text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none ${
              remarksMissing ? "border-destructive" : "border-foreground/40 focus:border-foreground"
            }`}
          />
        </div>

        {/* Decision is derived live from the ratings above, not a separate
            manual choice — one Poor anywhere sends it for Rework. */}
        {hasCheckpoints && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs" style={{ border: `1px solid hsl(var(--${anyPoor ? "destructive" : "foreground"}))` }}>
            <SheetMark
              text={anyPoor ? "Rework" : allRated ? "Ready to approve" : "Rating in progress"}
              tone={anyPoor ? "stopped" : allRated ? "done" : "waiting"}
            />
            <span className="text-foreground">
              {anyPoor
                ? "One or more checkpoints are rated Poor, so this will be sent back for rework."
                : allRated
                  ? "Every checkpoint is rated Good or better."
                  : "Rate every checkpoint to continue."}
            </span>
          </div>
        )}

        {canEdit && (
          <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button type="button" onClick={onClose} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
              Close
            </button>
            <button
              type="button"
              disabled={submitBlocked || decide.isPending}
              title={remarksMissing ? "Add a remark explaining the rework" : hasCheckpoints && !allRated ? "Rate every checkpoint first" : undefined}
              onClick={() => decide.mutate()}
              className={`${KEY} h-9 px-5 border ${
                decision === "REWORK"
                  ? "bg-destructive text-destructive-foreground border-destructive"
                  : "bg-foreground text-card border-foreground"
              }`}
            >
              {decide.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : decision === "REWORK" ? (
                <RotateCcw size={13} />
              ) : (
                <CheckCircle2 size={13} />
              )}
              {decision === "REWORK" ? "Send for rework" : "Approve"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function QualityCheck() {
  const rights = usePageRights("civilworkdpr-quality-check");
  const [search, setSearch] = useState("");
  const [inspecting, setInspecting] = useState<ReportedAssignment | null>(null);

  const { data: allRows = [], isLoading } = useQuery({
    queryKey: ["qc-queue"],
    queryFn: getCompletedAssignments,
    enabled: rights.canView,
  });

  // A Completed activity that already has a passing QC decision has moved
  // on to the approval step — it's not this queue's job any more, even
  // though its own Status is still literally Completed until that
  // approval lands (a super_admin approves directly when no approval
  // levels are configured, otherwise the named approval chain does). See
  // getCompletedAssignments' own comment.
  const rows = useMemo(() => allRows.filter((r) => r.qcStatus !== "APPROVED"), [allRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.activityName, r.alias, r.scopePath, r.projectName, r.engineerNames].some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [rows, search]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Quality Check"]} />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Quality check"
        subtitle="Every activity brought to 100% complete, waiting for inspection."
      >
        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="px-4 py-3 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5">
              <span className={HEAD}>Waiting for inspection</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{rows.length}</span>
            </p>
            <div className="relative ml-auto w-full sm:w-72">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search activity, location, engineer…"
                className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2.5 text-left">Activity</th>
                  <th className="px-4 py-2.5 text-left">Location</th>
                  <th className="px-4 py-2.5 text-left">Engineer</th>
                  <th className="px-4 py-2.5 text-left">Start date</th>
                  <th className="px-4 py-2.5 text-left">Material</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {rows.length === 0 ? "Nothing is waiting for inspection right now." : "No activities match your search."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.rungId}>
                      <td className="px-4 py-3">
                        <p className="text-[0.8125rem] font-medium text-foreground flex items-center gap-2 flex-wrap">
                          <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-muted-foreground">{r.sequenceNo}</span>
                          {r.activityName}
                          <QcBadge qcStatus={r.qcStatus} />
                          <AttemptBadge attemptNo={r.attemptNo} />
                        </p>
                        <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{r.alias}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[260px]">
                        {r.projectName ? `${r.projectName} > ` : ""}{r.scopePath}
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground">{r.engineerNames || "—"}</td>
                      <td className="px-4 py-3 text-xs text-foreground whitespace-nowrap tabular-nums">{fmtDate(r.startDate)}</td>
                      <td className="px-4 py-3 text-xs">
                        {r.materials.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="text-foreground tabular-nums">{r.materials.length} item{r.materials.length === 1 ? "" : "s"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setInspecting(r)} className={`${KEY} px-3 py-2 bg-foreground text-card border border-foreground`}>
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </SheetShell>

      {inspecting && <InspectDialog row={inspecting} canEdit={rights.canEdit} onClose={() => setInspecting(null)} />}
    </>
  );
}

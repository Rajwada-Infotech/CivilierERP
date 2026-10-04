import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Search, UserRound, CalendarDays, Package, Camera, Loader2, CheckCircle2, RotateCcw, MapPin, AlertTriangle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {row.sequenceNo}. {row.activityName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <MapPin size={11} /> {row.projectName ? `${row.projectName} > ` : ""}{row.scopePath}
          </p>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {[
            ["Chain", row.alias],
            ["Engineer", row.engineerNames || "—"],
            ["Start", fmtDate(row.startDate)],
            ["End", fmtDate(row.endDate)],
          ].map(([k, v]) => (
            <div key={k} className="px-3 py-2 rounded-xl bg-muted/30 border border-border/50">
              <p className="text-[0.5625rem] uppercase tracking-widest text-muted-foreground mb-0.5">{k}</p>
              <p className="font-semibold text-foreground truncate">{v}</p>
            </div>
          ))}
        </div>

        {history.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs space-y-1">
            <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-amber-600 dark:text-amber-400">Previous QC</p>
            {history.slice(0, 3).map((h) => (
              <p key={h.id} className="text-foreground">
                <span className="font-semibold">{h.decision === "APPROVED" ? "Approved" : "Rework"}</span>
                {" · "}{fmtDate(h.qcAt)}{h.qcBy ? ` · ${h.qcBy}` : ""}
                {h.remarks ? ` — ${h.remarks}` : ""}
              </p>
            ))}
          </div>
        )}

        <div>
          <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
            Checklist sign-off ({checkpoints.length})
          </p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : checkpoints.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">This activity has no checkpoints, so it can be approved directly.</p>
          ) : (
            <div className="rounded-xl border border-border divide-y divide-border/60">
              {checkpoints.map((c) => {
                const id = c.id as number;
                const v = verdicts[id];
                const isPoor = v?.rating === "POOR";
                return (
                  <div key={id} className="px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm font-medium text-foreground">{c.fieldName}</span>
                      {c.isChecked && <span className="text-[0.625rem] text-emerald-600 dark:text-emerald-400">Engineer ticked</span>}
                      <select
                        value={v?.rating ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setVerdict(id, { rating: (e.target.value || null) as QcRating | null })}
                        className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border focus:outline-none transition-colors ${
                          isPoor
                            ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400"
                            : v?.rating
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-border text-muted-foreground"
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
                        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30"
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

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canEdit || upload.isPending}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted/60 disabled:opacity-50 transition-colors"
          >
            {upload.isPending ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} Attach photo
          </button>
          <span className="text-xs text-muted-foreground">{photoCount} photo{photoCount === 1 ? "" : "s"} on this activity</span>
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
          <p className="text-[0.625rem] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">Remarks</p>
          <textarea
            rows={3}
            value={remarks}
            maxLength={1000}
            disabled={!canEdit}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Required when sending back for rework"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>

        {/* Decision is derived live from the ratings above, not a separate
            manual choice — one Poor anywhere sends it for Rework. */}
        {hasCheckpoints && (
          <div
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium ${
              anyPoor
                ? "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {anyPoor ? <AlertTriangle size={14} className="shrink-0" /> : <CheckCircle2 size={14} className="shrink-0" />}
            {anyPoor
              ? "One or more checkpoints rated Poor — this will be sent back for Rework."
              : allRated
                ? "Every checkpoint rated Good or better — ready to Approve."
                : "Rate every checkpoint to continue."}
          </div>
        )}

        {canEdit && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={submitBlocked || decide.isPending}
              title={remarksMissing ? "Add a remark explaining the rework" : hasCheckpoints && !allRated ? "Rate every checkpoint first" : undefined}
              onClick={() => decide.mutate()}
              className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-40 shadow-sm ${
                decision === "REWORK"
                  ? "btn-module shadow-fuchsia-500/20"
                  : "btn-module shadow-emerald-500/20"
              }`}
            >
              {decide.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : decision === "REWORK" ? (
                <RotateCcw size={14} />
              ) : (
                <CheckCircle2 size={14} />
              )}
              {decision === "REWORK" ? "Send for Rework" : "Approve"}
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
      <CivilWorkDprShell
        title="Quality Check"
        subtitle="Every activity dragged to 100% complete, ready for inspection"
        icon={ShieldCheck}
      >
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border/60 flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-heading font-semibold text-foreground">Completed Activities</h3>
            <span className="text-[0.6875rem] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{rows.length}</span>
            <div className="relative ml-auto w-full sm:w-72">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search activity, location, engineer…"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[0.625rem] uppercase tracking-widest font-heading text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Activity</th>
                  <th className="px-4 py-2 text-left">Location</th>
                  <th className="px-4 py-2 text-left">Engineer</th>
                  <th className="px-4 py-2 text-left">Start Date</th>
                  <th className="px-4 py-2 text-left">Material</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {rows.length === 0 ? "No activities are Completed right now." : "No activities match your search."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.rungId} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground flex items-center gap-1.5">
                          {r.sequenceNo}. {r.activityName}
                          <QcBadge qcStatus={r.qcStatus} />
                          <AttemptBadge attemptNo={r.attemptNo} />
                        </p>
                        <p className="text-[0.6875rem] text-muted-foreground">{r.alias}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[260px]">
                        {r.projectName ? `${r.projectName} > ` : ""}{r.scopePath}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="inline-flex items-center gap-1.5"><UserRound size={11} className="text-muted-foreground" />{r.engineerNames || "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5"><CalendarDays size={11} className="text-muted-foreground" />{fmtDate(r.startDate)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.materials.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5"><Package size={11} className="text-muted-foreground" />{r.materials.length} item{r.materials.length === 1 ? "" : "s"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setInspecting(r)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-module transition"
                        >
                          <ShieldCheck size={12} /> Inspect
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CivilWorkDprShell>

      {inspecting && <InspectDialog row={inspecting} canEdit={rights.canEdit} onClose={() => setInspecting(null)} />}
    </>
  );
}

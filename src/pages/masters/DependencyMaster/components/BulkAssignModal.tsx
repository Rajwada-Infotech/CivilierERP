import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getEngineers, type ApprovalLevel } from "@/api/dependencyActivityAssignmentApi";
import {
  applyBulkAssign,
  previewBulkAssign,
  type BulkAssignRequest,
  type BulkAssignSummary,
} from "@/api/dependencyBulkAssignApi";
import type { DependencyMasterListRow } from "@/api/dependencyMasterApi";
import { ApprovalLevelsEditor, UserMultiSelect } from "@/pages/civilworkdpr/RungAssignmentModal";
import { useDebouncedValue } from "@/components/docfinder/useDocFinder";

const selectCls =
  "w-full px-3 py-2.5 text-sm bg-card border border-foreground/40 focus:border-foreground text-foreground focus:outline-none";
const labelCls = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5 mb-1.5";

function CountLine({ label, c }: { label: string; c: BulkAssignSummary["engineers"] }) {
  if (!c.requested) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground">{label}</span>
      <span className="tabular-nums text-muted-foreground">
        <strong className="text-foreground">{c.willFill + c.willReplace}</strong> will be set
        {c.willReplace > 0 && <> · {c.willReplace} replaced</>}
        {c.alreadySet > 0 && <> · {c.alreadySet} already set, left as they are</>}
      </span>
    </div>
  );
}

/**
 * Sets Engineers, Quality Check and Approval Setup on every activity of a project
 * (or one block of it) in one go. By default only fills what is empty; with
 * "Overwrite existing" the chosen fields replace what the activities already have.
 */
export function BulkAssignModal({
  open, onClose, rows,
}: { open: boolean; onClose: () => void; rows: DependencyMasterListRow[] }) {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [towerId, setTowerId] = useState("");
  const [engineerIds, setEngineerIds] = useState<number[]>([]);
  const [qcUserIds, setQcUserIds] = useState<number[]>([]);
  const [levels, setLevels] = useState<ApprovalLevel[]>([]);
  const [overwrite, setOverwrite] = useState(false);

  // Start clean every time it opens.
  useEffect(() => {
    if (!open) return;
    setProjectId("");
    setTowerId("");
    setEngineerIds([]);
    setQcUserIds([]);
    setLevels([]);
    setOverwrite(false);
  }, [open]);

  const { data: users = [] } = useQuery({
    queryKey: ["dependency-activity-assignment-engineers"],
    queryFn: getEngineers,
    enabled: open,
  });

  // Projects / blocks that actually have activity chains (already limited to the user's project access).
  const projects = useMemo(() => {
    const m = new Map<number, string>();
    rows.forEach((r) => m.set(r.projectId, r.projectName || `Project ${r.projectId}`));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  const blocks = useMemo(() => {
    const m = new Map<number, string>();
    rows
      .filter((r) => String(r.projectId) === projectId)
      .forEach((r) => m.set(r.towerId, r.towerName || `Block ${r.towerId}`));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, projectId]);

  const request: BulkAssignRequest | null = projectId
    ? {
        projectId: Number(projectId),
        towerId: towerId ? Number(towerId) : null,
        engineerIds,
        qcUserIds,
        approvalLevels: levels.filter((l) => l.userIds.length > 0),
        overwrite,
      }
    : null;
  const hasChoice = !!request && (engineerIds.length > 0 || qcUserIds.length > 0 || request.approvalLevels.length > 0);

  // Live preview, debounced so typing/ticking doesn't fire a request per click.
  const signature = useDebouncedValue(JSON.stringify(request), 350);
  const settled = signature === JSON.stringify(request);
  const preview = useQuery({
    queryKey: ["bulk-assign-preview", signature],
    queryFn: () => previewBulkAssign(JSON.parse(signature) as BulkAssignRequest),
    // Only once the debounce has caught up: until then `signature` is a stale value (or null).
    enabled: open && hasChoice && settled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const summary = hasChoice ? preview.data?.summary : undefined;

  const apply = useMutation({
    mutationFn: () => applyBulkAssign(request as BulkAssignRequest),
    onSuccess: (res) => {
      const n = res.changed?.activities ?? 0;
      toast.success(n ? `Assigned ${n} ${n === 1 ? "activity" : "activities"}.` : "Nothing needed changing.");
      qc.invalidateQueries({ queryKey: ["dependency-masters"] });
      qc.invalidateQueries({ queryKey: ["dependency-activity-assignment"] });
      qc.invalidateQueries({ queryKey: ["bulk-assign-preview"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canApply = hasChoice && settled && !!summary && summary.willChange > 0 && !preview.isFetching && !apply.isPending;
  const scopeLabel = towerId
    ? `${projects.find((p) => String(p.id) === projectId)?.name ?? "project"} · ${blocks.find((b) => String(b.id) === towerId)?.name ?? "block"}`
    : projects.find((p) => String(p.id) === projectId)?.name ?? "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent className="sheet-frame max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl thin-scroll" style={{ margin: 0 }}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
          <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Work allocation</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">
            Bulk assign
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-xs">
            Set engineers, quality check and approvers on every activity of a project or block. By default activities that
            already have a value for a field keep it; turn on "Overwrite existing" to replace them.
          </DialogDescription>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Project</label>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setTowerId("");
                }}
                className={selectCls}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Block</label>
              <select value={towerId} onChange={(e) => setTowerId(e.target.value)} disabled={!projectId} className={`${selectCls} disabled:opacity-50`}>
                <option value="">All blocks</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}><UserRound size={11} /> Engineers</label>
              <UserMultiSelect users={users} selected={engineerIds} onChange={setEngineerIds} placeholder="Select engineers…" />
            </div>
            <div>
              <label className={labelCls}><ShieldCheck size={11} /> Quality Check</label>
              <UserMultiSelect users={users} selected={qcUserIds} onChange={setQcUserIds} placeholder="Select QC…" />
            </div>
          </div>

          <ApprovalLevelsEditor levels={levels} onChange={setLevels} users={users} />

          <label className="flex items-start gap-2.5 border border-foreground/40 p-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-foreground"
            />
            <span>
              <span className="font-semibold text-foreground">Overwrite existing</span>
              <span className="block text-xs text-muted-foreground">
                Replace the engineers, quality check and approvers already set on these activities with the ones chosen above.
                Fields you leave empty are not touched.
              </span>
            </span>
          </label>

          {/* Preview */}
          <div className="p-3.5" style={{ border: "1px solid hsl(var(--foreground))" }}>
            <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">
              What will happen{scopeLabel ? ` — ${scopeLabel}` : ""}
            </p>
            {!projectId ? (
              <p className="text-sm text-muted-foreground">Choose a project to see how many activities are affected.</p>
            ) : !hasChoice ? (
              <p className="text-sm text-muted-foreground">Choose engineers, quality check or approvers to apply.</p>
            ) : preview.isError ? (
              <p className="text-sm text-destructive">{(preview.error as Error).message}</p>
            ) : !summary ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Counting…</p>
            ) : (
              <div className="space-y-1.5">
                <p className={`text-sm ${preview.isFetching || !settled ? "opacity-60" : ""}`}>
                  <strong>{summary.willChange}</strong> of {summary.eligible} activities will be updated
                  {summary.skippedCancelledOrApproved > 0 && (
                    <span className="text-muted-foreground"> ({summary.skippedCancelledOrApproved} cancelled or already approved are skipped)</span>
                  )}
                </p>
                <CountLine label="Engineers" c={summary.engineers} />
                <CountLine label="Quality check" c={summary.qc} />
                <CountLine label="Approval setup" c={summary.approval} />
                {summary.willChange === 0 && (
                  <p className="text-xs text-muted-foreground">Every activity here already has these set, so there is nothing to change. Turn on "Overwrite existing" to replace them.</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={apply.isPending}
            className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-4 border border-foreground text-foreground hover:bg-primary/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={!canApply}
            className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-5 bg-foreground text-card border border-foreground"
          >
            {apply.isPending && <Loader2 size={13} className="animate-spin" />}
            {summary && summary.willChange > 0 ? `Assign ${summary.willChange} ${summary.willChange === 1 ? "activity" : "activities"}` : "Assign"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

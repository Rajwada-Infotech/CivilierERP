import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Copy } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { getDependencyMaster } from "@/api/dependencyMasterApi";
import { useDependencyMasterForm } from "./hooks/useDependencyMasterForm";
import { ScopeSelector } from "./components/ScopeSelector";
import { AliasInput } from "./components/AliasInput";
import { ScopeToggle } from "./components/ScopeToggle";
import { ActivityLadder } from "./components/ActivityLadder";
import { ActivityPickerModal } from "./components/ActivityPickerModal";
import { CopyChainModal } from "./components/CopyChainModal";
import { DependencyReviewPanel } from "./components/DependencyReviewPanel";

const STEPS = ["Task Scope", "Alias", "Work Type", "Activity Chain"] as const;

// Full-page create/edit — two columns rather than one narrow stack: the
// left column carries the 4 fillable steps, the right column stays sticky
// with a step tracker on top and the live Review panel underneath, so the
// wide page is doing something with its width instead of centering a
// dialog-width column of fields.
export default function DependencyMasterFormPage() {
  const { id } = useParams<{ id: string }>();
  const editingId = id ? Number(id) : null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  usePageRights("dependency-master");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);

  const { data: editing, isLoading: loadingEditing } = useQuery({
    queryKey: ["dependency-master-detail", editingId],
    queryFn: () => getDependencyMaster(editingId as number),
    enabled: !!editingId,
  });

  const goBack = () => {
    qc.invalidateQueries({ queryKey: ["dependency-masters"] });
    navigate("/masters/dependency");
  };

  const form = useDependencyMasterForm(editing ?? null, goBack);

  if (editingId && loadingEditing) {
    return (
      <>
        <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Dependency Master", "Edit"]} />
        <SheetShell eyebrow="CivilierERP · Civil Work DPR" title="Dependency master" subtitle="Loading the record…">
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        </SheetShell>
      </>
    );
  }

  const stepDone = [
    form.cascade.isComplete,
    form.alias.trim().length > 0,
    form.toggleActive,
    form.ladder.rungs.length > 0,
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Dependency Master", editingId ? "Edit" : "New"]} />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title={editingId ? "Edit dependency" : "New dependency"}
        subtitle="One room's activity chain: where it is, what it is called, and the strict order its activities follow."
        action={
          <button onClick={() => navigate("/masters/dependency")} className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 border border-foreground text-foreground hover:bg-primary/10">
            <ArrowLeft size={13} /> Back to list
          </button>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
          {/* ── Main column — the 4 fillable steps ─────────────────────── */}
          <div className="bg-card px-4 py-5 space-y-6 min-w-0" style={{ border: "1px solid hsl(var(--foreground))" }}>
            <div>
              <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground mb-2">
                1 · Task scope
              </p>
              <ScopeSelector cascade={form.cascade} />
            </div>

            <div>
              <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground mb-2">
                2 · Alias
              </p>
              <AliasInput
                active={form.aliasActive}
                value={form.alias}
                onChange={form.setAlias}
                resolvedPath={form.cascade.resolvedPath}
              />
            </div>

            {form.toggleActive && (
              <div>
                <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground mb-2">
                  3 · Work type
                </p>
                <ScopeToggle active={form.toggleActive} value={form.workType} onChange={form.setWorkType} />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
                  4 · Activity chain
                </p>
                {!editingId && form.ladderActive && (
                  <button
                    type="button"
                    onClick={() => setCopyModalOpen(true)}
                    className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1.5 border border-foreground/40 text-foreground hover:border-foreground hover:bg-primary/10"
                  >
                    <Copy size={11} /> Copy from existing chain
                  </button>
                )}
              </div>
              <ActivityLadder
                active={form.ladderActive}
                rungs={form.ladder.rungs}
                onAdd={() => setPickerOpen(true)}
                onRemove={form.ladder.remove}
                onMove={form.ladder.move}
              />
            </div>
          </div>

          {/* ── Side column — step tracker + live review, sticky ───────── */}
          <div className="lg:sticky lg:top-4 space-y-4">
            <div className="bg-card p-4" style={{ border: "1px solid hsl(var(--foreground))" }}>
              <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground mb-3">
                Progress · {stepDone.filter(Boolean).length} of {STEPS.length}
              </p>
              <ol>
                {STEPS.map((label, i) => (
                  <li key={label} className="flex items-center justify-between gap-3 py-2 border-t border-border/70 first:border-t-0 first:pt-0 last:pb-0">
                    <span className={`text-xs ${stepDone[i] ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      <span className="font-heading tabular-nums text-muted-foreground mr-2">{i + 1}</span>
                      {label}
                    </span>
                    <SheetMark text={stepDone[i] ? "Done" : "To do"} tone={stepDone[i] ? "done" : "waiting"} />
                  </li>
                ))}
              </ol>
            </div>

            {form.canSubmit ? (
              <DependencyReviewPanel
                resolvedPath={form.cascade.resolvedPath}
                alias={form.alias}
                workType={form.workType}
                rungs={form.ladder.rungs}
              />
            ) : (
              <div className="p-4 text-xs text-muted-foreground text-center" style={{ border: "1px dashed hsl(var(--foreground) / 0.4)" }}>
                Review appears here once every step is complete.
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => navigate("/masters/dependency")} disabled={form.isSaving} className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-4 border border-foreground text-foreground hover:bg-primary/10">
                Cancel
              </button>
              <button
                type="button"
                onClick={form.submit}
                disabled={!form.canSubmit || form.isSaving}
                className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-6 bg-foreground text-card border border-foreground"
              >
                {form.isSaving ? "Saving…" : editingId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </SheetShell>

      <ActivityPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(picks) => {
          form.ladder.addMany(picks, form.workType);
          setPickerOpen(false);
        }}
        excludeIds={form.ladder.rungs.map((r) => r.activityId)}
      />

      {!editingId && (
        <CopyChainModal
          open={copyModalOpen}
          onClose={() => setCopyModalOpen(false)}
          onCopy={(activities) => form.ladder.reset(activities)}
        />
      )}
    </>
  );
}

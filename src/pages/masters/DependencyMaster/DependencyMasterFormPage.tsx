import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, Loader2, CheckCircle2, Circle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { Button } from "@/components/ui/button";
import { getDependencyMaster } from "@/api/dependencyMasterApi";
import { useDependencyMasterForm } from "./hooks/useDependencyMasterForm";
import { ScopeSelector } from "./components/ScopeSelector";
import { AliasInput } from "./components/AliasInput";
import { ScopeToggle } from "./components/ScopeToggle";
import { ActivityLadder } from "./components/ActivityLadder";
import { ActivityPickerModal } from "./components/ActivityPickerModal";
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
        <Breadcrumbs items={["Dashboard", "Engineering", "Dependency Master", "Edit"]} />
        <EngineeringShell title="Dependency Master" subtitle="Loading record…" icon={GitBranch}>
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        </EngineeringShell>
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
      <Breadcrumbs items={["Dashboard", "Engineering", "Dependency Master", editingId ? "Edit" : "New"]} />
      <EngineeringShell
        title={editingId ? "Edit Dependency" : "New Dependency"}
        subtitle="Room-level activity chain — task scope, alias, and a strictly linear dependency sequence"
        icon={GitBranch}
        action={
          <button
            onClick={() => navigate("/masters/dependency")}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={13} /> Back to list
          </button>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
          {/* ── Main column — the 4 fillable steps ─────────────────────── */}
          <div className="space-y-5 min-w-0">
            <div>
              <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                1. Task Scope
              </p>
              <ScopeSelector cascade={form.cascade} />
            </div>

            <div>
              <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                2. Alias
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
                <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                  3. Work Type
                </p>
                <ScopeToggle active={form.toggleActive} value={form.workType} onChange={form.setWorkType} />
              </div>
            )}

            <div>
              <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                4. Activity Chain
              </p>
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
            <div className="rounded-xl border border-border p-4">
              <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-2.5">
                Progress
              </p>
              <ol className="space-y-2">
                {STEPS.map((label, i) => (
                  <li key={label} className="flex items-center gap-2 text-xs">
                    {stepDone[i] ? (
                      <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    ) : (
                      <Circle size={14} className="text-muted-foreground/40 shrink-0" />
                    )}
                    <span className={stepDone[i] ? "text-foreground" : "text-muted-foreground"}>{label}</span>
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
              <div className="rounded-xl border border-dashed border-border/60 p-4 text-xs text-muted-foreground italic text-center">
                Review appears here once every step is complete.
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => navigate("/masters/dependency")} disabled={form.isSaving}>
                Cancel
              </Button>
              <Button
                onClick={form.submit}
                disabled={!form.canSubmit || form.isSaving}
                className="gradient-engineering shadow-sm gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto hover:opacity-90"
              >
                {form.isSaving ? "Saving…" : editingId ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </EngineeringShell>

      <ActivityPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(activityId, activityName) => {
          form.ladder.add(activityId, activityName, form.workType);
          setPickerOpen(false);
        }}
        excludeIds={form.ladder.rungs.map((r) => r.activityId)}
      />
    </>
  );
}

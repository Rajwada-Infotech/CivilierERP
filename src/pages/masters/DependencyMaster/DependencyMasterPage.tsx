import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getDependencyMasters,
  deleteDependencyMaster,
  type DependencyMasterListRow,
  type LadderActivity,
  type WorkType,
} from "@/api/dependencyMasterApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, RefreshCw } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { DependencyMasterList } from "./components/DependencyMasterList";
import { AutoNameResults } from "@/components/civilworkdpr/AutoNameFinder";
import { RungAssignmentModal } from "@/pages/civilworkdpr/RungAssignmentModal";
import { dependencyAutoName, matchesAutoNameSearch } from "@/lib/dependencyAutoName";

type TypeFilter = "ALL" | WorkType;

// Page shell: list of existing Dependency Master records, each row
// expandable inline for its activity chain. "+" and row-edit both navigate
// to the full-page workflow (DependencyMasterFormPage) rather than a modal —
// the ladder + review panel need more room than a dialog card gives them.
export default function DependencyMasterPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const rights = usePageRights("dependency-master");

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [deleteTarget, setDeleteTarget] = useState<DependencyMasterListRow | null>(null);
  // An activity picked from the Auto Name matches — opens its allocation form (where Auto Name is shown).
  const [activeAssignment, setActiveAssignment] = useState<{ rung: LadderActivity; chain: DependencyMasterListRow } | null>(null);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["dependency-masters"],
    queryFn: getDependencyMasters,
  });

  const internalCount = rows.filter((r) => r.workType === "INTERNAL").length;
  const externalCount = rows.filter((r) => r.workType === "EXTERNAL").length;

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((r) => {
      if (typeFilter !== "ALL" && r.workType !== typeFilter) return false;
      if (!q) return true;
      // A chain matches on its own alias / location, or when one of its activities' Auto Names
      // (flat, room and activity) contains every word typed.
      const chainText = [r.alias, r.scopePath, r.projectName];
      return (
        matchesAutoNameSearch(q, chainText) ||
        (r.activities ?? []).some((a) =>
          matchesAutoNameSearch(q, [
            dependencyAutoName({ flatName: r.flatName, alias: r.alias, roomName: r.roomName, storey: r.storey, activityName: a.activityName }),
            ...chainText,
          ]),
        )
      );
    });
  }, [rows, search, typeFilter]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDependencyMaster(id),
    onSuccess: (res) => {
      toast.success(res.message || "Dependency deleted");
      qc.invalidateQueries({ queryKey: ["dependency-masters"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Dependency Master"]} />

      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Dependency master"
        subtitle="Activity chains set room by room: where the work is, what it is called, and the strict order its activities follow."
        action={
          rights.canCreate ? (
            <button onClick={() => navigate("/masters/dependency/new")} className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 px-4 py-2 bg-foreground text-card border border-foreground">
              <Plus className="h-3.5 w-3.5" />
              New dependency
            </button>
          ) : undefined
        }
      >
        {/* Figures */}
        <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Chains", value: rows.length, note: "in all" },
              { label: "Internal", value: internalCount, note: "work inside the unit" },
              { label: "External", value: externalCount, note: "work outside the unit" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
          <div className="seg">
            {([
              ["ALL", "All"],
              ["INTERNAL", "Internal"],
              ["EXTERNAL", "External"],
            ] as [TypeFilter, string][]).map(([val, label]) => (
              <button key={val} onClick={() => setTypeFilter(val)} aria-pressed={typeFilter === val} className={typeFilter === val ? "on" : undefined}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="Search auto name, alias or path…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
            <button
              onClick={() => refetch()}
              className="h-9 w-9 shrink-0 inline-flex items-center justify-center border border-foreground/40 hover:border-foreground text-foreground transition-colors"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="p-2 sm:p-4 space-y-3">

        {/* Auto Name matches — pick one to open that activity */}
        <AutoNameResults chains={rows} query={search} onPick={(rung, chain) => setActiveAssignment({ rung, chain })} />

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Loading dependencies…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <span className="text-sm">
              {search || typeFilter !== "ALL" ? "No dependencies match your filters" : "No dependencies yet"}
            </span>
            {rights.canCreate && !search && typeFilter === "ALL" && (
              <button
                onClick={() => navigate("/masters/dependency/new")}
                className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-1 px-4 py-2 bg-foreground text-card border border-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Create your first Dependency
              </button>
            )}
          </div>
        ) : (
          <DependencyMasterList
            rows={filtered}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            onEdit={(row) => navigate(`/masters/dependency/${row.id}/edit`)}
            onDelete={(row) => setDeleteTarget(row)}
            forceExpand={!!search.trim()}
          />
        )}
        </div>
        </div>
      </SheetShell>


      {activeAssignment && (
        <RungAssignmentModal rung={activeAssignment.rung} chain={activeAssignment.chain} onClose={() => setActiveAssignment(null)} />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="sheet-frame" style={{ margin: 0 }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dependency?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.alias}</strong> and its entire activity chain will be permanently
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getDependencyMasters,
  deleteDependencyMaster,
  type DependencyMasterListRow,
  type WorkType,
} from "@/api/dependencyMasterApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { Input } from "@/components/ui/input";
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
import { Plus, Search, RefreshCw, GitBranch, Boxes, Home, Waypoints } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { DependencyMasterList } from "./components/DependencyMasterList";

type TypeFilter = "ALL" | WorkType;

function StatTile({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 bg-card">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${accent}18` }}
      >
        <Icon size={16} style={{ color: accent }} />
      </div>
      <div>
        <p className="text-lg font-heading font-bold text-foreground leading-none">{value}</p>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-1">{label}</p>
      </div>
    </div>
  );
}

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

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["dependency-masters"],
    queryFn: getDependencyMasters,
  });

  const internalCount = rows.filter((r) => r.workType === "INTERNAL").length;
  const externalCount = rows.filter((r) => r.workType === "EXTERNAL").length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "ALL" && r.workType !== typeFilter) return false;
      if (!q) return true;
      return r.alias.toLowerCase().includes(q) || r.scopePath.toLowerCase().includes(q);
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
      <Breadcrumbs items={["Dashboard", "Engineering", "Dependency Master"]} />

      <EngineeringShell
        title="Dependency Master"
        subtitle="Room-level activity chains — task scope, alias, and a strictly linear dependency sequence"
        icon={GitBranch}
        action={
          rights.canCreate && (
            <button
              onClick={() => navigate("/masters/dependency/new")}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg gradient-engineering transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              New Dependency
            </button>
          )
        }
      >
        {/* Stat strip */}
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Total Entries" value={rows.length} icon={Boxes} accent="#f97316" />
          <StatTile label="Internal" value={internalCount} icon={Home} accent="#f97316" />
          <StatTile label="External" value={externalCount} icon={Waypoints} accent="#0ea5e9" />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {([
              ["ALL", "All"],
              ["INTERNAL", "Internal"],
              ["EXTERNAL", "External"],
            ] as [TypeFilter, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setTypeFilter(val)}
                className={`px-3 py-1.5 text-xs font-heading font-semibold tracking-wide transition-colors ${
                  typeFilter === val ? "gradient-engineering text-white" : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search alias or path…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 w-64"
              />
            </div>
            <button
              onClick={() => refetch()}
              className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Loading dependencies…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground rounded-xl border border-dashed border-border">
            <GitBranch className="h-9 w-9 opacity-25" />
            <span className="text-sm">
              {search || typeFilter !== "ALL" ? "No dependencies match your filters" : "No dependencies yet"}
            </span>
            {rights.canCreate && !search && typeFilter === "ALL" && (
              <button
                onClick={() => navigate("/masters/dependency/new")}
                className="inline-flex items-center gap-1.5 mt-1 font-heading font-semibold text-white shadow-sm text-xs px-4 py-1.5 rounded-lg gradient-engineering transition-all"
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
          />
        )}
      </EngineeringShell>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
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

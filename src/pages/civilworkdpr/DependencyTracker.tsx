import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell, CivilWorkDprGlassCard } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  GitBranch,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
  Save,
  ThumbsUp,
  ThumbsDown,
  HardHat,
  UserPlus,
  Building2,
  ClipboardList,
  Plus,
  Users2,
  TrendingUp,
  ClockAlert,
  History,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getContractorAllocations,
  getContractorOptions,
  addContractorAllocation,
} from "@/api/contractorAllocationApi";
import { getActivities, type DbActivity } from "@/api/activityMasterApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  getWorkProgress,
  addWorkProgress,
  updateWorkProgress,
  reviewWorkProgress,
  deleteWorkProgress,
  type WorkProgress,
  type WorkProgressPayload,
} from "@/api/workProgressApi";
import { getUsers } from "@/api/userApi";
// The Engineering module's Dependency Master (/masters/dependency) is the
// actual source of "which activities depend on which, in what order, for
// which scope" — this page previously only tracked worker/progress logging
// with no link to those defined chains at all. Pulled in read-only here
// (same list-row + expand-to-chain components the admin page itself uses,
// not a re-implementation) so a chain is visible right where its progress
// is being logged, instead of two disconnected pages.
import { getDependencyMasters, type DependencyMasterListRow } from "@/api/dependencyMasterApi";
import { useDependencyMasterList } from "@/pages/masters/DependencyMaster/hooks/useDependencyMasterList";
import { DependencyMasterListItem } from "@/pages/masters/DependencyMaster/components/DependencyMasterListItem";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const STATUS_OPTIONS = ["Not Started", "In Progress", "Completed", "On Hold"];

const statusColors: Record<string, string> = {
  Completed: "bg-emerald-500/10 text-emerald-600",
  "In Progress": "bg-blue-500/10 text-blue-600",
  "Not Started": "bg-muted text-muted-foreground",
  "On Hold": "bg-amber-500/10 text-amber-600",
};

const reviewColors: Record<string, string> = {
  Approved: "bg-emerald-500/10 text-emerald-600",
  Rejected: "bg-red-500/10 text-red-600",
  Pending: "bg-amber-500/10 text-amber-600",
};

const inputCls = (err?: boolean) =>
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${
    err ? "border-destructive" : "border-border"
  }`;

const selectTriggerCls =
  "w-full h-auto text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground hover:border-cyan-500/40 focus:ring-2 focus:ring-cyan-500/30 transition";

const Field = ({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: boolean;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wide">
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error && <span className="text-xs text-destructive">{label} is required</span>}
  </div>
);

const EMPTY_FORM: WorkProgressPayload = {
  allocationId: 0,
  workDescription: "",
  quantityPlanned: null,
  quantityCompleted: null,
  unit: "",
  plannedStartDate: "",
  plannedEndDate: "",
  actualStartDate: "",
  actualEndDate: "",
  currentStatus: "Not Started",
  remarks: "",
};

const DependencyTracker: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const rights = usePageRights("civilworkdpr-dependency");

  // Defined dependency chains (Engineering's Dependency Master) — read-only
  // here, filtered to the active project tab below.
  const { data: dependencyMasters = [], isLoading: loadingDependencyMasters } = useQuery({
    queryKey: ["dependencyMastersForCivilDpr"],
    queryFn: getDependencyMasters,
    staleTime: 60 * 1000,
  });
  const depList = useDependencyMasterList();

  // A project's "work in progress" is the set of Contractor Register
  // allocations against it — each allocation is one (Activity, Contractor)
  // pair. An Activity can have several allocations (several workers each
  // logging their own progress), so the list below is grouped by Activity.
  const { data: allocations = [], isLoading: loadingAllocations } = useQuery({
    queryKey: ["contractorAllocations"],
    queryFn: getContractorAllocations,
  });

  // Full project list (not just ones with existing allocations) — so you
  // can switch to any project and assign its first worker from this page.
  const { data: projects = [] } = useQuery({
    queryKey: ["projectOptionsCivilDpr"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: rawActivities = [] } = useQuery({
    queryKey: ["activities"],
    queryFn: getActivities,
    staleTime: 5 * 60 * 1000,
  });
  const activityOptions = rawActivities
    .filter((a: DbActivity) => a.activity_type === 1 && a.is_active !== false)
    .map((a: DbActivity) => ({ id: a.id, name: a.activity_name }));

  const { data: contractorOptions = [] } = useQuery({
    queryKey: ["contractorOptions"],
    queryFn: getContractorOptions,
    staleTime: 5 * 60 * 1000,
  });

  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  useEffect(() => {
    if (activeProjectId === null && projects.length > 0) {
      setActiveProjectId((projects[0] as any).id);
    }
  }, [projects, activeProjectId]);

  const activeProjectLabel = (projects as any[]).find((p) => p.id === activeProjectId)?.label as string | undefined;

  const dependencyChainsForProject: DependencyMasterListRow[] = dependencyMasters.filter(
    (d) => d.projectId === activeProjectId && d.isActive,
  );

  // Worker count per project — shown on each project chip so you can see
  // which projects actually have activity going on before switching tabs.
  const workerCountByProject = new Map<number, number>();
  for (const a of allocations) {
    if (a.projectId == null) continue;
    workerCountByProject.set(a.projectId, (workerCountByProject.get(a.projectId) || 0) + 1);
  }

  const allocationsForProject = allocations.filter(
    (a) => a.projectId === activeProjectId,
  );

  // Group allocations by Activity — an Activity can have multiple workers.
  const allocationsByActivity = new Map<number, typeof allocationsForProject>();
  for (const a of allocationsForProject) {
    const list = allocationsByActivity.get(a.activityId) || [];
    list.push(a);
    allocationsByActivity.set(a.activityId, list);
  }

  const { data: progressEntries = [], isLoading: loadingProgress } = useQuery({
    queryKey: ["workProgress", activeProjectId],
    queryFn: () => getWorkProgress({ projectId: activeProjectId ?? undefined }),
    enabled: activeProjectId !== null,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["usersForWorkProgressReview"],
    queryFn: getUsers,
    staleTime: 5 * 60 * 1000,
  });

  // Latest progress entry per allocation — drives the "Activities in
  // Progress" summary row (current %, status) for this project tab.
  const latestByAllocation = new Map<number, WorkProgress>();
  for (const entry of progressEntries) {
    const existing = latestByAllocation.get(entry.allocationId);
    if (!existing || new Date(entry.createdAt || 0) > new Date(existing.createdAt || 0)) {
      latestByAllocation.set(entry.allocationId, entry);
    }
  }

  // Summary strip for this project tab — same "give the page some visual
  // weight instead of a bare list" treatment as the other module pages.
  const activityCount = allocationsByActivity.size;
  const workerCount = allocationsForProject.length;
  const avgProgress = latestByAllocation.size
    ? Math.round(
        Array.from(latestByAllocation.values()).reduce((s, e) => s + (e.percentageProgress || 0), 0) /
          latestByAllocation.size,
      )
    : 0;
  const pendingReviewCount = progressEntries.filter((e) => e.reviewStatus === "Pending").length;

  const [form, setFormState] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── Single "Add" dialog — covers both flows:
  //   "new"      → pick Activity + Contractor (creates the allocation) and
  //                log its first progress entry, all in one submit.
  //   "progress" → log/edit progress for an *existing* worker — the
  //                Activity/Contractor are already fixed, so the dialog
  //                just shows (fetches) them as read-only labels instead
  //                of pickers.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"new" | "progress">("new");
  const [assignActivityId, setAssignActivityId] = useState("");
  const [assignContractorId, setAssignContractorId] = useState("");
  const [logLabel, setLogLabel] = useState<{ activityName: string; contractorName: string } | null>(null);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [contractorAutoFilled, setContractorAutoFilled] = useState(false);

  const set = useCallback(
    (key: keyof typeof EMPTY_FORM, val: unknown) => {
      setFormState((p) => ({ ...p, [key]: val }));
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors],
  );

  const resetDialog = () => {
    setFormState(EMPTY_FORM);
    setEditingId(null);
    setErrors({});
    setAssignActivityId("");
    setAssignContractorId("");
    setLogLabel(null);
    setContractorAutoFilled(false);
  };

  const openAddDialog = () => {
    resetDialog();
    setDialogMode("new");
    setDialogOpen(true);
  };

  // When an Activity already has a worker linked to it (via Contractor
  // Register / a prior Add here), suggest that same contractor — still
  // changeable, since an Activity can have several workers.
  const handleActivityPick = (activityId: string) => {
    setAssignActivityId(activityId);
    const linked = allocations.find((a) => String(a.activityId) === activityId && a.projectId === activeProjectId);
    if (linked) {
      setAssignContractorId(String(linked.contractorId));
      setContractorAutoFilled(true);
    } else {
      setContractorAutoFilled(false);
    }
  };

  const handleContractorPick = (contractorId: string) => {
    setAssignContractorId(contractorId);
    setContractorAutoFilled(false);
  };

  const openLogDialog = (allocation: { id: number; activityName: string | null; contractorName: string | null }) => {
    resetDialog();
    setDialogMode("progress");
    setFormState((p) => ({ ...p, allocationId: allocation.id }));
    setLogLabel({
      activityName: allocation.activityName || "—",
      contractorName: allocation.contractorName || "—",
    });
    setDialogOpen(true);
  };

  const openEditDialog = (row: WorkProgress) => {
    resetDialog();
    setDialogMode("progress");
    setFormState({
      allocationId: row.allocationId,
      workDescription: row.workDescription || "",
      quantityPlanned: row.quantityPlanned,
      quantityCompleted: row.quantityCompleted,
      unit: row.unit || "",
      plannedStartDate: row.plannedStartDate?.slice(0, 10) || "",
      plannedEndDate: row.plannedEndDate?.slice(0, 10) || "",
      actualStartDate: row.actualStartDate?.slice(0, 10) || "",
      actualEndDate: row.actualEndDate?.slice(0, 10) || "",
      currentStatus: row.currentStatus || "Not Started",
      remarks: row.remarks || "",
    });
    setEditingId(row.id);
    setLogLabel({ activityName: row.activityName || "—", contractorName: row.contractorName || "—" });
    setDialogOpen(true);
  };

  const handleDialogSave = async () => {
    if (dialogMode === "new") {
      if (!assignActivityId || !assignContractorId) {
        toast.error("Activity and Contractor are required");
        return;
      }
      setDialogSaving(true);
      try {
        const created = await addContractorAllocation({
          contractorId: Number(assignContractorId),
          activityId: Number(assignActivityId),
          projectId: activeProjectId,
        });
        if (!created?.id) throw new Error("Allocation creation did not return an id");
        await addWorkProgress({ ...form, allocationId: created.id });
        toast.success("Worker assigned and progress logged ✓");
        await queryClient.invalidateQueries({ queryKey: ["contractorAllocations"] });
        await queryClient.invalidateQueries({ queryKey: ["workProgress"] });
        setDialogOpen(false);
        resetDialog();
      } catch (err: any) {
        toast.error("Failed to add: " + err.message);
      } finally {
        setDialogSaving(false);
      }
      return;
    }

    // dialogMode === "progress"
    if (!form.allocationId) {
      setErrors({ allocationId: true });
      return;
    }
    setDialogSaving(true);
    try {
      if (editingId) {
        await updateWorkProgress(editingId, form);
        toast.success("Progress updated — sent back for review ✓");
      } else {
        await addWorkProgress(form);
        toast.success("Progress logged — pending engineer review ✓");
      }
      await queryClient.invalidateQueries({ queryKey: ["workProgress"] });
      setDialogOpen(false);
      resetDialog();
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setDialogSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteWorkProgress(id);
      toast.success("Progress entry deleted");
      await queryClient.invalidateQueries({ queryKey: ["workProgress"] });
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
    setDeleteConfirmId(null);
  };

  // ── Review dialog ────────────────────────────────────────────────────────
  const [reviewTarget, setReviewTarget] = useState<WorkProgress | null>(null);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

  const openReview = (row: WorkProgress) => {
    setReviewTarget(row);
    setReviewerName(row.reviewedBy || "");
    setReviewRemarks("");
  };

  const submitReview = async (status: "Approved" | "Rejected") => {
    if (!reviewTarget) return;
    if (!reviewerName.trim()) {
      toast.error("Reviewer name is required");
      return;
    }
    setReviewSaving(true);
    try {
      await reviewWorkProgress(reviewTarget.id, {
        reviewedBy: reviewerName.trim(),
        reviewStatus: status,
        reviewRemarks: reviewRemarks || null,
      });
      toast.success(`Progress entry ${status.toLowerCase()} ✓`);
      await queryClient.invalidateQueries({ queryKey: ["workProgress"] });
      setReviewTarget(null);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    } finally {
      setReviewSaving(false);
    }
  };

  const COLUMNS: ColumnDef<WorkProgress>[] = [
    {
      accessorKey: "activityName",
      header: "Activity",
      cell: ({ row }) => row.original.activityName || "—",
    },
    {
      accessorKey: "contractorName",
      header: "Contractor",
      cell: ({ row }) => row.original.contractorName || "—",
    },
    {
      accessorKey: "percentageProgress",
      header: "Progress",
      cell: ({ row }) => {
        const pct = row.original.percentageProgress || 0;
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground w-10 text-right">
              {pct}%
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "currentStatus",
      header: "Status",
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            statusColors[row.original.currentStatus || ""] || "bg-muted text-muted-foreground"
          }`}
        >
          {row.original.currentStatus || "Not Started"}
        </span>
      ),
    },
    {
      accessorKey: "reviewStatus",
      header: "Review",
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            reviewColors[row.original.reviewStatus] || "bg-muted text-muted-foreground"
          }`}
        >
          {row.original.reviewStatus}
          {row.original.reviewedBy ? ` · ${row.original.reviewedBy}` : ""}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const r = row.original;
        const isConfirming = deleteConfirmId === r.id;
        return (
          <div className="flex items-center gap-1">
            {isConfirming ? (
              <>
                <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                  <Check size={15} />
                </button>
                <button onClick={() => setDeleteConfirmId(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                {rights.canEdit && r.reviewStatus === "Pending" && (
                  <button title="Review" onClick={() => openReview(r)} className="p-1 rounded hover:bg-emerald-500/10 text-emerald-600">
                    <ThumbsUp size={15} />
                  </button>
                )}
                {rights.canEdit && (
                  <button onClick={() => openEditDialog(r)} className="p-1 rounded hover:bg-primary/10 text-primary">
                    <Edit2 size={15} />
                  </button>
                )}
                {rights.canDelete && (
                  <button onClick={() => setDeleteConfirmId(r.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];

  if (loadingAllocations)
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading projects...
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Dependency"]} />
      <CivilWorkDprShell
        title="Dependency Management"
        subtitle="Activities in progress per project, logged by the assigned contractor, reviewed by an engineer"
        icon={GitBranch}
      >
        {/* ── Project selector — every project; assign the first worker right here ── */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <Building2 size={12} className="text-muted-foreground" />
          <span className="text-[11px] font-heading font-semibold uppercase tracking-wider text-muted-foreground">
            Project
          </span>
        </div>
        <div className="flex items-center gap-2.5 overflow-x-auto scrollbar-none pb-1">
          {projects.map((p: any) => {
            const isActive = activeProjectId === p.id;
            const workerCount = workerCountByProject.get(p.id) || 0;
            return (
              <button
                key={p.id}
                onClick={() => setActiveProjectId(p.id)}
                className={`group flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left whitespace-nowrap transition-all shrink-0 ${
                  isActive
                    ? "bg-gradient-to-br from-cyan-500 to-emerald-500 border-cyan-500 text-white shadow-md shadow-cyan-500/20"
                    : "bg-card border-border hover:border-cyan-500/40 hover:bg-muted/50"
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    isActive ? "bg-white/20" : "bg-cyan-500/10"
                  }`}
                >
                  <Building2 size={13} className={isActive ? "text-white" : "text-cyan-600"} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-heading font-semibold truncate ${isActive ? "text-white" : "text-foreground"}`}>
                    {p.label}
                  </p>
                  <p className={`text-[10px] truncate ${isActive ? "text-white/75" : "text-muted-foreground"}`}>
                    {workerCount} worker{workerCount === 1 ? "" : "s"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {activeProjectId === null ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
            No projects found.
          </div>
        ) : (
          <>
            {/* ── Summary strip for this project tab ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CivilWorkDprGlassCard label="Activities" value={activityCount} icon={ClipboardList} accentColor="#0891b2" />
              <CivilWorkDprGlassCard label="Workers Assigned" value={workerCount} icon={Users2} accentColor="#3b82f6" />
              <CivilWorkDprGlassCard label="Avg. Progress" value={`${avgProgress}%`} icon={TrendingUp} accentColor="#10b981" />
              <CivilWorkDprGlassCard label="Pending Review" value={pendingReviewCount} icon={ClockAlert} accentColor="#f59e0b" />
            </div>

            {/* ── Defined dependency chains for this project, pulled straight
                 from Engineering's Dependency Master — the actual "what
                 order must these activities happen in" definitions, not
                 re-entered here. Read-only: expand a chain to see its
                 ladder, "Manage" jumps to the real admin page to edit. ── */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                <span className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground">
                  <GitBranch size={14} className="text-cyan-600 dark:text-cyan-400" />
                  Dependency Chains
                  {dependencyChainsForProject.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                      {dependencyChainsForProject.length}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => navigate("/masters/dependency")}
                  className="inline-flex items-center gap-1 text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                  Manage in Dependency Master <ArrowUpRight size={12} />
                </button>
              </div>
              {loadingDependencyMasters ? (
                <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Loading dependency chains…
                </div>
              ) : dependencyChainsForProject.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 px-6 text-center">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center bg-cyan-500/10">
                    <GitBranch size={20} className="text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-heading font-semibold text-foreground">No dependency chains defined for this project</p>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      Define which activities must happen in what order (per Tower / Floor / Flat / Room) in the Dependency Master.
                    </p>
                  </div>
                  <button
                    onClick={() => navigate("/masters/dependency")}
                    className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-heading font-semibold text-white shadow-sm bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 transition-opacity"
                  >
                    <Plus size={13} /> Define a Dependency Chain
                  </button>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {dependencyChainsForProject.map((row) => (
                    <DependencyMasterListItem
                      key={row.id}
                      row={row}
                      isExpanded={depList.expandedId === row.id}
                      isLoading={depList.loadingId === row.id}
                      cached={depList.getCached(row.id)}
                      onToggle={() => depList.toggle(row.id)}
                      canEdit={false}
                      canDelete={false}
                      onEdit={() => {}}
                      onDelete={() => {}}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Activities in progress on this project, grouped — an Activity
                 can have several workers, each logging their own progress ── */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                <span className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground">
                  <HardHat size={14} className="text-cyan-600 dark:text-cyan-400" />
                  Activities in Progress
                </span>
                {rights.canCreate && (
                  <button
                    onClick={openAddDialog}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold text-white shadow-sm bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 transition-opacity"
                  >
                    <Plus size={13} /> Add
                  </button>
                )}
              </div>
              {allocationsByActivity.size === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center bg-cyan-500/10">
                    <HardHat size={20} className="text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-heading font-semibold text-foreground">No workers assigned yet</p>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      Assign a contractor to an activity on this project to start tracking progress.
                    </p>
                  </div>
                  {rights.canCreate && (
                    <button
                      onClick={openAddDialog}
                      className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-heading font-semibold text-white shadow-sm bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 transition-opacity"
                    >
                      <Plus size={13} /> Assign a Worker
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {Array.from(allocationsByActivity.entries()).map(([activityId, workers]) => (
                    <div key={activityId} className="rounded-xl border border-border bg-background overflow-hidden">
                      <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center gap-2">
                        <HardHat size={13} className="text-cyan-500 shrink-0" />
                        <span className="text-sm font-medium text-foreground">
                          {workers[0].activityName || "—"}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono ml-1">
                          {workers.length} worker{workers.length > 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="divide-y divide-border/50">
                        {workers.map((a) => {
                          const latest = latestByAllocation.get(a.id);
                          return (
                            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-foreground truncate">
                                  {a.contractorName || "—"}
                                </p>
                              </div>
                              {latest && (
                                <div className="flex items-center gap-2 w-32 shrink-0">
                                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                                      style={{ width: `${Math.min(100, latest.percentageProgress || 0)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-mono text-muted-foreground w-9 text-right">
                                    {latest.percentageProgress || 0}%
                                  </span>
                                </div>
                              )}
                              {rights.canCreate && (
                                <button
                                  onClick={() => openLogDialog(a)}
                                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium border border-cyan-500/30 text-cyan-600 hover:bg-cyan-500/10 shrink-0 whitespace-nowrap"
                                >
                                  Log Progress
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── History & review table ── */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                <History size={14} className="text-cyan-600 dark:text-cyan-400" />
                <span className="text-sm font-heading font-semibold text-foreground">Progress History & Review</span>
              </div>
              <DataTable
                data={progressEntries}
                columns={COLUMNS}
                loading={loadingProgress}
                searchable={false}
                paginated={true}
                defaultPageSize={10}
                emptyMessage="No progress logged for this project yet."
                rowClassName={(row) =>
                  row.original.id === deleteConfirmId ? "bg-destructive/5" : ""
                }
              />
            </div>
          </>
        )}

        {/* ── Review dialog ── */}
        <Dialog open={!!reviewTarget} onOpenChange={(open) => !open && setReviewTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">Review Progress Update</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              <p className="text-xs text-muted-foreground">
                {reviewTarget?.activityName} — {reviewTarget?.contractorName}: {reviewTarget?.percentageProgress}% complete
              </p>
              <Field label="Reviewer Name" required>
                <select value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} className={inputCls()}>
                  <option value="">Select reviewer…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Review Remarks">
                <textarea value={reviewRemarks} onChange={(e) => setReviewRemarks(e.target.value)} className={inputCls()} rows={2} />
              </Field>
            </div>
            <DialogFooter>
              <button
                onClick={() => submitReview("Rejected")}
                disabled={reviewSaving}
                className="px-3 py-1.5 rounded-lg text-xs font-heading border border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center gap-1.5 disabled:opacity-40"
              >
                <ThumbsDown size={12} /> Reject
              </button>
              <button
                onClick={() => submitReview("Approved")}
                disabled={reviewSaving}
                className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold bg-emerald-600 text-white flex items-center gap-1.5 disabled:opacity-40"
              >
                <ThumbsUp size={12} /> Approve
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Add / Log Progress dialog ──
             "new"      → pick Activity + Contractor, then fill in the first
                          progress entry — both happen as one record.
             "progress" → Activity/Contractor are already fixed for this
                          worker, so they're just shown (fetched), not pickers. */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-4xl overflow-hidden p-0 gap-0">
            <div className="relative px-8 pt-7 pb-6 bg-gradient-to-br from-cyan-500/[0.08] via-cyan-500/[0.03] to-transparent border-b border-cyan-500/15">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-cyan-500/60 via-cyan-500 to-emerald-500/60" />
              <DialogHeader>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-cyan-500/15 border border-cyan-500/30">
                    <UserPlus size={20} className="text-cyan-500" />
                  </div>
                  <div className="text-left">
                    <DialogTitle className="font-heading text-xl">
                      {dialogMode === "new" ? "Add Worker & Progress" : editingId ? "Edit Progress Entry" : "Log Progress"}
                    </DialogTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      {dialogMode === "new"
                        ? activeProjectLabel
                          ? `Assign a worker to an activity on ${activeProjectLabel} and log their progress`
                          : "Pick the activity and contractor, then log their progress"
                        : `${logLabel?.activityName} · ${logLabel?.contractorName}`}
                    </p>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="px-8 py-7 space-y-7">
              {/* ── Assignment ── */}
              <div>
                <div className="flex items-center gap-2 mb-3.5">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-heading font-semibold uppercase tracking-wider text-cyan-600 px-2">
                    Assignment
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                {dialogMode === "new" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field label="Activity" required>
                      <Select value={assignActivityId} onValueChange={handleActivityPick}>
                        <SelectTrigger className={selectTriggerCls}>
                          <div className="flex items-center gap-2 min-w-0">
                            <ClipboardList size={14} className="text-muted-foreground shrink-0" />
                            <SelectValue placeholder="Select activity…" />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {activityOptions.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Contractor / Worker" required>
                      <Select value={assignContractorId} onValueChange={handleContractorPick}>
                        <SelectTrigger className={selectTriggerCls}>
                          <div className="flex items-center gap-2 min-w-0">
                            <HardHat size={14} className="text-muted-foreground shrink-0" />
                            <SelectValue placeholder="Select contractor…" />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {contractorOptions.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {contractorAutoFilled && (
                        <p className="text-[10px] text-emerald-600 flex items-center gap-1 mt-0.5">
                          <Check size={10} /> Auto-filled from this activity's existing allocation — change if needed
                        </p>
                      )}
                    </Field>
                  </div>
                ) : (
                  <div className="flex items-center gap-6 px-4 py-3.5 rounded-xl bg-muted/40 border border-border">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                        <ClipboardList size={14} className="text-cyan-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Activity</p>
                        <p className="text-sm font-medium text-foreground truncate">{logLabel?.activityName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                        <HardHat size={14} className="text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Contractor</p>
                        <p className="text-sm font-medium text-foreground truncate">{logLabel?.contractorName}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Progress details ── */}
              <div>
                <div className="flex items-center gap-2 mb-3.5">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-heading font-semibold uppercase tracking-wider text-cyan-600 px-2">
                    Progress Details
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Field label="Work Description">
                      <input
                        type="text"
                        value={form.workDescription || ""}
                        onChange={(e) => set("workDescription", e.target.value)}
                        className={inputCls()}
                      />
                    </Field>
                  </div>
                  <Field label="Unit">
                    <input
                      type="text"
                      value={form.unit || ""}
                      onChange={(e) => set("unit", e.target.value)}
                      className={inputCls()}
                      placeholder="e.g. Cum, Sqm"
                    />
                  </Field>
                  <Field label="Quantity Planned">
                    <input
                      type="number"
                      value={form.quantityPlanned ?? ""}
                      onChange={(e) => set("quantityPlanned", e.target.value ? Number(e.target.value) : null)}
                      className={inputCls()}
                    />
                  </Field>
                  <Field label="Quantity Completed">
                    <input
                      type="number"
                      value={form.quantityCompleted ?? ""}
                      onChange={(e) => set("quantityCompleted", e.target.value ? Number(e.target.value) : null)}
                      className={inputCls()}
                    />
                  </Field>
                  <Field label="Current Status">
                    <select
                      value={form.currentStatus || ""}
                      onChange={(e) => set("currentStatus", e.target.value)}
                      className={inputCls()}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Planned Start Date">
                    <input type="date" value={form.plannedStartDate || ""} onChange={(e) => set("plannedStartDate", e.target.value)} className={inputCls()} />
                  </Field>
                  <Field label="Planned End Date">
                    <input type="date" value={form.plannedEndDate || ""} onChange={(e) => set("plannedEndDate", e.target.value)} className={inputCls()} />
                  </Field>
                  <Field label="Actual Start Date">
                    <input type="date" value={form.actualStartDate || ""} onChange={(e) => set("actualStartDate", e.target.value)} className={inputCls()} />
                  </Field>
                  <Field label="Actual End Date">
                    <input type="date" value={form.actualEndDate || ""} onChange={(e) => set("actualEndDate", e.target.value)} className={inputCls()} />
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Field label="Remarks">
                      <textarea
                        value={form.remarks || ""}
                        onChange={(e) => set("remarks", e.target.value)}
                        className={inputCls()}
                        rows={3}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="px-8 py-5 border-t border-border bg-muted/20">
              <button
                onClick={() => setDialogOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDialogSave}
                disabled={dialogSaving}
                className="px-6 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 text-white disabled:opacity-40 flex items-center gap-2 transition-opacity shadow-sm"
              >
                {dialogSaving ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : dialogMode === "new" ? (
                  <Plus size={14} />
                ) : (
                  <Save size={14} />
                )}
                {dialogSaving ? "Saving…" : dialogMode === "new" ? "Add" : editingId ? "Update" : "Log Progress"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CivilWorkDprShell>
    </>
  );
};

export default DependencyTracker;

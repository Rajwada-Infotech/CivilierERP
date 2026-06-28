import React, { useState, useCallback, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  GitBranch,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
  Save,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  HardHat,
  UserPlus,
  Building2,
  ClipboardList,
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
  const rights = usePageRights("civilworkdpr-dependency");

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

  const [form, setFormState] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── Assign Worker dialog — creates a ContractorAllocation directly from
  // this page, so an Activity can pick up additional workers without going
  // through Contractor Register first.
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignActivityId, setAssignActivityId] = useState("");
  const [assignContractorId, setAssignContractorId] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);

  const resetAssignForm = () => {
    setAssignActivityId("");
    setAssignContractorId("");
  };

  const handleAssignWorker = async () => {
    if (!assignActivityId || !assignContractorId) {
      toast.error("Activity and Contractor are required");
      return;
    }
    setAssignSaving(true);
    try {
      await addContractorAllocation({
        contractorId: Number(assignContractorId),
        activityId: Number(assignActivityId),
        projectId: activeProjectId,
      });
      toast.success("Worker assigned to activity ✓");
      await queryClient.invalidateQueries({ queryKey: ["contractorAllocations"] });
      setAssignOpen(false);
      resetAssignForm();
    } catch (err: any) {
      toast.error("Failed to assign worker: " + err.message);
    } finally {
      setAssignSaving(false);
    }
  };

  const set = useCallback(
    (key: keyof typeof EMPTY_FORM, val: unknown) => {
      setFormState((p) => ({ ...p, [key]: val }));
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors],
  );

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.allocationId) errs.allocationId = true;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const resetForm = () => {
    setFormState(EMPTY_FORM);
    setEditingId(null);
    setErrors({});
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateWorkProgress(editingId, form);
        toast.success("Progress updated — sent back for review ✓");
      } else {
        await addWorkProgress(form);
        toast.success("Progress logged — pending engineer review ✓");
      }
      await queryClient.invalidateQueries({ queryKey: ["workProgress"] });
      resetForm();
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (row: WorkProgress) => {
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
                  <button onClick={() => handleEdit(r)} className="p-1 rounded hover:bg-primary/10 text-primary">
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
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Building2 size={12} className="text-muted-foreground" />
            <span className="text-[10px] font-heading font-semibold uppercase tracking-wider text-muted-foreground">
              Project
            </span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            {projects.map((p: any) => (
              <button
                key={p.id}
                onClick={() => setActiveProjectId(p.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${
                  activeProjectId === p.id
                    ? "bg-cyan-600 border-cyan-600 text-white shadow-sm"
                    : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {activeProjectId === null ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
            No projects found.
          </div>
        ) : (
          <>
            {/* ── Activities in progress on this project, grouped — an Activity
                 can have several workers, each logging their own progress ── */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-heading font-semibold text-foreground">
                Activities in Progress
              </h2>
              {rights.canCreate && (
                <button
                  onClick={() => setAssignOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-cyan-500/30 text-cyan-600 hover:bg-cyan-500/10"
                >
                  <UserPlus size={13} /> Assign Worker
                </button>
              )}
            </div>
            <div className="space-y-3">
              {allocationsByActivity.size === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
                  No workers assigned to any activity on this project yet.
                </div>
              ) : (
                Array.from(allocationsByActivity.entries()).map(([activityId, workers]) => (
                  <div key={activityId} className="rounded-xl border border-border bg-card overflow-hidden">
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
                                onClick={() => {
                                  resetForm();
                                  setFormState((p) => ({ ...p, allocationId: a.id }));
                                  window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
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
                ))
              )}
            </div>

            {/* ── Form ── */}
            {rights.canCreate && (
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-base font-heading font-semibold mb-4">
                  {editingId ? "Edit Progress Entry" : "Log Progress"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Field label="Allocation (Activity · Contractor)" required error={errors.allocationId}>
                    <select
                      value={form.allocationId || ""}
                      onChange={(e) => set("allocationId", Number(e.target.value))}
                      className={inputCls(errors.allocationId)}
                    >
                      <option value="">Select allocation…</option>
                      {allocationsForProject.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.activityName} · {a.contractorName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Unit">
                    <input
                      type="text"
                      value={form.unit || ""}
                      onChange={(e) => set("unit", e.target.value)}
                      className={inputCls()}
                      placeholder="e.g. Cum, Sqm"
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
                        rows={2}
                      />
                    </Field>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border justify-end">
                  <button
                    onClick={resetForm}
                    className="px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw size={12} /> Reset
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 text-white disabled:opacity-40 flex items-center gap-2"
                  >
                    {saving ? (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : editingId ? (
                      <Check size={14} />
                    ) : (
                      <Save size={14} />
                    )}
                    {saving ? "Saving…" : editingId ? "Update" : "Log Progress"}
                  </button>
                </div>
              </div>
            )}

            {/* ── History & review table ── */}
            <div className="rounded-xl border border-border bg-card p-4">
              <DataTable
                data={progressEntries}
                columns={COLUMNS}
                loading={loadingProgress}
                searchable={false}
                paginated={true}
                defaultPageSize={20}
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

        {/* ── Assign Worker dialog ── */}
        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogContent className="max-w-sm overflow-hidden p-0">
            {/* Header band */}
            <div className="relative px-6 pt-6 pb-5 bg-cyan-500/[0.06] border-b border-cyan-500/15">
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-cyan-500 to-transparent" />
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-cyan-500/15 border border-cyan-500/30">
                    <UserPlus size={16} className="text-cyan-500" />
                  </div>
                  <div className="text-left">
                    <DialogTitle className="font-heading text-base">Assign Worker</DialogTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {activeProjectLabel
                        ? `Adding a worker to an activity on ${activeProjectLabel}`
                        : "Pick the activity and contractor to assign"}
                    </p>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="space-y-4 px-6 py-5">
              <Field label="Activity" required>
                <Select value={assignActivityId} onValueChange={setAssignActivityId}>
                  <SelectTrigger className={selectTriggerCls}>
                    <div className="flex items-center gap-2 min-w-0">
                      <ClipboardList size={13} className="text-muted-foreground shrink-0" />
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
                <Select value={assignContractorId} onValueChange={setAssignContractorId}>
                  <SelectTrigger className={selectTriggerCls}>
                    <div className="flex items-center gap-2 min-w-0">
                      <HardHat size={13} className="text-muted-foreground shrink-0" />
                      <SelectValue placeholder="Select contractor…" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {contractorOptions.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <DialogFooter className="px-6 pb-6 pt-0">
              <button
                onClick={() => setAssignOpen(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignWorker}
                disabled={assignSaving}
                className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 text-white disabled:opacity-40 flex items-center gap-1.5 transition-opacity"
              >
                {assignSaving ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <UserPlus size={12} />
                )}
                {assignSaving ? "Assigning…" : "Assign Worker"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CivilWorkDprShell>
    </>
  );
};

export default DependencyTracker;

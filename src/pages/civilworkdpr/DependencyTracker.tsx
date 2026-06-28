import React, { useState, useCallback, useEffect } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  GitBranch,
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
  Save,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getActivities,
  addActivity,
  type DbActivity,
} from "@/api/activityMasterApi";
import {
  getActivityDependencies,
  addActivityDependency,
  updateActivityDependency,
  deleteActivityDependency,
  type ActivityDependency,
  type ActivityDependencyPayload,
} from "@/api/activityDependencyApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
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

const inputCls = (err?: boolean) =>
  `w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${
    err ? "border-destructive" : "border-border"
  }`;

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

const EMPTY_FORM: ActivityDependencyPayload & { _id?: string } = {
  activityId: 0,
  parentActivityId: null,
  dependentActivityId: null,
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

  // Activities are sourced from the shared Engineering Activity Master
  // (activity_type = 1, i.e. real activities, not groups) — not a separate
  // Civil Work DPR-specific master.
  const { data: rawActivities = [], isLoading: loadingActivities } = useQuery({
    queryKey: ["activities"],
    queryFn: getActivities,
    staleTime: 5 * 60 * 1000,
  });
  const activities = rawActivities
    .filter((a: DbActivity) => a.activity_type === 1 && a.is_active !== false)
    .map((a: DbActivity) => ({ id: a.id, code: String(a.id), name: a.activity_name }));

  const [activeTab, setActiveTab] = useState<number | null>(null);
  useEffect(() => {
    if (activeTab === null && activities.length > 0) {
      setActiveTab(activities[0].id);
    }
  }, [activities, activeTab]);

  const { data: rows = [], isLoading: loadingRows } = useQuery({
    queryKey: ["activityDependencies", activeTab],
    queryFn: () => getActivityDependencies(activeTab ?? undefined),
    enabled: activeTab !== null,
  });

  const [form, setFormState] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [creatingTab, setCreatingTab] = useState(false);

  const set = useCallback(
    (key: keyof typeof EMPTY_FORM, val: unknown) => {
      setFormState((p) => ({ ...p, [key]: val }));
      if (errors[key]) setErrors((p) => ({ ...p, [key]: false }));
    },
    [errors],
  );

  const validate = () => {
    const errs: Record<string, boolean> = {};
    if (!form.activityId) errs.activityId = true;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const resetForm = () => {
    setFormState({ ...EMPTY_FORM, activityId: activeTab ?? 0 });
    setEditingId(null);
    setErrors({});
  };

  useEffect(() => {
    if (activeTab !== null) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: ActivityDependencyPayload = {
        activityId: form.activityId,
        parentActivityId: form.parentActivityId || null,
        dependentActivityId: form.dependentActivityId || null,
        workDescription: form.workDescription || null,
        quantityPlanned: form.quantityPlanned,
        quantityCompleted: form.quantityCompleted,
        unit: form.unit || null,
        plannedStartDate: form.plannedStartDate || null,
        plannedEndDate: form.plannedEndDate || null,
        actualStartDate: form.actualStartDate || null,
        actualEndDate: form.actualEndDate || null,
        currentStatus: form.currentStatus || null,
        remarks: form.remarks || null,
      };
      if (editingId) {
        await updateActivityDependency(editingId, payload);
        toast.success("Dependency record updated ✓");
      } else {
        await addActivityDependency(payload);
        toast.success("Dependency record added ✓");
      }
      await queryClient.invalidateQueries({ queryKey: ["activityDependencies"] });
      resetForm();
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (row: ActivityDependency) => {
    setFormState({
      activityId: row.activityId,
      parentActivityId: row.parentActivityId,
      dependentActivityId: row.dependentActivityId,
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
      await deleteActivityDependency(id);
      toast.success("Dependency record deleted");
      await queryClient.invalidateQueries({ queryKey: ["activityDependencies"] });
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
    setDeleteConfirmId(null);
  };

  const handleCreateTab = async () => {
    if (!newTabName.trim()) {
      toast.error("Name is required");
      return;
    }
    setCreatingTab(true);
    try {
      const res = await addActivity({
        activity_name: newTabName.trim(),
        short_description: null,
        activity_type: 1,
        group_id: null,
        is_active: true,
        belongsTo: null,
        hsn_code: null,
      });
      toast.success(`Activity "${newTabName}" added as a new tab ✓`);
      await queryClient.invalidateQueries({ queryKey: ["activities"] });
      if (res.id) setActiveTab(res.id);
      setNewTabOpen(false);
      setNewTabName("");
    } catch (err: any) {
      toast.error("Failed to create activity: " + err.message);
    } finally {
      setCreatingTab(false);
    }
  };

  const COLUMNS: ColumnDef<ActivityDependency>[] = [
    {
      accessorKey: "parentActivityName",
      header: "Parent Activity",
      cell: ({ row }) => row.original.parentActivityName || "—",
    },
    {
      accessorKey: "dependentActivityName",
      header: "Dependent Activity",
      cell: ({ row }) => row.original.dependentActivityName || "—",
    },
    {
      accessorKey: "workDescription",
      header: "Work Description",
      cell: ({ row }) => (
        <span className="truncate max-w-[200px] inline-block">
          {row.original.workDescription || "—"}
        </span>
      ),
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
      accessorKey: "remainingQuantity",
      header: "Remaining",
      cell: ({ row }) =>
        `${row.original.remainingQuantity ?? 0} ${row.original.unit || ""}`.trim(),
    },
    {
      accessorKey: "plannedStartDate",
      header: "Planned",
      cell: ({ row }) =>
        row.original.plannedStartDate
          ? `${row.original.plannedStartDate.slice(0, 10)} → ${row.original.plannedEndDate?.slice(0, 10) || "—"}`
          : "—",
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
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const id = row.original.id;
        const isConfirming = deleteConfirmId === id;
        return (
          <div className="flex items-center gap-1">
            {isConfirming ? (
              <>
                <span className="text-xs text-destructive mr-1">Delete?</span>
                <button onClick={() => handleDelete(id)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                  <Check size={15} />
                </button>
                <button onClick={() => setDeleteConfirmId(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                {rights.canEdit && (
                  <button onClick={() => handleEdit(row.original)} className="p-1 rounded hover:bg-primary/10 text-primary">
                    <Edit2 size={15} />
                  </button>
                )}
                {rights.canDelete && (
                  <button onClick={() => setDeleteConfirmId(id)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
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

  if (loadingActivities)
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading activities...
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Dependency"]} />
      <CivilWorkDprShell
        title="Dependency Management"
        subtitle="Track activity dependencies and work progress"
        icon={GitBranch}
      >
        {/* ── Tab strip ── */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {activities.map((act) => (
            <button
              key={act.id}
              onClick={() => setActiveTab(act.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === act.id
                  ? "bg-cyan-600 text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {act.name}
            </button>
          ))}
          {rights.canCreate && (
            <button
              onClick={() => setNewTabOpen(true)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-cyan-500/40 flex items-center gap-1 whitespace-nowrap"
            >
              <Plus size={12} /> New Tab
            </button>
          )}
        </div>

        {activeTab === null ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
            No activities yet. Click "New Tab" to create your first activity.
          </div>
        ) : (
          <>
            {/* ── Form ── */}
            {rights.canCreate && (
              <div className="rounded-xl border border-border bg-card p-6 mt-4">
                <h2 className="text-base font-heading font-semibold mb-4">
                  {editingId ? "Edit Dependency Record" : "Add Dependency Record"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Field label="Parent Activity">
                    <select
                      value={form.parentActivityId ?? ""}
                      onChange={(e) => set("parentActivityId", e.target.value ? Number(e.target.value) : null)}
                      className={inputCls()}
                    >
                      <option value="">None</option>
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Dependent Activity">
                    <select
                      value={form.dependentActivityId ?? ""}
                      onChange={(e) => set("dependentActivityId", e.target.value ? Number(e.target.value) : null)}
                      className={inputCls()}
                    >
                      <option value="">None</option>
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
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
                    {saving ? "Saving…" : editingId ? "Update" : "Save"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Table ── */}
            <div className="rounded-xl border border-border bg-card p-4 mt-4">
              <DataTable
                data={rows}
                columns={COLUMNS}
                loading={loadingRows}
                searchable={false}
                paginated={true}
                defaultPageSize={20}
                emptyMessage="No dependency records for this activity yet."
                rowClassName={(row) =>
                  row.original.id === deleteConfirmId ? "bg-destructive/5" : ""
                }
              />
            </div>
          </>
        )}

        {/* ── New Tab dialog ── */}
        <Dialog open={newTabOpen} onOpenChange={setNewTabOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">New Activity Tab</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              <Field label="Name" required>
                <input
                  type="text"
                  value={newTabName}
                  onChange={(e) => setNewTabName(e.target.value)}
                  className={inputCls()}
                  placeholder="e.g. RCC Work"
                />
              </Field>
            </div>
            <DialogFooter>
              <button
                onClick={() => setNewTabOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTab}
                disabled={creatingTab}
                className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold bg-cyan-600 text-white disabled:opacity-40"
              >
                {creatingTab ? "Creating…" : "Create"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CivilWorkDprShell>
    </>
  );
};

export default DependencyTracker;

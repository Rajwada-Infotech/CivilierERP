import React, { useState, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  HardHat,
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Users2,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getContractorOptions,
  getContractorAllocations,
  addContractorAllocation,
  updateContractorAllocation,
  acknowledgeAllocation,
  approveAllocation,
  deleteContractorAllocation,
  type ContractorAllocation,
  type ContractorAllocationPayload,
} from "@/api/contractorAllocationApi";
import { getActivities, type DbActivity } from "@/api/activityMasterApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getUsers } from "@/api/userApi";
import {
  getDailyLabourEntries,
  addDailyLabourEntry,
  updateDailyLabourEntry,
  deleteDailyLabourEntry,
  type DailyLabourEntry,
  type DailyLabourPayload,
} from "@/api/dailyLabourApi";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const ALLOC_STATUS_OPTIONS = ["Allocated", "In Progress", "Completed", "On Hold"];
const SHIFT_OPTIONS = ["Day", "Night", "General"];
const ATTENDANCE_OPTIONS = ["Present", "Absent", "Partial"];

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

const approvalColors: Record<string, string> = {
  Approved: "bg-emerald-500/10 text-emerald-600",
  Rejected: "bg-red-500/10 text-red-600",
  Pending: "bg-amber-500/10 text-amber-600",
};

const EMPTY_ALLOC_FORM: ContractorAllocationPayload = {
  contractorId: 0,
  projectId: null,
  activityId: 0,
  workDescription: "",
  allocationDate: "",
  startDate: "",
  expectedCompletionDate: "",
  currentStatus: "Allocated",
  siteLocation: "",
  remarks: "",
};

const EMPTY_LABOUR_FORM: DailyLabourPayload = {
  allocationId: 0,
  entryDate: "",
  skilledLabourCount: 0,
  unskilledLabourCount: 0,
  shift: "Day",
  attendanceStatus: "Present",
  remarks: "",
};

const ContractorRegister: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("civilworkdpr-contractor-register");
  const [tab, setTab] = useState<"allocations" | "labour">("allocations");

  const { data: contractors = [] } = useQuery({
    queryKey: ["contractorOptions"],
    queryFn: getContractorOptions,
    staleTime: 5 * 60 * 1000,
  });
  // Activities are sourced from the shared Engineering Activity Master
  // (activity_type = 1, i.e. real activities, not groups).
  const { data: rawActivities = [] } = useQuery({
    queryKey: ["activities"],
    queryFn: getActivities,
    staleTime: 5 * 60 * 1000,
  });
  const activities = rawActivities
    .filter((a: DbActivity) => a.activity_type === 1 && a.is_active !== false)
    .map((a: DbActivity) => ({ id: a.id, name: a.activity_name }));
  const { data: projects = [] } = useQuery({
    queryKey: ["projectOptionsCivilDpr"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 5 * 60 * 1000,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["usersForEngineerApproval"],
    queryFn: getUsers,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: allocations = [],
    isLoading: loadingAllocations,
  } = useQuery({
    queryKey: ["contractorAllocations"],
    queryFn: getContractorAllocations,
  });

  // ── Allocation form ──────────────────────────────────────────────────────
  const [allocForm, setAllocForm] = useState(EMPTY_ALLOC_FORM);
  const [allocEditingId, setAllocEditingId] = useState<number | null>(null);
  const [allocErrors, setAllocErrors] = useState<Record<string, boolean>>({});
  const [allocSaving, setAllocSaving] = useState(false);
  const [allocDeleteConfirmId, setAllocDeleteConfirmId] = useState<number | null>(null);

  const setAlloc = useCallback(
    (key: keyof typeof EMPTY_ALLOC_FORM, val: unknown) => {
      setAllocForm((p) => ({ ...p, [key]: val }));
      if (allocErrors[key]) setAllocErrors((p) => ({ ...p, [key]: false }));
    },
    [allocErrors],
  );

  const validateAlloc = () => {
    const errs: Record<string, boolean> = {};
    if (!allocForm.contractorId) errs.contractorId = true;
    if (!allocForm.activityId) errs.activityId = true;
    setAllocErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const resetAllocForm = () => {
    setAllocForm(EMPTY_ALLOC_FORM);
    setAllocEditingId(null);
    setAllocErrors({});
  };

  const handleSaveAlloc = async () => {
    if (!validateAlloc()) return;
    setAllocSaving(true);
    try {
      if (allocEditingId) {
        await updateContractorAllocation(allocEditingId, allocForm);
        toast.success("Allocation updated ✓");
      } else {
        await addContractorAllocation(allocForm);
        toast.success("Contractor allocated ✓");
      }
      await queryClient.invalidateQueries({ queryKey: ["contractorAllocations"] });
      resetAllocForm();
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setAllocSaving(false);
    }
  };

  const handleEditAlloc = (row: ContractorAllocation) => {
    setAllocForm({
      contractorId: row.contractorId,
      projectId: row.projectId,
      activityId: row.activityId,
      workDescription: row.workDescription || "",
      allocationDate: row.allocationDate?.slice(0, 10) || "",
      startDate: row.startDate?.slice(0, 10) || "",
      expectedCompletionDate: row.expectedCompletionDate?.slice(0, 10) || "",
      currentStatus: row.currentStatus || "Allocated",
      siteLocation: row.siteLocation || "",
      remarks: row.remarks || "",
    });
    setAllocEditingId(row.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteAlloc = async (id: number) => {
    try {
      await deleteContractorAllocation(id);
      toast.success("Allocation deleted");
      await queryClient.invalidateQueries({ queryKey: ["contractorAllocations"] });
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
    setAllocDeleteConfirmId(null);
  };

  const handleAcknowledge = async (id: number) => {
    try {
      await acknowledgeAllocation(id);
      await queryClient.invalidateQueries({ queryKey: ["contractorAllocations"] });
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    }
  };

  // ── Engineer approval dialog ─────────────────────────────────────────────
  const [approveTarget, setApproveTarget] = useState<ContractorAllocation | null>(null);
  const [approveEngineer, setApproveEngineer] = useState("");
  const [approveRemarks, setApproveRemarks] = useState("");
  const [approveSaving, setApproveSaving] = useState(false);

  const openApprove = (row: ContractorAllocation) => {
    setApproveTarget(row);
    setApproveEngineer(row.engineerName || "");
    setApproveRemarks("");
  };

  const submitApproval = async (status: "Approved" | "Rejected") => {
    if (!approveTarget) return;
    if (!approveEngineer.trim()) {
      toast.error("Engineer Name is required");
      return;
    }
    setApproveSaving(true);
    try {
      await approveAllocation(approveTarget.id, {
        engineerName: approveEngineer.trim(),
        approvalStatus: status,
        approvalRemarks: approveRemarks || null,
      });
      toast.success(`Allocation ${status.toLowerCase()} ✓`);
      await queryClient.invalidateQueries({ queryKey: ["contractorAllocations"] });
      setApproveTarget(null);
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    } finally {
      setApproveSaving(false);
    }
  };

  // ── Daily Labour ─────────────────────────────────────────────────────────
  const { data: labourEntries = [], isLoading: loadingLabour } = useQuery({
    queryKey: ["dailyLabourEntries"],
    queryFn: () => getDailyLabourEntries(),
    enabled: tab === "labour",
  });

  const [labourForm, setLabourForm] = useState(EMPTY_LABOUR_FORM);
  const [labourEditingId, setLabourEditingId] = useState<number | null>(null);
  const [labourErrors, setLabourErrors] = useState<Record<string, boolean>>({});
  const [labourSaving, setLabourSaving] = useState(false);
  const [labourDeleteConfirmId, setLabourDeleteConfirmId] = useState<number | null>(null);

  const setLabour = useCallback(
    (key: keyof typeof EMPTY_LABOUR_FORM, val: unknown) => {
      setLabourForm((p) => ({ ...p, [key]: val }));
      if (labourErrors[key]) setLabourErrors((p) => ({ ...p, [key]: false }));
    },
    [labourErrors],
  );

  const validateLabour = () => {
    const errs: Record<string, boolean> = {};
    if (!labourForm.allocationId) errs.allocationId = true;
    if (!labourForm.entryDate) errs.entryDate = true;
    setLabourErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const resetLabourForm = () => {
    setLabourForm(EMPTY_LABOUR_FORM);
    setLabourEditingId(null);
    setLabourErrors({});
  };

  const handleSaveLabour = async () => {
    if (!validateLabour()) return;
    setLabourSaving(true);
    try {
      if (labourEditingId) {
        await updateDailyLabourEntry(labourEditingId, labourForm);
        toast.success("Labour entry updated ✓");
      } else {
        await addDailyLabourEntry(labourForm);
        toast.success("Labour entry recorded ✓");
      }
      await queryClient.invalidateQueries({ queryKey: ["dailyLabourEntries"] });
      resetLabourForm();
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setLabourSaving(false);
    }
  };

  const handleEditLabour = (row: DailyLabourEntry) => {
    setLabourForm({
      allocationId: row.allocationId,
      entryDate: row.entryDate?.slice(0, 10) || "",
      skilledLabourCount: row.skilledLabourCount,
      unskilledLabourCount: row.unskilledLabourCount,
      shift: row.shift || "Day",
      attendanceStatus: row.attendanceStatus || "Present",
      remarks: row.remarks || "",
    });
    setLabourEditingId(row.id);
  };

  const handleDeleteLabour = async (id: number) => {
    try {
      await deleteDailyLabourEntry(id);
      toast.success("Labour entry deleted");
      await queryClient.invalidateQueries({ queryKey: ["dailyLabourEntries"] });
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
    setLabourDeleteConfirmId(null);
  };

  // ── Columns ───────────────────────────────────────────────────────────────
  const ALLOC_COLUMNS: ColumnDef<ContractorAllocation>[] = [
    {
      accessorKey: "contractorName",
      header: "Contractor",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{row.original.contractorName || "—"}</span>
          {row.original.isNew && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500 text-white">
              <Sparkles size={9} /> New
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "activityName",
      header: "Activity",
      cell: ({ row }) => row.original.activityName || "—",
    },
    {
      accessorKey: "projectName",
      header: "Project",
      cell: ({ row }) => row.original.projectName || "—",
    },
    {
      accessorKey: "currentStatus",
      header: "Status",
      cell: ({ row }) => row.original.currentStatus || "—",
    },
    {
      accessorKey: "approvalStatus",
      header: "Approval",
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            approvalColors[row.original.approvalStatus] || "bg-muted text-muted-foreground"
          }`}
        >
          {row.original.approvalStatus}
          {row.original.engineerName ? ` · ${row.original.engineerName}` : ""}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const r = row.original;
        const isConfirming = allocDeleteConfirmId === r.id;
        return (
          <div className="flex items-center gap-1">
            {isConfirming ? (
              <>
                <button onClick={() => handleDeleteAlloc(r.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                  <Check size={15} />
                </button>
                <button onClick={() => setAllocDeleteConfirmId(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                {r.isNew && rights.canEdit && (
                  <button title="Acknowledge" onClick={() => handleAcknowledge(r.id)} className="p-1 rounded hover:bg-cyan-500/10 text-cyan-600">
                    <Sparkles size={15} />
                  </button>
                )}
                {rights.canEdit && r.approvalStatus === "Pending" && (
                  <button title="Engineer Approval" onClick={() => openApprove(r)} className="p-1 rounded hover:bg-emerald-500/10 text-emerald-600">
                    <ThumbsUp size={15} />
                  </button>
                )}
                {rights.canEdit && (
                  <button onClick={() => handleEditAlloc(r)} className="p-1 rounded hover:bg-primary/10 text-primary">
                    <Edit2 size={15} />
                  </button>
                )}
                {rights.canDelete && (
                  <button onClick={() => setAllocDeleteConfirmId(r.id)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
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

  const LABOUR_COLUMNS: ColumnDef<DailyLabourEntry>[] = [
    { accessorKey: "entryDate", header: "Date", cell: ({ row }) => row.original.entryDate?.slice(0, 10) },
    { accessorKey: "contractorName", header: "Contractor", cell: ({ row }) => row.original.contractorName || "—" },
    { accessorKey: "activityName", header: "Activity", cell: ({ row }) => row.original.activityName || "—" },
    { accessorKey: "skilledLabourCount", header: "Skilled" },
    { accessorKey: "unskilledLabourCount", header: "Unskilled" },
    { accessorKey: "totalLabourPresent", header: "Total" },
    { accessorKey: "shift", header: "Shift", cell: ({ row }) => row.original.shift || "—" },
    {
      accessorKey: "attendanceStatus",
      header: "Attendance",
      cell: ({ row }) => row.original.attendanceStatus || "—",
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const id = row.original.id;
        const isConfirming = labourDeleteConfirmId === id;
        return (
          <div className="flex items-center gap-1">
            {isConfirming ? (
              <>
                <button onClick={() => handleDeleteLabour(id)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                  <Check size={15} />
                </button>
                <button onClick={() => setLabourDeleteConfirmId(null)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                  <X size={15} />
                </button>
              </>
            ) : (
              <>
                {rights.canEdit && (
                  <button onClick={() => handleEditLabour(row.original)} className="p-1 rounded hover:bg-primary/10 text-primary">
                    <Edit2 size={15} />
                  </button>
                )}
                {rights.canDelete && (
                  <button onClick={() => setLabourDeleteConfirmId(id)} className="p-1 rounded hover:bg-destructive/10 text-destructive">
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

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Contractor Register"]} />
      <CivilWorkDprShell
        title="Contractor Register"
        subtitle="Contractor allocations, daily labour, and engineer approval"
        icon={HardHat}
      >
        {/* ── Tab strip ── */}
        <div className="flex items-center gap-1.5">
          {[
            { id: "allocations" as const, label: "Allocations", icon: HardHat },
            { id: "labour" as const, label: "Daily Labour", icon: Users2 },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                tab === t.id ? "bg-cyan-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              <t.icon size={12} /> {t.label}
            </button>
          ))}
        </div>

        {tab === "allocations" ? (
          <>
            {rights.canCreate && (
              <div className="rounded-xl border border-border bg-card p-6 mt-4">
                <h2 className="text-base font-heading font-semibold mb-4">
                  {allocEditingId ? "Edit Allocation" : "Allocate Contractor"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Field label="Contractor" required error={allocErrors.contractorId}>
                    <select
                      value={allocForm.contractorId || ""}
                      onChange={(e) => setAlloc("contractorId", Number(e.target.value))}
                      className={inputCls(allocErrors.contractorId)}
                    >
                      <option value="">Select contractor…</option>
                      {contractors.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Activity" required error={allocErrors.activityId}>
                    <select
                      value={allocForm.activityId || ""}
                      onChange={(e) => setAlloc("activityId", Number(e.target.value))}
                      className={inputCls(allocErrors.activityId)}
                    >
                      <option value="">Select activity…</option>
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Assigned Project">
                    <select
                      value={allocForm.projectId ?? ""}
                      onChange={(e) => setAlloc("projectId", e.target.value ? Number(e.target.value) : null)}
                      className={inputCls()}
                    >
                      <option value="">None</option>
                      {projects.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Field label="Work Description">
                      <input
                        type="text"
                        value={allocForm.workDescription || ""}
                        onChange={(e) => setAlloc("workDescription", e.target.value)}
                        className={inputCls()}
                      />
                    </Field>
                  </div>
                  <Field label="Allocation Date">
                    <input type="date" value={allocForm.allocationDate || ""} onChange={(e) => setAlloc("allocationDate", e.target.value)} className={inputCls()} />
                  </Field>
                  <Field label="Start Date">
                    <input type="date" value={allocForm.startDate || ""} onChange={(e) => setAlloc("startDate", e.target.value)} className={inputCls()} />
                  </Field>
                  <Field label="Expected Completion Date">
                    <input type="date" value={allocForm.expectedCompletionDate || ""} onChange={(e) => setAlloc("expectedCompletionDate", e.target.value)} className={inputCls()} />
                  </Field>
                  <Field label="Current Status">
                    <select
                      value={allocForm.currentStatus || ""}
                      onChange={(e) => setAlloc("currentStatus", e.target.value)}
                      className={inputCls()}
                    >
                      {ALLOC_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Site Location">
                    <input
                      type="text"
                      value={allocForm.siteLocation || ""}
                      onChange={(e) => setAlloc("siteLocation", e.target.value)}
                      className={inputCls()}
                    />
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Field label="Remarks">
                      <textarea
                        value={allocForm.remarks || ""}
                        onChange={(e) => setAlloc("remarks", e.target.value)}
                        className={inputCls()}
                        rows={2}
                      />
                    </Field>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border justify-end">
                  <button onClick={resetAllocForm} className="px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted flex items-center gap-1.5">
                    <RotateCcw size={12} /> Reset
                  </button>
                  <button
                    onClick={handleSaveAlloc}
                    disabled={allocSaving}
                    className="px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 text-white disabled:opacity-40 flex items-center gap-2"
                  >
                    {allocSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : allocEditingId ? <Check size={14} /> : <Save size={14} />}
                    {allocSaving ? "Saving…" : allocEditingId ? "Update" : "Allocate"}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4 mt-4">
              <DataTable
                data={allocations}
                columns={ALLOC_COLUMNS}
                loading={loadingAllocations}
                searchable={true}
                paginated={true}
                defaultPageSize={20}
                emptyMessage="No contractor allocations yet."
                rowClassName={(row) => (row.original.id === allocDeleteConfirmId ? "bg-destructive/5" : "")}
              />
            </div>
          </>
        ) : (
          <>
            {rights.canCreate && (
              <div className="rounded-xl border border-border bg-card p-6 mt-4">
                <h2 className="text-base font-heading font-semibold mb-4">
                  {labourEditingId ? "Edit Labour Entry" : "Record Daily Labour"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Field label="Allocation" required error={labourErrors.allocationId}>
                    <select
                      value={labourForm.allocationId || ""}
                      onChange={(e) => setLabour("allocationId", Number(e.target.value))}
                      className={inputCls(labourErrors.allocationId)}
                    >
                      <option value="">Select allocation…</option>
                      {allocations.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.contractorName} — {a.activityName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Date" required error={labourErrors.entryDate}>
                    <input type="date" value={labourForm.entryDate} onChange={(e) => setLabour("entryDate", e.target.value)} className={inputCls(labourErrors.entryDate)} />
                  </Field>
                  <Field label="Shift">
                    <select value={labourForm.shift || ""} onChange={(e) => setLabour("shift", e.target.value)} className={inputCls()}>
                      {SHIFT_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Skilled Labour Count">
                    <input
                      type="number"
                      value={labourForm.skilledLabourCount}
                      onChange={(e) => setLabour("skilledLabourCount", Number(e.target.value) || 0)}
                      className={inputCls()}
                    />
                  </Field>
                  <Field label="Unskilled Labour Count">
                    <input
                      type="number"
                      value={labourForm.unskilledLabourCount}
                      onChange={(e) => setLabour("unskilledLabourCount", Number(e.target.value) || 0)}
                      className={inputCls()}
                    />
                  </Field>
                  <Field label="Attendance Status">
                    <select value={labourForm.attendanceStatus || ""} onChange={(e) => setLabour("attendanceStatus", e.target.value)} className={inputCls()}>
                      {ATTENDANCE_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Field label="Remarks">
                      <textarea value={labourForm.remarks || ""} onChange={(e) => setLabour("remarks", e.target.value)} className={inputCls()} rows={2} />
                    </Field>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-5 pt-4 border-t border-border justify-end">
                  <button onClick={resetLabourForm} className="px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted flex items-center gap-1.5">
                    <RotateCcw size={12} /> Reset
                  </button>
                  <button
                    onClick={handleSaveLabour}
                    disabled={labourSaving}
                    className="px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 text-white disabled:opacity-40 flex items-center gap-2"
                  >
                    {labourSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : labourEditingId ? <Check size={14} /> : <Plus size={14} />}
                    {labourSaving ? "Saving…" : labourEditingId ? "Update" : "Add Entry"}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4 mt-4">
              <DataTable
                data={labourEntries}
                columns={LABOUR_COLUMNS}
                loading={loadingLabour}
                searchable={true}
                paginated={true}
                defaultPageSize={20}
                emptyMessage="No daily labour entries yet."
                rowClassName={(row) => (row.original.id === labourDeleteConfirmId ? "bg-destructive/5" : "")}
              />
            </div>
          </>
        )}

        {/* ── Engineer Approval dialog ── */}
        <Dialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">Engineer Approval</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              <p className="text-xs text-muted-foreground">
                Allocation: <span className="font-medium text-foreground">{approveTarget?.contractorName} — {approveTarget?.activityName}</span>
              </p>
              <Field label="Engineer Name" required>
                <select value={approveEngineer} onChange={(e) => setApproveEngineer(e.target.value)} className={inputCls()}>
                  <option value="">Select engineer…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Approval Remarks">
                <textarea value={approveRemarks} onChange={(e) => setApproveRemarks(e.target.value)} className={inputCls()} rows={2} />
              </Field>
            </div>
            <DialogFooter>
              <button
                onClick={() => submitApproval("Rejected")}
                disabled={approveSaving}
                className="px-3 py-1.5 rounded-lg text-xs font-heading border border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center gap-1.5 disabled:opacity-40"
              >
                <ThumbsDown size={12} /> Reject
              </button>
              <button
                onClick={() => submitApproval("Approved")}
                disabled={approveSaving}
                className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold bg-emerald-600 text-white flex items-center gap-1.5 disabled:opacity-40"
              >
                <ThumbsUp size={12} /> Approve
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CivilWorkDprShell>
    </>
  );
};

export default ContractorRegister;

import React, { useState, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml, raw } from "@/utils/escapeHtml";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  HardHat,
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  RotateCcw,
  Save,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Users2,
  Building2,
  Eye,
  Printer,
  CheckCircle2,
  XCircle,
  CircleDashed,
  UserPlus2,
  ChevronDown,
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
import { getEnterprisesByType } from "@/api/enterpriseApi";
import { getUsers } from "@/api/userApi";
import {
  getDailyLabourEntries,
  addDailyLabourEntry,
  updateDailyLabourEntry,
  deleteDailyLabourEntry,
  type DailyLabourEntry,
  type DailyLabourPayload,
} from "@/api/dailyLabourApi";
import {
  getLocationProjects,
  getLocationBlocks,
  getLocationUnits,
  getLocationRooms,
} from "@/api/locationMasterApi";
import { markAttendance } from "@/api/workerAttendanceApi";
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

const STATUS_LABEL: Record<"P" | "A" | "H", string> = { P: "Present", A: "Absent", H: "Half Day" };
const STATUS_BADGE_CLS: Record<"P" | "A" | "H", string> = {
  P: "border-emerald-500/30 text-emerald-600 bg-emerald-500/10",
  A: "border-red-500/30 text-red-600 bg-red-500/10",
  H: "border-amber-500/30 text-amber-600 bg-amber-500/10",
};
const STATUS_PRINT_CLS: Record<"P" | "A" | "H", string> = { P: "present", A: "absent", H: "halfday" };

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

// Native <select> with a consistent custom chevron — the browser's own
// dropdown arrow renders inconsistently across the many selects on this
// page, so it's hidden (appearance-none) in favor of one fixed icon.
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }
>(({ className, wrapperClassName, children, ...props }, ref) => (
  <div className={`relative ${wrapperClassName || ""}`}>
    <select
      ref={ref}
      {...props}
      className={`${className || ""} appearance-none pr-9 disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {children}
    </select>
    <ChevronDown
      size={14}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
    />
  </div>
));
NativeSelect.displayName = "NativeSelect";

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
  skilledLabourNames: "",
  unskilledLabourNames: "",
  blockId: null,
  unitId: null,
  roomId: null,
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
    .map((a: DbActivity) => ({ id: a.id, name: a.activity_name, description: a.short_description }));
  // Full project records (not just {id,label}) — needed so picking a
  // project can auto-fill its address into Site Location below.
  const { data: projects = [] } = useQuery({
    queryKey: ["projectsFullCivilDpr"],
    queryFn: () => getEnterprisesByType("P"),
    staleTime: 5 * 60 * 1000,
  });

  const projectSiteLocation = (projectId: number | null) => {
    const p = projects.find((pr) => pr.id === projectId);
    if (!p) return "";
    return [p.address, p.city, p.state].filter(Boolean).join(", ");
  };
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

  // ── Location cascade (Project → Block → Unit → Room), sourced from the
  // Follow-up module's masters — purely to scope which allocation/site this
  // day's attendance was recorded for; persisted as block/unit/roomId.
  const [labourProjectId, setLabourProjectId] = useState<number | "">("");

  const { data: locationProjects = [] } = useQuery({
    queryKey: ["locationProjects"],
    queryFn: getLocationProjects,
    enabled: tab === "labour",
    staleTime: 5 * 60 * 1000,
  });
  const { data: locationBlocks = [] } = useQuery({
    queryKey: ["locationBlocks", labourProjectId],
    queryFn: () => getLocationBlocks(Number(labourProjectId)),
    enabled: tab === "labour" && !!labourProjectId,
    staleTime: 5 * 60 * 1000,
  });
  const { data: locationUnits = [] } = useQuery({
    queryKey: ["locationUnits", labourProjectId],
    queryFn: () => getLocationUnits(Number(labourProjectId)),
    enabled: tab === "labour" && !!labourProjectId,
    staleTime: 5 * 60 * 1000,
  });
  const { data: locationRoomsAll = [] } = useQuery({
    queryKey: ["locationRooms"],
    queryFn: getLocationRooms,
    enabled: tab === "labour",
    staleTime: 5 * 60 * 1000,
  });
  const locationRooms = locationRoomsAll.filter((r) => r.UnitId === labourForm.unitId);
  // Floor isn't picked manually — it's whichever floor the selected Room is
  // recorded on in Room Master.
  const selectedRoomFloor = locationRooms.find((r) => r.Id === labourForm.roomId)?.Floor || "";

  const allocationsForLabourProject = labourProjectId
    ? allocations.filter((a) => a.projectId === labourProjectId)
    : allocations;

  // ── Attendance is per-activity, not a shared roster ────────────────────
  // An Activity (allocation) and its attendance are the same thing here —
  // each allocation added gets its OWN worker roster. Adding a second
  // activity does not duplicate or carry over names from the first; saving
  // creates one DailyLabourEntry per allocation, each with its own list.
  type AttendanceStatus = "P" | "A" | "H";
  type RosterRow = { name: string; type: "Skilled" | "Unskilled"; status: AttendanceStatus };

  const [selectedAllocationIds, setSelectedAllocationIds] = useState<number[]>([]);
  const [pendingAllocationId, setPendingAllocationId] = useState("");
  const [allocationRosters, setAllocationRosters] = useState<Record<number, RosterRow[]>>({});
  const [pendingWorkerByAlloc, setPendingWorkerByAlloc] = useState<
    Record<number, { name: string; type: RosterRow["type"] }>
  >({});

  const getRoster = (allocationId: number) => allocationRosters[allocationId] || [];
  const getPendingWorker = (allocationId: number) =>
    pendingWorkerByAlloc[allocationId] || { name: "", type: "Skilled" as RosterRow["type"] };

  const addAllocation = () => {
    if (!pendingAllocationId) return;
    const id = Number(pendingAllocationId);
    if (!selectedAllocationIds.includes(id)) {
      setSelectedAllocationIds((prev) => [...prev, id]);
      setAllocationRosters((prev) => ({ ...prev, [id]: prev[id] || [] }));
      setPendingWorkerByAlloc((prev) => ({ ...prev, [id]: prev[id] || { name: "", type: "Skilled" } }));
      if (labourErrors.allocationId) setLabourErrors((p) => ({ ...p, allocationId: false }));
    }
    setPendingAllocationId("");
  };
  const removeAllocation = (id: number) => {
    setSelectedAllocationIds((prev) => prev.filter((a) => a !== id));
    setAllocationRosters((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPendingWorkerByAlloc((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setLabour = useCallback(
    (key: keyof typeof EMPTY_LABOUR_FORM, val: unknown) => {
      setLabourForm((p) => ({ ...p, [key]: val }));
      if (labourErrors[key]) setLabourErrors((p) => ({ ...p, [key]: false }));
    },
    [labourErrors],
  );

  const validateLabour = () => {
    const errs: Record<string, boolean> = {};
    if (selectedAllocationIds.length === 0) errs.allocationId = true;
    if (!labourForm.entryDate) errs.entryDate = true;
    setLabourErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const resetLabourForm = () => {
    setLabourForm(EMPTY_LABOUR_FORM);
    setLabourEditingId(null);
    setLabourErrors({});
    setLabourProjectId("");
    setSelectedAllocationIds([]);
    setPendingAllocationId("");
    setAllocationRosters({});
    setPendingWorkerByAlloc({});
  };

  const parseNames = (raw: string | null | undefined, type: "Skilled" | "Unskilled"): RosterRow[] => {
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const m = entry.match(/^(.*)\(([PAH])\)\s*$/);
        return m
          ? { name: m[1].trim(), type, status: m[2] as AttendanceStatus }
          : { name: entry, type, status: "P" as AttendanceStatus };
      });
  };

  const removeRosterRow = (allocationId: number, i: number) =>
    setAllocationRosters((prev) => ({
      ...prev,
      [allocationId]: (prev[allocationId] || []).filter((_, idx) => idx !== i),
    }));
  const updateRosterRow = (allocationId: number, i: number, patch: Partial<RosterRow>) =>
    setAllocationRosters((prev) => ({
      ...prev,
      [allocationId]: (prev[allocationId] || []).map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    }));

  const setPendingWorkerName = (allocationId: number, name: string) =>
    setPendingWorkerByAlloc((prev) => ({ ...prev, [allocationId]: { ...getPendingWorker(allocationId), name } }));
  const setPendingWorkerType = (allocationId: number, type: RosterRow["type"]) =>
    setPendingWorkerByAlloc((prev) => ({ ...prev, [allocationId]: { ...getPendingWorker(allocationId), type } }));

  const addWorker = (allocationId: number) => {
    const pending = getPendingWorker(allocationId);
    if (!pending.name.trim()) return;
    setAllocationRosters((prev) => ({
      ...prev,
      [allocationId]: [...(prev[allocationId] || []), { name: pending.name.trim(), type: pending.type, status: "P" }],
    }));
    setPendingWorkerByAlloc((prev) => ({ ...prev, [allocationId]: { name: "", type: pending.type } }));
  };

  const cycleStatus = (status: AttendanceStatus): AttendanceStatus =>
    status === "P" ? "A" : status === "A" ? "H" : "P";

  // Headcount on the entry counts anyone who showed up at all (full or half
  // day) — only full absentees are excluded.
  const presentCountFor = (allocationId: number) => getRoster(allocationId).filter((r) => r.status !== "A").length;

  const encodeRoster = (allocationId: number, type: "Skilled" | "Unskilled") =>
    getRoster(allocationId)
      .filter((r) => r.type === type && r.name.trim())
      .map((r) => `${r.name.trim()} (${r.status})`)
      .join(", ") || null;

  // Feeds the per-worker attendance history (Worker Attendance page) —
  // best-effort, one upsert per roster row. Failures here don't block the
  // Daily Labour save itself (that's the system of record for the day).
  const syncWorkerAttendance = async (allocationId: number, roster: RosterRow[]) => {
    const allocation = allocations.find((a) => a.id === allocationId);
    if (!allocation || !labourForm.entryDate) return;
    await Promise.allSettled(
      roster
        .filter((r) => r.name.trim())
        .map((r) =>
          markAttendance({
            name: r.name.trim(),
            contractorId: allocation.contractorId,
            skillType: r.type,
            allocationId,
            date: labourForm.entryDate,
            status: r.status,
          }),
        ),
    );
  };

  const handleSaveLabour = async () => {
    if (!validateLabour()) return;
    setLabourSaving(true);
    try {
      if (labourEditingId) {
        const allocationId = selectedAllocationIds[0];
        const roster = getRoster(allocationId);
        await updateDailyLabourEntry(labourEditingId, {
          ...labourForm,
          allocationId,
          skilledLabourCount: roster.filter((r) => r.type === "Skilled" && r.status !== "A").length,
          unskilledLabourCount: roster.filter((r) => r.type === "Unskilled" && r.status !== "A").length,
          skilledLabourNames: encodeRoster(allocationId, "Skilled"),
          unskilledLabourNames: encodeRoster(allocationId, "Unskilled"),
        });
        await syncWorkerAttendance(allocationId, roster);
        toast.success("Labour entry updated ✓");
      } else {
        await Promise.all(
          selectedAllocationIds.map(async (allocationId) => {
            const roster = getRoster(allocationId);
            await addDailyLabourEntry({
              ...labourForm,
              allocationId,
              skilledLabourCount: roster.filter((r) => r.type === "Skilled" && r.status !== "A").length,
              unskilledLabourCount: roster.filter((r) => r.type === "Unskilled" && r.status !== "A").length,
              skilledLabourNames: encodeRoster(allocationId, "Skilled"),
              unskilledLabourNames: encodeRoster(allocationId, "Unskilled"),
            });
            await syncWorkerAttendance(allocationId, roster);
          }),
        );
        toast.success(
          selectedAllocationIds.length > 1
            ? `Logged attendance for ${selectedAllocationIds.length} activities ✓`
            : "Labour entry recorded ✓",
        );
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
      skilledLabourNames: row.skilledLabourNames || "",
      unskilledLabourNames: row.unskilledLabourNames || "",
      blockId: row.blockId,
      unitId: row.unitId,
      roomId: row.roomId,
      shift: row.shift || "Day",
      attendanceStatus: row.attendanceStatus || "Present",
      remarks: row.remarks || "",
    });
    setLabourProjectId(row.projectId || "");
    setSelectedAllocationIds([row.allocationId]);
    setAllocationRosters({
      [row.allocationId]: [
        ...parseNames(row.skilledLabourNames, "Skilled"),
        ...parseNames(row.unskilledLabourNames, "Unskilled"),
      ],
    });
    setPendingWorkerByAlloc({ [row.allocationId]: { name: "", type: "Skilled" } });
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

  // ── View / Print attendance register ────────────────────────────────────
  const [printTarget, setPrintTarget] = useState<DailyLabourEntry | null>(null);

  const printAttendance = (row: DailyLabourEntry) => {
    const rows = [...parseNames(row.skilledLabourNames, "Skilled"), ...parseNames(row.unskilledLabourNames, "Unskilled")];
    const win = window.open("", "_blank");
    if (!win) return;
    const location = [row.blockName, row.unitName, row.roomName, row.floor ? `Floor ${row.floor}` : null]
      .filter(Boolean)
      .join(" / ") || "—";
    win.document.write(safeHtml`
      <html>
        <head>
          <title>Attendance Register — ${row.entryDate?.slice(0, 10)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            p.meta { font-size: 12px; color: #555; margin: 2px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #ccc; padding: 6px 10px; font-size: 13px; text-align: left; }
            th { background: #f2f2f2; }
            .present { color: #047857; font-weight: 600; }
            .absent { color: #b91c1c; font-weight: 600; }
            .halfday { color: #b45309; font-weight: 600; }
          </style>
        </head>
        <body>
          <h1>Daily Labour Attendance Register</h1>
          <p class="meta"><b>Date:</b> ${row.entryDate?.slice(0, 10)} &nbsp; <b>Shift:</b> ${row.shift || "—"}</p>
          <p class="meta"><b>Project:</b> ${row.projectName || "—"} &nbsp; <b>Location:</b> ${location}</p>
          <p class="meta"><b>Activity:</b> ${row.activityName || "—"} &nbsp; <b>Contractor:</b> ${row.contractorName || "—"}</p>
          <table>
            <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>
              ${raw(
                rows
                  .map(
                    (r, i) =>
                      safeHtml`<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.type}</td><td class="${STATUS_PRINT_CLS[r.status]}">${STATUS_LABEL[r.status]}</td></tr>`,
                  )
                  .join(""),
              )}
            </tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
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
    {
      id: "attendanceNames",
      header: "Names",
      cell: ({ row }) => {
        const names = [row.original.skilledLabourNames, row.original.unskilledLabourNames]
          .filter(Boolean)
          .join(", ");
        if (!names) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="text-xs truncate max-w-[200px] inline-block" title={names}>
            {names}
          </span>
        );
      },
    },
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
                <button onClick={() => setPrintTarget(row.original)} title="View register" className="p-1 rounded hover:bg-cyan-500/10 text-cyan-600">
                  <Eye size={15} />
                </button>
                <button onClick={() => printAttendance(row.original)} title="Print register" className="p-1 rounded hover:bg-cyan-500/10 text-cyan-600">
                  <Printer size={15} />
                </button>
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
                  <Field label="Project">
                    <NativeSelect
                      value={allocForm.projectId ?? ""}
                      onChange={(e) => {
                        const projectId = e.target.value ? Number(e.target.value) : null;
                        setAlloc("projectId", projectId);
                        // Site Location is derived from the project's address —
                        // stays editable after, in case the actual work site differs.
                        setAlloc("siteLocation", projectSiteLocation(projectId));
                      }}
                      className={inputCls()}
                    >
                      <option value="">None</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Activity" required error={allocErrors.activityId}>
                    <NativeSelect
                      value={allocForm.activityId || ""}
                      onChange={(e) => {
                        const activityId = e.target.value ? Number(e.target.value) : null;
                        setAlloc("activityId", activityId);
                        // Pre-fill Work Description from the Activity Master's
                        // own description when it has one; otherwise clear it
                        // so the user can type their own for this activity.
                        const activity = activities.find((a) => a.id === activityId);
                        setAlloc("workDescription", activity?.description || "");
                      }}
                      className={inputCls(allocErrors.activityId)}
                    >
                      <option value="">Select activity…</option>
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Contractor" required error={allocErrors.contractorId}>
                    <NativeSelect
                      value={allocForm.contractorId || ""}
                      onChange={(e) => setAlloc("contractorId", Number(e.target.value))}
                      className={inputCls(allocErrors.contractorId)}
                    >
                      <option value="">Select contractor…</option>
                      {contractors.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </NativeSelect>
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
                    <NativeSelect
                      value={allocForm.currentStatus || ""}
                      onChange={(e) => setAlloc("currentStatus", e.target.value)}
                      className={inputCls()}
                    >
                      {ALLOC_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </NativeSelect>
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
                defaultPageSize={10}
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

                {/* ── Location — Project → Block → Unit → Room (Follow-up masters) ── */}
                <div className="rounded-lg border border-border bg-muted/30 p-4 mb-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Building2 size={13} className="text-cyan-600" />
                    <span className="text-xs font-heading font-semibold text-foreground">Location</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <Field label="Project">
                      <NativeSelect
                        value={labourProjectId}
                        onChange={(e) => {
                          const id = e.target.value ? Number(e.target.value) : "";
                          setLabourProjectId(id);
                          setSelectedAllocationIds([]);
                          setLabour("allocationId", 0);
                          setLabour("blockId", null);
                          setLabour("unitId", null);
                          setLabour("roomId", null);
                        }}
                        className={inputCls()}
                      >
                        <option value="">All projects</option>
                        {locationProjects.map((p) => (
                          <option key={p.Id} value={p.Id}>{p.Name}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Block">
                      <NativeSelect
                        value={labourForm.blockId ?? ""}
                        onChange={(e) => setLabour("blockId", e.target.value ? Number(e.target.value) : null)}
                        className={inputCls()}
                        disabled={!labourProjectId}
                      >
                        <option value="">{labourProjectId ? "Select block…" : "Pick a project first"}</option>
                        {locationBlocks.map((b) => (
                          <option key={b.Id} value={b.Id}>{b.Name}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Unit">
                      <NativeSelect
                        value={labourForm.unitId ?? ""}
                        onChange={(e) => setLabour("unitId", e.target.value ? Number(e.target.value) : null)}
                        className={inputCls()}
                        disabled={!labourProjectId}
                      >
                        <option value="">{labourProjectId ? "Select unit…" : "Pick a project first"}</option>
                        {locationUnits.map((u) => (
                          <option key={u.Id} value={u.Id}>{u.Name}{u.BlockName ? ` (${u.BlockName})` : ""}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Room">
                      <NativeSelect
                        value={labourForm.roomId ?? ""}
                        onChange={(e) => setLabour("roomId", e.target.value ? Number(e.target.value) : null)}
                        className={inputCls()}
                        disabled={!labourForm.unitId}
                      >
                        <option value="">{labourForm.unitId ? "Select room…" : "Pick a unit first"}</option>
                        {locationRooms.map((r) => (
                          <option key={r.Id} value={r.Id}>{r.RoomName}{r.Floor ? ` (Floor ${r.Floor})` : ""}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Floor">
                      <div className={`${inputCls()} flex items-center bg-muted/40`}>
                        {selectedRoomFloor || <span className="text-muted-foreground">Auto from Room</span>}
                      </div>
                    </Field>
                  </div>
                </div>

                <div className="space-y-5">
                  {/* ── Activities — addable list, since a crew may work several
                       activities in one day. Saving logs the same attendance
                       against every activity picked here. ── */}
                  <div className={`rounded-lg border ${labourErrors.allocationId ? "border-destructive" : "border-border"} bg-muted/30 p-4 space-y-3`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-1.5">
                        <HardHat size={13} className="text-cyan-600" />
                        <span className="text-xs font-heading font-semibold text-foreground">
                          Activities <span className="text-destructive">*</span>
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 font-mono">
                          {selectedAllocationIds.length} selected
                        </span>
                      </div>
                      {!labourEditingId && (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                          <NativeSelect
                            value={pendingAllocationId}
                            onChange={(e) => setPendingAllocationId(e.target.value)}
                            className={`${inputCls()} w-full`}
                            wrapperClassName="w-full sm:w-56 min-w-0"
                          >
                            <option value="">Select activity…</option>
                            {allocationsForLabourProject
                              .filter((a) => !selectedAllocationIds.includes(a.id))
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.activityName} — {a.contractorName}
                                </option>
                              ))}
                          </NativeSelect>
                          <button
                            type="button"
                            onClick={addAllocation}
                            disabled={!pendingAllocationId}
                            className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-medium border border-cyan-500/30 text-cyan-600 hover:bg-cyan-500/10 disabled:opacity-40 whitespace-nowrap shrink-0"
                          >
                            <Plus size={12} /> Add Allocation
                          </button>
                        </div>
                      )}
                    </div>

                    {selectedAllocationIds.length === 0 && (
                      <p className="text-xs text-muted-foreground py-1">
                        No activities added yet — pick one and click "Add Allocation".
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Date" required error={labourErrors.entryDate}>
                      <input type="date" value={labourForm.entryDate} onChange={(e) => setLabour("entryDate", e.target.value)} className={inputCls(labourErrors.entryDate)} />
                    </Field>
                    <Field label="Shift">
                      <NativeSelect value={labourForm.shift || ""} onChange={(e) => setLabour("shift", e.target.value)} className={inputCls()}>
                        {SHIFT_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>

                  {/* ── One attendance register per activity — an Activity IS its
                       attendance, so each gets its own independent worker list
                       (no shared names across activities). ── */}
                  {selectedAllocationIds.map((allocationId) => {
                    const a = allocations.find((x) => x.id === allocationId);
                    const roster = getRoster(allocationId);
                    const pending = getPendingWorker(allocationId);
                    const present = presentCountFor(allocationId);
                    return (
                      <div key={allocationId} className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Users2 size={13} className="text-cyan-600 shrink-0" />
                            <span className="text-xs font-heading font-semibold text-foreground truncate">
                              {a ? `${a.activityName} — ${a.contractorName}` : `Allocation #${allocationId}`}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 font-mono shrink-0">
                              {present} present / {roster.length} total
                            </span>
                          </div>
                          {!labourEditingId && (
                            <button
                              type="button"
                              onClick={() => removeAllocation(allocationId)}
                              className="p-1 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
                              title="Remove this activity"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>

                        {/* Type a name, pick Skilled/Unskilled, click Add Worker (or hit Enter) */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input
                            type="text"
                            value={pending.name}
                            placeholder="Type worker's name…"
                            onChange={(e) => setPendingWorkerName(allocationId, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addWorker(allocationId);
                              }
                            }}
                            className={`${inputCls()} w-full sm:flex-1 min-w-0`}
                          />
                          <div className="flex items-center gap-2 shrink-0">
                            <NativeSelect
                              value={pending.type}
                              onChange={(e) => setPendingWorkerType(allocationId, e.target.value as RosterRow["type"])}
                              className={`${inputCls()} w-full`}
                              wrapperClassName="w-28 sm:w-32 shrink-0"
                            >
                              <option value="Skilled">Skilled</option>
                              <option value="Unskilled">Unskilled</option>
                            </NativeSelect>
                            <button
                              type="button"
                              onClick={() => addWorker(allocationId)}
                              disabled={!pending.name.trim()}
                              className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[11px] font-medium border border-cyan-500/30 text-cyan-600 hover:bg-cyan-500/10 disabled:opacity-40 shrink-0 whitespace-nowrap flex-1 sm:flex-initial"
                            >
                              <UserPlus2 size={12} /> Add Worker
                            </button>
                          </div>
                        </div>

                        {roster.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-1">No workers added yet — type a name above and click "Add Worker".</p>
                        ) : (
                          <div className="space-y-2">
                            {roster.map((r, i) => (
                              <div key={i} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 sm:p-0 rounded-lg sm:rounded-none bg-card sm:bg-transparent border border-border sm:border-0">
                                <input
                                  type="text"
                                  value={r.name}
                                  placeholder="Worker name"
                                  onChange={(e) => updateRosterRow(allocationId, i, { name: e.target.value })}
                                  className={`${inputCls()} w-full sm:flex-1 min-w-0`}
                                />
                                <div className="flex items-center gap-2">
                                  <NativeSelect
                                    value={r.type}
                                    onChange={(e) => updateRosterRow(allocationId, i, { type: e.target.value as RosterRow["type"] })}
                                    className={`${inputCls()} w-full`}
                                    wrapperClassName="flex-1 sm:flex-initial sm:w-32 min-w-0 shrink-0"
                                  >
                                    <option value="Skilled">Skilled</option>
                                    <option value="Unskilled">Unskilled</option>
                                  </NativeSelect>
                                  <button
                                    type="button"
                                    onClick={() => updateRosterRow(allocationId, i, { status: cycleStatus(r.status) })}
                                    title="Click to cycle Present → Absent → Half Day"
                                    className={`inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium border shrink-0 whitespace-nowrap w-[104px] ${STATUS_BADGE_CLS[r.status]}`}
                                  >
                                    {r.status === "P" && <CheckCircle2 size={13} />}
                                    {r.status === "A" && <XCircle size={13} />}
                                    {r.status === "H" && <CircleDashed size={13} />}
                                    {STATUS_LABEL[r.status]}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeRosterRow(allocationId, i)}
                                    className="p-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Attendance Status">
                      <NativeSelect value={labourForm.attendanceStatus || ""} onChange={(e) => setLabour("attendanceStatus", e.target.value)} className={inputCls()}>
                        {ATTENDANCE_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>

                  <Field label="Remarks">
                    <textarea value={labourForm.remarks || ""} onChange={(e) => setLabour("remarks", e.target.value)} className={inputCls()} rows={2} />
                  </Field>
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
                    {labourSaving ? "Saving…" : labourEditingId ? "Update" : "Save for This Day"}
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
                defaultPageSize={10}
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
                <NativeSelect value={approveEngineer} onChange={(e) => setApproveEngineer(e.target.value)} className={inputCls()}>
                  <option value="">Select engineer…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </NativeSelect>
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

        {/* ── View attendance register ── */}
        <Dialog open={!!printTarget} onOpenChange={(open) => !open && setPrintTarget(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">
                Attendance — {printTarget?.entryDate?.slice(0, 10)}
              </DialogTitle>
            </DialogHeader>
            {printTarget && (
              <div className="space-y-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  {printTarget.activityName || "—"} · {printTarget.contractorName || "—"}
                  {[printTarget.blockName, printTarget.unitName, printTarget.roomName, printTarget.floor ? `Floor ${printTarget.floor}` : null].filter(Boolean).length > 0 && (
                    <> — {[printTarget.blockName, printTarget.unitName, printTarget.roomName, printTarget.floor ? `Floor ${printTarget.floor}` : null].filter(Boolean).join(" / ")}</>
                  )}
                </p>
                <div className="rounded-lg border border-border divide-y divide-border max-h-80 overflow-y-auto">
                  {[...parseNames(printTarget.skilledLabourNames, "Skilled"), ...parseNames(printTarget.unskilledLabourNames, "Unskilled")].map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{r.name}</p>
                        <p className="text-[10px] text-muted-foreground">{r.type}</p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_BADGE_CLS[r.status]}`}
                      >
                        {r.status === "P" && <CheckCircle2 size={11} />}
                        {r.status === "A" && <XCircle size={11} />}
                        {r.status === "H" && <CircleDashed size={11} />}
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter>
              <button
                onClick={() => setPrintTarget(null)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted"
              >
                Close
              </button>
              <button
                onClick={() => printTarget && printAttendance(printTarget)}
                className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 text-white flex items-center gap-1.5"
              >
                <Printer size={12} /> Print
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CivilWorkDprShell>
    </>
  );
};

export default ContractorRegister;

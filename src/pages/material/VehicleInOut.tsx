import React, { useRef, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Truck,
  Plus,
  ArrowLeft,
  Hash,
  Calendar,
  Search,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Trash2,
  Building2,
  FolderOpen,
  FileText,
  Clock,
  Camera,
  Paperclip,
  RotateCcw,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Filter,
} from "lucide-react";
import * as vehApi from "@/api/vehicleInOutApi";
import type { VehicleInOutPayload } from "@/api/vehicleInOutApi";
import { usePageRights } from "@/hooks/usePageRights";

// ── Design tokens (match GRN.tsx) ─────────────────────────────────────────────
const inp =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground/50";
const inpSel =
  "w-full px-3 py-2 pr-8 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground appearance-none";

// ── Small helpers ─────────────────────────────────────────────────────────────
function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

function SectionCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card/50 p-5 space-y-4 ${className}`}
    >
      {children}
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  label,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
        <Icon size={13} className="text-primary" />
      </div>
      <div>
        <p className="text-xs font-semibold text-foreground tracking-wide">
          {label}
        </p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function InfoPill({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-muted/60 border border-border/60 min-w-0">
      <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-xs font-semibold text-foreground truncate ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Mobile card (shown < sm, replaces the DataTable on small screens) ────────
function VehicleCard({
  rec,
  onView,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: {
  rec: any;
  onView: (r: any) => void;
  onEdit: (r: any) => void;
  onDelete: (id: number) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const statusCls =
    rec.Status === "Approved"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
      : rec.Status === "Rejected"
        ? "bg-red-500/10 text-red-600 border-red-500/20"
        : "bg-amber-500/10 text-amber-600 border-amber-500/20";

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Top row: Doc No + Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold text-foreground truncate">
            {rec.DocNo || "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {rec.DocDate
              ? new Date(rec.DocDate).toLocaleDateString("en-IN")
              : "—"}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCls}`}
        >
          {rec.Status === "Approved" ? (
            <CheckCircle2 size={9} />
          ) : (
            <Clock size={9} />
          )}
          {rec.Status}
        </span>
      </div>

      {/* Vehicle No */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
        <Truck size={13} className="text-primary shrink-0" />
        <span className="font-mono text-sm font-semibold text-primary truncate">
          {rec.VehicleNo || "—"}
        </span>
      </div>

      {/* Supplier / PO / Entry / Challan grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">
            Supplier
          </p>
          <p className="truncate">{rec.SupplierName || "—"}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">
            PO No
          </p>
          <p className="font-mono truncate">{rec.PONumber || "—"}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">
            Entry Time
          </p>
          <p className="truncate">
            {rec.EntryTime
              ? new Date(rec.EntryTime).toLocaleString("en-IN", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">
            Challan No
          </p>
          <p className="truncate">{rec.ChallanNo || "—"}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 pt-2 border-t border-border/60">
        <button
          onClick={() => onView(rec)}
          className="text-muted-foreground hover:bg-muted p-2 rounded-lg transition-colors"
          title="View"
        >
          <Eye size={15} />
        </button>
        {canEdit && (
        <button
          onClick={() => onEdit(rec)}
          className="text-muted-foreground hover:bg-muted p-2 rounded-lg transition-colors"
          title="Edit"
        >
          <RefreshCw size={15} />
        </button>
        )}
        {canDelete && (
        <button
          onClick={() => onDelete(rec.VehicleInOutID)}
          className="text-destructive hover:bg-destructive/10 p-2 rounded-lg transition-colors"
          title="Delete"
        >
          <Trash2 size={15} />
        </button>
        )}
      </div>
    </div>
  );
}

// ── Local time helpers ──────────────────────────────────────────────────────────
// toISOString() always converts to UTC, which is wrong for <input type="date">
// and <input type="datetime-local">: those inputs expect/display local wall-clock
// time. Using toISOString() here made entry/exit time off by the IST offset
// (+5:30), e.g. showing 11:08 AM when the local clock read 4:38 PM.
const pad2 = (n: number) => String(n).padStart(2, "0");

const toLocalDateInput = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const toLocalDateTimeInput = (d: Date) =>
  `${toLocalDateInput(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// ── Form default ───────────────────────────────────────────────────────────────
const buildEmpty = (activeFinYear?: string) => ({
  docDate: toLocalDateInput(new Date()),
  companyId: null as number | null,
  projectId: null as number | null,
  finYear: activeFinYear || "",
  supplierId: null as number | null,
  supplierName: "",
  contactPerson: "",
  poId: null as number | null,
  poNumber: "",
  vehicleNo: "",
  entryTime: toLocalDateTimeInput(new Date()), // datetime-local
  exitTime: null as string | null,
  challanNo: "",
  attachmentPath: null as string | null,
  remarks: "",
});

// ── Module-level refs for DataTable cell closures ─────────────────────────────
let _onView: (r: any) => void = () => {};
let _onEdit: (r: any) => void = () => {};
let _onDelete: (id: number) => void = () => {};
let _canEdit = true;
let _canDelete = true;

// ── List columns ──────────────────────────────────────────────────────────────
const COLUMNS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs font-bold">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "DocDate",
    header: "Doc Date",
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {v ? new Date(v).toLocaleDateString("en-IN") : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "VehicleNo",
    header: "Vehicle No",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs font-semibold text-primary">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "SupplierName",
    header: "Supplier",
    cell: ({ getValue }) => (
      <span className="text-xs">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    accessorKey: "PONumber",
    header: "PO No",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    accessorKey: "EntryTime",
    header: "Entry Time",
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {v
            ? new Date(v).toLocaleString("en-IN", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "ChallanNo",
    header: "Challan No",
    cell: ({ getValue }) => (
      <span className="text-xs">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }) => {
      const s = getValue() as string;
      const cls =
        s === "Approved"
          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
          : s === "Rejected"
            ? "bg-red-500/10 text-red-600 border-red-500/20"
            : "bg-amber-500/10 text-amber-600 border-amber-500/20";
      return (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}
        >
          {s === "Approved" ? <CheckCircle2 size={9} /> : <Clock size={9} />}
          {s}
        </span>
      );
    },
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    cell: ({ row }) => {
      const rec = row.original;
      return (
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => _onView(rec)}
            className="text-muted-foreground hover:bg-muted p-2 rounded-lg transition-colors"
            title="View"
          >
            <Eye size={15} />
          </button>
          {_canEdit && (
          <button
            onClick={() => _onEdit(rec)}
            className="text-muted-foreground hover:bg-muted p-2 rounded-lg transition-colors"
            title="Edit"
          >
            <RefreshCw size={15} />
          </button>
          )}
          {_canDelete && (
          <button
            onClick={() => _onDelete(rec.VehicleInOutID)}
            className="text-destructive hover:bg-destructive/10 p-2 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
          )}
        </div>
      );
    },
  },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function VehicleInOut() {
  const rights = usePageRights("vehicle-in-out");
  _canEdit = rights.canEdit;
  _canDelete = rights.canDelete;
  const qc = useQueryClient();
  const { finYears } = useFinYear();

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year ||
    [...finYears].sort((a, b) => b.year.localeCompare(a.year))[0]?.year ||
    "";

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRec, setViewingRec] = useState<any | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filterFY, setFilterFY] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState(buildEmpty(activeFinYear));
  const pf = (patch: Partial<typeof form>) =>
    setForm((p) => ({ ...p, ...patch }));

  // ── Queries ──────────────────────────────────────────────────────────────────
  const {
    data: listPage,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["vehicle-in-out", page, filterFY],
    queryFn: () =>
      vehApi.getVehicleInOuts({
        page,
        limit: 15,
        finYear: filterFY || undefined,
      }),
    placeholderData: (prev) => prev,
  });
  const records = listPage?.data ?? [];
  const totalPages = listPage?.totalPages ?? 1;
  const total = listPage?.total ?? 0;

  const { data: docNoPreview, isFetching: loadingPreview } = useQuery({
    queryKey: ["vehicle-in-out", "next-number"],
    queryFn: vehApi.previewNextVEHNumber,
    enabled: !editingId,
    staleTime: 15_000,
  });

  // Companies from enterprise
  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-companies"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=C").then((r) =>
        r.json(),
      ),
    staleTime: 300_000,
  });

  // Projects from enterprise
  const { data: projects = [] } = useQuery({
    queryKey: ["enterprise-projects"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=P").then((r) =>
        r.json(),
      ),
    staleTime: 300_000,
  });

  // Suppliers from AccountHeadMaster
  const { data: suppliers = [] } = useQuery({
    queryKey: ["account-head-suppliers-v2"],
    queryFn: () =>
      fetchWithAuth("/api/account-head/options?type=S").then((r) => r.json()),
    staleTime: 300_000,
  });

  // Purchase orders (all — filtered client-side by supplierId)
  const { data: allPOs = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () =>
      fetchWithAuth("/api/purchase-orders?limit=500")
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : (d.data ?? []))),
    staleTime: 120_000,
  });

  // POs filtered to the selected supplier
  const filteredPOs = useMemo(() => {
    if (!form.supplierId) return [];
    return (allPOs as any[]).filter(
      (po: any) =>
        String(po.SupplierID) === String(form.supplierId) &&
        (po.Status === "Approved" ||
          po.Status === "Pending" ||
          po.Status === "Received"),
    );
  }, [allPOs, form.supplierId]);

  const filteredProjects = useMemo(() => {
    if (!form.companyId) return projects as any[];
    return (projects as any[]).filter(
      (p: any) =>
        p.company_id != null && String(p.company_id) === String(form.companyId),
    );
  }, [projects, form.companyId]);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (p: VehicleInOutPayload) => vehApi.createVehicleInOut(p),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["vehicle-in-out"] });
      setPage(1);
      setShowForm(false);
      setEditingId(null);
      setErrors({});
      setForm(buildEmpty(activeFinYear));
      toast.success(`Vehicle In/Out ${res.docNo} created`);
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to create record"),
  });

  const updateMut = useMutation({
    mutationFn: (p: VehicleInOutPayload) =>
      vehApi.updateVehicleInOut(editingId!, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-in-out"] });
      setPage(1);
      setShowForm(false);
      setEditingId(null);
      setErrors({});
      setForm(buildEmpty(activeFinYear));
      toast.success("Record updated");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => vehApi.deleteVehicleInOut(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-in-out"] });
      setPage(1);
      toast.success("Record deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete"),
  });

  // ── Validate ──────────────────────────────────────────────────────────────────
  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.vehicleNo.trim()) errs.vehicleNo = "Vehicle number is required";
    if (!form.entryTime) errs.entryTime = "Entry time is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const buildPayload = (): VehicleInOutPayload => ({
    docDate: form.docDate,
    companyId: form.companyId,
    projectId: form.projectId,
    finYear: form.finYear || null,
    supplierId: form.supplierId,
    supplierName: form.supplierName,
    poId: form.poId,
    poNumber: form.poNumber,
    vehicleNo: form.vehicleNo.trim().toUpperCase(),
    entryTime: form.entryTime,
    exitTime: form.exitTime || null,
    challanNo: form.challanNo,
    attachmentPath: form.attachmentPath,
    remarks: form.remarks,
  });

  const onSubmit = () => {
    if (!validate()) {
      toast.error("Please fix the errors");
      return;
    }
    if (editingId) updateMut.mutate(buildPayload());
    else createMut.mutate(buildPayload());
  };

  const resetForm = () => {
    setForm(buildEmpty(activeFinYear));
    setEditingId(null);
    setShowForm(false);
    setErrors({});
  };

  // ── View / Edit ───────────────────────────────────────────────────────────────
  _onView = async (rec: any) => {
    try {
      const full = await vehApi.getVehicleInOut(rec.VehicleInOutID);
      setViewingRec(full);
    } catch {
      setViewingRec(rec);
    }
  };

  _onEdit = (rec: any) => {
    setForm({
      docDate: rec.DocDate ? String(rec.DocDate).slice(0, 10) : "",
      companyId: rec.CompanyID ?? null,
      projectId: rec.ProjectID ?? null,
      finYear: rec.FinYear ?? "",
      supplierId: rec.SupplierID ?? null,
      supplierName: rec.SupplierName ?? "",
      contactPerson:
        (suppliers as any[]).find((s: any) => Number(s.id) === rec.SupplierID)
          ?.contactPerson ?? "",
      poId: rec.POID ?? null,
      poNumber: rec.PONumber ?? "",
      vehicleNo: rec.VehicleNo ?? "",
      entryTime: rec.EntryTime
        ? toLocalDateTimeInput(new Date(rec.EntryTime))
        : "",
      exitTime: rec.ExitTime
        ? toLocalDateTimeInput(new Date(rec.ExitTime))
        : null,
      challanNo: rec.ChallanNo ?? "",
      attachmentPath: rec.AttachmentPath ?? null,
      remarks: rec.Remarks ?? "",
    });
    setEditingId(rec.VehicleInOutID);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  _onDelete = (id: number) => setDeleteId(id);

  // ── File upload ───────────────────────────────────────────────────────────────
  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await vehApi.uploadVehicleAttachment(file);
      pf({ attachmentPath: result.path });
      toast.success("Attachment uploaded");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filteredRecords = records.filter((r: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.DocNo?.toLowerCase().includes(q) ||
      r.VehicleNo?.toLowerCase().includes(q) ||
      r.ChallanNo?.toLowerCase().includes(q) ||
      r.SupplierName?.toLowerCase().includes(q) ||
      r.PONumber?.toLowerCase().includes(q)
    );
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2.5 mt-8 text-muted-foreground text-sm">
        <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        Loading Vehicle In/Out…
      </div>
    );
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Vehicle In/Out"]} />
      <MaterialShell
        title="Vehicle In/Out"
        subtitle="Track vehicle entry and exit against purchase orders"
        icon={Truck}
        action={
          !showForm && rights.canCreate ? (
            <button
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
                setForm(buildEmpty(activeFinYear));
                setErrors({});
              }}
              className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 inline-flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition"
            >
              <Plus size={13} /> New Entry
            </button>
          ) : undefined
        }
      >
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* FORM                                                                */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {showForm && (
          <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
            {/* Form header */}
            <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 bg-emerald-500/[0.06] border-b border-emerald-500/20">
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </button>
                <span className="text-emerald-500/40">|</span>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
                    <Truck size={12} className="text-emerald-400" />
                  </div>
                  <h2 className="text-sm font-heading font-bold text-foreground truncate">
                    {editingId ? "Edit Vehicle In/Out" : "New Vehicle In/Out"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* ── Section 1: Document Info ── */}
              <SectionCard>
                <SectionTitle
                  icon={FileText}
                  label="Document Details"
                  sub="Basic document information"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Company */}
                  <div>
                    <FieldLabel>
                      <span className="inline-flex items-center gap-1">
                        <Building2 size={9} />
                        Company
                      </span>
                    </FieldLabel>
                    <div className="relative">
                      <select
                        value={form.companyId ?? ""}
                        onChange={(e) =>
                          pf({
                            companyId: e.target.value
                              ? Number(e.target.value)
                              : null,
                            projectId: null,
                          })
                        }
                        className={inpSel}
                      >
                        <option value="">Select Company…</option>
                        {(companies as any[]).map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Project */}
                  <div>
                    <FieldLabel>
                      <span className="inline-flex items-center gap-1">
                        <FolderOpen size={9} />
                        Project
                      </span>
                    </FieldLabel>
                    <div className="relative">
                      <select
                        value={form.projectId ?? ""}
                        onChange={(e) =>
                          pf({
                            projectId: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        className={inpSel}
                      >
                        <option value="">Select Project…</option>
                        {filteredProjects.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Doc Date */}
                  <div>
                    <FieldLabel required>Doc Date</FieldLabel>
                    <div className="relative">
                      <Calendar
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                      <input
                        type="date"
                        value={form.docDate}
                        onChange={(e) => pf({ docDate: e.target.value })}
                        className={`${inp} pl-9 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
                      />
                    </div>
                  </div>

                  {/* Fin Year */}
                  <div>
                    <FieldLabel>Financial Year</FieldLabel>
                    <div className="relative">
                      <select
                        value={form.finYear}
                        onChange={(e) => pf({ finYear: e.target.value })}
                        className={inpSel}
                      >
                        <option value="">Select FY…</option>
                        {finYears
                          .filter((fy) => !fy.locked)
                          .sort((a, b) => b.year.localeCompare(a.year))
                          .map((fy) => (
                            <option key={fy.id} value={fy.year}>
                              {fy.year}
                            </option>
                          ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Doc Number preview */}
                  <div>
                    <FieldLabel>Doc Number</FieldLabel>
                    <div className="flex items-center gap-2 px-3 h-[38px] rounded-lg bg-muted/40 border border-dashed border-border">
                      <Hash
                        size={13}
                        className="text-muted-foreground shrink-0"
                      />
                      {editingId ? (
                        <span className="font-mono text-sm text-primary font-semibold">
                          —
                        </span>
                      ) : docNoPreview?.nextDocNo ? (
                        <span className="font-mono text-sm text-primary font-semibold">
                          {docNoPreview.nextDocNo}
                        </span>
                      ) : loadingPreview ? (
                        <span className="text-sm text-muted-foreground/60 animate-pulse">
                          Generating…
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground/40 italic">
                          Auto-generated on save
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Remarks */}
                  <div className="sm:col-span-3">
                    <FieldLabel>Remarks</FieldLabel>
                    <input
                      type="text"
                      value={form.remarks}
                      onChange={(e) => pf({ remarks: e.target.value })}
                      className={inp}
                      placeholder="Optional notes…"
                    />
                  </div>
                </div>
              </SectionCard>

              {/* ── Section 2: Supplier & PO ── */}
              <SectionCard>
                <SectionTitle
                  icon={Filter}
                  label="Supplier & Purchase Order"
                  sub="Select supplier then filter linked POs"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Supplier */}
                  <div>
                    <FieldLabel>Supplier</FieldLabel>
                    <div className="relative">
                      <select
                        value={form.supplierId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value
                            ? Number(e.target.value)
                            : null;
                          const sup = (suppliers as any[]).find(
                            (s: any) => Number(s.id) === id,
                          );
                          pf({
                            supplierId: id,
                            supplierName: sup?.label ?? "",
                            contactPerson: sup?.contactPerson ?? "",
                            poId: null,
                            poNumber: "",
                          });
                        }}
                        className={inpSel}
                      >
                        <option value="">Select Supplier…</option>
                        {(suppliers as any[]).map((s: any) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* PO */}
                  <div>
                    <FieldLabel>Purchase Order</FieldLabel>
                    <div className="relative">
                      <select
                        value={form.poId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value
                            ? Number(e.target.value)
                            : null;
                          const po = filteredPOs.find(
                            (p: any) => p.PurchaseOrderID === id,
                          );
                          pf({
                            poId: id,
                            poNumber: po?.DocNo || po?.PurchaseOrderNo || "",
                          });
                        }}
                        disabled={!form.supplierId}
                        className={`${inpSel} ${!form.supplierId ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <option value="">
                          {!form.supplierId
                            ? "Select a supplier first"
                            : filteredPOs.length === 0
                              ? "No POs for this supplier"
                              : "Select PO…"}
                        </option>
                        {filteredPOs.map((po: any) => (
                          <option
                            key={po.PurchaseOrderID}
                            value={po.PurchaseOrderID}
                          >
                            {po.DocNo || po.PurchaseOrderNo}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>
                </div>

                {form.supplierName && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                    <InfoPill label="Supplier" value={form.supplierName} />
                    {form.contactPerson && (
                      <InfoPill
                        label="Contact Person"
                        value={form.contactPerson}
                      />
                    )}
                    {form.poNumber && (
                      <InfoPill label="PO No" value={form.poNumber} mono />
                    )}
                  </div>
                )}
              </SectionCard>

              {/* ── Section 3: Vehicle Details ── */}
              <SectionCard>
                <SectionTitle
                  icon={Truck}
                  label="Vehicle Details"
                  sub="Vehicle number, entry/exit times, challan"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Vehicle No */}
                  <div>
                    <FieldLabel required>Vehicle Number</FieldLabel>
                    <input
                      type="text"
                      value={form.vehicleNo}
                      onChange={(e) =>
                        pf({ vehicleNo: e.target.value.toUpperCase() })
                      }
                      className={`${inp} font-mono uppercase ${errors.vehicleNo ? "border-destructive ring-1 ring-destructive" : ""}`}
                      placeholder="e.g. WB-01-AB-1234"
                    />
                    {errors.vehicleNo && (
                      <p className="text-destructive text-[11px] mt-1 flex items-center gap-1">
                        <AlertCircle size={10} />
                        {errors.vehicleNo}
                      </p>
                    )}
                  </div>

                  {/* Entry Time */}
                  <div>
                    <FieldLabel required>Entry Time</FieldLabel>
                    <div className="relative">
                      <Clock
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                      <input
                        type="datetime-local"
                        value={form.entryTime}
                        onChange={(e) => pf({ entryTime: e.target.value })}
                        className={`${inp} pl-9 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${errors.entryTime ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                    </div>
                    {errors.entryTime && (
                      <p className="text-destructive text-[11px] mt-1 flex items-center gap-1">
                        <AlertCircle size={10} />
                        {errors.entryTime}
                      </p>
                    )}
                  </div>

                  {/* Exit Time */}
                  <div>
                    <FieldLabel>Exit Time</FieldLabel>
                    <div className="relative">
                      <Clock
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                      <input
                        type="datetime-local"
                        value={form.exitTime ?? ""}
                        onChange={(e) =>
                          pf({ exitTime: e.target.value || null })
                        }
                        className={`${inp} pl-9 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Leave blank if vehicle hasn't exited yet
                    </p>
                  </div>

                  {/* Supplier Ref / Challan No */}
                  <div>
                    <FieldLabel>Supplier Ref / Challan No</FieldLabel>
                    <input
                      type="text"
                      value={form.challanNo}
                      onChange={(e) => pf({ challanNo: e.target.value })}
                      className={inp}
                      placeholder="e.g. CH-20240601-001"
                    />
                  </div>

                  {/* Attachment / Camera */}
                  <div className="sm:col-span-2">
                    <FieldLabel>Attachment / Car Plate Photo</FieldLabel>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* File pick */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        <Paperclip size={12} />
                        {uploading ? "Uploading…" : "Attach File"}
                      </button>

                      {/* Camera capture */}
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={uploading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        <Camera size={12} /> Camera
                      </button>

                      {/* Preview */}
                      {form.attachmentPath && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 size={11} />
                          <a
                            href={form.attachmentPath}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2 truncate max-w-[180px]"
                          >
                            {form.attachmentPath.split("/").pop()}
                          </a>
                          <button
                            type="button"
                            onClick={() => pf({ attachmentPath: null })}
                            className="ml-1 text-destructive hover:opacity-80"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* ── Actions ── */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-border">
                <button
                  onClick={() => {
                    setForm(buildEmpty(activeFinYear));
                    setEditingId(null);
                    setErrors({});
                  }}
                  disabled={createMut.isPending || updateMut.isPending}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-muted text-sm transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={14} /> Reset
                </button>
                <button
                  onClick={onSubmit}
                  disabled={
                    createMut.isPending || updateMut.isPending || uploading
                  }
                  className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold shadow-sm transition disabled:opacity-60"
                >
                  {createMut.isPending || updateMut.isPending ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {createMut.isPending || updateMut.isPending
                    ? "Saving…"
                    : editingId
                      ? "Update"
                      : "Save Entry"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* LIST                                                                */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Vehicle In/Out Register
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {total} record{total !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* FY filter */}
                  <div className="relative">
                    <select
                      value={filterFY}
                      onChange={(e) => {
                        setFilterFY(e.target.value);
                        setPage(1);
                      }}
                      className="pl-3 pr-8 py-2 rounded-lg text-xs bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground appearance-none"
                    >
                      <option value="">All Years</option>
                      {finYears
                        .sort((a, b) => b.year.localeCompare(a.year))
                        .map((fy) => (
                          <option key={fy.id} value={fy.year}>
                            {fy.year}
                          </option>
                        ))}
                    </select>
                    <ChevronDown
                      size={11}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {/* Search */}
                  <div className="relative w-full sm:w-60">
                    <Search
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <Input
                      placeholder="Search doc, vehicle, challan…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Mobile: stacked cards (table is hard to use on phones) */}
            <div
              className={`sm:hidden p-3 space-y-3 transition-opacity duration-200 ${isFetching ? "opacity-60 pointer-events-none" : ""}`}
            >
              {filteredRecords.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-10">
                  No Vehicle In/Out records. Click 'New Entry' to create one.
                </p>
              ) : (
                filteredRecords.map((rec: any) => (
                  <VehicleCard
                    key={rec.VehicleInOutID}
                    rec={rec}
                    onView={_onView}
                    onEdit={_onEdit}
                    onDelete={_onDelete}
                    canEdit={rights.canEdit}
                    canDelete={rights.canDelete}
                  />
                ))
              )}
            </div>

            {/* Desktop / tablet: full table */}
            <div
              className={`hidden sm:block overflow-x-auto transition-opacity duration-200 ${isFetching ? "opacity-60 pointer-events-none" : ""}`}
            >
              <DataTable
                data={filteredRecords}
                columns={COLUMNS}
                searchable={false}
                paginated={false}
                emptyMessage="No Vehicle In/Out records. Click 'New Entry' to create one."
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages} · {total} record
                {total !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft size={12} /> Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  Next <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* VIEW MODAL                                                          */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {viewingRec && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto">
              {/* Modal header */}
              <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <h2 className="font-heading font-bold text-base">
                    {viewingRec.DocNo || "Vehicle In/Out"}
                  </h2>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                    Vehicle In/Out Entry
                  </p>
                </div>
                <button
                  onClick={() => setViewingRec(null)}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 sm:p-6 space-y-5">
                {/* Meta grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    {
                      label: "Doc No",
                      value: viewingRec.DocNo || "—",
                      mono: true,
                    },
                    {
                      label: "Doc Date",
                      value: viewingRec.DocDate
                        ? new Date(viewingRec.DocDate).toLocaleDateString(
                            "en-IN",
                          )
                        : "—",
                    },
                    { label: "Fin Year", value: viewingRec.FinYear || "—" },
                    { label: "Company", value: viewingRec.CompanyName || "—" },
                    { label: "Project", value: viewingRec.ProjectName || "—" },
                    {
                      label: "Supplier",
                      value: viewingRec.SupplierName || "—",
                    },
                    {
                      label: "PO No",
                      value: viewingRec.PONumber || "—",
                      mono: true,
                    },
                    {
                      label: "Vehicle No",
                      value: viewingRec.VehicleNo || "—",
                      mono: true,
                    },
                    { label: "Challan No", value: viewingRec.ChallanNo || "—" },
                  ].map(({ label, value, mono }: any) => (
                    <div
                      key={label}
                      className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50"
                    >
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                        {label}
                      </p>
                      <p
                        className={`text-xs font-semibold ${mono ? "font-mono" : ""} text-foreground`}
                      >
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Times */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="px-3 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                      Entry Time
                    </p>
                    <p className="text-xs font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                      {viewingRec.EntryTime
                        ? new Date(viewingRec.EntryTime).toLocaleString("en-IN")
                        : "—"}
                    </p>
                  </div>
                  <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                      Exit Time
                    </p>
                    <p className="text-xs font-semibold font-mono text-foreground">
                      {viewingRec.ExitTime
                        ? new Date(viewingRec.ExitTime).toLocaleString("en-IN")
                        : "Not yet exited"}
                    </p>
                  </div>
                </div>

                {/* Attachment */}
                {viewingRec.AttachmentPath && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
                      Attachment
                    </p>
                    <a
                      href={viewingRec.AttachmentPath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/5 border border-primary/20 text-sm text-primary font-medium hover:bg-primary/10 transition-colors"
                    >
                      <Paperclip size={13} />
                      {viewingRec.AttachmentPath.split("/").pop()}
                    </a>
                  </div>
                )}

                {/* Remarks */}
                {viewingRec.Remarks && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
                      Remarks
                    </p>
                    <p className="text-sm text-foreground bg-muted/40 rounded-xl px-4 py-3 border border-border/50">
                      {viewingRec.Remarks}
                    </p>
                  </div>
                )}

                {/* Edit button */}
                <div className="flex justify-end pt-2 border-t border-border">
                  {rights.canEdit && (
                  <button
                    onClick={() => {
                      setViewingRec(null);
                      _onEdit(viewingRec);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-muted border border-border text-sm font-medium hover:bg-muted/80 transition-colors"
                  >
                    <RefreshCw size={13} /> Edit
                  </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </MaterialShell>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Vehicle In/Out Entry?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteId) {
                  deleteMut.mutate(deleteId);
                  setDeleteId(null);
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

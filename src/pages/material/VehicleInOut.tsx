import React, { useRef, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Webcam from "react-webcam";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { parseJsonArray } from "@/utils/parseJsonArray";
import { useAuth } from "@/contexts/AuthContext";
import { OrderChat } from "@/components/orders/OrderChat";
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
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import {
  Truck,
  Plus,
  ArrowLeft,
  Hash,
  Calendar,
  Search,
  X,
  XCircle,
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
  Check,
  CheckCircle2,
  Filter,
  SwitchCamera,
  Image as ImageIcon,
  Edit3,
  Download,
  Upload,
  Loader2,
  Package,
  MessageCircle,
} from "lucide-react";
import { exportToCsv, parseCsv } from "@/lib/export";
import * as vehApi from "@/api/vehicleInOutApi";
import type { VehicleInOutPayload } from "@/api/vehicleInOutApi";
import { usePageRights } from "@/hooks/usePageRights";

// ─── Template columns ─────────────────────────────────────────────────────────
const VEH_TEMPLATE_COLUMNS = [
  { header: "Vehicle Number", accessor: "Vehicle Number" },
  { header: "Driver Name", accessor: "Driver Name" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "Entry Type (In/Out)", accessor: "Entry Type (In/Out)" },
  { header: "Purpose", accessor: "Purpose" },
  { header: "Date (YYYY-MM-DD)", accessor: "Date (YYYY-MM-DD)" },
  { header: "Remarks", accessor: "Remarks" },
];

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

// ── Auth-gated attachment blob cache ──────────────────────────────────────────
// Attachments now stream from the DB via an authenticated endpoint
// (/api/vehicle-in-out/attachment/:id), so a plain <img src="..."> or
// <a href="..."> can't load them — the browser won't attach the bearer
// token. Fetch via fetchWithAuth(), convert to an object URL, and cache it
// so each attachment is only fetched once per page session.
const vehAttachmentBlobCache = new Map<string, string>();
let vehAttachmentCleanupRegistered = false;
const registerVehAttachmentCleanup = () => {
  if (vehAttachmentCleanupRegistered || typeof window === "undefined") return;
  vehAttachmentCleanupRegistered = true;
  window.addEventListener("pagehide", () => {
    vehAttachmentBlobCache.forEach((u) => URL.revokeObjectURL(u));
    vehAttachmentBlobCache.clear();
  });
};

/** Thumbnail/link for one attachment — resolves its authenticated blob URL
 *  before rendering an <img> (for images) or a download link (for PDFs etc). */
function AttachmentThumb({
  attachment,
  onRemove,
}: {
  attachment: vehApi.VehicleAttachment;
  onRemove?: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(
    vehAttachmentBlobCache.get(attachment.url) ?? null,
  );
  const [failed, setFailed] = useState(false);
  const isImage = attachment.mimeType?.startsWith("image/");

  React.useEffect(() => {
    if (blobUrl || !isImage) return;
    let alive = true;
    fetchWithAuth(attachment.url)
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.blob();
      })
      .then((blob) => {
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        vehAttachmentBlobCache.set(attachment.url, url);
        registerVehAttachmentCleanup();
        setBlobUrl(url);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attachment.url, blobUrl, isImage]);

  // Open (and cache) the full file in a new tab on click — works for both
  // images and PDFs, using the same authenticated-fetch + blob-URL approach.
  const openFile = async () => {
    try {
      let url = vehAttachmentBlobCache.get(attachment.url);
      if (!url) {
        const res = await fetchWithAuth(attachment.url);
        if (!res.ok) throw new Error("fetch failed");
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        vehAttachmentBlobCache.set(attachment.url, url);
        registerVehAttachmentCleanup();
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to open attachment");
    }
  };

  return (
    <div className="relative inline-flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400">
      {isImage && blobUrl && !failed ? (
        <button type="button" onClick={openFile}>
          <img
            src={blobUrl}
            alt={attachment.filename}
            className="h-8 w-8 rounded object-cover border border-emerald-500/30"
          />
        </button>
      ) : (
        <FileText size={13} />
      )}
      <button
        type="button"
        onClick={openFile}
        className="underline underline-offset-2 truncate max-w-[140px] text-left"
      >
        {attachment.filename}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-destructive hover:opacity-80"
        >
          <X size={11} />
        </button>
      )}
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
        <div className="shrink-0">
          <ApprovalStatusChain
            table="VehicleInOut"
            recordId={rec.VehicleInOutID}
          />
        </div>
      </div>

      {/* Attachment count */}
      {Number(rec.AttachmentCount) > 0 && (
        <div className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Paperclip size={10} />
          {rec.AttachmentCount} attachment{rec.AttachmentCount > 1 ? "s" : ""}
        </div>
      )}

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
            <Edit3 size={15} />
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
  docNo: "",
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
  attachments: [] as vehApi.VehicleAttachment[],
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
    id: "DocInfo",
    header: "Doc No",
    size: 130,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs font-bold">{row.original.DocNo || "—"}</span>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {row.original.DocDate ? new Date(row.original.DocDate).toLocaleDateString("en-IN") : ""}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "VehicleNo",
    header: "Vehicle No",
    size: 110,
    meta: { className: "hidden sm:table-cell" },
    cell: ({ getValue }) => (
      <span className="font-mono text-xs font-semibold text-primary">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "SupplierName",
    header: "Supplier",
    size: 160,
    meta: { className: "hidden sm:table-cell" },
    cell: ({ getValue }) => (
      <span className="text-xs truncate block">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    accessorKey: "PONumber",
    header: "PO No",
    size: 110,
    meta: { className: "hidden sm:table-cell" },
    cell: ({ getValue }) => (
      <span className="font-mono text-xs">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "CompanyProject",
    header: "Company / Project",
    size: 150,
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs truncate block">{row.original.CompanyName || "—"}</span>
        <span className="text-[10px] text-muted-foreground truncate block">
          {row.original.ProjectName || "—"}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "EntryTime",
    header: "Entry Time",
    size: 130,
    meta: { className: "hidden sm:table-cell" },
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
    size: 130,
    meta: { className: "hidden sm:table-cell" },
    cell: ({ getValue }) => (
      <span className="text-xs font-mono">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    size: 170,
    meta: { className: "hidden sm:table-cell" },
    enableSorting: false,
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <ApprovalStatusChain
          table="VehicleInOut"
          recordId={row.original.VehicleInOutID}
        />
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <div className="text-right">ACTIONS</div>,
    enableSorting: false,
    cell: ({ row }) => {
      const rec = row.original;
      return (
        <div className="flex items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => _onView(rec)}
              className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
              title="View details"
            >
              <Eye size={15} />
            </button>
            {_canEdit && (
              <button
                onClick={() => _onEdit(rec)}
                className="p-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors"
                title="Edit this entry"
              >
                <Edit3 size={15} />
              </button>
            )}
            {_canDelete && (
              <button
                onClick={() => _onDelete(rec.VehicleInOutID)}
                className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete this entry"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
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
  const { currentUser } = useAuth();

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year ||
    [...finYears].sort((a, b) => b.year.localeCompare(a.year))[0]?.year ||
    "";

  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRec, setViewingRec] = useState<any | null>(null);
  const [viewTab, setViewTab] = useState<"details" | "supplier">("details");
  const [showPODetails, setShowPODetails] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filterFY, setFilterFY] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">(
    "environment",
  );
  const webcamRef = useRef<Webcam>(null);

  // Received qty entered in THIS lot, keyed by PO line item id. Reset when
  // the PO changes; prefilled from the record's own saved items on edit.
  const [receivedQtyByItem, setReceivedQtyByItem] = useState<Record<number, string>>({});

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
        r.json().catch(() => ({})),
      ),
    staleTime: 300_000,
  });

  // Projects from enterprise
  const { data: projects = [] } = useQuery({
    queryKey: ["enterprise-projects"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=P").then((r) =>
        r.json().catch(() => ({})),
      ),
    staleTime: 300_000,
  });

  // Suppliers from AccountHeadMaster
  const { data: suppliers = [] } = useQuery({
    queryKey: ["account-head-suppliers-v2"],
    queryFn: () =>
      fetchWithAuth("/api/account-head/options?type=S").then((r) => r.json().catch(() => ({}))),
    staleTime: 300_000,
  });

  // Purchase orders (all — filtered client-side by supplierId)
  const { data: allPOs = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () =>
      fetchWithAuth("/api/purchase-orders?limit=500")
        .then((r) => r.json().catch(() => ({})))
        .then((d) => (Array.isArray(d) ? d : (d.data ?? []))),
    staleTime: 120_000,
  });

  const { data: viewingPODetail, isFetching: loadingPODetail } = useQuery({
    queryKey: ["veh-po-preview", viewingRec?.VehicleInOutID],
    queryFn: () =>
      fetchWithAuth(`/api/vehicle-in-out/${viewingRec!.VehicleInOutID}/po`)
        .then((r) => { if (!r.ok) throw new Error("No PO"); return r.json().catch(() => ({})); }),
    enabled: !!viewingRec?.VehicleInOutID && showPODetails,
    staleTime: 300_000,
    retry: false,
  });

  // Selectable POs — status-filtered only, not supplier-filtered, since PO
  // is now picked first and drives the supplier (not the other way round).
  const filteredPOs = useMemo(() => {
    return (allPOs as any[]).filter(
      (po: any) =>
        po.Status === "Approved" ||
        po.Status === "Pending" ||
        po.Status === "Received",
    );
  }, [allPOs]);

  // Live PO line items + how much is already received across other lots
  // (excludes this record's own rows when editing, via editingId) — the
  // read side of the "10 + 20 + 70 of 100" flow. Queried straight from
  // dbo.PurchaseOrderItems rather than the cached PO list's denormalized
  // POItems JSON blob, since that blob has no stable id to key qty inputs.
  const { data: poItemsRemaining = [], isFetching: loadingPOItems } = useQuery({
    queryKey: ["veh-po-items-remaining", form.poId, editingId],
    queryFn: () => vehApi.getPOItemsRemaining(form.poId!, editingId ?? undefined),
    enabled: !!form.poId,
    staleTime: 0,
  });

  const filteredProjects = useMemo(() => {
    if (!form.companyId) return projects as any[];
    return (projects as any[]).filter(
      (p: any) =>
        p.company_id != null && String(p.company_id) === String(form.companyId),
    );
  }, [projects, form.companyId]);

  // ── Deep links from the "Pending Vehicle In/Out" widget ────────────────────
  // ?view=<id>      — open a previously logged lot in the view modal.
  // ?newForPO=<id>  — open the create form pre-filled for a PO that still
  //                   has goods outstanding (mirrors the PO <select>'s own
  //                   onChange below, so company/project/supplier match).
  const [searchParams, setSearchParams] = useSearchParams();
  React.useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    _onView({ VehicleInOutID: Number(viewId) });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("view");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  React.useEffect(() => {
    const poIdParam = searchParams.get("newForPO");
    if (!poIdParam || allPOs.length === 0) return;
    const id = Number(poIdParam);
    const po = (allPOs as any[]).find((p: any) => p.PurchaseOrderID === id);
    setShowForm(true);
    setEditingId(null);
    setForm({
      ...buildEmpty(activeFinYear),
      poId: id,
      poNumber: po?.DocNo || po?.PurchaseOrderNo || "",
      supplierId: po?.SupplierID ?? null,
      supplierName: po?.SupplierName ?? "",
      companyId: po?.CompanyId ?? null,
      projectId: po?.ProjectId ?? null,
    });
    setReceivedQtyByItem({});
    setErrors({});
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("newForPO");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, allPOs]);

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
      setReceivedQtyByItem({});
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
      setReceivedQtyByItem({});
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

  // Received-qty entries as a payload array — only lines with a positive
  // quantity are sent (an empty/zero input just means "not delivered in
  // this lot").
  const itemsPayload = useMemo(
    () =>
      Object.entries(receivedQtyByItem)
        .map(([poItemId, raw]) => ({
          poItemId: Number(poItemId),
          receivedQty: parseFloat(raw) || 0,
        }))
        .filter((it) => it.receivedQty > 0),
    [receivedQtyByItem],
  );

  // ── Validate ──────────────────────────────────────────────────────────────────
  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.companyId) errs.companyId = "Company is required";
    if (!form.projectId) errs.projectId = "Project is required";
    if (!form.vehicleNo.trim()) errs.vehicleNo = "Vehicle number is required";
    if (!form.entryTime) errs.entryTime = "Entry time is required";

    // Mirror the backend's cap client-side so the user gets an inline
    // error instead of a round-trip failure — "don't let me save 1000
    // when I ordered 100".
    for (const it of itemsPayload) {
      const po = poItemsRemaining.find((p) => p.poItemId === it.poItemId);
      if (po && it.receivedQty > po.remainingQty + 1e-6) {
        errs.items = `${po.itemName || "An item"}: cannot receive ${it.receivedQty} — only ${po.remainingQty} remaining on the PO.`;
        break;
      }
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error(
        errs.items || errs.companyId || errs.projectId || "Please fix the errors",
      );
      return false;
    }
    return true;
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
    // Backend links any of these ids that are still unlinked (newly
    // uploaded during this session); already-linked ids are a harmless
    // no-op, so it's safe to always send the full current list.
    attachmentIds: form.attachments.map((a) => a.id),
    remarks: form.remarks,
    items: itemsPayload,
  });

  const onSubmit = () => {
    if (!validate()) return;
    if (editingId) updateMut.mutate(buildPayload());
    else createMut.mutate(buildPayload());
  };

  const resetForm = () => {
    setForm(buildEmpty(activeFinYear));
    setReceivedQtyByItem({});
    setEditingId(null);
    setShowForm(false);
    setErrors({});
  };

  // ── View / Edit ───────────────────────────────────────────────────────────────
  _onView = async (rec: any) => {
    setShowPODetails(false);
    setViewTab("details");
    try {
      const full = await vehApi.getVehicleInOut(rec.VehicleInOutID);
      setViewingRec(full);
    } catch {
      setViewingRec(rec);
    }
  };

  _onEdit = async (rec: any) => {
    // List rows only carry AttachmentCount (cheap query) and never carry
    // Items at all — fetch the full record so we have both the actual
    // Attachments[] (id/filename/url) and Items[] (received qty per PO
    // line item) to edit.
    let full = rec;
    if (!Array.isArray(rec.Attachments) || !Array.isArray(rec.Items)) {
      try {
        full = await vehApi.getVehicleInOut(rec.VehicleInOutID);
      } catch {
        toast.error("Failed to load record details");
      }
    }
    setReceivedQtyByItem(
      Array.isArray(full.Items)
        ? Object.fromEntries(
            full.Items.map((it: any) => [it.POItemId, String(it.ReceivedQty)]),
          )
        : {},
    );
    setForm({
      docNo: full.DocNo ?? "",
      docDate: full.DocDate ? String(full.DocDate).slice(0, 10) : "",
      companyId: full.CompanyID ?? null,
      projectId: full.ProjectID ?? null,
      finYear: full.FinYear ?? "",
      supplierId: full.SupplierID ?? null,
      supplierName: full.SupplierName ?? "",
      contactPerson:
        (suppliers as any[]).find((s: any) => Number(s.id) === full.SupplierID)
          ?.contactPerson ?? "",
      poId: full.POID ?? null,
      poNumber: full.PONumber ?? "",
      vehicleNo: full.VehicleNo ?? "",
      entryTime: full.EntryTime
        ? toLocalDateTimeInput(new Date(full.EntryTime))
        : "",
      exitTime: full.ExitTime
        ? toLocalDateTimeInput(new Date(full.ExitTime))
        : null,
      challanNo: full.ChallanNo ?? "",
      attachments: Array.isArray(full.Attachments) ? full.Attachments : [],
      remarks: full.Remarks ?? "",
    });
    setEditingId(rec.VehicleInOutID);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  _onDelete = (id: number) => setDeleteId(id);

  // ── File upload (supports multiple files — appends, doesn't replace) ────────
  // Files are sent straight to the DB-backed /upload endpoint (no local disk
  // involved) and come back with server-assigned ids + streamable urls.
  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const result = await vehApi.uploadVehicleAttachments(files);
      pf({ attachments: [...form.attachments, ...result.attachments] });
      toast.success(
        result.attachments.length > 1
          ? `${result.attachments.length} attachments uploaded`
          : "Attachment uploaded",
      );
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    // Optimistically drop it from the form; roll back if the delete fails.
    const prev = form.attachments;
    pf({ attachments: prev.filter((a) => a.id !== attachmentId) });
    try {
      await vehApi.deleteVehicleAttachment(attachmentId);
    } catch (err: any) {
      pf({ attachments: prev });
      toast.error(err.message || "Failed to remove attachment");
    }
  };

  // ── Camera capture ───────────────────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    const dataUrl = webcamRef.current?.getScreenshot();
    if (!dataUrl) {
      toast.error("Could not capture photo — try again");
      return;
    }
    setUploading(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], `vehicle-capture-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      const result = await vehApi.uploadVehicleAttachments([file]);
      pf({ attachments: [...form.attachments, ...result.attachments] });
      toast.success("Photo captured");
    } catch (err: any) {
      toast.error(err.message || "Failed to save captured photo");
    } finally {
      setUploading(false);
    }
  }, [form.attachments]);

  const switchCamera = () =>
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));

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

  // ── Group by linked PO — every Vehicle In/Out lot delivered against the
  // same PO now shows together instead of scattered across a flat list.
  // Records with no PO link fall into a single "No PO Linked" bucket.
  // Group order follows first-appearance in the (already recency-sorted)
  // list, so the most recently active PO's group surfaces first.
  const groupedRecords = useMemo(() => {
    const groups = new Map<string, { key: string; poNumber: string | null; supplierName: string | null; rows: any[] }>();
    for (const r of filteredRecords) {
      const key = r.POID ? `po-${r.POID}` : "no-po";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          poNumber: r.PONumber || null,
          supplierName: r.SupplierName || null,
          rows: [],
        });
      }
      groups.get(key)!.rows.push(r);
    }
    return Array.from(groups.values());
  }, [filteredRecords]);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  if (isLoading) {
    return (
      <div className="flex items-center gap-2.5 mt-8 text-muted-foreground text-sm">
        <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        Loading Vehicle In/Out…
      </div>
    );
  }

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], VEH_TEMPLATE_COLUMNS, "vehicle-in-out-template");
  };
  const handleImportClick = () => { importFileInputRef.current?.click(); };
  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) { toast.error("CSV is empty"); return; }
      toast.success(`${rows.length} rows read — full import coming soon`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Vehicle In/Out"]} />
      <MaterialShell
        title="Vehicle In/Out"
        subtitle="Track vehicle entry and exit against purchase orders"
        icon={Truck}
        action={
          !showForm ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={importFileInputRef} type="file" accept=".csv" onChange={handleImportFileChange} className="hidden" />
              <button
                onClick={handleDownloadTemplate}
                title="Download a blank CSV template"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                <Download size={13} />
                <span className="hidden sm:inline">Download Template</span>
              </button>
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import from CSV"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                <span className="hidden sm:inline">{importing ? "Importing..." : "Import CSV"}</span>
              </button>
              {rights.canCreate && (
                <button
                  onClick={() => {
                    setShowForm(true);
                    setEditingId(null);
                    setForm(buildEmpty(activeFinYear));
                    setReceivedQtyByItem({});
                    setErrors({});
                  }}
                  className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 inline-flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                >
                  <Plus size={13} /> New Entry
                </button>
              )}
            </div>
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
                    <FieldLabel required>
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
                        className={`${inpSel} ${errors.companyId ? "border-destructive/60" : ""}`}
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
                    {errors.companyId && (
                      <p className="text-[10px] text-destructive mt-1">
                        {errors.companyId}
                      </p>
                    )}
                  </div>

                  {/* Project */}
                  <div>
                    <FieldLabel required>
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
                        className={`${inpSel} ${errors.projectId ? "border-destructive/60" : ""}`}
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
                    {errors.projectId && (
                      <p className="text-[10px] text-destructive mt-1">
                        {errors.projectId}
                      </p>
                    )}
                  </div>

                  {/* Doc Date — locked to today; entries are dated when
                      they're actually made, not backdated/postdated. */}
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
                        readOnly
                        disabled
                        title="Doc date is always today's date"
                        className={`${inp} pl-9 bg-muted/30 cursor-not-allowed opacity-70 [&::-webkit-calendar-picker-indicator]:hidden`}
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
                          .filter((fy) => !fy.locked && fy.status === "Active")
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
                          {form.docNo || "—"}
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

              {/* ── Section 2: PO & Supplier ── */}
              <SectionCard>
                <SectionTitle
                  icon={Filter}
                  label="Purchase Order & Supplier"
                  sub="Select a PO — supplier is fetched automatically"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                            // Auto-fetch supplier from the selected PO —
                            // PO now drives supplier, not the other way
                            // round.
                            supplierId: po?.SupplierID ?? null,
                            supplierName: po?.SupplierName ?? "",
                            contactPerson:
                              (suppliers as any[]).find(
                                (s: any) => Number(s.id) === Number(po?.SupplierID),
                              )?.contactPerson ?? "",
                            // Auto-fill Company + Project straight from the
                            // PO too, same as GRN.tsx does.
                            companyId: po?.CompanyId ?? form.companyId,
                            projectId: po?.ProjectId ?? form.projectId,
                          });
                          // Switching POs invalidates any received-qty
                          // entered against the previous PO's line items.
                          setReceivedQtyByItem({});
                        }}
                        className={inpSel}
                      >
                        <option value="">
                          {filteredPOs.length === 0 ? "No POs available" : "Select PO…"}
                        </option>
                        {filteredPOs.map((po: any) => (
                          <option
                            key={po.PurchaseOrderID}
                            value={po.PurchaseOrderID}
                          >
                            {po.DocNo || po.PurchaseOrderNo}
                            {po.SupplierName ? ` — ${po.SupplierName}` : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Supplier — auto-filled from the selected PO and locked
                      while a PO is selected (it's derived, not independent
                      input). Only editable for a standalone (no-PO) entry. */}
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
                          });
                        }}
                        disabled={!!form.poId}
                        title={form.poId ? "Supplier is set by the selected PO" : undefined}
                        className={`${inpSel} ${form.poId ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`}
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

                {/* PO Items — enter how much this specific lot/vehicle is
                    delivering, per line item. Capped at what's actually
                    left on the PO (ordered minus everything already
                    received across other Vehicle In/Out entries for the
                    same PO) — this is the "10 + 20 + 70 of 100" flow. */}
                {form.poId && (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center gap-2">
                      <Package size={13} className="text-muted-foreground" />
                      <span className="text-[11px] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                        PO Items — Qty Received (This Lot)
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {loadingPOItems
                          ? "Loading…"
                          : `${poItemsRemaining.length} item${poItemsRemaining.length !== 1 ? "s" : ""}`}
                      </span>
                    </div>
                    {poItemsRemaining.length === 0 && !loadingPOItems ? (
                      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                        No items on this PO.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border bg-muted/10">
                              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-heading">#</th>
                              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-heading">Item</th>
                              <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-heading">Ordered</th>
                              <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-heading">Received So Far</th>
                              <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-heading">Remaining</th>
                              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-heading">UOM</th>
                              <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-heading">Qty This Lot</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {poItemsRemaining.map((it, i) => {
                              const raw = receivedQtyByItem[it.poItemId] ?? "";
                              const entered = parseFloat(raw) || 0;
                              const overLimit = entered > it.remainingQty + 1e-6;
                              return (
                                <tr key={it.poItemId} className="hover:bg-muted/10 transition-colors">
                                  <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                                  <td className="px-4 py-2.5 font-medium text-foreground">{it.itemName || "—"}</td>
                                  <td className="px-4 py-2.5 text-right font-mono">{it.orderedQty}</td>
                                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{it.receivedSoFar}</td>
                                  <td className="px-4 py-2.5 text-right font-mono font-semibold">
                                    {entered > 0 ? (
                                      <span className="inline-flex items-baseline gap-1.5">
                                        <span className="text-muted-foreground line-through">
                                          {it.remainingQty}
                                        </span>
                                        <span
                                          className={
                                            overLimit
                                              ? "text-destructive"
                                              : "text-primary"
                                          }
                                        >
                                          {Math.max(it.remainingQty - entered, 0)}
                                        </span>
                                      </span>
                                    ) : (
                                      <span
                                        className={
                                          it.remainingQty === 0
                                            ? "text-muted-foreground"
                                            : "text-primary"
                                        }
                                      >
                                        {it.remainingQty}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5 text-muted-foreground">{it.uomName || "—"}</td>
                                  <td className="px-4 py-2.5 text-right">
                                    <input
                                      type="number"
                                      min={0}
                                      max={it.remainingQty}
                                      step="any"
                                      value={raw}
                                      disabled={it.remainingQty === 0}
                                      onChange={(e) => {
                                        const nextVal = e.target.value;
                                        const nextEntered =
                                          parseFloat(nextVal) || 0;
                                        if (
                                          nextEntered > it.remainingQty + 1e-6 &&
                                          entered <= it.remainingQty + 1e-6
                                        ) {
                                          toast.error(
                                            `${it.itemName || "Item"}: quantity can't be greater than ${it.remainingQty} ${it.uomName || ""}`.trim(),
                                          );
                                        }
                                        setReceivedQtyByItem((prev) => ({
                                          ...prev,
                                          [it.poItemId]: nextVal,
                                        }));
                                      }}
                                      placeholder="0"
                                      className={`w-24 px-2 py-1.5 rounded-lg border bg-background text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary ${
                                        overLimit ? "border-destructive text-destructive" : "border-border"
                                      } ${it.remainingQty === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
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
                    <FieldLabel>Attachments / Car Plate Photos</FieldLabel>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* File pick — multiple files at once */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          if (files.length) handleFileUpload(files);
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
                        {uploading ? "Uploading…" : "Attach Files"}
                      </button>

                      {/* Camera capture — opens live in-page camera */}
                      <button
                        type="button"
                        onClick={() => {
                          setCameraError(null);
                          setShowCamera(true);
                        }}
                        disabled={uploading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        <Camera size={12} /> Camera
                      </button>
                    </div>

                    {/* Preview list — multiple attachments */}
                    {form.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        {form.attachments.map((a) => (
                          <AttachmentThumb
                            key={a.id}
                            attachment={a}
                            onRemove={() => removeAttachment(a.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>

              {/* ── Actions ── */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden mt-4 -mx-5 -mb-5">
                <p className="hidden sm:block text-[11px] text-muted-foreground">
                  Ready to save
                </p>
                <div className="flex items-center gap-2 sm:ml-auto">
                  <button
                    onClick={() => {
                      setForm(buildEmpty(activeFinYear));
                      setReceivedQtyByItem({});
                      setEditingId(null);
                      setErrors({});
                    }}
                    disabled={createMut.isPending || updateMut.isPending}
                    className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw size={12} /> Reset
                  </button>
                  <button
                    onClick={onSubmit}
                    disabled={
                      createMut.isPending || updateMut.isPending || uploading
                    }
                    className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
                  >
                    {createMut.isPending || updateMut.isPending ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : editingId ? (
                      <Check size={14} />
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
                      {[...finYears]
                        .filter((fy) => fy.status === "Active")
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
            {filteredRecords.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-10">
                No Vehicle In/Out records. Click 'New Entry' to create one.
              </p>
            ) : (
              groupedRecords.map((group) => {
                const collapsed = !!collapsedGroups[group.key];
                return (
                  <div key={group.key} className="border-b border-border last:border-0">
                    {/* Group header — one PO's lots grouped together */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
                    >
                      {collapsed ? (
                        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                      )}
                      <FileText size={13} className="text-primary shrink-0" />
                      <span className="text-sm font-heading font-semibold text-foreground">
                        {group.poNumber || "No PO Linked"}
                      </span>
                      {group.supplierName && (
                        <span className="text-xs text-muted-foreground truncate">
                          · {group.supplierName}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {group.rows.length} lot{group.rows.length !== 1 ? "s" : ""}
                      </span>
                    </button>

                    {!collapsed && (
                      <>
                        {/* Mobile: stacked cards (table is hard to use on phones) */}
                        <div
                          className={`sm:hidden p-3 space-y-3 transition-opacity duration-200 ${isFetching ? "opacity-60 pointer-events-none" : ""}`}
                        >
                          {group.rows.map((rec: any) => (
                            <VehicleCard
                              key={rec.VehicleInOutID}
                              rec={rec}
                              onView={_onView}
                              onEdit={_onEdit}
                              onDelete={_onDelete}
                              canEdit={rights.canEdit}
                              canDelete={rights.canDelete}
                            />
                          ))}
                        </div>

                        {/* Desktop / tablet: full table */}
                        <div
                          className={`hidden sm:block overflow-x-auto transition-opacity duration-200 ${isFetching ? "opacity-60 pointer-events-none" : ""}`}
                        >
                          <DataTable
                            data={group.rows}
                            columns={COLUMNS}
                            searchable={false}
                            paginated={false}
                            emptyMessage="No Vehicle In/Out records."
                          />
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}

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

      </MaterialShell>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* VIEW MODAL                                                          */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {viewingRec && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
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
                  onClick={() => { setViewingRec(null); setShowPODetails(false); }}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Tabs — Supplier only makes sense once this entry is linked
                  to a PO (chat is scoped to the PO, same conversation the
                  supplier sees on their own "Received by Customer" card). */}
              {viewingRec.POID && (
                <div className="sticky top-[57px] bg-card z-10 flex border-b border-border px-6 gap-1">
                  {[
                    { id: "details" as const, label: "Details" },
                    { id: "supplier" as const, label: "Supplier", icon: MessageCircle },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setViewTab(t.id)}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                        viewTab === t.id
                          ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.icon && <t.icon size={12} />}
                      {t.label}
                    </button>
                  ))}
                </div>
              )}

              {viewTab === "supplier" && viewingRec.POID ? (
                <div className="p-5 sm:p-6 h-[60vh]">
                  {currentUser && (
                    <OrderChat
                      poId={viewingRec.POID}
                      apiBase="/api/purchase-orders"
                      currentUser={{ id: Number(currentUser.id), name: currentUser.name, role: currentUser.role }}
                      className="h-full"
                    />
                  )}
                </div>
              ) : (
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

                  {/* PO Reference */}
                  {viewingRec.PONumber ? (
                    <button
                      onClick={() => setShowPODetails(true)}
                      className="px-3 py-2.5 rounded-xl bg-blue-500/5 border border-blue-500/20 text-left hover:bg-blue-500/10 transition-colors"
                    >
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                        PO Reference
                      </p>
                      <p className="text-xs font-semibold font-mono text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                        {viewingRec.PONumber}
                        <Eye size={10} className="shrink-0 opacity-60" />
                      </p>
                    </button>
                  ) : (
                    <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">PO Reference</p>
                      <p className="text-xs text-muted-foreground">—</p>
                    </div>
                  )}
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

                {/* Attachments — new records use the DB-backed Attachments[]
                    (binary stored in dbo.VehicleInOutAttachments); older
                    records created before this change may still only have
                    legacy disk paths in AttachmentPath. */}
                {Array.isArray(viewingRec.Attachments) &&
                viewingRec.Attachments.length > 0 ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
                      Attachments ({viewingRec.Attachments.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {viewingRec.Attachments.map(
                        (a: vehApi.VehicleAttachment) => (
                          <AttachmentThumb key={a.id} attachment={a} />
                        ),
                      )}
                    </div>
                  </div>
                ) : (
                  (() => {
                    // Legacy fallback: pre-migration rows that still hold
                    // disk paths (single string or JSON array) instead of
                    // DB-backed attachment rows.
                    const legacyPaths = parseJsonArray<string>(
                      viewingRec.AttachmentPath,
                    ).length
                      ? parseJsonArray<string>(viewingRec.AttachmentPath)
                      : viewingRec.AttachmentPath
                        ? [viewingRec.AttachmentPath]
                        : [];
                    if (legacyPaths.length === 0) return null;
                    return (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
                          Attachments ({legacyPaths.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {legacyPaths.map((p) => {
                            const isImage =
                              /\.(jpe?g|png|gif|webp|heic)$/i.test(p);
                            return (
                              <a
                                key={p}
                                href={p}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20 text-sm text-primary font-medium hover:bg-primary/10 transition-colors"
                              >
                                {isImage ? (
                                  <img
                                    src={p}
                                    alt="attachment"
                                    className="h-7 w-7 rounded object-cover"
                                  />
                                ) : (
                                  <Paperclip size={13} />
                                )}
                                <span className="truncate max-w-[160px]">
                                  {p.split("/").pop()}
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()
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
                      <Edit3 size={13} /> Edit
                    </button>
                  )}
                </div>
              </div>
              )}
            </div>
          </div>
        )}

      {/* ── PO Preview pop-out (above view modal) ── */}
      {showPODetails && viewingRec && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-blue-500/10 border border-blue-500/20">
                    <FileText size={12} className="text-blue-500" />
                  </div>
                  <h2 className="font-heading font-bold text-sm text-foreground font-mono">
                    {loadingPODetail ? "Loading…" : (viewingPODetail as any)?.PurchaseOrderNo || viewingRec.PONumber}
                  </h2>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 ml-8">Purchase Order</p>
              </div>
              <button
                onClick={() => setShowPODetails(false)}
                className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {loadingPODetail ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <RefreshCw size={14} className="animate-spin" />
                Loading PO details…
              </div>
            ) : viewingPODetail ? (
              <div className="p-5 space-y-4">
                {/* Meta grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "PO Number", value: (viewingPODetail as any).PurchaseOrderNo, blue: true },
                    { label: "PO Date", value: (viewingPODetail as any).PODate ? new Date((viewingPODetail as any).PODate).toLocaleDateString("en-IN") : "—" },
                    { label: "Expected Delivery", value: (viewingPODetail as any).ExpectedDeliveryDate ? new Date((viewingPODetail as any).ExpectedDeliveryDate).toLocaleDateString("en-IN") : "—" },
                    { label: "Supplier", value: (viewingPODetail as any).SupplierName },
                    { label: "Company", value: (viewingPODetail as any).CompanyName },
                    { label: "Project / Site", value: (viewingPODetail as any).ProjectName },
                    { label: "Payment Terms", value: (viewingPODetail as any).PaymentTerms || "—" },
                    { label: "Status", value: (viewingPODetail as any).Status },
                    { label: "Total Amount", value: (viewingPODetail as any).TotalAmount != null ? `₹${Number((viewingPODetail as any).TotalAmount).toLocaleString("en-IN")}` : "—" },
                  ].map(({ label, value, blue }: any) => (
                    <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                      <p className={`text-xs font-semibold truncate ${blue ? "font-mono text-blue-600 dark:text-blue-400" : "text-foreground"}`}>{value || "—"}</p>
                    </div>
                  ))}
                </div>

                {/* Line items */}
                {Array.isArray((viewingPODetail as any).LineItems) && (viewingPODetail as any).LineItems.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">Order Items</p>
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
                        <thead className="bg-muted/40 border-b border-border">
                          <tr>
                            {[["Description", "38%"], ["Qty", "12%"], ["Unit", "10%"], ["Rate", "15%"], ["Amount", "15%"], ["GST", "10%"]].map(([h, w]) => (
                              <th key={h} className={`px-3 py-2 text-[9px] uppercase tracking-widest font-heading text-muted-foreground ${h === "Qty" || h === "Rate" || h === "Amount" || h === "GST" ? "text-right" : "text-left"}`} style={{ width: w }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {(viewingPODetail as any).LineItems.map((item: any, i: number) => (
                            <tr key={i} className="hover:bg-muted/20 transition-colors">
                              <td className="px-3 py-2 truncate font-medium">{item.ItemName || item.Description || "—"}</td>
                              <td className="px-3 py-2 text-right">{item.Quantity}</td>
                              <td className="px-3 py-2 text-muted-foreground">{item.UomName || item.Unit || "—"}</td>
                              <td className="px-3 py-2 text-right">₹{Number(item.Rate || 0).toLocaleString("en-IN")}</td>
                              <td className="px-3 py-2 text-right font-semibold">₹{Number(item.LineAmount || 0).toLocaleString("en-IN")}</td>
                              <td className="px-3 py-2 text-right text-muted-foreground">{item.TaxPct ? `${item.TaxPct}%` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(viewingPODetail as any).Remarks && (
                  <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Remarks</p>
                    <p className="text-xs text-foreground">{(viewingPODetail as any).Remarks}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <FileText size={28} className="opacity-30" />
                <p className="text-sm">PO details not available</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Camera capture modal ── */}
      {showCamera && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Camera size={15} className="text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  Capture Vehicle / Plate Photo
                </h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowCamera(false)}
              >
                <XCircle size={15} />
              </Button>
            </div>

            <div className="p-4">
              {cameraError ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                  <XCircle size={32} className="text-red-400" />
                  <p className="text-sm text-muted-foreground">{cameraError}</p>
                  <p className="text-xs text-muted-foreground/60">
                    Please allow camera access in your browser settings and try
                    again.
                  </p>
                </div>
              ) : (
                <div className="relative">
                  <Webcam
                    ref={webcamRef}
                    audio={false}
                    screenshotFormat="image/jpeg"
                    className="rounded-xl w-full"
                    width={640}
                    height={480}
                    mirrored={facingMode === "user"}
                    videoConstraints={{
                      width: 640,
                      height: 480,
                      facingMode: { ideal: facingMode },
                    }}
                    onUserMediaError={(err) => {
                      const msg =
                        err instanceof Error ? err.message : String(err);
                      setCameraError(
                        msg.toLowerCase().includes("permission")
                          ? "Camera permission denied."
                          : "Could not access camera: " + msg,
                      );
                    }}
                  />

                  {/* Switch camera (front/back) */}
                  <button
                    type="button"
                    onClick={switchCamera}
                    title="Switch camera"
                    className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/55 text-white hover:bg-black/70 transition-colors backdrop-blur-sm"
                  >
                    <SwitchCamera size={16} />
                  </button>

                  {/* Multi-capture hint */}
                  {form.attachments.length > 0 && (
                    <div className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/55 text-white text-[11px] backdrop-blur-sm">
                      <ImageIcon size={11} />
                      {form.attachments.length} attached
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <Button
                className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={capturePhoto}
                disabled={!!cameraError || uploading}
              >
                {uploading ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {uploading ? "Saving…" : "Capture"}
              </Button>
              {form.attachments.length > 0 && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCamera(false)}
                >
                  Done
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

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

// Constants, small presentational parts and the register columns shared by the Vehicle In/Out page and its parts.
import * as vehApi from "@/api/vehicleInOutApi";
import React, { useState } from "react";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { printStatusLabel } from "@/utils/printStatus";
import { type ExportColumn } from "@/lib/export";
import { ApprovalStatusChain, type TrailData } from "@/components/ApprovalStatusChain";
import { StatusBadge } from "@/components/StatusBadge";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { Truck, X, Eye, Trash2, FileText, Paperclip, Edit3, FileDown } from "lucide-react";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";

export const VIO_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "Entry Time", accessor: (r) => r.EntryTime ? fmtServerDateTime(r.EntryTime as string) : "" },
  { header: "Vehicle No", accessor: "VehicleNo" },
  { header: "Supplier", accessor: "SupplierName" },
  { header: "PO Number", accessor: "PONumber" },
  { header: "Status", accessor: (r) => printStatusLabel(r.Status as string) },
];


// ─── Template columns ─────────────────────────────────────────────────────────
export const VEH_TEMPLATE_COLUMNS = [
  { header: "Vehicle Number", accessor: "Vehicle Number" },
  { header: "Driver Name", accessor: "Driver Name" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "Entry Type (In/Out)", accessor: "Entry Type (In/Out)" },
  { header: "Purpose", accessor: "Purpose" },
  { header: "Date (YYYY-MM-DD)", accessor: "Date (YYYY-MM-DD)" },
  { header: "Remarks", accessor: "Remarks" },
];

// ── Field styles (sheet: squared, ruled, ink on focus) ────────────────────────
export const inp =
  "w-full px-3 py-2 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground placeholder:text-muted-foreground/60 disabled:opacity-60";
export const inpSel =
  "w-full px-3 py-2 pr-8 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground appearance-none disabled:opacity-60";

export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const chip = (on: boolean) =>
  `${KEY} h-7 px-2.5 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

// ── Small helpers ─────────────────────────────────────────────────────────────
export function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block text-[0.625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

export function SectionCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border border-foreground/30 bg-card/50 p-5 space-y-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
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
      <div className="p-1.5 bg-primary/10 shrink-0">
        <Icon size={13} className="text-primary" />
      </div>
      <div>
        <p className="text-xs font-semibold text-foreground tracking-wide">
          {label}
        </p>
        {sub && <p className="text-[0.625rem] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export function InfoPill({
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
    <div className="flex flex-col gap-0.5 px-3 py-2 bg-card border border-foreground/30 min-w-0">
      <span className="text-[0.5625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-xs font-semibold text-foreground truncate ${mono ? "font-heading" : ""}`}
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
export const vehAttachmentBlobCache = new Map<string, string>();
let vehAttachmentCleanupRegistered = false;
export const registerVehAttachmentCleanup = () => {
  if (vehAttachmentCleanupRegistered || typeof window === "undefined") return;
  vehAttachmentCleanupRegistered = true;
  window.addEventListener("pagehide", () => {
    vehAttachmentBlobCache.forEach((u) => URL.revokeObjectURL(u));
    vehAttachmentBlobCache.clear();
  });
};

/** Thumbnail/link for one attachment — resolves its authenticated blob URL
 *  before rendering an <img> (for images) or a download link (for PDFs etc). */
/** "8.5 tonne" — a line's weight, or null when none was entered. */
export const fmtWeight = (it: { Weight?: number | null; WeightUnit?: string | null }) =>
  Number(it.Weight) > 0 ? `${Number(it.Weight).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${it.WeightUnit || "kg"}` : null;

/** An entry's received lines, one per row: item, quantity, quality grade and weight. Register and its phone cards. */
export function VioLinesSummary({ items }: { items: any[] | undefined }) {
  if (!Array.isArray(items) || items.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {items.map((it) => (
        <div key={it.VehicleInOutItemID} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.6875rem] leading-tight">
          <span className="font-medium text-foreground truncate max-w-[12rem]" title={it.ItemName || ""}>{it.ItemName || "—"}</span>
          <span className="font-heading tabular-nums text-muted-foreground whitespace-nowrap">
            {Number(it.ReceivedQty ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })}{it.UomName ? ` ${it.UomName}` : ""}
          </span>
          {it.Quality && (
            <span className="inline-flex items-center px-1 py-px text-[0.5rem] font-semibold uppercase tracking-wide border border-foreground/40">{it.Quality}</span>
          )}
          {fmtWeight(it) && <span className="font-heading tabular-nums text-muted-foreground whitespace-nowrap">· {fmtWeight(it)}</span>}
        </div>
      ))}
    </div>
  );
}

/** The photo captured beside a received line (a base64 data URL); opens full size in a new tab. */
export function LinePhotoThumb({ src, alt }: { src: string | null | undefined; alt: string }) {
  if (!src) return null;
  const open = () => {
    // A data URL can't be navigated to directly; show it on a blank page instead.
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.title = alt;
    const img = w.document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.style.cssText = "max-width:100%;height:auto;display:block;margin:auto";
    w.document.body.style.margin = "0";
    w.document.body.style.background = "#111";
    w.document.body.appendChild(img);
  };
  return (
    <button type="button" onClick={open} title="Open the photo" className="shrink-0 border border-foreground/30 hover:border-foreground transition-colors">
      <img src={src} alt={alt} className="w-9 h-9 object-cover block" />
    </button>
  );
}

export function AttachmentThumb({
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
    <div className="relative inline-flex items-center gap-2 pl-2 pr-7 py-1.5 bg-card border border-foreground/40 text-xs text-foreground">
      {isImage && blobUrl && !failed ? (
        <button type="button" onClick={openFile}>
          <img
            src={blobUrl}
            alt={attachment.filename}
            className="h-8 w-8 object-cover border border-foreground/40"
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
export function VehicleCard({
  rec,
  onView,
  onEdit,
  onDelete,
  onGeneratePdf,
  canEdit = true,
  canDelete = true,
  approvalTrail,
  approvalTrailLoading = false,
}: {
  rec: any;
  onView: (r: any) => void;
  onEdit: (r: any) => void;
  onDelete: (id: number) => void;
  onGeneratePdf: (r: any) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Bulk-fetched by the parent list — see useApprovalTrailsBulk's comment
   *  on why this card doesn't fetch its own trail per-instance. */
  approvalTrail?: TrailData | null;
  approvalTrailLoading?: boolean;
}) {
  return (
    <div className="border border-foreground/30 bg-card p-4 space-y-3">
      {/* Top row: Doc No + Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading text-sm font-bold text-foreground truncate">
            {rec.DocNo || "—"}
          </p>
          <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
            {rec.DocDate
              ? new Date(rec.DocDate).toLocaleDateString("en-IN")
              : "—"}
          </p>
        </div>
        <div className="shrink-0">
          <ApprovalStatusChain
            table="VehicleInOut"
            recordId={rec.VehicleInOutID}
            fallback={<StatusBadge status={rec.Status} />}
            preloaded={approvalTrail ?? null}
            preloadedLoading={approvalTrailLoading}
          />
        </div>
      </div>

      {/* Attachment count */}
      {Number(rec.AttachmentCount) > 0 && (
        <div className="inline-flex items-center gap-1 text-[0.625rem] text-muted-foreground">
          <Paperclip size={10} />
          {rec.AttachmentCount} attachment{rec.AttachmentCount > 1 ? "s" : ""}
        </div>
      )}

      {/* Vehicle No */}
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/15">
        <Truck size={13} className="text-primary shrink-0" />
        <span className="font-heading text-sm font-semibold text-primary truncate">
          {rec.VehicleNo || "—"}
        </span>
      </div>

      {/* Received lines */}
      {Array.isArray(rec.Items) && rec.Items.length > 0 && (
        <div>
          <p className="text-[0.5625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-1">Items</p>
          <VioLinesSummary items={rec.Items} />
        </div>
      )}

      {/* Supplier / PO / Entry / Challan grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <p className="text-[0.5625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            Supplier
          </p>
          <p className="truncate">{rec.SupplierName || "—"}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[0.5625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            PO No
          </p>
          <p className="font-heading truncate">{rec.PONumber || "—"}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[0.5625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            Entry Time
          </p>
          <p className="truncate">
            {rec.EntryTime
              ? fmtServerDateTime(rec.EntryTime, { dateStyle: "short", timeStyle: "short" })
              : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[0.5625rem] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            Challan No
          </p>
          <p className="truncate">{rec.ChallanNo || "—"}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 pt-2 border-t border-foreground/30">
        <button data-row-view
          onClick={() => onView(rec)}
          className="text-muted-foreground hover:bg-primary/5 p-2 transition-colors"
          title="View"
        >
          <Eye size={15} />
        </button>
        <button
          onClick={() => onGeneratePdf(rec)}
          className="text-foreground hover:bg-primary/5 p-2 transition-colors"
          title="Generate PDF"
        >
          <FileDown size={15} />
        </button>
        {canEdit && (
          <button
            onClick={() => onEdit(rec)}
            className="text-muted-foreground hover:bg-primary/5 p-2 transition-colors"
            title="Edit"
          >
            <Edit3 size={15} />
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => onDelete(rec.VehicleInOutID)}
            className="text-destructive hover:bg-destructive/10 p-2 transition-colors"
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
// toISOString() always converts to UTC, which is wrong for <DateInput>
// and <DateTimeInput>: those inputs expect/display local wall-clock
// time. Using toISOString() here made entry/exit time off by the IST offset
// (+5:30), e.g. showing 11:08 AM when the local clock read 4:38 PM.
export const pad2 = (n: number) => String(n).padStart(2, "0");

export const toLocalDateInput = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const toLocalDateTimeInput = (d: Date) =>
  `${toLocalDateInput(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// ── Server-returned time helpers ──────────────────────────────────────────
// EntryTime/ExitTime come back from the API as "...Z"-suffixed ISO strings
// purely because Date -> JSON always appends "Z" — not because the value is
// a true UTC instant. The backend round-trips the literal IST digits the
// user typed through a UTC-configured Node process with no real conversion
// (see vehicleInOut.js's parseIstDateTime comment), so the ISO string's UTC
// component IS the intended IST wall-clock reading. Formatting it with
// plain toLocaleString() applies the BROWSER's own local-timezone
// conversion on top of that, double-shifting the displayed time by +5:30
// (06:10 AM rendered as 11:40 AM). These read the UTC getters directly so
// the literal digits typed in are what's ever shown or prefilled.
export const fmtServerDateTime = (iso: string | Date, opts?: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString("en-IN", { ...opts, timeZone: "UTC" });

export const toUtcDateTimeInput = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;

// ── Form default ───────────────────────────────────────────────────────────────
export const buildEmpty = (activeFinYear?: string) => ({
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
  exitTime: toLocalDateTimeInput(new Date()) as string | null, // defaults to now — backfill only, never future (see max on the input)
  challanNo: "",
  attachments: [] as vehApi.VehicleAttachment[],
  remarks: "",
});

// ── Module-level refs for DataTable cell closures ─────────────────────────────
// The register columns are defined outside the page component, so the page hands them its
// handlers, rights and approval trails through this one object (set on every render).
// Reassigned each render by VehicleInOut() below — see
// useApprovalTrailsBulk's own comment for why the Status column reads from
// this instead of firing its own per-row GET /trail.
export const bridge = {
  onView: (() => {}) as (r: any) => void,
  onEdit: (() => {}) as (r: any) => void,
  onDelete: (() => {}) as (id: number) => void,
  onGeneratePdf: (() => {}) as (r: any) => void,
  canEdit: true,
  canDelete: true,
  vehicleApprovalTrails: new Map<string, TrailData | null>(),
  vehicleApprovalTrailsLoading: false,
};

// ── List columns ──────────────────────────────────────────────────────────────
export const COLUMNS: ColumnDef<any, unknown>[] = [
  {
    id: "DocInfo",
    header: "Doc No",
    size: 130,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-heading text-xs font-bold">{row.original.DocNo || "—"}</span>
        <span className="text-[0.625rem] text-muted-foreground whitespace-nowrap">
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
      <span className="font-heading text-xs font-semibold text-primary">
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
      <span className="font-heading text-xs">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "Items",
    header: "Items · Quality · Weight",
    size: 230,
    meta: { className: "hidden sm:table-cell" },
    enableSorting: false,
    cell: ({ row }) => <VioLinesSummary items={row.original.Items} />,
  },
  {
    id: "CompanyProject",
    header: "Company / Project",
    size: 150,
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs truncate block">{row.original.CompanyName || "—"}</span>
        <span className="text-[0.625rem] text-muted-foreground truncate block">
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
          {v ? fmtServerDateTime(v, { dateStyle: "short", timeStyle: "short" }) : "—"}
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
      <span className="text-xs font-heading">{(getValue() as string) || "—"}</span>
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
          fallback={<StatusBadge status={row.original.Status} />}
          preloaded={bridge.vehicleApprovalTrails.get(String(row.original.VehicleInOutID)) ?? null}
          preloadedLoading={bridge.vehicleApprovalTrailsLoading}
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
            <button data-row-view
              onClick={() => bridge.onView(rec)}
              className="p-1 text-foreground hover:bg-primary/5 transition-colors"
              title="View details"
            >
              <Eye size={15} />
            </button>
            <button
              onClick={() => bridge.onGeneratePdf(rec)}
              className="p-1 text-foreground hover:bg-primary/5 transition-colors"
              title="Generate PDF"
            >
              <FileDown size={15} />
            </button>
            {bridge.canEdit && (
              <button
                onClick={() => bridge.onEdit(rec)}
                className="p-1 text-foreground hover:bg-primary/5 transition-colors"
                title="Edit this entry"
              >
                <Edit3 size={15} />
              </button>
            )}
            {bridge.canDelete && (
              <button
                onClick={() => bridge.onDelete(rec.VehicleInOutID)}
                className="p-1 text-destructive hover:bg-destructive/10 transition-colors"
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

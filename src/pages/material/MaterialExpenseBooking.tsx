import React, { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useFinYear } from "@/contexts/FinYearContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus,
  Edit,
  Trash2,
  ArrowLeft,
  Receipt,
  Building2,
  CalendarDays,
  FileText,
  BadgePercent,
  CreditCard,
  StickyNote,
  CheckCircle2,
  Clock,
  AlertCircle,
  TrendingUp,
  FolderKanban,
  ShoppingCart,
  HardHat,
  Hammer,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Hash,
  User,
  Banknote,
  Eye,
  Truck,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { ApprovalActions } from "@/components/ApprovalActions";
import { StatusBadge } from "@/components/StatusBadge";
import { Field, PriceBreakdownPanel } from "./ExpenseBooking/FormPrimitives";
import { BillingAccordion } from "./ExpenseBooking/BillingAccordion";
import { EmiSection } from "./ExpenseBooking/EmiSection";
import { ApprovalTrailPanel } from "./ExpenseBooking/ApprovalTrailPanel";
import { RecordCard } from "./ExpenseBooking/RecordCard";
import { ExpenseBookingPreviewModal } from "./ExpenseBookingPreviewModal";
import {
  blankForm,
  computeBreakdown,
  dbToRecord,
  fmt,
  generateEmiSchedule,
  recordToDb,
} from "./ExpenseBooking/helpers";
import type {
  BookingStatus,
  ExpenseRecord,
  PageView,
} from "./ExpenseBooking/types";

const API = "/api/expense-booking";

async function apiFetch(url: string, opts?: RequestInit, timeoutMs = 25000) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Request timed out. Please try again.")),
      timeoutMs,
    );
  });

  const res = await Promise.race([fetchWithAuth(url, opts), timeout]).finally(
    () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const details = Array.isArray(body.details)
      ? body.details
          .map((d: any) => `${d.field || "?"}: ${d.message}`)
          .join(" | ")
      : "";
    throw new Error(
      (body.error ?? body.message ?? `HTTP ${res.status}`) +
        (details ? ` → ${details}` : ""),
    );
  }
  return res.json();
}

const _mastersCache: {
  po: POItem[] | null;
  wo: WOItem[] | null;
  woPO: POItem[] | null;
  tod: TodItem[] | null;
  grn: GRNItem[] | null;
  workDone: WorkDoneItem[] | null;
} = { po: null, wo: null, woPO: null, tod: null, grn: null, workDone: null };

// ─── Types ────────────────────────────────────────────────────────────────────
interface CompanyOption {
  id: number;
  label: string;
}
interface ProjectOption {
  id: number;
  label: string;
}
interface GSTConfig {
  applicable: boolean;
  type: "none" | "cgst_sgst" | "igst";
  rate: number;
}
interface POItem {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  DocNo?: string;
  PODate: string;
  ItemDescription?: string;
  SupplierName?: string;
  CompanyId?: number;
  ProjectId?: number;
  TotalAmount?: number;
  Status: string;
  GST?: GSTConfig | null;
  SourceWOId?: number | null;
  SourceWODocNo?: string | null;
  SourceWDId?: number | null;
  SourceWDDocNo?: string | null;
  POType?: string | null;
}
interface WOItem {
  Id: number;
  DocumentNumber: string;
  DocNo?: string;
  DocumentDate: string;
  ContractorName?: string;
  Remarks?: string;
  CompanyId?: number;
  ProjectId?: number;
  TotalAmount?: number;
  Status: string;
  GST?: GSTConfig | null;
}
interface WorkDoneItem {
  ID: number;
  DocNo?: string;
  DocDate?: string;
  FinYear?: string | null;
  ContractorName?: string;
  SupplierId?: number;
  SupplierName?: string;
  DescriptionOfWork?: string;
  CertifiedAmount?: number;
  Status: string;
  CompanyId?: number;
  ProjectId?: number;
  WorkOrderID?: number;
  WorkOrderNo?: string;
  GST?: GSTConfig | null;
}
interface TodItem {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix?: string;
  Description: string;
  EntryType?: string;
}
type SourceKind = "PO" | "WO" | "WO_PO" | "TOD" | "GRN" | "WORK_DONE";

interface GRNItemLine {
  itemName?: string;
  itemId?: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom?: string;
  rate?: number;
  quantity?: number;
  totalAmount?: number;
  // GST breakdown fields (populated after /gst-breakdown fetch)
  hsnCode?: string;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  baseAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  gstAmount?: number;
  totalAmountInclGST?: number;
}

interface SelectedDoc {
  kind: SourceKind;
  docNo: string;
  sourceId: number;
  nameLabel?: string;
  vendorLabel?: string;
  companyId?: number;
  projectId?: number;
  amount?: number;
  status?: string;
  date?: string;
  gst?: GSTConfig | null;
  grnItems?: GRNItemLine[];
}

interface GRNItem {
  GRNID: number;
  GRNNo: string;
  DocNo?: string;
  GRNDate: string;
  SupplierName?: string;
  PONumber?: string;
  POID?: number;
  CompanyId?: number;
  ProjectId?: number;
  FinYear?: string;
  Status?: string;
  TotalItems?: number;
  Remarks?: string;
  GRNItems?: string | GRNItemLine[];
  ParentGST?: GSTConfig | string | null;
}

interface BillingTermOption {
  BillingTermID: number;
  Name: string;
  Description?: string;
  Type?: string;
  GST?: string;
  IsActive?: boolean;
}
interface TCOption {
  Id: number;
  Name: string;
  TermsAndCondition?: string;
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────
const SECTION_ICONS: Record<string, React.ElementType> = {
  "Document Selection": FileText,
  "Booking Information": CalendarDays,
  "Amount & GST": BadgePercent,
  "GRN Items Summary": Truck,
  "Billing Terms": Receipt,
  "EMI / Installment Options": CreditCard,
  "Approval Workflow": CheckCircle2,
  "Terms & Conditions": FileText,
  Remarks: StickyNote,
};

function SectionHeader({ label }: { label: string }) {
  const Icon = SECTION_ICONS[label];
  return (
    <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
      {Icon && (
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
          <Icon size={12} className="text-primary" />
        </div>
      )}
      <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function InfoPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border/50">
      <Icon size={11} className="text-muted-foreground shrink-0" />
      <span className="text-[10px] text-muted-foreground">{label}:</span>
      <span className="text-[10px] font-semibold text-foreground truncate">
        {value}
      </span>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-10 text-center text-xs text-muted-foreground">
      <AlertCircle size={16} className="mx-auto mb-2 opacity-30" />
      {label}
    </div>
  );
}

function PickerRow({
  icon,
  iconBg,
  primary,
  primaryColor,
  secondary,
  badge,
  amount,
  onClick,
}: {
  icon: React.ReactNode;
  iconBg: string;
  primary: string;
  primaryColor: string;
  secondary?: string;
  badge?: string;
  amount?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border/30 last:border-0 text-left group"
    >
      <div
        className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-xs font-bold ${primaryColor}`}>
            {primary}
          </span>
          {badge && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
              {badge}
            </span>
          )}
        </div>
        {secondary && (
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {secondary}
          </p>
        )}
      </div>
      {amount != null && (
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          ₹{fmt(amount)}
        </span>
      )}
      <ChevronRight size={12} className="text-muted-foreground/30 shrink-0" />
    </button>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg shrink-0 ${color}`}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider truncate">
          {label}
        </p>
        <p className="text-base font-bold font-mono text-foreground mt-0.5">
          {value}
        </p>
      </div>
    </div>
  );
}

function RateInput({
  value,
  onChange,
  highlighted,
}: {
  value: number;
  onChange: (v: number) => void;
  highlighted: boolean;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
        %
      </span>
      <Input
        type="number"
        min={0}
        max={28}
        step={0.5}
        value={value ?? ""}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={`pl-7 font-mono ${highlighted ? "border-primary/40 bg-primary/5" : ""}`}
        placeholder="0"
      />
    </div>
  );
}

// ─── Document Selector Panel ──────────────────────────────────────────────────
interface DocSelectorProps {
  poList: POItem[];
  woPOList: POItem[];
  workDoneList: WorkDoneItem[];
  todList: TodItem[];
  grnList: GRNItem[];
  loadingPO: boolean;
  loadingWorkDone: boolean;
  loadingWOPO: boolean;
  loadingTOD: boolean;
  loadingGRN: boolean;

  // GRN filtering (suppliers-based picker)
  companyOptions: CompanyOption[];
  projectOptions: ProjectOption[];
  suppliers: { id: number; label: string }[];

  selected: SelectedDoc | null;
  finYear?: string;
  filterCompanyId?: number | null;
  filterProjectId?: number | null;
  filterFinYear?: string | null;
  filterSupplier?: string | null;
  /** IDs already booked — excludes them from picker (except the one being edited) */
  bookedPOIds?: Set<number>;
  bookedWorkDoneIds?: Set<number>;
  bookedWOPOIds?: Set<number>;
  bookedGRNIds?: Set<number>;
  onSelect: (doc: SelectedDoc) => void;
  onClear: () => void;
  onTodSelected?: (tod: TodItem | null) => void;
}

function DocSelectorPanel({
  poList,
  woPOList,
  workDoneList,
  todList,
  grnList,
  loadingPO,
  loadingWorkDone,
  loadingWOPO,
  loadingTOD,
  loadingGRN,
  companyOptions,
  projectOptions,
  suppliers,
  selected,
  finYear,
  filterCompanyId,
  filterProjectId,
  filterFinYear,
  filterSupplier,
  bookedPOIds,
  bookedWorkDoneIds,
  bookedWOPOIds,
  bookedGRNIds,
  onSelect,
  onClear,
  onTodSelected,
}: DocSelectorProps) {
  const [tab, setTab] = useState<SourceKind>("PO");
  const [search, setSearch] = useState("");
  const [todFetching, setTodFetching] = useState(false);

  const selectTod = async (tod: TodItem) => {
    setTodFetching(true);
    try {
      const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
      const data = await apiFetch(
        `/api/document-type/${tod.TypeOfDocId}/next-number${qs}`,
      );
      const docNo = data.nextDocNo ?? (tod.FullPrefix ?? tod.Prefix) + "/001";
      onTodSelected?.(tod);
      onSelect({
        kind: "TOD",
        docNo,
        sourceId: tod.TypeOfDocId,
        nameLabel: tod.Description,
      });
    } catch (err) {
      onTodSelected?.(null);
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setTodFetching(false);
    }
  };

  const q = search.toLowerCase();

  const inFinYear = (docNo?: string, recFinYear?: string) => {
    if (!filterFinYear) return true;
    if (recFinYear) return recFinYear === filterFinYear;
    if (!docNo) return true;
    if (docNo.includes(filterFinYear)) return true;
    const [startYearStr, endYearStr] = filterFinYear.split("-");
    if (startYearStr && docNo.includes(`-${startYearStr}-`)) return true;
    if (endYearStr && docNo.includes(`-${endYearStr}-`)) return true;
    return false;
  };

  const filteredPO = poList.filter((p) => {
    if (bookedPOIds?.has(p.PurchaseOrderID)) return false;
    if (
      filterCompanyId &&
      p.CompanyId &&
      Number(p.CompanyId) !== Number(filterCompanyId)
    )
      return false;
    if (
      filterProjectId &&
      p.ProjectId &&
      Number(p.ProjectId) !== Number(filterProjectId)
    )
      return false;
    if (!inFinYear(p.DocNo || p.PurchaseOrderNo)) return false;
    if (
      filterSupplier &&
      (p.SupplierName || "").toLowerCase() !== filterSupplier.toLowerCase()
    )
      return false;
    return (
      (p.DocNo || p.PurchaseOrderNo).toLowerCase().includes(q) ||
      (p.SupplierName || "").toLowerCase().includes(q)
    );
  });
  const filteredWorkDone = workDoneList.filter((wd) => {
    if (bookedWorkDoneIds?.has(wd.ID)) return false;
    if (
      filterCompanyId &&
      wd.CompanyId &&
      Number(wd.CompanyId) !== Number(filterCompanyId)
    )
      return false;
    if (
      filterProjectId &&
      wd.ProjectId &&
      Number(wd.ProjectId) !== Number(filterProjectId)
    )
      return false;
    if (!inFinYear(wd.DocNo, wd.FinYear)) return false;
    if (
      filterSupplier &&
      (wd.ContractorName || "").toLowerCase() !== filterSupplier.toLowerCase()
    )
      return false;
    return (
      (wd.DocNo || "").toLowerCase().includes(q) ||
      (wd.ContractorName || "").toLowerCase().includes(q) ||
      (wd.WorkOrderNo || "").toLowerCase().includes(q) ||
      (wd.DescriptionOfWork || "").toLowerCase().includes(q)
    );
  });
  const filteredWOPO = woPOList.filter((p) => {
    if (bookedWOPOIds?.has(p.PurchaseOrderID)) return false;
    if (
      filterCompanyId &&
      p.CompanyId &&
      Number(p.CompanyId) !== Number(filterCompanyId)
    )
      return false;
    if (
      filterProjectId &&
      p.ProjectId &&
      Number(p.ProjectId) !== Number(filterProjectId)
    )
      return false;
    if (!inFinYear(p.DocNo || p.PurchaseOrderNo)) return false;
    if (
      filterSupplier &&
      (p.SupplierName || "").toLowerCase() !== filterSupplier.toLowerCase()
    )
      return false;
    return (
      (p.DocNo || p.PurchaseOrderNo).toLowerCase().includes(q) ||
      (p.SupplierName || "").toLowerCase().includes(q) ||
      (p.SourceWODocNo || "").toLowerCase().includes(q)
    );
  });
  const filteredTOD = todList.filter(
    (t) =>
      (t.FullPrefix ?? t.Prefix).toLowerCase().includes(q) ||
      t.Description.toLowerCase().includes(q),
  );
  const filteredGRN = grnList.filter((g) => {
    if (bookedGRNIds?.has(g.GRNID)) return false;
    if (
      filterCompanyId &&
      g.CompanyId &&
      Number(g.CompanyId) !== Number(filterCompanyId)
    )
      return false;
    if (
      filterProjectId &&
      g.ProjectId &&
      Number(g.ProjectId) !== Number(filterProjectId)
    )
      return false;
    const grnDocNo = g.DocNo || g.GRNNo;
    if (!inFinYear(grnDocNo, (g as any).FinYear)) return false;
    if (
      filterSupplier &&
      (g.SupplierName || "").trim().toLowerCase() !==
        filterSupplier.trim().toLowerCase()
    )
      return false;
    return (
      (grnDocNo || "").toLowerCase().includes(q) ||
      (g.SupplierName || "").toLowerCase().includes(q) ||
      (g.PONumber || "").toLowerCase().includes(q)
    );
  });

  if (selected) {
    const isPO = selected.kind === "PO",
      isWorkDone = selected.kind === "WORK_DONE",
      isWOPO = selected.kind === "WO_PO",
      isGRN = selected.kind === "GRN";
    const Icon = isPO
      ? ShoppingCart
      : isWorkDone
        ? Hammer
        : isWOPO
          ? Package
          : isGRN
            ? Truck
            : FileText;
    const colors = isPO
      ? {
          ring: "border-blue-500/30 bg-blue-500/5",
          icon: "bg-blue-500/10",
          text: "text-blue-500",
          badge:
            "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
        }
      : isWorkDone
        ? {
            ring: "border-violet-500/30 bg-violet-500/5",
            icon: "bg-violet-500/10",
            text: "text-violet-500",
            badge:
              "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
          }
        : isWOPO
          ? {
              ring: "border-amber-500/30 bg-amber-500/5",
              icon: "bg-amber-500/10",
              text: "text-amber-600",
              badge:
                "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
            }
          : isGRN
            ? {
                ring: "border-teal-500/30 bg-teal-500/5",
                icon: "bg-teal-500/10",
                text: "text-teal-500",
                badge:
                  "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
              }
            : {
                ring: "border-emerald-500/30 bg-emerald-500/5",
                icon: "bg-emerald-500/10",
                text: "text-emerald-500",
                badge:
                  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
              };
    return (
      <div className={`rounded-xl border p-4 ${colors.ring}`}>
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-lg ${colors.icon} flex items-center justify-center shrink-0`}
            >
              <Icon size={15} className={colors.text} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs font-heading font-semibold ${colors.text}`}
                >
                  {isPO
                    ? "Purchase Order"
                    : isWorkDone
                      ? "Work Done"
                      : isWOPO
                        ? "WO Material PO"
                        : isGRN
                          ? "Goods Receipt Note"
                          : "Document"}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${colors.badge}`}
                >
                  {selected.docNo}
                </span>
                {selected.status && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] border border-border bg-muted/50 text-muted-foreground">
                    {selected.status}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.vendorLabel && (
                  <InfoPill
                    icon={User}
                    label={
                      isPO
                        ? "Supplier"
                        : isWorkDone
                          ? "Contractor"
                          : isWOPO
                            ? "Supplier"
                            : isGRN
                              ? "Supplier"
                              : "Vendor"
                    }
                    value={selected.vendorLabel}
                  />
                )}
                {!isGRN && selected.amount != null && (
                  <InfoPill
                    icon={Banknote}
                    label="Order Value"
                    value={`₹${fmt(selected.amount)}`}
                  />
                )}
                {isGRN &&
                  Array.isArray(selected.grnItems) &&
                  selected.grnItems.length > 0 &&
                  (() => {
                    const totalReceived = selected.grnItems.reduce(
                      (s, i) => s + (Number(i.receivedQty) || 0),
                      0,
                    );
                    const totalRemaining = selected.grnItems.reduce(
                      (s, i) => s + (Number(i.remainingQty) || 0),
                      0,
                    );
                    return (
                      <>
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <Package
                            size={11}
                            className="text-emerald-600 dark:text-emerald-400 shrink-0"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            Received:
                          </span>
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {totalReceived} units
                          </span>
                        </div>
                        {totalRemaining > 0 && (
                          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                            <Clock
                              size={11}
                              className="text-amber-600 dark:text-amber-400 shrink-0"
                            />
                            <span className="text-[10px] text-muted-foreground">
                              Pending:
                            </span>
                            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                              {totalRemaining} units
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50">
                          <Truck
                            size={11}
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {selected.grnItems.length}{" "}
                            {selected.grnItems.length === 1 ? "item" : "items"}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                {selected.date && (
                  <InfoPill
                    icon={CalendarDays}
                    label="Date"
                    value={selected.date.slice(0, 10)}
                  />
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              onTodSelected?.(null);
              onClear();
            }}
            className="flex items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-destructive transition-colors shrink-0 px-2 py-1.5 sm:py-1 rounded-md hover:bg-destructive/5 border border-transparent hover:border-destructive/20 w-full sm:w-auto mt-2 sm:mt-0"
          >
            <X size={10} /> Change
          </button>
        </div>
      </div>
    );
  }

  const tabs: {
    id: SourceKind;
    label: string;
    icon: React.ElementType;
    count: number;
  }[] = [
    {
      id: "PO",
      label: "Purchase Orders",
      icon: ShoppingCart,
      count: filteredPO.length,
    },
    {
      id: "WORK_DONE",
      label: "Work Done",
      icon: Hammer,
      count: filteredWorkDone.length,
    },
    {
      id: "WO_PO",
      label: "WO Material POs",
      icon: Package,
      count: filteredWOPO.length,
    },
    { id: "GRN", label: "GRN", icon: Truck, count: filteredGRN.length },
    {
      id: "TOD",
      label: "Other Expenses",
      icon: FileText,
      count: todList.length,
    },
  ];
  const loading =
    tab === "PO"
      ? loadingPO
      : tab === "WORK_DONE"
        ? loadingWorkDone
        : tab === "WO_PO"
          ? loadingWOPO
          : tab === "GRN"
            ? loadingGRN
            : loadingTOD;
  const placeholder =
    tab === "PO"
      ? "Search by PO number or supplier…"
      : tab === "WORK_DONE"
        ? "Search by Work Done doc no, contractor, or WO ref…"
        : tab === "WO_PO"
          ? "Search by WO_PO number, supplier, or WO ref…"
          : tab === "GRN"
            ? "Search by GRN number, supplier, or PO…"
            : "Search document types…";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex border-b border-border bg-muted/20 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id as SourceKind);
              setSearch("");
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-heading font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap ${tab === t.id ? "border-primary text-primary bg-background" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <t.icon size={11} />
            {t.label}
            <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground font-normal">
              {t.count}
            </span>
          </button>
        ))}
      </div>
      <div className="p-3 border-b border-border/40 bg-background">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-60 overflow-y-auto bg-background">
        {loading || todFetching ? (
          <div className="flex items-center justify-center py-10 gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {todFetching ? "Fetching next document number…" : "Loading…"}
          </div>
        ) : tab === "PO" ? (
          filteredPO.length === 0 ? (
            <EmptyState label="No purchase orders found" />
          ) : (
            filteredPO.map((po) => {
              const docNo = po.DocNo || po.PurchaseOrderNo;
              return (
                <PickerRow
                  key={po.PurchaseOrderID}
                  icon={<ShoppingCart size={12} className="text-blue-500" />}
                  iconBg="bg-blue-500/10"
                  primary={docNo}
                  primaryColor="text-blue-600 dark:text-blue-400"
                  secondary={[po.SupplierName, po.PODate?.slice(0, 10)]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={po.Status}
                  amount={po.TotalAmount}
                  onClick={() =>
                    onSelect({
                      kind: "PO",
                      docNo,
                      sourceId: po.PurchaseOrderID,
                      nameLabel: po.ItemDescription,
                      vendorLabel: po.SupplierName,
                      companyId: po.CompanyId,
                      projectId: po.ProjectId,
                      amount: po.TotalAmount,
                      status: po.Status,
                      date: po.PODate,
                      gst: po.GST ?? null,
                    })
                  }
                />
              );
            })
          )
        ) : tab === "WORK_DONE" ? (
          filteredWorkDone.length === 0 ? (
            <EmptyState label="No approved Work Done entries found" />
          ) : (
            filteredWorkDone.map((wd) => {
              return (
                <PickerRow
                  key={wd.ID}
                  icon={<Hammer size={12} className="text-violet-500" />}
                  iconBg="bg-violet-500/10"
                  primary={wd.DocNo || `WD-${wd.ID}`}
                  primaryColor="text-violet-600 dark:text-violet-400"
                  secondary={[
                    wd.ContractorName,
                    wd.WorkOrderNo ? `WO: ${wd.WorkOrderNo}` : null,
                    wd.DocDate?.slice(0, 10),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={wd.Status}
                  amount={wd.CertifiedAmount}
                  onClick={() =>
                    onSelect({
                      kind: "WORK_DONE",
                      docNo: wd.DocNo || `WD-${wd.ID}`,
                      sourceId: wd.ID,
                      nameLabel: wd.DescriptionOfWork,
                      vendorLabel: wd.ContractorName,
                      companyId: wd.CompanyId,
                      projectId: wd.ProjectId,
                      amount: wd.CertifiedAmount,
                      status: wd.Status,
                      date: wd.DocDate,
                      gst: wd.GST ?? null,
                    })
                  }
                />
              );
            })
          )
        ) : tab === "WO_PO" ? (
          filteredWOPO.length === 0 ? (
            <EmptyState label="No WO Material POs found" />
          ) : (
            filteredWOPO.map((po) => {
              const docNo = po.DocNo || po.PurchaseOrderNo;
              return (
                <PickerRow
                  key={po.PurchaseOrderID}
                  icon={<Package size={12} className="text-amber-600" />}
                  iconBg="bg-amber-500/10"
                  primary={docNo}
                  primaryColor="text-amber-600 dark:text-amber-400"
                  secondary={[
                    po.SupplierName,
                    po.SourceWODocNo ? `WO: ${po.SourceWODocNo}` : null,
                    po.SourceWDDocNo ? `WD: ${po.SourceWDDocNo}` : null,
                    po.PODate?.slice(0, 10),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={po.Status}
                  amount={po.TotalAmount}
                  onClick={() =>
                    onSelect({
                      kind: "WO_PO",
                      docNo,
                      sourceId: po.PurchaseOrderID,
                      nameLabel: po.ItemDescription,
                      vendorLabel: po.SupplierName,
                      companyId: po.CompanyId,
                      projectId: po.ProjectId,
                      amount: po.TotalAmount,
                      status: po.Status,
                      date: po.PODate,
                      gst: po.GST ?? null,
                    })
                  }
                />
              );
            })
          )
        ) : tab === "GRN" ? (
          <>
            {loadingGRN ? (
              <div className="flex items-center justify-center py-10 gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Loading GRNs…
              </div>
            ) : filteredGRN.length === 0 ? (
              <EmptyState label="No GRNs found" />
            ) : (
              filteredGRN.map((g) => {
                const parsedItems: GRNItemLine[] = (() => {
                  try {
                    if (Array.isArray(g.GRNItems))
                      return g.GRNItems as GRNItemLine[];
                    if (typeof g.GRNItems === "string" && g.GRNItems.trim()) {
                      const parsed = JSON.parse(g.GRNItems);
                      return Array.isArray(parsed) ? parsed : [];
                    }
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Something went wrong",
                    );
                    /* ignore */
                  }
                  return [];
                })();
                const totalReceived = parsedItems.reduce(
                  (s, i) => s + (Number(i.receivedQty) || 0),
                  0,
                );
                const totalRemaining = parsedItems.reduce(
                  (s, i) => s + (Number(i.remainingQty) || 0),
                  0,
                );
                return (
                  <button
                    key={g.GRNID}
                    onClick={() =>
                      onSelect({
                        kind: "GRN",
                        docNo: g.DocNo || g.GRNNo || "",
                        sourceId: g.GRNID,
                        vendorLabel: g.SupplierName,
                        status: g.Status,
                        date: g.GRNDate,
                        nameLabel:
                          g.Remarks ||
                          g.SupplierName ||
                          g.DocNo ||
                          g.GRNNo ||
                          "GRN Expense",
                        grnItems: parsedItems,
                        projectId: g.ProjectId,
                        companyId: g.CompanyId,
                        gst:
                          typeof g.ParentGST === "string"
                            ? (() => {
                                try {
                                  return JSON.parse(g.ParentGST!);
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error
                                      ? err.message
                                      : "Something went wrong",
                                  );
                                  return null;
                                }
                              })()
                            : (g.ParentGST ?? null),
                      })
                    }
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border/30 last:border-0 text-left group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Truck size={12} className="text-teal-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-teal-600 dark:text-teal-400">
                          {g.DocNo || g.GRNNo || "—"}
                        </span>
                        {g.Status && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
                            {g.Status}
                          </span>
                        )}
                        {g.PONumber && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                            PO: {g.PONumber}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {[g.SupplierName, g.GRNDate?.slice(0, 10)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {parsedItems.length > 0 && (
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">
                            <Package size={9} />
                            {totalReceived} received
                          </span>
                          {totalRemaining > 0 && (
                            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-md">
                              <Clock size={9} />
                              {totalRemaining} pending
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {parsedItems.length}{" "}
                            {parsedItems.length === 1 ? "item" : "items"}
                          </span>
                        </div>
                      )}
                    </div>
                    <ChevronRight
                      size={12}
                      className="text-muted-foreground/30 shrink-0 mt-1"
                    />
                  </button>
                );
              })
            )}
          </>
        ) : filteredTOD.length === 0 ? (
          <EmptyState label="No other expense types found" />
        ) : (
          filteredTOD.map((tod) => (
            <PickerRow
              key={tod.TypeOfDocId}
              icon={<Hash size={12} className="text-emerald-500" />}
              iconBg="bg-emerald-500/10"
              primary={tod.FullPrefix ?? tod.Prefix}
              primaryColor="text-emerald-600 dark:text-emerald-400"
              secondary={tod.Description}
              badge={tod.EntryType}
              onClick={() => selectTod(tod)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveGstRates(
  doc: SelectedDoc,
  fallbackCgst: number,
  fallbackSgst: number,
) {
  if (doc.kind === "GRN") return { cgst: 0, sgst: 0 };

  if (doc.kind === "PO" || doc.kind === "WORK_DONE" || doc.kind === "WO_PO") {
    if (doc.gst?.applicable) {
      const { type, rate } = doc.gst;
      if (type === "cgst_sgst") return { cgst: rate / 2, sgst: rate / 2 };
      if (type === "igst") return { cgst: rate, sgst: 0 };
    }
    return { cgst: 0, sgst: 0 };
  }

  return { cgst: fallbackCgst, sgst: fallbackSgst };
}

function GRNChainBadge({
  bookingId,
}: {
  bookingId: string | null | undefined;
}) {
  const [grns, setGrns] = useState<{ GRNNo: string }[]>([]);
  useEffect(() => {
    if (!bookingId) return;
    fetchWithAuth(`/api/expense-booking/${bookingId}/grns`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setGrns(Array.isArray(data) ? data : []))
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Something went wrong",
        );
      });
  }, [bookingId]);
  if (grns.length === 0)
    return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {grns.map((g) => (
        <span
          key={g.GRNNo}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800 font-mono"
        >
          <Truck size={9} />
          {g.GRNNo}
        </span>
      ))}
    </div>
  );
}

function parseGRNItemsFromRaw(raw: unknown): GRNItemLine[] {
  try {
    if (Array.isArray(raw)) return raw as GRNItemLine[];
    if (typeof raw === "string" && raw.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as GRNItemLine[];
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Something went wrong");
    /* fall through */
  }
  return [];
}

// ─── Main Component ───────────────────────────────────────────────────────────
const BOOKING_STATUSES: BookingStatus[] = [
  "Draft",
  "Pending",
  "Approved",
  "Rejected",
  "Booked",
  "Hold",
  "Received",
];
const ALL_STATUSES = ["All", ...BOOKING_STATUSES] as const;
const PAGE_SIZE = 20;

export default function MaterialExpenseBooking() {
  const { finYears } = useFinYear();
  const activeFinYears = finYears
    .filter((fy) => fy.status === "Active")
    .sort((a, b) => b.year.localeCompare(a.year));

  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [poList, setPoList] = useState<POItem[]>([]);
  const [workDoneList, setWorkDoneList] = useState<WorkDoneItem[]>([]);
  const [woPOList, setWoPOList] = useState<POItem[]>([]);
  const [todList, setTodList] = useState<TodItem[]>([]);
  const [grnList, setGrnList] = useState<GRNItem[]>([]);
  const [loadingPO, setLoadingPO] = useState(false);
  const [loadingWorkDone, setLoadingWorkDone] = useState(false);
  const [loadingWOPO, setLoadingWOPO] = useState(false);
  const [loadingTOD, setLoadingTOD] = useState(false);
  const [loadingGRN, setLoadingGRN] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<SelectedDoc | null>(null);
  const [grnItemsLoading, setGrnItemsLoading] = useState(false);
  const [gstBreakdown, setGstBreakdown] = useState<{
    items: GRNItemLine[];
    totals: {
      totalBase: number;
      totalCGST: number;
      totalSGST: number;
      totalGST: number;
      totalInclGST: number;
    };
  } | null>(null);
  const [selectedTod, setSelectedTod] = useState<TodItem | null>(null);
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [bookedSourceIds, setBookedSourceIds] = useState<
    { ESourceType: string; ESourceId: number; Eid: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [view, setView] = useState<PageView>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ExpenseRecord, "id">>(blankForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [approvalTrail, setApprovalTrail] =
    useState<ExpenseRecord["approvalTrail"]>(undefined);
  const [liveEmiSchedule, setLiveEmiSchedule] = useState<
    import("./ExpenseBooking/types").EmiScheduleRow[] | null
  >(null);
  const [loadingEmi, setLoadingEmi] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<ExpenseRecord | null>(
    null,
  );
  const [suppliers, setSuppliers] = useState<{ id: number; label: string }[]>(
    [],
  );
  const [supplierHeads, setSupplierHeads] = useState<
    { id: number; label: string }[]
  >([]);
  const [billingTerms, setBillingTerms] = useState<BillingTermOption[]>([]);
  const [tcOptions, setTcOptions] = useState<TCOption[]>([]);

  const isEditing = editingId !== null;

  const fetchRecords = useCallback(async (p = 1) => {
    try {
      setLoading(true);
      const data = await apiFetch(`${API}?page=${p}&limit=${PAGE_SIZE}`);
      setRecords((data.data ?? []).map(dbToRecord));
      setTotalPages(data.totalPages ?? 1);
      setTotalRecords(data.total ?? 0);
      setPage(p);
    } catch (err: any) {
      toast.error("Failed to load bookings: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBookedSources = useCallback(async () => {
    try {
      const data = await apiFetch(`${API}/source-ids`);
      setBookedSourceIds(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      // non-fatal — pickers will show everything if this fails
    }
  }, []);

  const fetchMasters = () => {
    const load = <T,>(
      key: keyof typeof _mastersCache,
      url: string,
      setter: (v: T[]) => void,
      setLd: (v: boolean) => void,
      transform?: (r: any) => T[],
    ) => {
      if (_mastersCache[key]) {
        setter(_mastersCache[key] as T[]);
        return;
      }
      setLd(true);
      apiFetch(url)
        .then((r) => {
          const list: T[] = transform
            ? transform(r)
            : Array.isArray(r)
              ? r
              : (r.data ?? []);
          (_mastersCache as any)[key] = list;
          setter(list);
        })
        .catch((err) => {
          toast.error(
            err instanceof Error ? err.message : "Something went wrong",
          );
        })
        .finally(() => setLd(false));
    };

    _mastersCache.po = null;
    _mastersCache.woPO = null;
    load("po", "/api/purchase-orders?limit=500", setPoList, setLoadingPO);
    _mastersCache.workDone = null;
    setLoadingWorkDone(true);
    apiFetch("/api/engineering/work-done?status=Approved&limit=500")
      .then((r: any) => {
        const all: WorkDoneItem[] = Array.isArray(r) ? r : (r.data ?? []);
        const list = all.filter(
          (wd) => (wd.Status ?? "").toLowerCase() === "approved",
        );
        _mastersCache.workDone = list;
        setWorkDoneList(list);
      })
      .catch((err: any) => {
        console.error("Work Done fetch failed:", err?.message);
        toast.error(
          "Could not load Work Done list: " + (err?.message ?? "Unknown error"),
        );
      })
      .finally(() => setLoadingWorkDone(false));
    load<POItem>(
      "woPO",
      "/api/purchase-orders?limit=500",
      setWoPOList,
      setLoadingWOPO,
      (r) => {
        const all: POItem[] = Array.isArray(r) ? r : (r.data ?? []);
        return all.filter(
          (p) =>
            p.SourceWOId != null ||
            p.SourceWDId != null ||
            p.POType === "WO_PO",
        );
      },
    );
    load<TodItem>("tod", "/api/document-type", setTodList, setLoadingTOD, (r) =>
      (Array.isArray(r) ? r : []).filter(
        (t) => !["PO", "WO"].includes((t as any).ModuleTag ?? ""),
      ),
    );

    _mastersCache.grn = null;
    setLoadingGRN(true);
    apiFetch("/api/grns?limit=500")
      .then((r) => {
        const list: GRNItem[] = Array.isArray(r) ? r : (r?.data ?? []);
        _mastersCache.grn = list;
        setGrnList(list);
      })
      .catch((err: any) => {
        console.error("GRN list fetch failed:", err?.message);
        toast.error(
          "Could not load GRN list: " + (err?.message ?? "Unknown error"),
        );
      })
      .finally(() => setLoadingGRN(false));
  };

  useEffect(() => {
    if (!selectedTod || !selectedDoc || selectedDoc.kind !== "TOD") return;
    let cancelled = false;
    (async () => {
      try {
        const qs = form.financialYear
          ? `?finYear=${encodeURIComponent(form.financialYear)}`
          : "";
        const data = await apiFetch(
          `/api/document-type/${selectedTod.TypeOfDocId}/next-number${qs}`,
        );
        if (cancelled) return;
        const docNo =
          data.nextDocNo ??
          (selectedTod.FullPrefix ?? selectedTod.Prefix) + "/001";
        setSelectedDoc((prev) => (prev ? { ...prev, docNo } : prev));
        setForm((prev) => ({ ...prev, bookingReference: docNo }));
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Something went wrong",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.financialYear, selectedTod]);

  useEffect(() => {
    fetchRecords(1);
    fetchBookedSources();
    apiFetch("/api/enterprises/options?business_type=C")
      .then((list: CompanyOption[]) => setCompanyOptions(list ?? []))
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Something went wrong",
        );
      });
    apiFetch("/api/enterprises/options?business_type=P")
      .then((list: ProjectOption[]) => setProjectOptions(list ?? []))
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Something went wrong",
        );
      });
    apiFetch("/api/enterprises/options?business_type=S")
      .then((list: { id: number; label: string }[]) => setSuppliers(list ?? []))
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Something went wrong",
        );
      });
    apiFetch("/api/account-head?type=S")
      .then((list: any[]) => {
        const heads = (Array.isArray(list) ? list : []).map((h) => ({
          id: h.LHeadId,
          label: h.LHeadName,
        }));
        setSupplierHeads(heads);
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Something went wrong",
        );
      });
    apiFetch("/api/billing-terms")
      .then((list: BillingTermOption[]) =>
        setBillingTerms(
          (Array.isArray(list) ? list : []).filter((t) => t.IsActive !== false),
        ),
      )
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "Something went wrong",
        );
      });
    apiFetch("/api/tc-master")
      .then((list: TCOption[]) => setTcOptions(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [fetchRecords]);

  const set = <K extends keyof Omit<ExpenseRecord, "id">>(
    field: K,
    value: Omit<ExpenseRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const applyDoc = (doc: SelectedDoc) => {
    setSelectedDoc(doc);

    if (doc.kind === "GRN") {
      setSelectedDoc({ ...doc, grnItems: [] });
      setGstBreakdown(null);
      setGrnItemsLoading(true);
      apiFetch(`/api/grns/${doc.sourceId}`)
        .then((r: any) => {
          const items = parseGRNItemsFromRaw(r.GRNItems);
          const rawDocNo: string = r.GRNNo || r.DocNo || doc.docNo;
          const canonicalDocNo = rawDocNo
            ? rawDocNo.startsWith("GRN-")
              ? rawDocNo
              : `GRN-${rawDocNo}`
            : rawDocNo;
          const grnTotal =
            Math.round((parseFloat(r.TotalAmount) || 0) * 100) / 100;
          setSelectedDoc((prev) =>
            prev && prev.kind === "GRN" && prev.sourceId === doc.sourceId
              ? {
                  ...prev,
                  docNo: canonicalDocNo,
                  grnItems: items,
                  amount: grnTotal,
                }
              : prev,
          );
          if (items.length === 0)
            toast.info("This GRN has no item lines recorded against it.");

          // Fetch GST breakdown — back-calculates base/tax per item using Item_Master_Group HSN rates
          return apiFetch(`/api/grns/${doc.sourceId}/gst-breakdown`)
            .then((bd: any) => {
              setGstBreakdown(bd);
              const t = bd?.totals;
              if (t && t.totalInclGST > 0) {
                const avgCGST =
                  t.totalBase > 0 ? (t.totalCGST / t.totalBase) * 100 : 0;
                const avgSGST =
                  t.totalBase > 0 ? (t.totalSGST / t.totalBase) * 100 : 0;
                const cleanTotal = Math.round(t.totalInclGST * 100) / 100;
                setSelectedDoc((prev) =>
                  prev && prev.kind === "GRN"
                    ? { ...prev, amount: cleanTotal }
                    : prev,
                );
                setForm((prev) => ({
                  ...prev,
                  bookingReference: canonicalDocNo,
                  basicAmount: Math.round(t.totalBase * 100) / 100,
                  cgstRate: Math.round(avgCGST * 100) / 100,
                  sgstRate: Math.round(avgSGST * 100) / 100,
                }));
              } else {
                setForm((prev) => ({
                  ...prev,
                  bookingReference: canonicalDocNo,
                  basicAmount: grnTotal > 0 ? grnTotal : prev.basicAmount,
                }));
              }
            })
            .catch(() => {
              setForm((prev) => ({
                ...prev,
                bookingReference: canonicalDocNo,
                basicAmount: grnTotal > 0 ? grnTotal : prev.basicAmount,
              }));
            });
        })
        .catch((err: any) => {
          toast.error(
            "Could not load GRN items: " +
              (err?.message ?? "Unknown error") +
              ". Check that the /api/grns/:id endpoint is deployed.",
          );
        })
        .finally(() => setGrnItemsLoading(false));
    }

    const { cgst, sgst } = resolveGstRates(doc, form.cgstRate, form.sgstRate);
    setForm((prev) => ({
      ...prev,
      bookingReference: doc.docNo,
      bookingName: doc.nameLabel ?? prev.bookingName,
      basicAmount:
        doc.kind === "GRN"
          ? prev.basicAmount
          : (doc.amount ?? prev.basicAmount),
      companyId: doc.companyId ?? prev.companyId,
      projectSite: doc.projectId ? String(doc.projectId) : prev.projectSite,
      supplier: doc.vendorLabel ?? prev.supplier,
      materialCategory:
        doc.kind === "PO"
          ? "PO"
          : doc.kind === "WORK_DONE"
            ? "WORK_DONE"
            : doc.kind === "WO_PO"
              ? "WO_PO"
              : doc.kind === "GRN"
                ? "GRN"
                : doc.docNo.split("/")[0],
      cgstRate: cgst,
      sgstRate: sgst,
      workDoneRef:
        doc.kind === "WORK_DONE"
          ? doc.docNo
          : doc.kind === "WO_PO" && (doc as any).sourcWDDocNo
            ? (doc as any).sourceWDDocNo
            : undefined,
    }));
  };

  const clearDoc = () => {
    setSelectedDoc(null);
    setSelectedTod(null);
    setGrnItemsLoading(false);
    setGstBreakdown(null);
    setForm((prev) => ({
      ...prev,
      bookingReference: "",
      basicAmount: 0,
      supplier: "",
    }));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(blankForm());
    setApprovalTrail(undefined);
    setSelectedDoc(null);
    setSelectedTod(null);
    setLiveEmiSchedule(null);
    setPreviewRecord(null);
  };

  const openNew = () => {
    resetForm();
    setForm({ ...blankForm(), financialYear: activeFinYears[0]?.year || "" });
    _mastersCache.grn = null;
    fetchMasters();
    setView("form");
  };

  const openEdit = (rec: ExpenseRecord) => {
    resetForm();
    if (!rec.id) {
      toast.error("Cannot edit this booking because its record id is missing.");
      return;
    }
    setEditingId(rec.id);
    const { id, ...rest } = rec;
    setForm(rest);
    setApprovalTrail(undefined);
    setLiveEmiSchedule(null);

    if (rec.eSourceType && rec.eSourceId) {
      const kind = rec.eSourceType;
      const sourceId = rec.eSourceId;
      const docNo = rec.bookingReference;

      if (kind === "GRN") {
        const stub: SelectedDoc = {
          kind: "GRN",
          docNo,
          sourceId,
          grnItems: [],
        };
        setSelectedDoc(stub);
        setGrnItemsLoading(true);
        apiFetch(`/api/grns/${sourceId}`)
          .then((r: any) => {
            const items = parseGRNItemsFromRaw(r.GRNItems);
            const rawDocNo: string = r.GRNNo || r.DocNo || docNo;
            const canonical = rawDocNo.startsWith("GRN-")
              ? rawDocNo
              : `GRN-${rawDocNo}`;
            const parsedParentGST: GSTConfig | null = (() => {
              if (!r.ParentGST) return null;
              if (typeof r.ParentGST === "object")
                return r.ParentGST as GSTConfig;
              try {
                return JSON.parse(r.ParentGST) as GSTConfig;
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Something went wrong",
                );
                return null;
              }
            })();
            setSelectedDoc({
              kind: "GRN",
              docNo: canonical,
              sourceId,
              vendorLabel: r.SupplierName,
              status: r.Status,
              date: r.GRNDate?.slice(0, 10),
              grnItems: items,
              amount: Math.round((parseFloat(r.TotalAmount) || 0) * 100) / 100,
              gst: parsedParentGST,
            });
            setForm((prev) => ({
              ...prev,
              supplier: r.SupplierName ?? prev.supplier,
              projectSite: r.ProjectId ? String(r.ProjectId) : prev.projectSite,
            }));
          })
          .catch((err) => {
            toast.error(
              err instanceof Error ? err.message : "Something went wrong",
            );
          })
          .finally(() => setGrnItemsLoading(false));
      } else if (kind === "PO") {
        const tryBuildPO = (list: POItem[]) => {
          const po = list.find((p) => p.PurchaseOrderID === sourceId);
          if (po) {
            setSelectedDoc({
              kind: "PO",
              docNo: po.DocNo || po.PurchaseOrderNo,
              sourceId,
              vendorLabel: po.SupplierName,
              companyId: po.CompanyId,
              projectId: po.ProjectId,
              amount: po.TotalAmount,
              status: po.Status,
              date: po.PODate,
              gst: po.GST ?? null,
            });
            setForm((prev) => ({
              ...prev,
              supplier: po.SupplierName ?? prev.supplier,
              projectSite: po.ProjectId
                ? String(po.ProjectId)
                : prev.projectSite,
            }));
          }
        };
        if (_mastersCache.po) {
          tryBuildPO(_mastersCache.po);
        } else {
          apiFetch("/api/purchase-orders?limit=500")
            .then((r: any) => {
              const list: POItem[] = Array.isArray(r) ? r : (r.data ?? []);
              _mastersCache.po = list;
              tryBuildPO(list);
            })
            .catch(() => {});
        }
      } else if (kind === "WORK_DONE") {
        const tryBuildWorkDone = (list: WorkDoneItem[]) => {
          const wd = list.find((w) => w.ID === sourceId);
          if (wd) {
            setSelectedDoc({
              kind: "WORK_DONE",
              docNo: wd.DocNo || `WD-${wd.ID}`,
              sourceId,
              vendorLabel: wd.ContractorName,
              companyId: wd.CompanyId,
              projectId: wd.ProjectId,
              amount: wd.CertifiedAmount,
              status: wd.Status,
              date: wd.DocDate,
              gst: wd.GST ?? null,
            });
            setForm((prev) => ({
              ...prev,
              supplier: wd.ContractorName ?? prev.supplier,
              projectSite: wd.ProjectId
                ? String(wd.ProjectId)
                : prev.projectSite,
            }));
          }
        };
        if (_mastersCache.workDone) {
          tryBuildWorkDone(_mastersCache.workDone);
        } else {
          apiFetch("/api/engineering/work-done?status=Approved&limit=500")
            .then((r: any) => {
              const all: WorkDoneItem[] = Array.isArray(r) ? r : (r.data ?? []);
              const list = all.filter(
                (wd) => (wd.Status ?? "").toLowerCase() === "approved",
              );
              _mastersCache.workDone = list;
              tryBuildWorkDone(list);
            })
            .catch(() => {});
        }
      } else if (kind === "WO_PO") {
        const tryBuildWOPO = (list: POItem[]) => {
          const po = list.find((p) => p.PurchaseOrderID === sourceId);
          if (po) {
            setSelectedDoc({
              kind: "WO_PO",
              docNo: po.DocNo || po.PurchaseOrderNo,
              sourceId,
              vendorLabel: po.SupplierName,
              companyId: po.CompanyId,
              projectId: po.ProjectId,
              amount: po.TotalAmount,
              status: po.Status,
              date: po.PODate,
              gst: po.GST ?? null,
            });
            setForm((prev) => ({
              ...prev,
              supplier: po.SupplierName ?? prev.supplier,
              projectSite: po.ProjectId
                ? String(po.ProjectId)
                : prev.projectSite,
            }));
          }
        };
        if (_mastersCache.woPO) {
          tryBuildWOPO(_mastersCache.woPO);
        } else {
          apiFetch("/api/purchase-orders?limit=500")
            .then((r: any) => {
              const all: POItem[] = Array.isArray(r) ? r : (r.data ?? []);
              const list = all.filter(
                (p) =>
                  p.SourceWOId != null ||
                  p.SourceWDId != null ||
                  p.POType === "WO_PO",
              );
              _mastersCache.woPO = list;
              tryBuildWOPO(list);
            })
            .catch(() => {});
        }
      } else if (kind === "TOD") {
        setSelectedDoc({ kind: "TOD", docNo, sourceId });
      }
    } else {
      setSelectedDoc(null);
    }

    if (rec.emi?.enabled) {
      setLoadingEmi(true);
      apiFetch(`${API}/${rec.id}/emi-schedule`)
        .then((rows: any[]) => {
          setLiveEmiSchedule(
            rows.map((r) => ({
              installmentNo: r.InstallmentNo ?? r.installmentNo,
              dueDate: r.DueDate
                ? String(r.DueDate).slice(0, 10)
                : (r.dueDate ?? ""),
              amount: parseFloat(r.Amount ?? r.amount) || 0,
              status: (r.Status ?? r.status ?? "Pending") as "Pending" | "Paid",
              refNumber: r.RefNumber ?? r.refNumber ?? "",
            })),
          );
        })
        .catch(() => setLiveEmiSchedule(null))
        .finally(() => setLoadingEmi(false));
    }
    apiFetch(`${API}/${rec.id}/approval-trail`)
      .then(setApprovalTrail)
      .catch(() => setApprovalTrail(undefined));
    _mastersCache.grn = null;
    fetchMasters();
    setView("form");
  };

  const requestDelete = async (id: string) => {
    try {
      const result = await apiFetch(`${API}/${id}/can-delete`);
      if (!result.deletable) {
        toast.error(result.reason || "This booking cannot be deleted.");
        return;
      }
      setDeleteId(id);
    } catch (err: any) {
      toast.error(
        err.message || "Could not verify whether this booking can be deleted.",
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`${API}/${id}`, { method: "DELETE" });
      toast.success("Expense booking deleted.");
      setDeleteId(null);
      await fetchRecords(page);
      fetchBookedSources();
    } catch (err: any) {
      setDeleteId(null);
      toast.error(err.message || "Failed to delete booking.");
    }
  };

  const cancelForm = () => {
    setView("list");
    resetForm();
  };

  const disableEmi = async () => {
    if (!editingId) return;
    const result = await apiFetch(`${API}/${editingId}/emi-toggle`, {
      method: "PUT",
      body: JSON.stringify({ enabled: false, deleteUnpaid: true }),
    });
    const ref =
      result?.lumpSum?.docNo ||
      (result?.lumpSum ? `#${result.lumpSum.id}` : null);
    if (ref) {
      toast.success(
        `EMI disabled. Remaining balance created as new booking ${ref}. This booking has been reset to Draft for re-approval.`,
        { duration: 8000 },
      );
    } else {
      toast.success(
        "EMI disabled. Booking reset to Draft — please resubmit for approval.",
        { duration: 6000 },
      );
    }
    cancelForm();
    await fetchRecords(page);
    fetchBookedSources();
  };

  const handleSave = async () => {
    if (saveInFlight.current) return;

    if (!form.bookingReference.trim()) {
      toast.error("Please select a document (PO, WO, or Doc Type) first.");
      return;
    }
    if (!form.bookingDate) {
      toast.error("Booking date is required.");
      return;
    }
    if (!form.companyId) {
      toast.error("Please select a company.");
      return;
    }
    if (form.emi.enabled && !form.paymentType) {
      toast.error("Payment type is required for EMI bookings.");
      return;
    }
    if (
      selectedDoc?.kind !== "GRN" &&
      (!form.basicAmount || form.basicAmount <= 0)
    ) {
      toast.error("Basic amount is required and must be greater than 0.");
      return;
    }
    const bd = computeBreakdown(
      form.basicAmount,
      form.cgstRate,
      form.sgstRate,
      form.billingTerms && form.billingTerms.length > 0
        ? form.billingTerms
        : form.discount,
    );
    if (selectedDoc?.kind === "GRN" && selectedDoc.amount != null) {
      const exactGrnTotal = Math.round(selectedDoc.amount * 100) / 100;
      bd.roundOff = exactGrnTotal - bd.grossAmount;
      bd.netAmount = exactGrnTotal;
    }

    let emiForSave = { ...form.emi };
    if (
      !isEditing &&
      form.emi.enabled &&
      form.emi.installmentCount > 0 &&
      form.emi.startDate
    ) {
      const freshSchedule = generateEmiSchedule(
        bd.netAmount,
        form.emi.installmentCount,
        form.emi.startDate,
        form.bookingReference,
      );
      emiForSave = { ...form.emi, schedule: freshSchedule };
    }

    const body = {
      ...recordToDb(
        { ...form, emi: emiForSave },
        bd.netAmount,
        selectedDoc?.kind === "TOD" ? (selectedDoc.sourceId ?? null) : null,
      ),
      ESourceType: selectedDoc?.kind ?? null,
      ESourceId: selectedDoc?.sourceId ?? null,
    };
    saveInFlight.current = true;
    setSaving(true);

    try {
      if (isEditing) {
        if (!editingId) throw new Error("Missing booking id for update.");
        await apiFetch(
          `${API}/${editingId}`,
          {
            method: "PUT",
            body: JSON.stringify(body),
          },
          30000,
        );
        toast.success("Expense booking updated.");
        cancelForm();
        await fetchRecords(page);
        fetchBookedSources();
      } else {
        const result = await apiFetch(
          API,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
          30000,
        );
        toast.success(
          `Expense booking created and sent for approval — Ref: ${result?.docNo || form.bookingReference}`,
        );

        if (
          selectedDoc?.kind === "GRN" &&
          selectedDoc.grnItems &&
          selectedDoc.grnItems.length > 0
        ) {
          const remainingItems = selectedDoc.grnItems.filter(
            (i) => Number(i.remainingQty) > 0,
          );
          if (remainingItems.length > 0) {
            // Auto-create a draft booking for remaining items using the same GRN source
            try {
              const remainingTotal = remainingItems.reduce((s, i) => {
                const amt =
                  Number(i.totalAmount) > 0
                    ? Number(i.totalAmount)
                    : Number(i.rate || 0) * Number(i.remainingQty || 0);
                return s + amt;
              }, 0);
              const itemList = remainingItems
                .map(
                  (i) =>
                    `${i.itemName || "Item"} (${i.remainingQty} remaining)`,
                )
                .join(", ");
              const remarks = (() => {
                const full = `Auto-created for remaining items from GRN ${selectedDoc.docNo}. Items: ${itemList}`;
                return full.length > 990 ? full.slice(0, 987) + "…" : full;
              })();
              const remainingBody = {
                EName: form.bookingName
                  ? `[Remaining] ${form.bookingName}`
                  : `Remaining items – ${selectedDoc.docNo}`,
                EProjectName: form.projectSite || null,
                EDocumentType: "GRN",
                EDocDate: form.bookingDate || null,
                EAmount: remainingTotal,
                ENetAmount: remainingTotal,
                ECgstRate: 0,
                ESgstRate: 0,
                EDiscountData: JSON.stringify(form.discount),
                EBillingTermsData: JSON.stringify(form.billingTerms ?? []),
                EDocNo: null,
                EDocTypeId: null,
                EFinYear: form.financialYear || null,
                EEmiPayment: false,
                EEmiData: JSON.stringify({
                  enabled: false,
                  installmentCount: 0,
                  emiAmount: 0,
                  startDate: "",
                  schedule: [],
                }),
                EInstallmentCount: null,
                EEmiAmount: null,
                EEmiStartDate: null,
                EReminder: form.dueDate || null,
                ERemarks: remarks,
                EStatus: "Draft",
                ECompanyId: form.companyId ?? null,
                EBillingTermId: null,
                EBillingTermName: null,
                ETCId: form.tcId ?? null,
                ETCName: form.tcName || null,
                ETCText: form.tcText || null,
                EVendorInvoiceNo: null,
                EVendorInvoiceDate: null,
                EAdditionalCharges: null,
                ECostCenter: form.costCenter || null,
                EGLAccount: form.glAccount || null,
                EWorkDoneRef: null,
                ESourceType: "GRN",
                ESourceId: selectedDoc.sourceId,
              };
              const remainingResult = await apiFetch(
                API,
                { method: "POST", body: JSON.stringify(remainingBody) },
                30000,
              );
              toast.info(
                `Draft booking ${remainingResult?.docNo || ""} auto-created for ${remainingItems.length} remaining item(s) from the same GRN.`,
                { duration: 6000 },
              );
            } catch (remErr: any) {
              toast.warning(
                "Main booking saved. Could not auto-create remaining items draft: " +
                  remErr.message,
              );
            }
          }
        }

        cancelForm();
        await fetchRecords(page);
        fetchBookedSources();
      }
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
      saveInFlight.current = false;
    }
  };


  const bd = computeBreakdown(
    form.basicAmount,
    form.cgstRate,
    form.sgstRate,
    form.billingTerms && form.billingTerms.length > 0
      ? form.billingTerms
      : form.discount,
  );
  if (selectedDoc?.kind === "GRN" && selectedDoc.amount != null) {
    const grnTotal = Math.round(selectedDoc.amount * 100) / 100;
    bd.roundOff = grnTotal - bd.grossAmount;
    bd.netAmount = grnTotal;
  }
  const filteredRecords =
    statusFilter && statusFilter !== "All"
      ? records.filter((r) => r.status === statusFilter)
      : records;
  const totalNet = records.reduce((s, r) => s + (r.netAmount ?? 0), 0);
  const approvedCount = records.filter((r) => r.status === "Approved").length;
  const pendingCount = records.filter((r) => r.status === "Pending").length;
  const emiCount = records.filter((r) => r.emi?.enabled).length;
  const vendorLabel =
    selectedDoc?.kind === "WORK_DONE" ? "Contractor" : "Supplier / Vendor";
  const isPOorWO =
    selectedDoc?.kind === "PO" ||
    selectedDoc?.kind === "WORK_DONE" ||
    selectedDoc?.kind === "WO_PO";
  const isGRN = selectedDoc?.kind === "GRN";
  const hasParentGST = isPOorWO;
  const gstHighlighted = hasParentGST && !!selectedDoc?.gst?.applicable;

  const editingIdNum = editingId ? parseInt(editingId, 10) : null;
  const bookedPOIds = new Set<number>();
  const bookedWorkDoneIds = new Set<number>();
  const bookedWOPOIds = new Set<number>();
  const bookedGRNIds = new Set<number>();
  for (const r of bookedSourceIds) {
    if (editingIdNum && r.Eid === editingIdNum) continue;
    if (r.ESourceType === "PO") bookedPOIds.add(r.ESourceId);
    if (r.ESourceType === "WORK_DONE") bookedWorkDoneIds.add(r.ESourceId);
    if (r.ESourceType === "WO_PO") bookedWOPOIds.add(r.ESourceId);
    if (r.ESourceType === "GRN") bookedGRNIds.add(r.ESourceId);
  }

  const showDocSection = !!(form.bookingDate || form.companyId);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Expense Booking"]} />
      <div className="space-y-6 mt-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="w-full sm:w-auto">
            <h1 className="text-xl font-heading font-bold text-foreground">
              Expense Booking
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Book expenses against purchase orders, confirmed work done, or
              invoice documents
            </p>
          </div>
          {view === "list" && (
            <Button
              className="gradient-accent shrink-0 gap-1.5 w-full sm:w-auto"
              onClick={openNew}
            >
              <Plus size={14} /> New Booking
            </Button>
          )}
        </div>

        {/* Form View */}
        {view === "form" && (
          <Card className="border-border shadow-sm">
            <CardHeader className="pb-4 border-b border-border px-5 sm:px-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={cancelForm}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <ArrowLeft size={15} />
                    <span className="hidden sm:inline">Back</span>
                  </button>
                  <span className="text-border">|</span>
                  <CardTitle className="text-base font-heading truncate">
                    {isEditing ? "Edit Expense Booking" : "New Expense Booking"}
                  </CardTitle>
                  {form.bookingReference && (
                    <span className="hidden sm:inline font-mono text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md shrink-0">
                      {form.bookingReference}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    onClick={cancelForm}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gradient-accent flex-1 sm:flex-none"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : isEditing ? "Update" : "Save Booking"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-6 space-y-7 px-5 sm:px-6">
              {/* ── 0. Booking Information ─────────────────────────────── */}
              <div className="space-y-4">
                <SectionHeader label="Booking Information" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Company" required>
                    <Select
                      value={form.companyId ? String(form.companyId) : ""}
                      onValueChange={(v) =>
                        set("companyId", v ? parseInt(v, 10) : null)
                      }
                    >
                      <SelectTrigger>
                        <div className="flex items-center gap-2">
                          <Building2
                            size={13}
                            className="text-muted-foreground shrink-0"
                          />
                          <SelectValue placeholder="Select company…" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {companyOptions.length === 0 && (
                          <SelectItem value="__none__" disabled>
                            No companies found
                          </SelectItem>
                        )}
                        {companyOptions.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    label={vendorLabel}
                    hint={
                      selectedDoc?.vendorLabel
                        ? `Auto-filled from ${selectedDoc.kind === "PO" ? "Purchase Order (supplier)" : selectedDoc.kind === "GRN" ? "GRN (supplier)" : "Work Done (contractor)"}`
                        : "Select supplier or auto-filled when a source document is selected"
                    }
                  >
                    {selectedDoc?.vendorLabel ? (
                      <div className="relative">
                        <User
                          size={13}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          value={form.supplier}
                          readOnly
                          placeholder="Auto-filled from linked order"
                          className="pl-8 bg-muted/30 cursor-not-allowed"
                        />
                      </div>
                    ) : (
                      <Select
                        value={form.supplier || "__none__"}
                        onValueChange={(v) =>
                          set("supplier", v === "__none__" ? "" : v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select supplier…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          {supplierHeads.map((s) => (
                            <SelectItem key={s.id} value={s.label}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Project / Site"
                    hint={
                      selectedDoc?.projectId
                        ? "Pre-filled from linked order"
                        : undefined
                    }
                  >
                    <Select
                      value={form.projectSite || ""}
                      onValueChange={(v) => set("projectSite", v || "")}
                    >
                      <SelectTrigger>
                        <div className="flex items-center gap-2">
                          <FolderKanban
                            size={13}
                            className="text-muted-foreground shrink-0"
                          />
                          <SelectValue placeholder="Select project…" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {projectOptions.length === 0 && !form.projectSite && (
                          <SelectItem value="__none__" disabled>
                            No projects found
                          </SelectItem>
                        )}
                        {form.projectSite &&
                          !projectOptions.some(
                            (p) => String(p.id) === form.projectSite,
                          ) && (
                            <SelectItem
                              key="__current__"
                              value={form.projectSite}
                            >
                              {form.projectName || form.projectSite}
                            </SelectItem>
                          )}
                        {projectOptions.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Field label="Booking Date" required>
                    <Input
                      type="date"
                      value={form.bookingDate}
                      onChange={(e) => set("bookingDate", e.target.value)}
                    />
                  </Field>
                  <Field label="Due Date">
                    <Input
                      type="date"
                      value={form.dueDate}
                      onChange={(e) => set("dueDate", e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Financial Year"
                    hint={
                      selectedTod
                        ? "Changing year updates the booking reference number"
                        : undefined
                    }
                  >
                    <Select
                      value={form.financialYear}
                      onValueChange={(v) => set("financialYear", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select year…" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeFinYears.map((fy) => (
                          <SelectItem key={fy.id} value={fy.year}>
                            {fy.year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>

              {/* ── 1. Document Selection ──────────────────────────────── */}
              {showDocSection ? (
                <>
                  <div className="space-y-3">
                    <SectionHeader label="Document Selection" />
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      Pick a Purchase Order, confirmed Work Done entry, or GRN
                      to auto-fill booking details, or choose a document type
                      from Other Expenses for standalone expense entries.
                    </p>
                    <DocSelectorPanel
                      poList={poList}
                      woPOList={woPOList}
                      workDoneList={workDoneList}
                      todList={todList}
                      grnList={grnList}
                      loadingPO={loadingPO}
                      loadingWorkDone={loadingWorkDone}
                      loadingWOPO={loadingWOPO}
                      loadingTOD={loadingTOD}
                      loadingGRN={loadingGRN}
                      companyOptions={companyOptions}
                      projectOptions={projectOptions}
                      suppliers={suppliers}
                      selected={selectedDoc}
                      finYear={form.financialYear || undefined}
                      filterCompanyId={form.companyId ?? null}
                      filterProjectId={
                        form.projectSite ? parseInt(form.projectSite) : null
                      }
                      filterFinYear={form.financialYear || null}
                      filterSupplier={form.supplier || null}
                      bookedPOIds={bookedPOIds}
                      bookedWorkDoneIds={bookedWorkDoneIds}
                      bookedWOPOIds={bookedWOPOIds}
                      bookedGRNIds={bookedGRNIds}
                      onSelect={applyDoc}
                      onClear={clearDoc}
                      onTodSelected={setSelectedTod}
                    />

                    {/* Source chain banner */}
                    {selectedDoc &&
                      (selectedDoc.kind === "WORK_DONE" ||
                        selectedDoc.kind === "WO_PO" ||
                        selectedDoc.kind === "PO" ||
                        selectedDoc.kind === "GRN") && (
                        <div
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${selectedDoc.kind === "GRN" ? "border-teal-500/30 bg-teal-500/5 text-teal-600 dark:text-teal-400" : "border-primary/30 bg-primary/5 text-primary"}`}
                        >
                          <span className="shrink-0">←</span>
                          <span className="font-mono font-semibold">
                            {selectedDoc.docNo}
                          </span>
                          {selectedDoc.vendorLabel && (
                            <>
                              <span className="text-muted-foreground">|</span>
                              <span className="text-foreground">
                                {selectedDoc.vendorLabel}
                              </span>
                            </>
                          )}
                          {selectedDoc.amount != null &&
                            selectedDoc.amount > 0 && (
                              <>
                                <span className="text-muted-foreground">|</span>
                                <span className="text-foreground font-semibold">
                                  ₹{selectedDoc.amount.toLocaleString("en-IN")}
                                </span>
                              </>
                            )}
                          <span
                            className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${selectedDoc.kind === "WORK_DONE" ? "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400" : selectedDoc.kind === "GRN" ? "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400" : "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400"}`}
                          >
                            {selectedDoc.kind === "WORK_DONE"
                              ? "Work Done"
                              : selectedDoc.kind === "GRN"
                                ? "GRN"
                                : "Purchase Order"}
                          </span>
                        </div>
                      )}

                    <Field
                      label="Booking Reference"
                      required
                      hint={
                        selectedDoc
                          ? `Auto-filled from the selected ${selectedDoc.kind === "PO" ? "Purchase Order" : selectedDoc.kind === "WORK_DONE" ? "Work Done" : selectedDoc.kind === "GRN" ? "GRN" : "document"}.`
                          : "Will be populated once you select a document above."
                      }
                    >
                      <Input
                        value={form.bookingReference}
                        readOnly
                        placeholder="Auto-filled from selected document"
                        className="font-mono bg-muted/30 cursor-not-allowed"
                      />
                    </Field>
                  </div>

                  <div className="space-y-2">
                    <Field
                      label="Booking Name"
                      hint={
                        selectedDoc?.nameLabel
                          ? "Auto-filled from selected document — editable"
                          : undefined
                      }
                    >
                      <Input
                        value={form.bookingName}
                        onChange={(e) => set("bookingName", e.target.value)}
                        placeholder="e.g. Cement supply for Block A, Q1 contractor payment…"
                      />
                    </Field>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-border/60 text-xs text-muted-foreground">
                  <FileText size={13} className="shrink-0 opacity-40" />
                  Fill in the booking information above to see matching
                  documents.
                </div>
              )}

              {/* ── 2. Amount & GST ────────────────────────────────────── */}
              <div className="space-y-4">
                <SectionHeader label="Amount & GST" />
                {hasParentGST && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                    <BadgePercent size={12} className="text-primary shrink-0" />
                    {selectedDoc!.gst?.applicable ? (
                      <span className="text-foreground">
                        GST auto-filled from linked{" "}
                        <span className="font-semibold">
                          {selectedDoc!.kind === "PO"
                            ? "Purchase Order"
                            : "Work Done"}
                        </span>
                        {" — "}
                        {selectedDoc!.gst!.type === "cgst_sgst"
                          ? `CGST ${selectedDoc!.gst!.rate / 2}% + SGST ${selectedDoc!.gst!.rate / 2}% (total ${selectedDoc!.gst!.rate}%)`
                          : selectedDoc!.gst!.type === "igst"
                            ? `IGST ${selectedDoc!.gst!.rate}% (mapped to CGST)`
                            : "GST not applicable"}
                        . Editable if needed.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Linked{" "}
                        {selectedDoc!.kind === "PO"
                          ? "Purchase Order"
                          : "Work Done"}{" "}
                        has no GST applied — rates set to 0. Editable if needed.
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`grid grid-cols-1 gap-4 ${isGRN ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}
                >
                  <Field
                    label="Basic Amount (₹)"
                    required
                    hint={
                      isGRN
                        ? "Enter the invoice amount being booked against this GRN"
                        : selectedDoc?.amount != null
                          ? "Auto-filled from linked order value"
                          : "Will be auto-filled when a PO or WO is selected"
                    }
                  >
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
                        ₹
                      </span>
                      <Input
                        type="number"
                        min={0}
                        value={form.basicAmount || ""}
                        readOnly={!isGRN && !!selectedDoc?.amount}
                        onChange={(e) => {
                          if (!isGRN && selectedDoc?.amount) return;
                          set("basicAmount", parseFloat(e.target.value) || 0);
                        }}
                        className={`pl-7 font-mono ${!isGRN && selectedDoc?.amount != null ? "bg-muted/30 cursor-not-allowed" : ""}`}
                        placeholder="0.00"
                      />
                    </div>
                  </Field>
                  {!isGRN && (
                    <>
                      <Field
                        label="CGST Rate (%)"
                        hint={
                          isPOorWO
                            ? selectedDoc!.gst?.applicable
                              ? selectedDoc!.gst!.type === "igst"
                                ? "IGST mapped here — editable"
                                : "Auto-filled from linked order — editable"
                              : "No GST on this order — editable"
                            : "Enter CGST rate manually"
                        }
                      >
                        <RateInput
                          value={form.cgstRate}
                          onChange={(v) => set("cgstRate", v)}
                          highlighted={gstHighlighted}
                        />
                      </Field>
                      <Field
                        label={
                          selectedDoc?.gst?.type === "igst"
                            ? "SGST Rate (%) — N/A for IGST"
                            : "SGST Rate (%)"
                        }
                        hint={
                          isPOorWO
                            ? selectedDoc!.gst?.type === "igst"
                              ? "IGST order — SGST is 0"
                              : selectedDoc!.gst?.applicable
                                ? "Auto-filled from linked order — editable"
                                : "No GST on this order — editable"
                            : "Enter SGST rate manually"
                        }
                      >
                        <RateInput
                          value={form.sgstRate}
                          onChange={(v) => set("sgstRate", v)}
                          highlighted={gstHighlighted}
                        />
                      </Field>
                    </>
                  )}
                </div>
                {form.basicAmount > 0 && (
                  <>
                    {isGRN && gstBreakdown ? (
                      <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50 text-sm">
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                          <div>
                            <p className="text-xs font-medium">Basic Amount</p>
                            <p className="text-[10px] text-muted-foreground">
                              Pre-tax value (excl. GST)
                            </p>
                          </div>
                          <p className="font-mono text-sm font-semibold">
                            ₹{fmt(gstBreakdown.totals.totalBase)}
                          </p>
                        </div>
                        {gstBreakdown.totals.totalCGST > 0 && (
                          <div className="flex items-center justify-between px-4 py-2 bg-amber-500/[0.03]">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                CGST
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                Central GST
                              </p>
                            </div>
                            <p className="font-mono text-sm text-foreground/80">
                              + ₹{fmt(gstBreakdown.totals.totalCGST)}
                            </p>
                          </div>
                        )}
                        {gstBreakdown.totals.totalSGST > 0 && (
                          <div className="flex items-center justify-between px-4 py-2 bg-amber-500/[0.03]">
                            <div>
                              <p className="text-xs text-muted-foreground">
                                SGST
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                State GST
                              </p>
                            </div>
                            <p className="font-mono text-sm text-foreground/80">
                              + ₹{fmt(gstBreakdown.totals.totalSGST)}
                            </p>
                          </div>
                        )}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20">
                          <div>
                            <p className="text-xs font-medium">Gross Amount</p>
                            <p className="text-[10px] text-muted-foreground">
                              Basic + CGST + SGST
                            </p>
                          </div>
                          <p className="font-mono text-sm font-semibold">
                            ₹{fmt(gstBreakdown.totals.totalInclGST)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <PriceBreakdownPanel
                        bd={bd}
                        cgstRate={form.cgstRate}
                        sgstRate={form.sgstRate}
                        hasDiscount={form.discount.applicable}
                      />
                    )}
                    <div className="flex items-center justify-between rounded-xl bg-primary/8 border border-primary/20 px-5 py-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={15} className="text-primary" />
                        <span className="text-sm font-heading font-semibold text-foreground">
                          Net Payable Amount
                        </span>
                      </div>
                      <span className="font-mono text-xl font-bold text-primary">
                        ₹
                        {fmt(
                          isGRN && gstBreakdown
                            ? gstBreakdown.totals.totalInclGST
                            : bd.netAmount,
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* ── GRN Items Summary ──────────────────────────────────── */}
              {isGRN && (
                <div className="space-y-3">
                  <SectionHeader label="GRN Items Summary" />
                  {grnItemsLoading ? (
                    <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-4 py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-teal-400 border-t-transparent animate-spin shrink-0" />
                      <span>Loading GRN items…</span>
                    </div>
                  ) : !selectedDoc?.grnItems ||
                    selectedDoc.grnItems.length === 0 ? (
                    <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-4 py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Truck size={13} className="text-teal-400 shrink-0" />
                      <span>No items recorded against this GRN.</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Per-item breakdown table */}
                      <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-teal-500/20 bg-teal-500/8">
                          <Truck size={12} className="text-teal-500 shrink-0" />
                          <span className="text-xs font-heading font-semibold text-teal-600 dark:text-teal-400">
                            Items received against this GRN
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {selectedDoc!.grnItems!.length}{" "}
                            {selectedDoc!.grnItems!.length === 1
                              ? "item"
                              : "items"}
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-muted/20 border-b border-teal-500/15">
                                <th className="px-3 py-2.5 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                  Item
                                </th>
                                <th className="px-3 py-2.5 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                  HSN
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-emerald-600 dark:text-emerald-400 text-[10px]">
                                  Rcvd Qty
                                </th>
                                <th className="px-3 py-2.5 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                  UOM
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                  Rate (₹)
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                  Incl. GST (₹)
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-blue-600 dark:text-blue-400 text-[10px]">
                                  Base (₹)
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-violet-600 dark:text-violet-400 text-[10px]">
                                  CGST
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-violet-600 dark:text-violet-400 text-[10px]">
                                  SGST
                                </th>
                                <th className="px-3 py-2.5 text-right font-heading uppercase tracking-wider text-orange-600 dark:text-orange-400 text-[10px]">
                                  GST (₹)
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-teal-500/10">
                              {(() => {
                                const bdItems = gstBreakdown?.items;
                                const rows =
                                  bdItems && bdItems.length > 0
                                    ? bdItems
                                    : selectedDoc!.grnItems!.map((it) => ({
                                        ...it,
                                        totalAmountInclGST:
                                          Number(it.totalAmount) > 0
                                            ? Number(it.totalAmount)
                                            : Number(it.rate || 0) *
                                              Number(
                                                it.receivedQty ||
                                                  it.quantity ||
                                                  0,
                                              ),
                                      }));
                                return rows.map((item, idx) => (
                                  <tr
                                    key={idx}
                                    className="hover:bg-teal-500/5 transition-colors"
                                  >
                                    <td className="px-3 py-2.5 font-medium text-foreground max-w-[160px] truncate">
                                      {item.itemName || `Item ${idx + 1}`}
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground font-mono text-[10px]">
                                      {item.hsnCode || "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                      {Number(item.receivedQty) || 0}
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground">
                                      {item.uom || "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                      {Number(item.rate || 0) > 0
                                        ? `₹${fmt(Number(item.rate))}`
                                        : "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-foreground">
                                      {Number(item.totalAmountInclGST) > 0
                                        ? `₹${fmt(Number(item.totalAmountInclGST))}`
                                        : "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-blue-600 dark:text-blue-400">
                                      {item.baseAmount != null
                                        ? `₹${fmt(item.baseAmount)}`
                                        : "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono text-violet-600 dark:text-violet-400">
                                      {item.cgstRate != null &&
                                      item.cgstAmount != null ? (
                                        <span className="flex flex-col items-end gap-0.5">
                                          <span className="text-[10px] text-muted-foreground">
                                            {item.cgstRate}%
                                          </span>
                                          <span>₹{fmt(item.cgstAmount)}</span>
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono text-violet-600 dark:text-violet-400">
                                      {item.sgstRate != null &&
                                      item.sgstAmount != null ? (
                                        <span className="flex flex-col items-end gap-0.5">
                                          <span className="text-[10px] text-muted-foreground">
                                            {item.sgstRate}%
                                          </span>
                                          <span>₹{fmt(item.sgstAmount)}</span>
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-orange-600 dark:text-orange-400">
                                      {item.gstAmount != null
                                        ? `₹${fmt(item.gstAmount)}`
                                        : "—"}
                                    </td>
                                  </tr>
                                ));
                              })()}
                            </tbody>
                            <tfoot className="border-t-2 border-teal-500/30 bg-muted/15">
                              <tr>
                                <td
                                  colSpan={5}
                                  className="px-3 py-2.5 text-[10px] font-heading uppercase tracking-wider text-muted-foreground"
                                >
                                  Totals
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-foreground">
                                  ₹
                                  {fmt(
                                    gstBreakdown?.totals.totalInclGST ??
                                      selectedDoc!.grnItems!.reduce(
                                        (s, i) =>
                                          s +
                                          (Number(i.totalAmountInclGST) ||
                                            Number(i.totalAmount) ||
                                            0),
                                        0,
                                      ),
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                                  {gstBreakdown
                                    ? `₹${fmt(gstBreakdown.totals.totalBase)}`
                                    : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-violet-600 dark:text-violet-400">
                                  {gstBreakdown
                                    ? `₹${fmt(gstBreakdown.totals.totalCGST)}`
                                    : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-violet-600 dark:text-violet-400">
                                  {gstBreakdown
                                    ? `₹${fmt(gstBreakdown.totals.totalSGST)}`
                                    : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-orange-600 dark:text-orange-400">
                                  {gstBreakdown
                                    ? `₹${fmt(gstBreakdown.totals.totalGST)}`
                                    : "—"}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>

                      {/* GST Summary Cards + Equation */}
                      {gstBreakdown && gstBreakdown.totals.totalInclGST > 0 && (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[
                              {
                                label: "Base Amount",
                                value: gstBreakdown.totals.totalBase,
                                cls: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
                              },
                              {
                                label: "CGST",
                                value: gstBreakdown.totals.totalCGST,
                                cls: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
                              },
                              {
                                label: "SGST",
                                value: gstBreakdown.totals.totalSGST,
                                cls: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
                              },
                              {
                                label: "Total GST",
                                value: gstBreakdown.totals.totalGST,
                                cls: "border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-300",
                              },
                            ].map(({ label, value, cls }) => (
                              <div
                                key={label}
                                className={`rounded-lg border px-3 py-2 ${cls}`}
                              >
                                <div className="text-[10px] font-heading uppercase tracking-wider opacity-70">
                                  {label}
                                </div>
                                <div className="text-sm font-mono font-bold mt-1">
                                  ₹{fmt(value)}
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="px-4 py-2.5 bg-muted/10 border-t border-blue-500/10 flex flex-wrap items-center gap-1.5 text-[11px] font-mono mt-3">
                            <span className="text-blue-600 dark:text-blue-400 font-semibold">
                              ₹{fmt(gstBreakdown.totals.totalBase)}
                            </span>
                            <span className="text-muted-foreground">
                              (base)
                            </span>
                            <span className="text-muted-foreground">+</span>
                            <span className="text-violet-600 dark:text-violet-400 font-semibold">
                              ₹{fmt(gstBreakdown.totals.totalCGST)}
                            </span>
                            <span className="text-muted-foreground">
                              (CGST)
                            </span>
                            <span className="text-muted-foreground">+</span>
                            <span className="text-violet-600 dark:text-violet-400 font-semibold">
                              ₹{fmt(gstBreakdown.totals.totalSGST)}
                            </span>
                            <span className="text-muted-foreground">
                              (SGST)
                            </span>
                            <span className="text-muted-foreground">=</span>
                            <span className="text-foreground font-bold">
                              ₹{fmt(gstBreakdown.totals.totalInclGST)}
                            </span>
                            <span className="text-muted-foreground">
                              (incl. GST)
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── 3. Billing Terms ──────────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader label="Billing Terms" />
                <BillingAccordion
                  basicAmount={form.basicAmount}
                  cgstRate={form.cgstRate}
                  sgstRate={form.sgstRate}
                  discount={form.discount}
                  billingTerms={form.billingTerms}
                  onChange={(d) => set("discount", d)}
                  onChangeBillingTerms={(terms) => set("billingTerms", terms)}
                  grnNetAmount={
                    isGRN && selectedDoc?.amount != null
                      ? selectedDoc.amount
                      : null
                  }
                />
              </div>

              {/* ── 4. EMI Options ─────────────────────────────────────── */}
              {!isGRN && (
                <div className="space-y-3">
                  <SectionHeader label="EMI / Installment Options" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Payment Type" required>
                      <Select
                        value={form.paymentType || "full"}
                        onValueChange={(value) =>
                          set("paymentType", value as "full" | "partial")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select payment type…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">Full payment</SelectItem>
                          <SelectItem value="partial">
                            Partial payment (EMI)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <EmiSection
                    emi={form.emi}
                    netAmount={bd.netAmount}
                    baseDocNo={form.bookingReference}
                    onChange={(emi) => set("emi", emi)}
                    liveSchedule={isEditing ? liveEmiSchedule : null}
                    loadingEmi={loadingEmi}
                    onDisableEmi={isEditing ? disableEmi : undefined}
                  />
                </div>
              )}

              {/* ── 5. Approval Trail ──────────────────────────────────── */}
              {isEditing && (
                <div className="space-y-3">
                  <SectionHeader label="Approval Workflow" />
                  <ApprovalTrailPanel
                    trail={approvalTrail}
                    currentStatus={form.status}
                  />
                </div>
              )}

              {/* ── 6. Terms & Conditions ─────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader label="Terms & Conditions" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="T&C Template"
                    hint="Select a Terms & Conditions template to attach"
                  >
                    <Select
                      value={form.tcId ? String(form.tcId) : ""}
                      onValueChange={(v) => {
                        const tc = tcOptions.find((t) => String(t.Id) === v);
                        set("tcId", tc ? tc.Id : null);
                        set("tcName", tc?.Name ?? "");
                        set("tcText", tc?.TermsAndCondition ?? "");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select T&C template…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {tcOptions.map((t) => (
                          <SelectItem key={t.Id} value={String(t.Id)}>
                            {t.Name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                {form.tcText && (
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground mb-2">
                      T&amp;C Preview
                    </p>
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                      {form.tcText}
                    </p>
                  </div>
                )}
              </div>

              {/* ── 7. Remarks ─────────────────────────────────────────── */}
              <div className="space-y-3">
                <SectionHeader label="Remarks" />
                <textarea
                  value={form.remarks}
                  onChange={(e) => set("remarks", e.target.value)}
                  placeholder="Optional notes or internal comments…"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none text-foreground placeholder:text-muted-foreground"
                />
              </div>

              {/* Save row */}
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={cancelForm}
                >
                  Cancel
                </Button>
                <Button
                  className="gradient-accent gap-1.5 w-full sm:w-auto"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? "Saving…"
                    : isEditing
                      ? "Update Booking"
                      : "Save Booking"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* List View */}
        {view === "list" && (
          <>
            {!loading && records.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Total Booked"
                  value={`₹${fmt(totalNet)}`}
                  icon={Receipt}
                  color="text-primary bg-primary/10"
                />
                <StatCard
                  label="Approved"
                  value={approvedCount}
                  icon={CheckCircle2}
                  color="text-emerald-500 bg-emerald-500/10"
                />
                <StatCard
                  label="Pending"
                  value={pendingCount}
                  icon={Clock}
                  color="text-amber-500 bg-amber-500/10"
                />
                <StatCard
                  label="EMI Active"
                  value={emiCount}
                  icon={CreditCard}
                  color="text-violet-500 bg-violet-500/10"
                />
              </div>
            )}
            {loading && (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                Loading bookings…
              </div>
            )}
            {!loading && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {ALL_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-background text-muted-foreground border-border hover:border-primary/40"}`}
                    >
                      {s}
                      {s !== "All" && (
                        <span className="ml-1.5 text-[10px] opacity-70">
                          ({records.filter((r) => r.status === s).length})
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Mobile cards */}
                <div className="flex flex-col gap-3 sm:hidden">
                  {filteredRecords.length === 0 && (
                    <div className="text-center py-16 text-muted-foreground text-sm border rounded-xl border-dashed border-border">
                      <AlertCircle
                        size={20}
                        className="mx-auto mb-2 opacity-30"
                      />
                      No bookings
                      {statusFilter !== "All"
                        ? ` with status "${statusFilter}"`
                        : ""}
                      .
                    </div>
                  )}
                  {filteredRecords.map((rec, index) => (
                    <RecordCard
                      key={
                        rec.id
                          ? `booking-card-${rec.id}`
                          : `booking-card-${index}`
                      }
                      rec={rec}
                      onEdit={() => openEdit(rec)}
                      onPreview={() => setPreviewRecord(rec)}
                      onDelete={() => requestDelete(rec.id)}
                      onApprovalSuccess={fetchRecords}
                    />
                  ))}
                </div>

                {/* Records table */}
                <Card className="hidden sm:block border-border shadow-sm">
                  <CardContent className="p-0">
                    <div className="rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            <TableHead className="text-xs font-heading w-[22%]">
                              Booking Ref
                            </TableHead>
                            <TableHead className="text-xs font-heading w-[18%]">
                              Vendor
                            </TableHead>
                            <TableHead className="text-xs font-heading w-[10%] text-right">
                              Basic Amt
                            </TableHead>
                            <TableHead className="text-xs font-heading w-[10%] text-right hidden md:table-cell">
                              CGST
                            </TableHead>
                            <TableHead className="text-xs font-heading w-[10%] text-right hidden md:table-cell">
                              SGST
                            </TableHead>
                            <TableHead className="text-xs font-heading w-[12%] text-right">
                              Net Amt
                            </TableHead>
                            <TableHead className="text-xs font-heading w-[8%] hidden lg:table-cell">
                              GRN
                            </TableHead>
                            <TableHead className="text-xs font-heading w-[8%]">
                              Status
                            </TableHead>
                            <TableHead className="text-xs font-heading w-[12%] text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRecords.map((rec, index) => {
                            const rbd = computeBreakdown(
                              rec.basicAmount,
                              rec.cgstRate,
                              rec.sgstRate,
                              rec.billingTerms && rec.billingTerms.length > 0
                                ? rec.billingTerms
                                : rec.discount,
                            );
                            return (
                              <TableRow
                                key={
                                  rec.id
                                    ? `booking-row-${rec.id}`
                                    : `booking-row-${index}`
                                }
                                className="hover:bg-muted/20"
                              >
                                <TableCell className="py-2.5">
                                  <p className="font-mono text-[11px] font-semibold text-primary leading-tight break-all">
                                    {rec.bookingReference || "—"}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    {rec.bookingDate}
                                    {rec.docTypeName ? (
                                      <span className="ml-1 opacity-60">
                                        · {rec.docTypeName}
                                      </span>
                                    ) : null}
                                    {rec.emi?.enabled ? (
                                      <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] font-heading font-semibold bg-violet-500/10 text-violet-500 border border-violet-500/20 px-1 py-0.5 rounded-full">
                                        <CreditCard size={8} />
                                        {rec.emi.installmentCount}x
                                      </span>
                                    ) : null}
                                  </p>
                                </TableCell>
                                <TableCell className="text-xs max-w-[140px] truncate py-2.5">
                                  {rec.supplier || "—"}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-right text-muted-foreground py-2.5">
                                  ₹{fmt(rec.basicAmount)}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-right text-foreground/70 py-2.5 hidden md:table-cell">
                                  {rec.cgstRate}%
                                </TableCell>
                                <TableCell className="font-mono text-xs text-right text-foreground/70 py-2.5 hidden md:table-cell">
                                  {rec.sgstRate}%
                                </TableCell>
                                <TableCell className="font-mono text-xs font-semibold text-right py-2.5">
                                  ₹{fmt(rec.netAmount ?? rbd.netAmount)}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell py-2.5">
                                  <GRNChainBadge bookingId={rec.id} />
                                </TableCell>
                                <TableCell className="py-2.5">
                                  <StatusBadge status={rec.status} />
                                </TableCell>
                                <TableCell className="py-2.5">
                                  <div className="flex gap-1 items-center justify-end">
                                    <ApprovalActions
                                      status={rec.status}
                                      recordId={rec.id}
                                      endpoint="/api/expense-booking"
                                      submitOnly
                                      onSuccess={() => fetchRecords(page)}
                                    />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => setPreviewRecord(rec)}
                                      title="Preview"
                                    >
                                      <Eye size={12} />
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => openEdit(rec)}
                                    >
                                      <Edit size={12} />
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => requestDelete(rec.id)}
                                    >
                                      <Trash2 size={12} />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {filteredRecords.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={9}
                                className="text-center py-14 text-muted-foreground text-sm"
                              >
                                <AlertCircle
                                  size={18}
                                  className="mx-auto mb-2 opacity-30"
                                />
                                {statusFilter !== "All"
                                  ? `No bookings with status "${statusFilter}". Try a different filter.`
                                  : `No bookings yet. Click "New Booking" to get started.`}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-2 px-1">
                    <p className="text-xs text-muted-foreground text-center sm:text-left">
                      Page {page} of {totalPages} · {totalRecords} total
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-1 mt-2 sm:mt-0">
                      <button
                        onClick={() => fetchRecords(Math.max(1, page - 1))}
                        disabled={page === 1}
                        className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      {Array.from(
                        { length: Math.min(5, totalPages) },
                        (_, i) => {
                          const pg = page <= 3 ? i + 1 : page - 2 + i;
                          if (pg < 1 || pg > totalPages) return null;
                          return (
                            <button
                              key={pg}
                              onClick={() => fetchRecords(pg)}
                              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${pg === page ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                            >
                              {pg}
                            </button>
                          );
                        },
                      )}
                      <button
                        onClick={() =>
                          fetchRecords(Math.min(totalPages, page + 1))
                        }
                        disabled={page === totalPages}
                        className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Delete Confirm */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Booking</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this expense booking? This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview modal */}
      <ExpenseBookingPreviewModal
        previewRecord={previewRecord}
        onClose={() => setPreviewRecord(null)}
        onEdit={(record) => openEdit(record)}
      />

      {/* Remaining GRN Items — auto-created silently on save */}
    </>
  );
}

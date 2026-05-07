import React, { useState, useEffect, useCallback } from "react";
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

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetchWithAuth(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const _mastersCache: {
  po: POItem[] | null;
  wo: WOItem[] | null;
  tod: TodItem[] | null;
  grn: GRNItem[] | null;
} = { po: null, wo: null, tod: null, grn: null };

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
interface TodItem {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix?: string;
  Description: string;
  EntryType?: string;
}
type SourceKind = "PO" | "WO" | "TOD" | "GRN";

interface GRNItemLine {
  itemName?: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom?: string;
  rate?: number;
  quantity?: number;
  totalAmount?: number;
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
  GRNDate: string;
  SupplierName?: string;
  PONumber?: string;
  POID?: number;
  Status?: string;
  TotalItems?: number;
  Remarks?: string;
  GRNItems?: string | GRNItemLine[];
}

interface BillingTermOption {
  BillingTermID: number;
  Name: string;
  Description?: string;
  IsActive?: boolean | number;
  CalculationType?: string;
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
  "Billing Terms & Conditions": Receipt,
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
  woList: WOItem[];
  todList: TodItem[];
  grnList: GRNItem[];
  loadingPO: boolean;
  loadingWO: boolean;
  loadingTOD: boolean;
  loadingGRN: boolean;
  selected: SelectedDoc | null;
  finYear?: string;
  filterCompanyId?: number | null;
  filterProjectId?: number | null;
  filterFinYear?: string | null;
  onSelect: (doc: SelectedDoc) => void;
  onClear: () => void;
  onTodSelected?: (tod: TodItem | null) => void;
}

function DocSelectorPanel({
  poList,
  woList,
  todList,
  grnList,
  loadingPO,
  loadingWO,
  loadingTOD,
  loadingGRN,
  selected,
  finYear,
  filterCompanyId,
  filterProjectId,
  filterFinYear,
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
    } catch {
      onTodSelected?.(null);
      toast.error("Could not fetch next document number.");
    } finally {
      setTodFetching(false);
    }
  };

  const q = search.toLowerCase();

  // Match fin year by looking for the year string embedded in the doc number.
  // e.g. filterFinYear = "2026-2027", docNo = "CI/PUR/000001/2026-2027" → match
  // Falls back to true when no filter is set or doc has no number.
  const inFinYear = (docNo?: string) => {
    if (!filterFinYear || !docNo) return true;
    return docNo.includes(filterFinYear);
  };

  const filteredPO = poList.filter((p) => {
    if (filterCompanyId && p.CompanyId && p.CompanyId !== filterCompanyId)
      return false;
    if (filterProjectId && p.ProjectId && p.ProjectId !== filterProjectId)
      return false;
    if (!inFinYear(p.DocNo || p.PurchaseOrderNo)) return false;
    return (
      (p.DocNo || p.PurchaseOrderNo).toLowerCase().includes(q) ||
      (p.SupplierName || "").toLowerCase().includes(q)
    );
  });
  const filteredWO = woList.filter((w) => {
    if (filterCompanyId && w.CompanyId && w.CompanyId !== filterCompanyId)
      return false;
    if (filterProjectId && w.ProjectId && w.ProjectId !== filterProjectId)
      return false;
    if (!inFinYear(w.DocNo || w.DocumentNumber)) return false;
    return (
      (w.DocNo || w.DocumentNumber).toLowerCase().includes(q) ||
      (w.ContractorName || "").toLowerCase().includes(q)
    );
  });
  const filteredTOD = todList.filter(
    (t) =>
      (t.FullPrefix ?? t.Prefix).toLowerCase().includes(q) ||
      t.Description.toLowerCase().includes(q),
  );
  const filteredGRN = grnList.filter(
    (g) =>
      inFinYear(g.GRNNo) &&
      ((g.GRNNo || "").toLowerCase().includes(q) ||
        (g.SupplierName || "").toLowerCase().includes(q) ||
        (g.PONumber || "").toLowerCase().includes(q)),
  );

  if (selected) {
    const isPO = selected.kind === "PO",
      isWO = selected.kind === "WO",
      isGRN = selected.kind === "GRN";
    const Icon = isPO
      ? ShoppingCart
      : isWO
        ? HardHat
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
      : isWO
        ? {
            ring: "border-violet-500/30 bg-violet-500/5",
            icon: "bg-violet-500/10",
            text: "text-violet-500",
            badge:
              "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
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
        <div className="flex items-start gap-3">
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
                  : isWO
                    ? "Work Order"
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
                      : isWO
                        ? "Contractor"
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
          <button
            onClick={() => {
              onTodSelected?.(null);
              onClear();
            }}
            className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-destructive transition-colors shrink-0 px-2 py-1 rounded-md hover:bg-destructive/5 border border-transparent hover:border-destructive/20 mt-0.5"
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
    { id: "WO", label: "Work Orders", icon: HardHat, count: filteredWO.length },
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
      : tab === "WO"
        ? loadingWO
        : tab === "GRN"
          ? loadingGRN
          : loadingTOD;
  const placeholder =
    tab === "PO"
      ? "Search by PO number or supplier…"
      : tab === "WO"
        ? "Search by WO number or contractor…"
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
              setTab(t.id);
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
        ) : tab === "WO" ? (
          filteredWO.length === 0 ? (
            <EmptyState label="No work orders found" />
          ) : (
            filteredWO.map((wo) => {
              const docNo = wo.DocNo || wo.DocumentNumber;
              return (
                <PickerRow
                  key={wo.Id}
                  icon={<HardHat size={12} className="text-violet-500" />}
                  iconBg="bg-violet-500/10"
                  primary={docNo}
                  primaryColor="text-violet-600 dark:text-violet-400"
                  secondary={[wo.ContractorName, wo.DocumentDate?.slice(0, 10)]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={wo.Status}
                  amount={wo.TotalAmount}
                  onClick={() =>
                    onSelect({
                      kind: "WO",
                      docNo,
                      sourceId: wo.Id,
                      nameLabel: wo.Remarks,
                      vendorLabel: wo.ContractorName,
                      companyId: wo.CompanyId,
                      projectId: wo.ProjectId,
                      amount: wo.TotalAmount,
                      status: wo.Status,
                      date: wo.DocumentDate,
                      gst: wo.GST ?? null,
                    })
                  }
                />
              );
            })
          )
        ) : tab === "GRN" ? (
          filteredGRN.length === 0 ? (
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
                } catch {
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
                      docNo: g.GRNNo
                        ? g.GRNNo.startsWith("GRN-")
                          ? g.GRNNo
                          : `GRN-${g.GRNNo}`
                        : g.GRNNo,
                      sourceId: g.GRNID,
                      vendorLabel: g.SupplierName,
                      status: g.Status,
                      date: g.GRNDate,
                      nameLabel: g.Remarks,
                      grnItems: parsedItems,
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
                        {g.GRNNo
                          ? g.GRNNo.startsWith("GRN-")
                            ? g.GRNNo
                            : `GRN-${g.GRNNo}`
                          : "—"}
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
          )
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
  if ((doc.kind === "PO" || doc.kind === "WO") && doc.gst?.applicable) {
    const { type, rate } = doc.gst;
    if (type === "cgst_sgst") return { cgst: rate / 2, sgst: rate / 2 };
    if (type === "igst") return { cgst: rate, sgst: 0 };
    return { cgst: 0, sgst: 0 };
  }
  if (doc.kind === "PO" || doc.kind === "WO") return { cgst: 0, sgst: 0 };
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
      .catch(() => {});
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
  } catch {
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
  const activeFinYears = finYears.filter((fy) => fy.status === "Active");

  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [poList, setPoList] = useState<POItem[]>([]);
  const [woList, setWoList] = useState<WOItem[]>([]);
  const [todList, setTodList] = useState<TodItem[]>([]);
  const [grnList, setGrnList] = useState<GRNItem[]>([]);
  const [loadingPO, setLoadingPO] = useState(false);
  const [loadingWO, setLoadingWO] = useState(false);
  const [loadingTOD, setLoadingTOD] = useState(false);
  const [loadingGRN, setLoadingGRN] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<SelectedDoc | null>(null);
  const [grnItemsLoading, setGrnItemsLoading] = useState(false);
  const [selectedTod, setSelectedTod] = useState<TodItem | null>(null);
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [view, setView] = useState<PageView>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ExpenseRecord, "id">>(blankForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
        .catch(() => {})
        .finally(() => setLd(false));
    };

    load("po", "/api/purchase-orders?limit=500", setPoList, setLoadingPO);
    load("wo", "/api/work-orders?limit=500", setWoList, setLoadingWO);
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
      } catch {
        /* silently ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.financialYear, selectedTod]);

  useEffect(() => {
    fetchRecords(1);
    apiFetch("/api/enterprises/options?business_type=C")
      .then((list: CompanyOption[]) => setCompanyOptions(list ?? []))
      .catch(() => {});
    apiFetch("/api/enterprises/options?business_type=P")
      .then((list: ProjectOption[]) => setProjectOptions(list ?? []))
      .catch(() => {});
    apiFetch("/api/billing-terms")
      .then((list: BillingTermOption[]) =>
        setBillingTerms(
          (Array.isArray(list) ? list : []).filter(
            (t) => t.IsActive !== 0 && t.IsActive !== false,
          ),
        ),
      )
      .catch(() => {});
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
          const grnTotal = parseFloat(r.TotalAmount) || 0;
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
          setForm((prev) => ({
            ...prev,
            bookingReference: canonicalDocNo,
            basicAmount: grnTotal > 0 ? grnTotal : prev.basicAmount,
          }));
          if (items.length === 0)
            toast.info("This GRN has no item lines recorded against it.");
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
          : doc.kind === "WO"
            ? "WO"
            : doc.kind === "GRN"
              ? "GRN"
              : doc.docNo.split("/")[0],
      cgstRate: cgst,
      sgstRate: sgst,
    }));
  };

  const clearDoc = () => {
    setSelectedDoc(null);
    setSelectedTod(null);
    setGrnItemsLoading(false);
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
    if (!rec.id) {
      toast.error("Cannot edit this booking because its record id is missing.");
      return;
    }
    setEditingId(rec.id);
    const { id, ...rest } = rec;
    setForm(rest);
    setApprovalTrail(undefined);
    setSelectedDoc(null);
    setLiveEmiSchedule(null);
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
  };

  const handleSave = async () => {
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
      form.discount,
    );

    let emiForSave = form.emi;
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
    try {
      setSaving(true);
      if (isEditing) {
        await apiFetch(`${API}/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        toast.success("Expense booking updated.");
      } else {
        const result = await apiFetch(API, {
          method: "POST",
          body: JSON.stringify(body),
        });
        toast.success(
          `Expense booking created — Ref: ${result?.docNo || form.bookingReference}`,
        );
      }
      cancelForm();
      await fetchRecords(page);
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const bd = computeBreakdown(
    form.basicAmount,
    form.cgstRate,
    form.sgstRate,
    form.discount,
  );
  const filteredRecords =
    statusFilter && statusFilter !== "All"
      ? records.filter((r) => r.status === statusFilter)
      : records;
  const totalNet = records.reduce((s, r) => s + (r.netAmount ?? 0), 0);
  const approvedCount = records.filter((r) => r.status === "Approved").length;
  const pendingCount = records.filter((r) => r.status === "Pending").length;
  const emiCount = records.filter((r) => r.emi?.enabled).length;
  const vendorLabel =
    selectedDoc?.kind === "WO" ? "Contractor" : "Supplier / Vendor";
  const isPOorWO = selectedDoc?.kind === "PO" || selectedDoc?.kind === "WO";
  const isGRN = selectedDoc?.kind === "GRN";
  const gstHighlighted = isPOorWO && !!selectedDoc?.gst?.applicable;

  // Gate: reveal Document Selection only after booking info is started
  const showDocSection = !!(form.bookingDate || form.companyId);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Expense Booking"]} />
      <div className="space-y-5">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="w-full sm:w-auto">
            <h1 className="text-xl font-heading font-bold text-foreground">
              Expense Booking
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Book expenses against purchase orders, work orders, or invoice
              documents
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
                        ? `Auto-filled from ${selectedDoc.kind === "PO" ? "Purchase Order (supplier)" : "Work Order (contractor)"}`
                        : "Auto-filled when a PO or WO is selected above"
                    }
                  >
                    <div className="relative">
                      <User
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        value={form.supplier}
                        readOnly={!!selectedDoc?.vendorLabel}
                        onChange={(e) =>
                          !selectedDoc?.vendorLabel &&
                          set("supplier", e.target.value)
                        }
                        placeholder="Auto-filled from linked order"
                        className={`pl-8 ${selectedDoc?.vendorLabel ? "bg-muted/30 cursor-not-allowed" : ""}`}
                      />
                    </div>
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
                        {projectOptions.length === 0 && (
                          <SelectItem value="__none__" disabled>
                            No projects found
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
              </div>

              {/* ── 1. Document Selection (gated on booking info) ──────── */}
              {showDocSection ? (
                <>
                  <div className="space-y-3">
                    <SectionHeader label="Document Selection" />
                    <p className="text-[11px] text-muted-foreground -mt-1">
                      Pick a Purchase Order, Work Order, or GRN to auto-fill
                      booking details, or choose a document type from Other
                      Expenses for standalone expense entries.
                    </p>
                    <DocSelectorPanel
                      poList={poList}
                      woList={woList}
                      todList={todList}
                      grnList={grnList}
                      loadingPO={loadingPO}
                      loadingWO={loadingWO}
                      loadingTOD={loadingTOD}
                      loadingGRN={loadingGRN}
                      selected={selectedDoc}
                      finYear={form.financialYear || undefined}
                      filterCompanyId={form.companyId ?? null}
                      filterProjectId={
                        form.projectSite ? parseInt(form.projectSite) : null
                      }
                      filterFinYear={form.financialYear || null}
                      onSelect={applyDoc}
                      onClear={clearDoc}
                      onTodSelected={setSelectedTod}
                    />

                    {/* Source chain banner */}
                    {selectedDoc &&
                      (selectedDoc.kind === "WO" ||
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
                            className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${selectedDoc.kind === "WO" ? "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400" : selectedDoc.kind === "GRN" ? "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400" : "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400"}`}
                          >
                            {selectedDoc.kind === "WO"
                              ? "Work Order"
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
                          ? `Auto-filled from the selected ${selectedDoc.kind === "PO" ? "Purchase Order" : selectedDoc.kind === "WO" ? "Work Order" : selectedDoc.kind === "GRN" ? "GRN" : "document"}.`
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

                  {/* Booking Name — separate block, inside the fragment */}
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
                {isPOorWO && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                    <BadgePercent size={12} className="text-primary shrink-0" />
                    {selectedDoc!.gst?.applicable ? (
                      <span className="text-foreground">
                        GST auto-filled from linked{" "}
                        <span className="font-semibold">
                          {selectedDoc!.kind === "PO"
                            ? "Purchase Order"
                            : "Work Order"}
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
                          : "Work Order"}{" "}
                        has no GST applied — rates set to 0. Editable if needed.
                      </span>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                </div>
                {form.basicAmount > 0 && (
                  <>
                    <PriceBreakdownPanel
                      bd={bd}
                      cgstRate={form.cgstRate}
                      sgstRate={form.sgstRate}
                      hasDiscount={form.discount.applicable}
                    />
                    <div className="flex items-center justify-between rounded-xl bg-primary/8 border border-primary/20 px-5 py-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp size={15} className="text-primary" />
                        <span className="text-sm font-heading font-semibold text-foreground">
                          Net Payable Amount
                        </span>
                      </div>
                      <span className="font-mono text-xl font-bold text-primary">
                        ₹{fmt(bd.netAmount)}
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
                              <th className="px-4 py-2.5 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                Item
                              </th>
                              <th className="px-4 py-2.5 text-right font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                Ordered
                              </th>
                              <th className="px-4 py-2.5 text-right font-heading uppercase tracking-wider text-emerald-600 dark:text-emerald-400 text-[10px]">
                                Received
                              </th>
                              <th className="px-4 py-2.5 text-right font-heading uppercase tracking-wider text-amber-600 dark:text-amber-400 text-[10px]">
                                Remaining
                              </th>
                              <th className="px-4 py-2.5 text-left font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                UOM
                              </th>
                              <th className="px-4 py-2.5 text-right font-heading uppercase tracking-wider text-muted-foreground text-[10px]">
                                Amount (₹)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-teal-500/10">
                            {selectedDoc!.grnItems!.map((item, idx) => (
                              <tr
                                key={idx}
                                className="hover:bg-teal-500/5 transition-colors"
                              >
                                <td className="px-4 py-2.5 font-medium text-foreground max-w-[180px] truncate">
                                  {item.itemName || `Item ${idx + 1}`}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                                  {Number(item.orderedQty) || 0}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                  {Number(item.receivedQty) || 0}
                                </td>
                                <td
                                  className={`px-4 py-2.5 text-right font-mono font-semibold ${Number(item.remainingQty) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                                >
                                  {Number(item.remainingQty) || 0}
                                </td>
                                <td className="px-4 py-2.5 text-muted-foreground">
                                  {item.uom || "—"}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-foreground">
                                  {(() => {
                                    const amt =
                                      Number(item.totalAmount) > 0
                                        ? Number(item.totalAmount)
                                        : Number(item.rate || 0) *
                                          Number(
                                            item.quantity ||
                                              item.receivedQty ||
                                              0,
                                          );
                                    return amt > 0 ? `₹${fmt(amt)}` : "—";
                                  })()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t border-teal-500/20 bg-muted/10">
                            <tr>
                              <td className="px-4 py-2.5 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                                Totals
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-muted-foreground">
                                {selectedDoc!.grnItems!.reduce(
                                  (s, i) => s + (Number(i.orderedQty) || 0),
                                  0,
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                {selectedDoc!.grnItems!.reduce(
                                  (s, i) => s + (Number(i.receivedQty) || 0),
                                  0,
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                                {selectedDoc!.grnItems!.reduce(
                                  (s, i) => s + (Number(i.remainingQty) || 0),
                                  0,
                                )}
                              </td>
                              <td />
                              <td className="px-4 py-2.5 text-right font-mono text-xs font-bold text-foreground">
                                ₹
                                {fmt(
                                  selectedDoc!.grnItems!.reduce((s, i) => {
                                    const amt =
                                      Number(i.totalAmount) > 0
                                        ? Number(i.totalAmount)
                                        : Number(i.rate || 0) *
                                          Number(
                                            i.quantity || i.receivedQty || 0,
                                          );
                                    return s + amt;
                                  }, 0),
                                )}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── 3. Billing Terms ───────────────────────────────────── */}
              {!isGRN && (
                <div className="space-y-3">
                  <SectionHeader label="Billing Terms" />
                  <BillingAccordion
                    basicAmount={form.basicAmount}
                    cgstRate={form.cgstRate}
                    sgstRate={form.sgstRate}
                    discount={form.discount}
                    onChange={(d) => set("discount", d)}
                  />
                </div>
              )}

              {/* ── 4. EMI Options ─────────────────────────────────────── */}
              {!isGRN && (
                <div className="space-y-3">
                  <SectionHeader label="EMI / Installment Options" />
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

              {/* ── 6. Remarks ─────────────────────────────────────────── */}
              {/* ── Billing Terms & T&C ───────────────────────────────── */}
              <div className="space-y-4">
                <SectionHeader label="Billing Terms & Conditions" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Billing Terms"
                    hint="Select applicable payment / billing terms"
                  >
                    <Select
                      value={
                        form.billingTermId ? String(form.billingTermId) : ""
                      }
                      onValueChange={(v) => {
                        const term = billingTerms.find(
                          (t) => String(t.BillingTermID) === v,
                        );
                        set("billingTermId", term ? term.BillingTermID : null);
                        set("billingTermName", term?.Name ?? "");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select billing term…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {billingTerms.map((t) => (
                          <SelectItem
                            key={t.BillingTermID}
                            value={String(t.BillingTermID)}
                          >
                            {t.Name}
                            {t.CalculationType ? ` — ${t.CalculationType}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.billingTermId &&
                      (() => {
                        const term = billingTerms.find(
                          (t) => t.BillingTermID === form.billingTermId,
                        );
                        return term?.Description ? (
                          <p className="text-[10px] text-muted-foreground mt-1 px-1">
                            {term.Description}
                          </p>
                        ) : null;
                      })()}
                  </Field>

                  <Field
                    label="Terms & Conditions"
                    hint="Select T&C template to attach"
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
                      T&C Preview
                    </p>
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                      {form.tcText}
                    </p>
                  </div>
                )}
              </div>

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
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button variant="outline" onClick={cancelForm}>
                  Cancel
                </Button>
                <Button
                  className="gradient-accent gap-1.5"
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
                      onDelete={() => setDeleteId(rec.id)}
                      onApprovalSuccess={fetchRecords}
                    />
                  ))}
                </div>

                {/* Desktop table */}
                <Card className="hidden sm:block border-border shadow-sm">
                  <CardContent className="p-0">
                    <div className="rounded-md overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            {[
                              "Booking Ref",
                              "Type",
                              "Date",
                              "Vendor / Contractor",
                              "Basic Amt",
                              "CGST",
                              "SGST",
                              "Net Amt",
                              "GRN",
                              "EMI",
                              "Status",
                              "Actions",
                            ].map((h, i) => (
                              <TableHead
                                key={h}
                                className={`text-xs font-heading${[4, 5, 6].includes(i) ? " hidden md:table-cell" : ""}${i === 8 ? " hidden lg:table-cell" : ""}`}
                              >
                                {h}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRecords.map((rec, index) => {
                            const rbd = computeBreakdown(
                              rec.basicAmount,
                              rec.cgstRate,
                              rec.sgstRate,
                              rec.discount,
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
                                <TableCell className="font-mono text-xs font-semibold text-primary">
                                  {rec.bookingReference || "—"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground max-w-[90px] truncate">
                                  {rec.docTypeName || "—"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                  {rec.bookingDate}
                                </TableCell>
                                <TableCell className="text-xs max-w-[120px] truncate">
                                  {rec.supplier || "—"}
                                </TableCell>
                                <TableCell className="font-mono text-xs hidden md:table-cell text-muted-foreground">
                                  ₹{fmt(rec.basicAmount)}
                                </TableCell>
                                <TableCell className="font-mono text-xs hidden md:table-cell text-foreground/70">
                                  {rec.cgstRate}%
                                </TableCell>
                                <TableCell className="font-mono text-xs hidden md:table-cell text-foreground/70">
                                  {rec.sgstRate}%
                                </TableCell>
                                <TableCell className="font-mono text-xs font-semibold">
                                  ₹{fmt(rbd.netAmount)}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                  <GRNChainBadge bookingId={rec.id} />
                                </TableCell>
                                <TableCell>
                                  {rec.emi?.enabled ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-heading font-semibold bg-violet-500/10 text-violet-500 border border-violet-500/20 px-2 py-0.5 rounded-full">
                                      <CreditCard size={9} />
                                      {rec.emi.installmentCount}x
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <StatusBadge status={rec.status} />
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1.5 items-center">
                                    <ApprovalActions
                                      status={rec.status}
                                      recordId={rec.id}
                                      endpoint="/api/expense-booking"
                                      submitOnly
                                      onSuccess={fetchRecords}
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
                                      onClick={() => setDeleteId(rec.id)}
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
                                colSpan={12}
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
                    <div className="flex items-center gap-1">
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

      {/* Preview Dialog */}
      <Dialog
        open={!!previewRecord}
        onOpenChange={() => setPreviewRecord(null)}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Expense Booking Preview</DialogTitle>
            <DialogDescription>
              Details for booking {previewRecord?.bookingReference}
            </DialogDescription>
          </DialogHeader>
          {previewRecord && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">
                    Reference
                  </p>
                  <p className="font-medium">
                    {previewRecord.bookingReference || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">
                    Status
                  </p>
                  <div className="mt-1">
                    <StatusBadge status={previewRecord.status} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">
                    Date
                  </p>
                  <p className="font-medium">{previewRecord.bookingDate}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">
                    Supplier
                  </p>
                  <p className="font-medium">{previewRecord.supplier || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">
                    Type
                  </p>
                  <p className="font-medium">
                    {previewRecord.docTypeName || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">
                    Net Amount
                  </p>
                  <p className="font-medium text-emerald-600 dark:text-emerald-400">
                    ₹{fmt(previewRecord.netAmount ?? 0)}
                  </p>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs text-muted-foreground uppercase mb-3">
                  Breakdown
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-muted/20 p-4 rounded-lg border border-border">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">
                      Basic
                    </p>
                    <p className="font-mono text-sm font-semibold">
                      ₹{fmt(previewRecord.basicAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">
                      CGST ({previewRecord.cgstRate}%)
                    </p>
                    <p className="font-mono text-sm font-semibold">
                      ₹
                      {fmt(
                        (previewRecord.basicAmount *
                          (previewRecord.cgstRate || 0)) /
                          100,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">
                      SGST ({previewRecord.sgstRate}%)
                    </p>
                    <p className="font-mono text-sm font-semibold">
                      ₹
                      {fmt(
                        (previewRecord.basicAmount *
                          (previewRecord.sgstRate || 0)) /
                          100,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">
                      Discount
                    </p>
                    <p className="font-mono text-sm font-semibold text-red-500">
                      {previewRecord.discount?.applicable
                        ? `-₹${fmt(previewRecord.discount.amount)}`
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>
              {previewRecord.remarks && (
                <div className="border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground uppercase mb-2">
                    Remarks
                  </p>
                  <p className="text-sm bg-muted/30 p-3 rounded-lg border border-border">
                    {previewRecord.remarks}
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewRecord(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
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
} = { po: null, wo: null, tod: null };

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
type SourceKind = "PO" | "WO" | "TOD";
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
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────
const SECTION_ICONS: Record<string, React.ElementType> = {
  "Document Selection": FileText,
  "Booking Information": CalendarDays,
  "Amount & GST": BadgePercent,
  "Billing Terms": Receipt,
  "EMI / Installment Options": CreditCard,
  "Approval Workflow": CheckCircle2,
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
  loadingPO: boolean;
  loadingWO: boolean;
  loadingTOD: boolean;
  selected: SelectedDoc | null;
  finYear?: string;
  onSelect: (doc: SelectedDoc) => void;
  onClear: () => void;
  onTodSelected?: (tod: TodItem | null) => void;
}

function DocSelectorPanel({
  poList,
  woList,
  todList,
  loadingPO,
  loadingWO,
  loadingTOD,
  selected,
  finYear,
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
  const filteredPO = poList.filter(
    (p) =>
      (p.DocNo || p.PurchaseOrderNo).toLowerCase().includes(q) ||
      (p.SupplierName || "").toLowerCase().includes(q),
  );
  const filteredWO = woList.filter(
    (w) =>
      (w.DocNo || w.DocumentNumber).toLowerCase().includes(q) ||
      (w.ContractorName || "").toLowerCase().includes(q),
  );
  const filteredTOD = todList.filter(
    (t) =>
      (t.FullPrefix ?? t.Prefix).toLowerCase().includes(q) ||
      t.Description.toLowerCase().includes(q),
  );

  if (selected) {
    const isPO = selected.kind === "PO",
      isWO = selected.kind === "WO";
    const Icon = isPO ? ShoppingCart : isWO ? HardHat : FileText;
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
                {isPO ? "Purchase Order" : isWO ? "Work Order" : "Document"}
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
                  label={isPO ? "Supplier" : "Contractor"}
                  value={selected.vendorLabel}
                />
              )}
              {selected.amount != null && (
                <InfoPill
                  icon={Banknote}
                  label="Order Value"
                  value={`₹${fmt(selected.amount)}`}
                />
              )}
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
      count: poList.length,
    },
    { id: "WO", label: "Work Orders", icon: HardHat, count: woList.length },
    {
      id: "TOD",
      label: "Other Expenses",
      icon: FileText,
      count: todList.length,
    },
  ];
  const loading =
    tab === "PO" ? loadingPO : tab === "WO" ? loadingWO : loadingTOD;
  const placeholder =
    tab === "PO"
      ? "Search by PO number or supplier…"
      : tab === "WO"
        ? "Search by WO number or contractor…"
        : "Search document types…";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex border-b border-border bg-muted/20">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setSearch("");
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-heading font-semibold transition-colors border-b-2 -mb-px ${tab === t.id ? "border-primary text-primary bg-background" : "border-transparent text-muted-foreground hover:text-foreground"}`}
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
  const [loadingPO, setLoadingPO] = useState(false);
  const [loadingWO, setLoadingWO] = useState(false);
  const [loadingTOD, setLoadingTOD] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<SelectedDoc | null>(null);
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
  }, [fetchRecords]);

  const set = <K extends keyof Omit<ExpenseRecord, "id">>(
    field: K,
    value: Omit<ExpenseRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const applyDoc = (doc: SelectedDoc) => {
    setSelectedDoc(doc);
    const { cgst, sgst } = resolveGstRates(doc, form.cgstRate, form.sgstRate);
    setForm((prev) => ({
      ...prev,
      bookingReference: doc.docNo,
      bookingName: doc.nameLabel ?? prev.bookingName,
      basicAmount: doc.amount ?? prev.basicAmount,
      companyId: doc.companyId ?? prev.companyId,
      projectSite: doc.projectId ? String(doc.projectId) : prev.projectSite,
      supplier: doc.vendorLabel ?? prev.supplier,
      materialCategory:
        doc.kind === "PO"
          ? "PO"
          : doc.kind === "WO"
            ? "WO"
            : doc.docNo.split("/")[0],
      cgstRate: cgst,
      sgstRate: sgst,
    }));
  };

  const clearDoc = () => {
    setSelectedDoc(null);
    setSelectedTod(null);
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
  };

  const openNew = () => {
    resetForm();
    setForm({ ...blankForm(), financialYear: activeFinYears[0]?.year || "" });
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
    fetchMasters();
    setView("form");
  };

  const cancelForm = () => {
    setView("list");
    resetForm();
  };

  const disableEmi = async () => {
    if (!editingId) return;
    await apiFetch(`${API}/${editingId}/emi-toggle`, {
      method: "PUT",
      body: JSON.stringify({ enabled: false, deleteUnpaid: true }),
    });
    toast.success("EMI disabled. Unpaid installments removed.");
    setLiveEmiSchedule(null);
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
    const bd = computeBreakdown(
      form.basicAmount,
      form.cgstRate,
      form.sgstRate,
      form.discount,
    );
    const body = {
      ...recordToDb(
        form,
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

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`${API}/${id}`, { method: "DELETE" });
      setDeleteId(null);
      toast.success("Booking deleted.");
      await fetchRecords(page);
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
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
  const gstHighlighted = isPOorWO && !!selectedDoc?.gst?.applicable;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Expense Booking"]} />
      <div className="space-y-5">
        {/* Page Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
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
              className="gradient-accent shrink-0 gap-1.5"
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
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
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
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={cancelForm}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gradient-accent"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : isEditing ? "Update" : "Save Booking"}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-6 space-y-7 px-5 sm:px-6">
              {/* 0. Document Selection */}
              <div className="space-y-3">
                <SectionHeader label="Document Selection" />
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Pick a Purchase Order or Work Order to auto-fill details, or
                  choose a document type from the master for other expenses.
                </p>
                <DocSelectorPanel
                  poList={poList}
                  woList={woList}
                  todList={todList}
                  loadingPO={loadingPO}
                  loadingWO={loadingWO}
                  loadingTOD={loadingTOD}
                  selected={selectedDoc}
                  finYear={form.financialYear || undefined}
                  onSelect={applyDoc}
                  onClear={clearDoc}
                  onTodSelected={setSelectedTod}
                />
                <Field
                  label="Booking Reference"
                  required
                  hint={
                    selectedDoc
                      ? `Auto-filled from the selected ${selectedDoc.kind === "PO" ? "Purchase Order" : selectedDoc.kind === "WO" ? "Work Order" : "document"}.`
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

              {/* Booking Name */}
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

              {/* 1. Booking Information */}
              <div className="space-y-4">
                <SectionHeader label="Booking Information" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  <Field label="Status">
                    <Select
                      value={form.status}
                      onValueChange={(v) => set("status", v as BookingStatus)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BOOKING_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
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

              {/* 2. Amount & GST */}
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
                      selectedDoc?.amount != null
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
                        readOnly={!!selectedDoc?.amount}
                        onChange={(e) =>
                          !selectedDoc?.amount &&
                          set("basicAmount", parseFloat(e.target.value) || 0)
                        }
                        className={`pl-7 font-mono ${selectedDoc?.amount != null ? "bg-muted/30 cursor-not-allowed" : ""}`}
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

              {/* 3. Billing Terms */}
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

              {/* 4. EMI Options */}
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

              {/* 5. Approval Trail */}
              {isEditing && (
                <div className="space-y-3">
                  <SectionHeader label="Approval Workflow" />
                  <ApprovalTrailPanel
                    trail={approvalTrail}
                    currentStatus={form.status}
                  />
                </div>
              )}

              {/* 6. Remarks */}
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
                              "EMI",
                              "Status",
                              "Actions",
                            ].map((h, i) => (
                              <TableHead
                                key={h}
                                className={`text-xs font-heading${[4, 5, 6].includes(i) ? " hidden md:table-cell" : ""}`}
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
                                      onSuccess={fetchRecords}
                                    />
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
                                colSpan={11}
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
                  <div className="flex items-center justify-between mt-2 px-1">
                    <p className="text-xs text-muted-foreground">
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
    </>
  );
}

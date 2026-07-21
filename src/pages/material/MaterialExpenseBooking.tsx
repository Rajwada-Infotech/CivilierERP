import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { useFinYear } from "@/contexts/FinYearContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ArrowLeft,
  Receipt,
  CalendarDays,
  FileText,
  CreditCard,
  Loader2,
  User,
  Eye,
  Package,
  Save,
  Check,
  RotateCcw,
  Download,
  Upload,
  Building2,
  FolderKanban,
  SlidersHorizontal,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { exportToCsv, parseCsv } from "@/lib/export";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Field } from "./ExpenseBooking/FormPrimitives";
import { BillingAccordion } from "./ExpenseBooking/BillingAccordion";
import { EmiSection } from "./ExpenseBooking/EmiSection";
import { ApprovalTrailPanel } from "./ExpenseBooking/ApprovalTrailPanel";
import { RecordCard } from "./ExpenseBooking/RecordCard";
import { ExpenseBookingPreviewModal } from "./ExpenseBookingPreviewModal";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import {
  blankForm,
  computeBreakdown,
  computeGrnNetWithTerms,
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
import { usePageRights } from "@/hooks/usePageRights";


import { API, apiFetch } from "./ExpenseBooking/apiFetch";
import {
  PAGE_SIZE,
  INVOICE_TEMPLATE_COLUMNS,
  selectTriggerCls,
} from "./ExpenseBooking/constants";
import {
  DateField,
  SectionHeader,
  GRNChainBadge,
} from "./ExpenseBooking/PickerPrimitives";
import { AmountGstSection } from "./ExpenseBooking/AmountGstSection";
import { GRNItemsSummary } from "./ExpenseBooking/GRNItemsSummary";
import { computeGrnBd } from "./ExpenseBooking/computeGrnBd";
import { DeleteBlockedDialog } from "./ExpenseBooking/DeleteBlockedDialog";
import type { DeleteBlockInfo } from "./ExpenseBooking/DeleteBlockedDialog";
import { ExpenseBookingStatCards } from "./ExpenseBooking/ExpenseBookingStatCards";
import { BookingListToolbar } from "./ExpenseBooking/BookingListToolbar";
import { BookingPagination } from "./ExpenseBooking/BookingPagination";
import { DocSelectorPanel } from "./ExpenseBooking/DocSelectorPanel";
import { linkSupplierToInvoice } from "./ExpenseBooking/linkSupplierToInvoice";
import { resolveGstRates, parseGRNItemsFromRaw, derivePOGst } from "./ExpenseBooking/helpers";
import { aggregateGRNsForInvoice } from "./ExpenseBooking/invoiceLinking";
import { DirectItemsTable } from "./ExpenseBooking/DirectItemsTable";
import type {
  CompanyOption,
  ProjectOption,
  GSTConfig,
  POItem,
  WOItem,
  WorkDoneItem,
  TodItem,
  SourceKind,
  GRNItemLine,
  SelectedDoc,
  GRNItem,
  BillingTermOption,
  CostCenterOption,
  DocSelectorProps,
} from "./ExpenseBooking/types";

export default function MaterialExpenseBooking() {
  const importFileInputRef = useRef<HTMLInputElement>(null);
  // Scoped to this component instance (not module-level) so a different
  // user logging in within the same tab never sees a stale cache left
  // behind by whoever used this page before them.
  const mastersCacheRef = useRef<{
    po: POItem[] | null;
    wo: WOItem[] | null;
    woPO: POItem[] | null;
    tod: TodItem[] | null;
    grn: GRNItem[] | null;
    workDone: WorkDoneItem[] | null;
  }>({ po: null, wo: null, woPO: null, tod: null, grn: null, workDone: null });
  const _mastersCache = mastersCacheRef.current;
  const [importing, setImporting] = useState(false);
  const rights = usePageRights("expense-booking");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [bookedSourceIds, setBookedSourceIds] = useState<
    { ESourceType: string; ESourceId: number; Eid: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [, setTotalBookedAmount] = useState(0);
  const [view, setView] = useState<PageView>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ExpenseRecord, "id">>(blankForm());
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstMode, setGstMode] = useState<"cgst_sgst" | "igst">("cgst_sgst");

  const filteredProjectOptions = useMemo(() => {
    if (!form.companyId) return projectOptions;
    return projectOptions.filter(
      (p) => Number(p.company_id) === Number(form.companyId),
    );
  }, [projectOptions, form.companyId]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBlockInfo, setDeleteBlockInfo] =
    useState<DeleteBlockInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveInFlight = useRef(false);
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [listSearch, setListSearch] = useState("");
  const [approvalTrail, setApprovalTrail] =
    useState<ExpenseRecord["approvalTrail"]>(undefined);
  const [liveEmiSchedule, setLiveEmiSchedule] = useState<
    import("./ExpenseBooking/types").EmiScheduleRow[] | null
  >(null);
  const [previewRecord, setPreviewRecord] = useState<ExpenseRecord | null>(
    null,
  );
  const openPreview = useCallback((rec: ExpenseRecord | null) => {
    setPreviewRecord(rec);
    if (!rec?.id) return;
    // Re-fetch fresh data so totalPaid/billStatus reflect latest payment state
    apiFetch(`${API}/${rec.id}`)
      .then((row: any) => setPreviewRecord(dbToRecord(row)))
      .catch(() => {/* non-fatal — stale data still shown */});
  }, []);
  const [suppliers, setSuppliers] = useState<{ id: number; label: string }[]>(
    [],
  );
  const [supplierHeads, setSupplierHeads] = useState<
    { id: number; label: string; paymentTerms: string | null }[]
  >([]);
  const [, setBillingTerms] = useState<BillingTermOption[]>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<CostCenterOption[]>([]);
  const [paymentTermOptions, setPaymentTermOptions] = useState<{ Id: number; TermName: string; CreditDays: number | null }[]>([]);

  const isEditing = editingId !== null;

  const fetchRecords = useCallback(async (p = 1) => {
    try {
      setLoading(true);
      const data = await apiFetch(`${API}?page=${p}&limit=${PAGE_SIZE}`);
      setRecords((data.data ?? []).map(dbToRecord));
      setTotalPages(data.totalPages ?? 1);
      setTotalRecords(data.total ?? 0);
      setStatusCounts(data.statusCounts ?? {});
      setTotalBookedAmount(data.totalBookedAmount ?? 0);
      setPage(p);
    } catch (err: any) {
      toast.error("Failed to load bookings: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep-link support — Linked Documents panels navigate here as
  // /material/expense-booking?view=<Eid> to open this exact Invoice/booking.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    apiFetch(`${API}/${viewId}`)
      .then((row: any) => setPreviewRecord(dbToRecord(row)))
      .catch(() => toast.error(`Booking #${viewId} not found`));
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Only Service-type POs are eligible for a direct (no-GRN) invoice —
    // goods always have to be received via a GRN first. Filtering happens
    // server-side (see backend/services/invoiceLinking.js).
    load("po", "/api/purchase-orders/service-eligible", setPoList, setLoadingPO);
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
          paymentTerms: h.LHeadPaymentTerms ?? null,
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
    apiFetch("/api/cost-center/options")
      .then((list: CostCenterOption[]) =>
        setCostCenterOptions(Array.isArray(list) ? list : []),
      )
      .catch(() => {});
    apiFetch("/api/payment-plan-master")
      .then((list: any) => setPaymentTermOptions(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [fetchRecords]);

  const set = <K extends keyof Omit<ExpenseRecord, "id">>(
    field: K,
    value: Omit<ExpenseRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const resolveCostCenterForProject = useCallback(
    (projectId?: number | null) => {
      if (!projectId) return "";
      const match = costCenterOptions.find(
        (cc) => cc.projectId != null && Number(cc.projectId) === Number(projectId),
      );
      return match ? `${match.code} - ${match.label}` : "";
    },
    [costCenterOptions],
  );

  const applyDoc = (doc: SelectedDoc) => {
    setSelectedDoc(doc);

    // Multi-GRN combined invoices already carry their full merged
    // grnItems/amount (computed by aggregateGRNsForInvoice before this
    // was called) — skip the single-GRN refetch below, which would
    // otherwise overwrite the combined totals with just the primary GRN's.
    // computeGrnBd() (the actual GRN price-breakdown math) reads gstBreakdown,
    // not form.cgstRate/sgstRate, so build a synthetic breakdown from the
    // merged items' own per-item GST amounts instead of resolveGstRates.
    if (doc.kind === "GRN" && doc.linkedGrnIds && doc.linkedGrnIds.length > 1) {
      const items = doc.grnItems ?? [];
      const totalBase = items.reduce(
        (s, i) => s + (Number(i.receivedQty) || 0) * (Number(i.rate) || 0),
        0,
      );
      const totalGST = items.reduce(
        (s, i) => s + (Number((i as any).gstAmount) || 0),
        0,
      );
      setGstBreakdown({
        items,
        totals: {
          totalBase,
          totalCGST: totalGST / 2,
          totalSGST: totalGST / 2,
          totalGST,
          totalInclGST: totalBase + totalGST,
        },
      } as any);

      // The linked PO's own CostCenterId (fetched in applyMultiGRNDoc) is
      // the authoritative source — only guess from the project when the PO
      // itself has none set.
      const mAutoCostCenter =
        doc.costCenterLabel || resolveCostCenterForProject(doc.projectId);
      setForm((prev) => {
        const linkedSupplier = linkSupplierToInvoice(doc, {
          supplier: prev.supplier,
          supplierLHeadId: prev.supplierLHeadId ?? null,
        });
        return {
          ...prev,
          // GST rates — fetched from the linked PO's line items when
          // available (applyMultiGRNDoc), else the merged GRN items'
          // own rates. Stored on the booking so the list's CGST/SGST
          // columns show something other than 0%.
          cgstRate: doc.derivedCgstRate ?? prev.cgstRate,
          sgstRate: doc.derivedSgstRate ?? prev.sgstRate,
          igstRate: doc.derivedIgstRate ?? prev.igstRate,
          bookingReference: doc.docNo,
          bookingName: doc.nameLabel ?? prev.bookingName,
          basicAmount: totalBase > 0 ? totalBase : (doc.amount ?? prev.basicAmount),
          companyId: doc.companyId ?? prev.companyId,
          projectSite: doc.projectId ? String(doc.projectId) : prev.projectSite,
          ...linkedSupplier,
          costCenter: mAutoCostCenter || prev.costCenter,
          materialCategory: "GRN",
        };
      });
      return;
    }

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
          // Basic amount = sum of (receivedQty * rate) per item — qty × rate only, no GST
          const qtyRateTotal =
            Math.round(
              items.reduce(
                (s, i) =>
                  s + (Number(i.receivedQty) || 0) * (Number(i.rate) || 0),
                0,
              ) * 100,
            ) / 100;
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
              // Basic amount is always qty × rate (no GST), regardless of breakdown
              const basicAmt =
                qtyRateTotal > 0 ? qtyRateTotal : grnTotal > 0 ? grnTotal : 0;
              setForm((prev) => ({
                ...prev,
                bookingReference: canonicalDocNo,
                basicAmount: basicAmt,
              }));
            })
            .catch(() => {
              const basicAmt =
                qtyRateTotal > 0 ? qtyRateTotal : grnTotal > 0 ? grnTotal : 0;
              setForm((prev) => ({
                ...prev,
                bookingReference: canonicalDocNo,
                basicAmount: basicAmt,
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

    const { cgst, sgst, igst } = resolveGstRates(
      doc,
      form.cgstRate,
      form.sgstRate,
      form.igstRate ?? 0,
    );
    // The linked PO/WO_PO's own CostCenterId is authoritative — only
    // guess one from the project when the doc itself has none set (e.g.
    // TOD/direct bookings, which have no PO to inherit from).
    const autoCostCenter =
      doc.costCenterLabel || resolveCostCenterForProject(doc.projectId);
    setForm((prev) => {
      const linkedSupplier = linkSupplierToInvoice(doc, {
        supplier: prev.supplier,
        supplierLHeadId: prev.supplierLHeadId ?? null,
      });
      return {
        ...prev,
        bookingReference: doc.docNo,
        // Other Expenses (TOD) bookings have no descriptive source document —
        // name them by their supplier instead of the generic doc-type label.
        // PO/WO/GRN-linked bookings keep using the source doc's own label.
        bookingName:
          doc.kind === "TOD"
            ? linkedSupplier.supplier
              ? `Payment for ${linkedSupplier.supplier}`
              : prev.bookingName
            : (doc.nameLabel ?? prev.bookingName),
        basicAmount:
          doc.kind === "GRN"
            ? prev.basicAmount
            : doc.kind === "PO" || doc.kind === "WO_PO"
              ? (doc.subtotal ?? doc.amount ?? prev.basicAmount)
              : (doc.amount ?? prev.basicAmount),
        companyId: doc.companyId ?? prev.companyId,
        projectSite: doc.projectId ? String(doc.projectId) : prev.projectSite,
        ...linkedSupplier,
        costCenter: autoCostCenter || prev.costCenter,
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
        igstRate: igst,
        workDoneRef:
          doc.kind === "WORK_DONE"
            ? doc.docNo
            : doc.kind === "WO_PO" && (doc as any).sourceWDDocNo
              ? (doc as any).sourceWDDocNo
              : undefined,
      };
    });
  };

  // ── Combine multiple GRNs (same PO) into one invoice — the second way to
  // link GRNs, alongside picking one at a time. Uses grnList's already-
  // loaded data (GRNItems/TotalAmount), no refetch needed.
  const applyMultiGRNDoc = async (grns: GRNItem[]) => {
    const agg = aggregateGRNsForInvoice(grns);
    if (!agg.valid) {
      toast.error(agg.error || "Can't combine these GRNs.");
      return;
    }
    const ordered = [...grns].sort((a, b) => a.GRNID - b.GRNID);
    const primary = ordered[0];

    // GST rates for a combined invoice come from the linked PO's own line
    // items (the authoritative HSN-driven rate) rather than back-derived
    // from the GRNs' item totals — falls back to the GRN-derived rate
    // (agg.cgstRate/sgstRate) if the PO can't be fetched.
    let cgstRate = agg.cgstRate;
    let sgstRate = agg.sgstRate;
    let igstRate = 0;
    let poCostCenterLabel: string | null = null;
    if (agg.poId) {
      try {
        const po = await apiFetch(`/api/purchase-orders/${agg.poId}`);
        const {
          cgstRate: poCgst,
          sgstRate: poSgst,
          igstRate: poIgst,
        } = derivePOGst(po?.POItems ?? []);
        if (poIgst > 0) {
          cgstRate = 0;
          sgstRate = 0;
          igstRate = poIgst;
        } else if (poCgst > 0 || poSgst > 0) {
          cgstRate = poCgst;
          sgstRate = poSgst;
        }
        if (po?.CostCenterId) poCostCenterLabel = po.CostCenterName ?? null;
      } catch {
        /* non-fatal: keep the GRN-derived fallback rate */
      }
    }

    applyDoc({
      kind: "GRN",
      docNo: agg.grnDocNos.join(" + "),
      sourceId: agg.grnIds[0],
      vendorLabel: agg.supplierLabel ?? primary.SupplierName,
      status: "Approved",
      date: primary.GRNDate,
      nameLabel: agg.poNo ? `Combined GRNs — PO ${agg.poNo}` : "Combined GRNs",
      grnItems: agg.items,
      amount: agg.totalAmount,
      subtotal: agg.basicAmount,
      derivedCgstRate: cgstRate,
      derivedSgstRate: sgstRate,
      derivedIgstRate: igstRate,
      costCenterLabel: poCostCenterLabel,
      projectId: primary.ProjectId,
      companyId: primary.CompanyId,
      gst:
        typeof primary.ParentGST === "string"
          ? (() => {
              try {
                return JSON.parse(primary.ParentGST!);
              } catch {
                return null;
              }
            })()
          : (primary.ParentGST ?? null),
      linkedGrnIds: agg.grnIds,
      linkedGrnDocNos: agg.grnDocNos,
    });
    toast.success(
      `Combined ${agg.grnIds.length} GRNs into one invoice — total ₹${agg.totalAmount.toLocaleString("en-IN")}`,
    );
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
      supplierLHeadId: null,
    }));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(blankForm());
    setGstEnabled(false);
    setGstMode("cgst_sgst");
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

  const openAmend = (rec: ExpenseRecord) => {
    navigate("/material/amendment-menu", {
      state: {
        prefill: {
          tab: "EB",
          docId: rec.id ?? "",
          docNo: rec.bookingReference ?? "",
          supplierName: rec.supplier ?? "",
          projectName: rec.projectName ?? "",
          companyName: rec.companyName ?? "",
          totalAmount: rec.netAmount ?? rec.basicAmount ?? 0,
        },
      },
    });
  };

  const requestDelete = async (id: string) => {
    try {
      const result = await apiFetch(`${API}/${id}/can-delete`);
      if (!result.deletable) {
        if (result.reason === "brs_cleared") {
          setDeleteBlockInfo({
            reason: "brs_cleared",
            clearedPayments: result.clearedPayments,
          });
          return;
        }
        if (result.reason === "has_payments") {
          setDeleteBlockInfo({
            reason: "has_payments",
            linkedPayments: result.linkedPayments,
          });
          return;
        }
        // Debit note or generic block
        setDeleteBlockInfo({ reason: "debit_note" });
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
    try {
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
    } catch (err: any) {
      toast.error(err.message || "Failed to disable EMI for this booking.");
    }
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
    if (form.dueDate && form.bookingDate && form.dueDate < form.bookingDate) {
      toast.error("Due date cannot be before the booking date.");
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
    // For GRN bookings: use the shared computeGrnBd() which handles active billing
    // terms split by pre/post-GST, producing correct net with real GST amounts.
    const bd =
      selectedDoc?.kind === "GRN"
        ? computeGrnBd(form.basicAmount, form.billingTerms, gstBreakdown)
        : computeBreakdown(
            form.basicAmount,
            form.cgstRate,
            form.sgstRate,
            form.billingTerms && form.billingTerms.length > 0
              ? form.billingTerms
              : form.discount,
            form.igstRate ?? 0,
          );

    // Partial payment (EMI) — EMI is generated against the remaining balance
    // after the up-front partial amount, not the full net payable.
    const emiBaseAmountForSave =
      form.paymentType === "partial"
        ? Math.max(0, bd.netAmount - (form.partialAmount ?? 0))
        : bd.netAmount;

    let emiForSave = { ...form.emi };
    if (
      !isEditing &&
      form.emi.enabled &&
      form.emi.installmentCount > 0 &&
      form.emi.startDate
    ) {
      const freshSchedule = generateEmiSchedule(
        emiBaseAmountForSave,
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
      // Present only when multiple GRNs (same PO) were combined into this
      // one invoice — see ExpenseBooking/invoiceLinking.ts.
      ...(selectedDoc?.linkedGrnIds && selectedDoc.linkedGrnIds.length > 1
        ? { linkedGrnIds: selectedDoc.linkedGrnIds }
        : {}),
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
        setSaved(true);
        await fetchRecords(page);
        fetchBookedSources();
        setTimeout(() => {
          setSaved(false);
          cancelForm();
        }, 1500);
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

        setSaved(true);
        await fetchRecords(page);
        fetchBookedSources();
        setTimeout(() => {
          setSaved(false);
          cancelForm();
        }, 1500);
      }
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
      saveInFlight.current = false;
    }
  };

  const isGRN = selectedDoc?.kind === "GRN";

  const bd =
    selectedDoc?.kind === "GRN"
      ? computeGrnBd(form.basicAmount, form.billingTerms, gstBreakdown)
      : computeBreakdown(
          form.basicAmount,
          form.cgstRate,
          form.sgstRate,
          form.billingTerms && form.billingTerms.length > 0
            ? form.billingTerms
            : form.discount,
          form.igstRate ?? 0,
        );

  // Partial payment (EMI) — EMI is generated against the remaining balance
  // after the up-front partial amount, not the full net payable.
  const emiBaseAmount =
    form.paymentType === "partial"
      ? Math.max(0, bd.netAmount - (form.partialAmount ?? 0))
      : bd.netAmount;

  const filteredRecords = records.filter((r) => {
    if (statusFilter && statusFilter !== "All" && r.status !== statusFilter)
      return false;
    if (listSearch) {
      const q = listSearch.toLowerCase();
      if (
        !r.bookingReference?.toLowerCase().includes(q) &&
        !r.supplier?.toLowerCase().includes(q) &&
        !r.companyName?.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });
  const totalNet = records.reduce((sum, r) => {
    if (r.status === "Draft") return sum;
    // GRN-linked records: recompute from grnTotalAmount + billing terms with
    // correct pre/post-GST split (avoids stale ENetAmount from DB).
    if (r.eSourceType === "GRN" && r.grnTotalAmount != null) {
      const terms =
        r.billingTerms && r.billingTerms.length > 0
          ? r.billingTerms
          : r.discount
            ? [r.discount]
            : [];
      return (
        sum + computeGrnNetWithTerms(r.grnTotalAmount, terms, r.basicAmount)
      );
    }
    const bd = computeBreakdown(
      r.basicAmount,
      r.cgstRate,
      r.sgstRate,
      r.billingTerms && r.billingTerms.length > 0 ? r.billingTerms : r.discount,
      r.igstRate ?? 0,
    );
    return sum + bd.netAmount;
  }, 0);
  const approvedCount =
    statusCounts["Approved"] ??
    records.filter((r) => r.status === "Approved").length;
  const pendingCount =
    statusCounts["Pending"] ??
    records.filter((r) => r.status === "Pending").length;
  const emiCount = records.filter((r) => r.emi?.enabled).length;
  const vendorLabel =
    selectedDoc?.kind === "WORK_DONE" ? "Contractor" : "Supplier / Vendor";
  const isPOorWO =
    selectedDoc?.kind === "PO" ||
    selectedDoc?.kind === "WORK_DONE" ||
    selectedDoc?.kind === "WO_PO";
  /** True when the booking is a direct / Other-Expenses (TOD) entry with no linked source doc. */
  const isDirect = !isGRN && !isPOorWO;
  const { bookedPOIds, bookedWorkDoneIds, bookedWOPOIds, bookedGRNIds } =
    useMemo(() => {
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
      return { editingIdNum, bookedPOIds, bookedWorkDoneIds, bookedWOPOIds, bookedGRNIds };
    }, [bookedSourceIds, editingId]);

  const showDocSection = !!form.companyId;

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], INVOICE_TEMPLATE_COLUMNS, "invoice-template");
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
      toast.info("CSV import is not available yet. Please add records manually for now.");
      return;
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Invoice"]} />
      <FinanceShell
        title="Invoice"
        subtitle="Book expenses against purchase orders, confirmed work done, or invoice documents"
        icon={Receipt}
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2">
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 text-white hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                <span className="hidden sm:inline">{importing ? "Importing..." : "Import CSV"}</span>
              </button>
              {rights.canCreate && (
                <Button
                  onClick={openNew}
                  className="gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 transition-all"
                >
                  <Plus size={13} /> New Invoice
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {/* Form View */}
        {view === "form" && (
          <Card className="border-border shadow-sm">
            <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 bg-indigo-500/[0.06] border-b border-indigo-500/20">
              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-indigo-500 to-transparent" />
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={cancelForm}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </button>
                <span className="text-indigo-500/40">|</span>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-indigo-500/[0.18] border border-indigo-500/30 shrink-0">
                    <Receipt size={12} className="text-indigo-400" />
                  </div>
                  <h2 className="text-sm font-heading font-bold text-foreground truncate">
                    {isEditing ? "Edit Invoice" : "New Invoice"}
                  </h2>
                  {form.bookingReference && (
                    <span className="hidden sm:inline font-mono text-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-md shrink-0">
                      {form.bookingReference}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <CardContent className="pt-6 space-y-7 px-5 sm:px-6">
              {/* ── 0. Booking Information ─────────────────────────────── */}
              <div className="space-y-4">
                <SectionHeader label="Booking Information" />

                {/* ── Sub-section: Party & Project ── */}
                <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-indigo-500/10 flex items-center justify-center shrink-0">
                      <SlidersHorizontal size={12} className="text-indigo-500" />
                    </div>
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
                      Party &amp; Project
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        <Building2 size={11} className="shrink-0" />
                        Company
                        <span className="text-destructive">*</span>
                      </p>
                      <Select
                        value={form.companyId ? String(form.companyId) : ""}
                        onValueChange={(val) =>
                          set("companyId", val ? parseInt(val, 10) : null)
                        }
                      >
                        <SelectTrigger className={selectTriggerCls}>
                          <SelectValue
                            placeholder={
                              companyOptions.length === 0
                                ? "No companies found"
                                : "All companies"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {companyOptions.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        <FolderKanban size={11} className="shrink-0" />
                        Project
                      </p>
                      <Select
                        value={form.projectSite || ""}
                        onValueChange={(val) => set("projectSite", val || "")}
                      >
                        <SelectTrigger className={selectTriggerCls}>
                          <SelectValue
                            placeholder={
                              filteredProjectOptions.length === 0 &&
                              !form.projectSite
                                ? "No projects found"
                                : "All projects"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {form.projectSite &&
                            !filteredProjectOptions.some(
                              (p) => String(p.id) === form.projectSite,
                            ) && (
                              <SelectItem
                                key="__current__"
                                value={form.projectSite}
                              >
                                {projectOptions.find(
                                  (p) => String(p.id) === form.projectSite,
                                )?.label ||
                                  form.projectName ||
                                  form.projectSite}
                              </SelectItem>
                            )}
                          {filteredProjectOptions.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedDoc?.projectId && (
                        <p className="text-[10px] text-muted-foreground">
                          Pre-filled from linked order
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        <CalendarDays size={11} className="shrink-0" />
                        Year
                      </p>
                      <Select
                        value={form.financialYear}
                        onValueChange={(val) => set("financialYear", val)}
                      >
                        <SelectTrigger className={selectTriggerCls}>
                          <SelectValue placeholder="All years" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeFinYears.map((fy) => (
                            <SelectItem key={fy.id} value={fy.year}>
                              {fy.year}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedTod && (
                        <p className="text-[10px] text-muted-foreground">
                          Changing year updates the booking reference number
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        <User size={11} className="shrink-0" />
                        {vendorLabel}
                      </p>
                      {selectedDoc?.vendorLabel ? (
                        <div className="relative">
                          <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground shrink-0" />
                          <Input
                            value={form.supplier}
                            readOnly
                            title={form.supplier}
                            placeholder="Auto-filled from linked order"
                            className="pl-8 pr-3 bg-muted/30 cursor-not-allowed truncate"
                          />
                        </div>
                      ) : (
                        <Select value={form.supplier || "__none__"} onValueChange={(val) => {
                          const name = val === "__none__" ? "" : val;
                          set("supplier", name);
                          const head = name ? supplierHeads.find((s) => s.label === name) : undefined;
                          set("supplierLHeadId", head?.id ?? null);
                          // Other Expenses (TOD) bookings have no source-doc
                          // label to name themselves after — keep the
                          // booking name in sync with the chosen supplier.
                          if (name && selectedDoc?.kind === "TOD") {
                            set("bookingName", `Payment for ${name}`);
                          }
                          if (!name) return;
                          if (head?.paymentTerms) {
                            const termStr = head.paymentTerms.trim().toLowerCase();
                            const match = paymentTermOptions.find(
                              (t) => t.TermName.trim().toLowerCase() === termStr,
                            );
                            if (match) {
                              set("paymentTermId", match.Id);
                              if (form.bookingDate && match.CreditDays != null) {
                                const base = new Date(form.bookingDate);
                                base.setDate(base.getDate() + match.CreditDays);
                                set("dueDate", base.toISOString().split("T")[0]);
                              }
                            }
                          }
                          if (!form.vendorInvoiceDate) {
                            set("vendorInvoiceDate", new Date().toISOString().split("T")[0]);
                          }
                        }}>
                          <SelectTrigger className={selectTriggerCls}>
                            <SelectValue placeholder="All suppliers" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— None —</SelectItem>
                            {supplierHeads.map((s) => (
                              <SelectItem key={s.id} value={s.label}>{s.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {selectedDoc?.vendorLabel && (
                        <p className="text-[10px] text-muted-foreground">
                          {`Auto-filled from ${selectedDoc.kind === "PO" ? "Purchase Order (supplier)" : selectedDoc.kind === "GRN" ? "GRN (supplier)" : "Work Done (contractor)"}`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>{/* end Party & Project */}

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
                      onSelectMultiGRN={applyMultiGRNDoc}
                    />

                    {/* Source chain banner */}
                    {selectedDoc &&
                      (selectedDoc.kind === "WORK_DONE" ||
                        selectedDoc.kind === "WO_PO" ||
                        selectedDoc.kind === "PO" ||
                        selectedDoc.kind === "GRN") && (
                        <div
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${selectedDoc.kind === "GRN" ? "border-teal-500/30 bg-teal-500/5 text-teal-600 dark:text-teal-400" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"}`}
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
                            className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${selectedDoc.kind === "WORK_DONE" ? "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400" : selectedDoc.kind === "GRN" ? "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400" : "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"}`}
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
                  Select a company above to see matching documents.
                </div>
              )}

                {/* ── Sub-section: Dates & Payment ── */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60">Dates &amp; Payment</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Booking Date" required>
                      <DateField value={form.bookingDate} onChange={(val) => set("bookingDate", val)} />
                    </Field>
                    <Field label="Payment Term">
                      <select
                        className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition"
                        value={form.paymentTermId ?? ""}
                        onChange={(e) => {
                          const termId = e.target.value ? parseInt(e.target.value, 10) : null;
                          set("paymentTermId", termId);
                          if (termId && form.bookingDate) {
                            const term = paymentTermOptions.find((t) => t.Id === termId);
                            if (term && term.CreditDays != null) {
                              const base = new Date(form.bookingDate);
                              base.setDate(base.getDate() + term.CreditDays);
                              set("dueDate", base.toISOString().split("T")[0]);
                            }
                          }
                        }}
                      >
                        <option value="">— Select Payment Term —</option>
                        {paymentTermOptions.map((t) => (
                          <option key={t.Id} value={t.Id}>
                            {t.TermName}{t.CreditDays != null ? ` (${t.CreditDays} days)` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Due Date">
                      <DateField
                        value={form.dueDate}
                        min={form.bookingDate || undefined}
                        onChange={(val) => {
                          if (form.bookingDate && val && val < form.bookingDate) {
                            toast.error("Due date cannot be before the booking date.");
                            return;
                          }
                          set("dueDate", val);
                        }}
                      />
                    </Field>
                  </div>
                </div>

                {/* ── Sub-section: Vendor Invoice ── */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60">Vendor Invoice</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Vendor Invoice No">
                      <Input value={form.vendorInvoiceNo ?? ""} onChange={(e) => set("vendorInvoiceNo", e.target.value)} placeholder="Supplier invoice number" />
                    </Field>
                    <Field label="Vendor Invoice Date">
                      <DateField value={form.vendorInvoiceDate ?? ""} onChange={(val) => set("vendorInvoiceDate", val)} placeholder="Select invoice date..." />
                    </Field>
                  </div>
                </div>

                {/* ── Sub-section: Accounting ── */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/60">Accounting</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label="Cost Center"
                      className={
                        isDirect && selectedDoc?.kind === "TOD"
                          ? undefined
                          : "sm:col-span-2"
                      }
                      hint={selectedDoc?.projectId ? "Auto-filled from the selected document's project when a matching cost center exists" : "Select a cost center for expense allocation"}
                    >
                      <Select value={form.costCenter || "__none__"} onValueChange={(val) => set("costCenter", val === "__none__" ? "" : val)}>
                        <SelectTrigger className={selectTriggerCls}>
                          <SelectValue placeholder="Select cost center..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">-- None --</SelectItem>
                          {costCenterOptions.map((cc) => {
                            const value = `${cc.code} - ${cc.label}`;
                            return <SelectItem key={cc.id} value={value}>{value}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                    </Field>
                    {/* GL Account only makes sense for Other Expenses (TOD)
                        bookings — PO/GRN/WO-linked invoices already resolve
                        their GL posting from the linked document's own
                        accounts, so a free-text GL field there is unused and
                        confusing. */}
                    {isDirect && selectedDoc?.kind === "TOD" && (
                      <Field label="GL Account">
                        <Input value={form.glAccount ?? ""} onChange={(e) => set("glAccount", e.target.value)} placeholder="Optional GL account" />
                      </Field>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Direct (Other Expenses) Items ──────────────────────── */}
              {isDirect && selectedDoc?.kind === "TOD" && (
                <DirectItemsTable
                  items={form.directItems ?? []}
                  readOnly={
                    form.status === "Approved" ||
                    form.status === "Pending" ||
                    form.status === "Booked"
                  }
                  onChange={(items) => {
                    setForm((prev) => ({ ...prev, directItems: items }));
                  }}
                  onTotalChange={(total) => {
                    setForm((prev) => ({ ...prev, basicAmount: total }));
                  }}
                />
              )}

              {/* ── 2. Amount & GST ────────────────────────────────────── */}
              <AmountGstSection
                selectedDoc={selectedDoc}
                isGRN={isGRN}
                isPOorWO={isPOorWO}
                basicAmount={form.basicAmount}
                cgstRate={form.cgstRate}
                sgstRate={form.sgstRate}
                igstRate={form.igstRate ?? 0}
                gstEnabled={gstEnabled}
                gstMode={gstMode}
                billingTerms={form.billingTerms}
                discount={form.discount}
                bd={bd}
                gstBreakdown={gstBreakdown}
                onChangeBasicAmount={(v) => set("basicAmount", v)}
                onChangeCgstRate={(v) => set("cgstRate", v)}
                onChangeSgstRate={(v) => set("sgstRate", v)}
                onChangeIgstRate={(v) => set("igstRate", v)}
                onToggleGstEnabled={(enabled) => {
                  setGstEnabled(enabled);
                  if (!enabled) {
                    set("cgstRate", 0);
                    set("sgstRate", 0);
                    set("igstRate", 0);
                  }
                }}
                onChangeGstMode={(mode) => {
                  setGstMode(mode);
                  if (mode === "igst") {
                    set("cgstRate", 0);
                    set("sgstRate", 0);
                  } else {
                    set("igstRate", 0);
                  }
                }}
              />

              {/* ── GRN Items Summary ──────────────────────────────────── */}
              {isGRN && (
                <GRNItemsSummary
                  grnItemsLoading={grnItemsLoading}
                  grnItems={selectedDoc?.grnItems}
                  gstBreakdown={gstBreakdown}
                />
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
                    isGRN
                      ? (selectedDoc?.amount ?? form.grnTotalAmount ?? null)
                      : null
                  }
                  gstBreakdown={
                    isGRN && gstBreakdown ? (gstBreakdown as any) : null
                  }
                />
              </div>

              {/* ── 4. EMI Options ─────────────────────────────────────── */}
              {!isGRN && (
                <div className="space-y-3">
                  <SectionHeader label="EMI / Installment Options" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Payment Type" required>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            { value: "full", label: "Full payment" },
                            { value: "partial", label: "Partial payment (EMI)" },
                          ] as const
                        ).map((opt) => {
                          const active = (form.paymentType || "full") === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                set("paymentType", opt.value);
                                if (opt.value === "full") set("partialAmount", 0);
                              }}
                              className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-center transition-colors ${
                                active
                                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "border-border text-muted-foreground hover:border-emerald-500/40 hover:text-foreground"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                    {form.paymentType === "partial" && (
                      <Field
                        label="Partial Payment Amount (₹)"
                        hint="Paid now — EMI is generated for the remaining balance"
                      >
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold">
                            ₹
                          </span>
                          <Input
                            type="number"
                            min={0}
                            max={bd.netAmount}
                            value={form.partialAmount || ""}
                            onChange={(e) => {
                              const val = Math.min(
                                Math.max(parseFloat(e.target.value) || 0, 0),
                                bd.netAmount,
                              );
                              set("partialAmount", val);
                            }}
                            className="pl-7 font-mono"
                            placeholder="0.00"
                          />
                        </div>
                      </Field>
                    )}
                  </div>
                  {form.paymentType === "partial" &&
                    (form.partialAmount ?? 0) > 0 && (
                      <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-xs">
                        <span className="text-muted-foreground">
                          Remaining balance for EMI
                        </span>
                        <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                          ₹{fmt(emiBaseAmount)}
                        </span>
                      </div>
                    )}
                  <EmiSection
                    emi={form.emi}
                    netAmount={emiBaseAmount}
                    baseDocNo={form.bookingReference}
                    onChange={(emi) => set("emi", emi)}
                    liveSchedule={isEditing ? liveEmiSchedule : null}
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
              <div className="space-y-3">
                <SectionHeader label="Remarks" />
                <textarea
                  value={form.remarks}
                  onChange={(e) => set("remarks", e.target.value)}
                  placeholder="Optional notes or internal comments…"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none text-foreground placeholder:text-muted-foreground"
                />
              </div>

              {/* Save row */}
              {(() => {
                const ebCanSave = !!(
                  form.bookingReference.trim() &&
                  form.bookingDate &&
                  form.companyId &&
                  (selectedDoc?.kind === "GRN" ||
                    (form.basicAmount && form.basicAmount > 0))
                );
                const ebIsDirty = !!(
                  form.companyId ||
                  form.supplier ||
                  form.invoiceReference ||
                  form.basicAmount ||
                  form.poId ||
                  form.bookingReference.trim()
                );
                return (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
                    <p className="text-[11px] text-muted-foreground hidden sm:block">
                      {saved ? (
                        <span className="text-emerald-500 font-medium">
                          Saved!
                        </span>
                      ) : ebCanSave ? (
                        <span className="text-emerald-500 font-medium">
                          Ready to save
                        </span>
                      ) : (
                        "Fill in the required fields to save"
                      )}
                    </p>
                    <div className="flex items-center gap-2 sm:ml-auto">
                      <button
                        type="button"
                        onClick={resetForm}
                        disabled={saving || saved || !ebIsDirty}
                        className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw size={12} /> Reset
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving || saved || !ebCanSave}
                        className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
                      >
                        {saved ? (
                          <Check size={14} />
                        ) : saving ? (
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Save size={14} />
                        )}
                        {saved
                          ? "Saved!"
                          : saving
                            ? "Saving…"
                            : isEditing
                              ? "Update Booking"
                              : "Save Invoice"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* List View */}
        {view === "list" && (
          <>
            {!loading && records.length > 0 && (
              <ExpenseBookingStatCards
                totalNet={totalNet}
                approvedCount={approvedCount}
                pendingCount={pendingCount}
                emiCount={emiCount}
              />
            )}
            {loading && (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                Loading bookings…
              </div>
            )}
            {!loading && (
              <>
                <Card className="border-border shadow-sm">
                  <CardHeader className="pb-3 border-b border-border">
                    <BookingListToolbar
                      totalRecords={totalRecords}
                      search={listSearch}
                      onSearchChange={setListSearch}
                      statusFilter={statusFilter}
                      onStatusFilterChange={setStatusFilter}
                    />
                  </CardHeader>
                  <CardContent className="p-0">
                    {/* Mobile cards */}
                    <div className="flex flex-col gap-3 sm:hidden p-3">
                      {filteredRecords.length === 0 && (
                        <div className="text-center py-16 text-muted-foreground text-sm border rounded-xl border-dashed border-border">
                          {statusFilter !== "All"
                            ? `No bookings with status "${statusFilter}". Try a different filter.`
                            : `No bookings yet. Click 'New Invoice' to get started.`}
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
                          onEdit={() => openAmend(rec)}
                          onPreview={() => openPreview(rec)}
                          onDelete={() => requestDelete(rec.id)}
                          onApprovalSuccess={fetchRecords}
                          canEdit={rights.canEdit}
                          canDelete={rights.canDelete}
                        />
                      ))}
                    </div>

                    {/* Records table */}
                    <div className="hidden sm:block">
                      {/* Table still scrolls horizontally on narrow
                          viewports — just without the visible scrollbar
                          track taking up a row of its own. */}
                      <div className="rounded-md [&>div]:[scrollbar-width:none] [&>div]:[-ms-overflow-style:none] [&>div::-webkit-scrollbar]:hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="text-xs font-heading w-[20%]">
                                Booking Ref
                              </TableHead>
                              <TableHead className="text-xs font-heading w-[16%]">
                                Vendor
                              </TableHead>
                              <TableHead className="text-xs font-heading w-[12%] hidden xl:table-cell">
                                Company / Project
                              </TableHead>
                              <TableHead className="text-xs font-heading w-[10%] text-right">
                                Basic Amt
                              </TableHead>
                              <TableHead className="text-xs font-heading w-[9%] text-right hidden md:table-cell">
                                GST
                              </TableHead>
                              <TableHead className="text-xs font-heading w-[12%] text-right">
                                Net Amt
                              </TableHead>
                              <TableHead className="text-xs font-heading w-[12%] hidden lg:table-cell">
                                GRN
                              </TableHead>
                              <TableHead className="text-xs font-heading w-[9%]">
                                Status
                              </TableHead>
                              <TableHead className="text-xs font-heading w-[10%] text-right">
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredRecords.map((rec, index) => {
                              // For GRN-linked records, recompute from grnTotalAmount + billing terms
                              // with correct pre/post-GST split (avoids stale ENetAmount from DB).
                              // For all others, use computeBreakdown on stored basicAmount.
                              const effectiveNet = (() => {
                                if (
                                  rec.eSourceType === "GRN" &&
                                  rec.grnTotalAmount != null
                                ) {
                                  const terms =
                                    rec.billingTerms &&
                                    rec.billingTerms.length > 0
                                      ? rec.billingTerms
                                      : rec.discount
                                        ? [rec.discount]
                                        : [];
                                  return computeGrnNetWithTerms(
                                    rec.grnTotalAmount,
                                    terms,
                                    rec.basicAmount,
                                  );
                                }
                                const rbd = computeBreakdown(
                                  rec.basicAmount,
                                  rec.cgstRate,
                                  rec.sgstRate,
                                  rec.billingTerms &&
                                    rec.billingTerms.length > 0
                                    ? rec.billingTerms
                                    : rec.discount,
                                  rec.igstRate ?? 0,
                                );
                                return rec.netAmount ?? rbd.netAmount;
                              })();
                              return (
                                <TableRow
                                  key={
                                    rec.id
                                      ? `booking-row-${rec.id}`
                                      : `booking-row-${index}`
                                  }
                                  className={`hover:bg-muted/30 transition-colors border-b border-border/50 last:border-0 ${rec.status === "Draft" ? "opacity-70" : ""}`}
                                >
                                  <TableCell className="py-3">
                                    {rec.status === "Draft" ? (
                                      <p
                                        className="text-[11px] font-semibold text-amber-500 dark:text-amber-400 leading-tight max-w-[180px] truncate"
                                        title={rec.bookingReference || ""}
                                      >
                                        {rec.bookingReference || "—"}
                                      </p>
                                    ) : (
                                      <p
                                        className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 leading-tight max-w-[160px] truncate"
                                        title={rec.bookingReference || ""}
                                      >
                                        {rec.bookingReference || "—"}
                                      </p>
                                    )}
                                    <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                                      {rec.bookingDate && (
                                        <span>{rec.bookingDate}</span>
                                      )}
                                      {rec.docTypeName ? (
                                        <span className="opacity-60">
                                          · {rec.docTypeName}
                                        </span>
                                      ) : null}
                                      {rec.emi?.enabled ? (
                                        <span className="inline-flex items-center gap-0.5 text-[9px] font-heading font-semibold bg-violet-500/10 text-violet-500 border border-violet-500/20 px-1 py-0.5 rounded-full">
                                          <CreditCard size={8} />
                                          {rec.emi.installmentCount}x
                                        </span>
                                      ) : null}
                                    </p>
                                  </TableCell>
                                  <TableCell className="text-xs max-w-[120px] py-3 text-foreground/80">
                                    <p className="truncate">{rec.supplier || "—"}</p>
                                    {rec.supplierGstRegistered !== undefined ? (
                                      <span
                                        className={`inline-flex items-center mt-1 text-[9px] font-heading font-semibold px-1.5 py-0.5 rounded-full border ${
                                          rec.supplierGstRegistered
                                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                        }`}
                                      >
                                        {rec.supplierGstRegistered ? "GST Bill" : "Non GST Bill"}
                                      </span>
                                    ) : null}
                                  </TableCell>
                                  <TableCell className="hidden xl:table-cell py-3">
                                    <p className="text-xs truncate max-w-[110px]">
                                      {rec.companyName || "—"}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground truncate max-w-[110px]">
                                      {rec.projectName || "—"}
                                    </p>
                                  </TableCell>
                                  <TableCell className="font-mono text-xs text-right text-muted-foreground py-3">
                                    {rec.status === "Draft" ? (
                                      <span className="text-muted-foreground/50">
                                        —
                                      </span>
                                    ) : (
                                      (() => {
                                        // For GRN records, derive original base from grnTotalAmount
                                        // since rec.basicAmount may be stale from old saves.
                                        if (
                                          rec.eSourceType === "GRN" &&
                                          rec.grnTotalAmount != null
                                        ) {
                                          const gstRate =
                                            (rec.igstRate ?? 0) > 0
                                              ? rec.igstRate ?? 0
                                              : (rec.cgstRate ?? 0) +
                                                (rec.sgstRate ?? 0);
                                          const base =
                                            gstRate > 0
                                              ? rec.grnTotalAmount /
                                                (1 + gstRate / 100)
                                              : rec.grnTotalAmount;
                                          return `₹${fmt(Math.round(base * 100) / 100)}`;
                                        }
                                        return `₹${fmt(rec.basicAmount)}`;
                                      })()
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs text-right text-foreground/70 py-3 hidden md:table-cell">
                                    {rec.status === "Draft" ? (
                                      "—"
                                    ) : (rec.igstRate ?? 0) > 0 ? (
                                      <span title="IGST (interstate)">
                                        {rec.igstRate}%
                                      </span>
                                    ) : (
                                      `${(rec.cgstRate ?? 0) + (rec.sgstRate ?? 0)}%`
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs font-semibold text-right py-3">
                                    {rec.status === "Draft" ? (
                                      <span className="text-amber-500 dark:text-amber-400">
                                        ₹{fmt(effectiveNet)}
                                      </span>
                                    ) : (
                                      `₹${fmt(effectiveNet)}`
                                    )}
                                  </TableCell>
                                  <TableCell className="hidden lg:table-cell py-3 min-w-[100px]">
                                    <GRNChainBadge bookingId={rec.id} />
                                  </TableCell>
                                  <TableCell className="py-3">
                                    {rec.status === "Draft" ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25">
                                        <Package
                                          size={10}
                                          className="shrink-0"
                                        />
                                        Pending Items
                                      </span>
                                    ) : null}
                                    <ApprovalStatusChain
                                      table="ExpenseBooking"
                                      recordId={rec.id}
                                      fallback={
                                        rec.status === "Pending" ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                                            <Clock size={10} />
                                            Pending
                                          </span>
                                        ) : null
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="py-3">
                                    <div className="flex gap-1 items-center justify-end">
                                      <ApprovalActions
                                        status={rec.status}
                                        recordId={rec.id}
                                        endpoint="/api/expense-booking"
                                        submitOnly
                                        onSuccess={() => fetchRecords(page)}
                                      />
                                      <button
                                        type="button"
                                        className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
                                        onClick={() => openPreview(rec)}
                                        title="Preview"
                                      >
                                        <Eye size={15} />
                                      </button>
                                      {rights.canDelete && (
                                        <button
                                          type="button"
                                          className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                                          onClick={() => requestDelete(rec.id)}
                                          title="Delete"
                                        >
                                          <Trash2 size={15} />
                                        </button>
                                      )}
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
                                  {statusFilter !== "All"
                                    ? `No bookings with status "${statusFilter}". Try a different filter.`
                                    : `No bookings yet. Click "New Invoice" to get started.`}
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* Pagination */}
                    <BookingPagination
                      page={page}
                      totalPages={totalPages}
                      totalRecords={totalRecords}
                      onPageChange={fetchRecords}
                    />
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
        <DeleteBlockedDialog
          info={deleteBlockInfo}
          onClose={() => setDeleteBlockInfo(null)}
        />

        {/* Delete Confirm */}
        <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Booking</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this expense booking? This
                cannot be undone.
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
          onEdit={(record) => openAmend(record)}
        />

        {/* Remaining GRN Items — auto-created silently on save */}
      </FinanceShell>
    </>
  );
}

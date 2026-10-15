// Everything the GRN page holds: master data, the list, the form, PO lines received,
// attachments, print and the mutations. The page and its parts read from this one object.
import * as grnApi from "@/api/grnApi";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { printGrn, downloadGrnPdf } from "@/utils/grnDocument";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { exportToCsv, parseCsv } from "@/lib/export";
import { computeRemainingPOItems, hasRemainingItems, countRemainingItems, buildGRNLineItemsFromRemaining, type RemainingPOItem } from "../grnRemainingItems";
import { createQualityDebitNote } from "@/api/qualityRejectionDebitNoteApi";
import { getProjects, getCompanies, type GRNFormDataPayload, type PurchaseOrder } from "@/api/grnApi";
import { getGodowns } from "@/api/godownsApi";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { GRNItemLine, PendingItemsData, RemainingItemsPanel, createEmptyItem, parseJsonArray, round3, deriveFYFromDate, bridge, GRN_TEMPLATE_COLUMNS } from "./config";

export function useGRN() {
  bridge.queryClient = useQueryClient();
  const rights = usePageRights("grn-master");
  const today = new Date().toISOString().slice(0, 10);
  bridge.canDelete = rights.canDelete;
  bridge.canEdit = rights.canEdit;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Quality-rejection debit note — raised against a single GRN line item
  // (identified by its position in the GRNItems JSON array) from the view
  // modal's Received Items table.
  const [debitNoteLine, setDebitNoteLine] = useState<{ index: number; item: GRNItemLine } | null>(null);
  const [debitNoteQty, setDebitNoteQty] = useState("");
  const [debitNoteReason, setDebitNoteReason] = useState("");
  const debitNoteMut = useMutation({
    mutationFn: () =>
      createQualityDebitNote({
        grnId: viewingGrn.GRNID,
        grnItemIndex: debitNoteLine!.index,
        rejectedQty: parseFloat(debitNoteQty) || 0,
        reason: debitNoteReason.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast.success(
        `Debit note ${res.docNo} raised — ${res.percentBad}% bad, ₹${res.amount.toLocaleString("en-IN")}`,
      );
      setDebitNoteLine(null);
      setDebitNoteQty("");
      setDebitNoteReason("");
    },
    onError: (err: any) => toast.error(err.message || "Failed to raise debit note"),
  });
  const { finYears } = useFinYear();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [viewingGrn, setViewingGrn] = useState<any | null>(null);
  const [viewModalTab, setViewModalTab] = useState<"details" | "posting">(
    "details",
  );

  // Fetch live posting data when the posting tab is opened
  React.useEffect(() => {
    if (viewModalTab !== "posting" || !viewingGrn?.GRNID) return;
    setGrnPostingLoading(true);
    setGrnPostingData(null);
    fetchWithAuth(`/api/grns/${viewingGrn.GRNID}/posting`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGrnPostingData(d ?? null))
      .catch(() => setGrnPostingData(null))
      .finally(() => setGrnPostingLoading(false));
  }, [viewModalTab, viewingGrn?.GRNID]);

  const [grnPostingData, setGrnPostingData] = useState<any | null>(null);
  const [grnPostingLoading, setGrnPostingLoading] = useState(false);
  const [grnPosting, setGrnPosting] = useState(false);
  const [grnPostingError, setGrnPostingError] = useState<string | null>(null);

  // Auto-post as soon as the posting tab's data has loaded and it isn't
  // posted yet — no manual "Post to GL" click; the journal entry is created
  // the moment the user looks at the posting tab.
  React.useEffect(() => {
    if (
      viewModalTab !== "posting" ||
      grnPostingLoading ||
      !grnPostingData ||
      grnPostingData.isPosted ||
      grnPosting ||
      !viewingGrn?.GRNID
    )
      return;
    const grnId = viewingGrn.GRNID;
    setGrnPosting(true);
    setGrnPostingError(null);
    fetchWithAuth(`/api/grns/${grnId}/post-to-gl`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error ?? "Posting failed");
        setGrnPostingData((prev: any) => ({
          ...prev,
          isPosted: true,
          jvNo: body.jvNo,
          jvId: body.jvId,
        }));
      })
      .catch((err: any) => setGrnPostingError(err.message ?? "Posting failed"))
      .finally(() => setGrnPosting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewModalTab, grnPostingLoading, grnPostingData, viewingGrn?.GRNID]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [grnStatusFilter, setGrnStatusFilter] = useState("All");
  const [loadingPO, setLoadingPO] = useState(false);
  const [pendingVehicleInOuts, setPendingVehicleInOuts] = useState<any[]>([]);
  const [loadingVehicleInOuts, setLoadingVehicleInOuts] = useState(false);
  const [poRemainingItems, setPoRemainingItems] = useState<RemainingPOItem[]>(
    [],
  );
  const [selectedFinYear, setSelectedFinYear] = useState<string>("");
  const [deleteBlockInfo, setDeleteBlockInfo] = useState<{
    reason: string;
    expenseBookings?: { id: number; docNo: string; status: string }[];
    clearedPayments?: {
      paymentId: number;
      paymentName: string;
      amount: number;
      brsId: number;
      expenseDocNo: string;
    }[];
    linkedPayments?: {
      paymentId: number;
      paymentName: string;
      amount: number;
      expenseDocNo: string;
    }[];
  } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const limit = 10;

  const activeFinYearEntry =
    finYears.find((fy) => fy.status === "Active") ||
    [...finYears].sort((a, b) => b.year.localeCompare(a.year))[0];
  const activeFinYear = activeFinYearEntry?.year || undefined;
  // The GRN list endpoint filters by a derived "YYYY-YYYY" FinYear string
  // (built from GRNDate, see GET /api/grns), not the FinYear label ("FY
  // 2026-27") the context stores — passing the label made the filter never
  // match anything and silently returned zero rows. Derive the same
  // "YYYY-YYYY" shape from the active year's start date instead.
  const activeFinYearRange = activeFinYearEntry?.startDate
    ? `${new Date(activeFinYearEntry.startDate).getFullYear()}-${new Date(activeFinYearEntry.startDate).getFullYear() + 1}`
    : undefined;

  // Selectable years for the (now unlocked) Financial Year filter — same
  // "YYYY-YYYY" shape as activeFinYearRange so it matches what the backend
  // computes per-GRN. Restricted to Active fin years from the Fin Year
  // master — a GRN is a live receiving transaction, not a backdated entry
  // against a closed year.
  const finYearOptions = useMemo(
    () =>
      finYears
        .filter((fy) => fy.status === "Active")
        .map((fy) =>
          fy.startDate
            ? `${new Date(fy.startDate).getFullYear()}-${new Date(fy.startDate).getFullYear() + 1}`
            : null,
        )
        .filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i)
        .sort((a, b) => b.localeCompare(a)),
    [finYears],
  );

  // Default the Financial Year filter to the active year once it loads, but
  // leave it editable — matches PurchaseOrderMaster.tsx / VehicleInOut.tsx.
  useEffect(() => {
    if (!selectedFinYear && activeFinYearRange)
      setSelectedFinYear(activeFinYearRange);
  }, [activeFinYearRange, selectedFinYear]);

  const buildEmptyForm = () => ({
    grnNo: "",
    grnDate: new Date().toISOString().slice(0, 10),
    // Doc Date — always today's date, distinct from GRN Date which now
    // tracks the linked Vehicle In/Out document's own date.
    docDate: new Date().toISOString().slice(0, 10),
    supplierId: "",
    supplierName: "",
    poId: "",
    poNumber: "",
    vehicleInOutId: "" as string,
    vehicleInOutDocNo: "" as string,
    // Which of the two ways this GRN's items were sourced from — a
    // specific Vehicle In/Out lot, or a direct "remaining items on this
    // PO" quick-fill. Empty until the user picks one.
    grnSourceMode: "" as "" | "vehicleInOut" | "remaining",
    // Why the vehicle gate was skipped — only shown/sent when
    // grnSourceMode === "remaining" (no Vehicle In/Out on this GRN).
    directEntryReason: "" as string,
    poTotalAmount: 0 as number,
    poSubtotalAmount: 0 as number,
    poReceivedAmount: 0 as number,
    remarks: "",
    status: "Draft" as const,
    items: [createEmptyItem()] as GRNItemLine[],
    docTypeId: null as number | null,
    docNo: "",
    parentDocNo: "",
    rootExBDocNo: "",
    finYear: activeFinYear || "",
    companyId: "" as string,
    projectId: "" as string,
    godownId: "" as string,
  });

  const [formData, setFormData] = useState(buildEmptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Queries ──────────────────────────────────────────────────────────────────
  const {
    data: grnsPage,
    isLoading: loadingGrns,
    isFetching: fetchingGrns,
  } = useQuery({
    queryKey: ["grns", page, limit, selectedFinYear],
    queryFn: () =>
      grnApi.getGRNs({
        page,
        limit,
        ...(selectedFinYear ? { finYear: selectedFinYear } : {}),
      }),
    placeholderData: (prev) => prev,
  });
  const grns = grnsPage?.data ?? [];
  const totalPages = Math.max(grnsPage?.totalPages ?? 1, 1);
  const totalRecords = grnsPage?.total ?? grns.length;

  // Fetch ALL POs — filtered client-side by fy_id
  const { data: posData = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => grnApi.getPurchaseOrders(),
  });

  // Derive the financial year string from a date string using Indian FY rule (Apr–Mar).
  // e.g. 2026-01-15 → "2025-2026",  2026-05-10 → "2026-2027"
  useQuery({ queryKey: ["uomMaster"], queryFn: grnApi.getUoms });

  const { data: grnNumberPreview, isFetching: loadingPreview } = useQuery({
    queryKey: ["grns", "next-number", formData.parentDocNo],
    queryFn: () => grnApi.previewNextGRNNumber(formData.parentDocNo || null),
    enabled: !editingId,
    staleTime: 15_000,
  });

  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  });
  const godowns = (godownsData as any)?.data ?? [];

  // Find the godown linked to a project (by ProjectID FK on Godowns row)
  const findProjectGodownId = (
    projectId: string | number | null | undefined,
  ): string => {
    if (!projectId || !godowns.length) return "";
    const match = godowns.find(
      (g: any) => String(g.ProjectID) === String(projectId),
    );
    return match ? String(match.GodownID) : "";
  };

  // Auto-select the project-linked godown whenever projectId changes.
  // Skip when editing an existing GRN (the saved GodownID is loaded via loadForEdit).
  useEffect(() => {
    if (editingId) return;
    const auto = findProjectGodownId(formData.projectId);
    setFormData((prev) => {
      if (prev.godownId === auto) return prev; // no change → no re-render
      return { ...prev, godownId: auto };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.projectId, godowns]);

  const { data: filteredProjects = [] } = useQuery({
    queryKey: ["grn-projects", formData.companyId],
    queryFn: () => getProjects(formData.companyId || null),
  });

  const { data: companiesData = [] } = useQuery({
    queryKey: ["grn-companies"],
    queryFn: getCompanies,
  });

  const pos = useMemo(
    () =>
      (posData as PurchaseOrder[])
        .filter((po) => {
          if (formData.poId && String(po.PurchaseOrderID) === formData.poId)
            return true;
          // Only Approved POs (or already-partially-received ones) can be
          // used to raise a GRN. Draft / Pending / Rejected / Cancelled POs
          // must not show up in the dropdown.
          const status = (po as any).Status;
          if (status !== "Approved" && status !== "Received") return false;
          if (selectedFinYear) {
            // selectedFinYear is a derived "YYYY-YYYY" string (see
            // activeFinYearRange above) — always derive the PO's FY the
            // same way from its date rather than comparing against the
            // "FY YYYY-YY" label, which uses a different format.
            const poFY = deriveFYFromDate((po as any).PODate);
            if (!poFY || poFY !== selectedFinYear) return false;
          }
          if (formData.companyId) {
            if (String((po as any).CompanyId ?? "") !== formData.companyId)
              return false;
          }
          if (formData.projectId) {
            if (String((po as any).ProjectId ?? "") !== formData.projectId)
              return false;
          }
          return true;
        })
        .map((po) => {
          const docNo = po.DocNo || po.PurchaseOrderNo;
          const typeTag =
            po.POType === "Normal"
              ? " [Normal]"
              : po.POType === "WO_PO"
                ? " [WO_PO]"
                : "";
          return {
            value: String(po.PurchaseOrderID),
            label: `${docNo}${typeTag}`,
          };
        }),
    [
      posData,
      selectedFinYear,
      formData.companyId,
      formData.projectId,
      formData.poId,
      editingId,
    ],
  );

  const filteredGrns = grns.filter((grn: any) => {
    if (selectedFinYear && grn.FinYear && grn.FinYear !== selectedFinYear)
      return false;
    if (grnStatusFilter !== "All" && grn.Status !== grnStatusFilter)
      return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      grn.DocNo?.toLowerCase().includes(q) ||
      grn.GRNNo?.toLowerCase().includes(q) ||
      grn.PONumber?.toLowerCase().includes(q) ||
      grn.SupplierName?.toLowerCase().includes(q) ||
      grn.SourceTransferDocNo?.toLowerCase().includes(q) ||
      grn.SourceMRDocNo?.toLowerCase().includes(q)
    );
  });

  // ── Group by linked PO — every GRN raised against the same PO now shows
  // together instead of scattered across the flat register, matching the
  // same grouping VehicleInOut.tsx uses. GRNs with no PO link (transfer
  // GRNs, older records) fall into one "No PO Linked" bucket. Group order
  // follows first-appearance in the (already recency-sorted) page.
  const groupedGrns = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; poNumber: string | null; supplierName: string | null; rows: any[] }
    >();
    for (const grn of filteredGrns) {
      const key = grn.POID ? `po-${grn.POID}` : "no-po";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          poNumber: grn.PONumber || null,
          supplierName: grn.SupplierName || null,
          rows: [],
        });
      }
      groups.get(key)!.rows.push(grn);
    }
    return Array.from(groups.values());
  }, [filteredGrns]);

  // One request for every visible row's approval trail instead of one per
  // row — see useApprovalTrailsBulk's own comment.
  const { trails: grnApprovalTrails, isLoading: grnApprovalTrailsLoading } = useApprovalTrailsBulk(
    "GoodsReceiptNotes",
    filteredGrns.map((g: any) => g.GRNID),
  );
  bridge.grnApprovalTrails = grnApprovalTrails;
  bridge.grnApprovalTrailsLoading = grnApprovalTrailsLoading;

  const [collapsedGrnGroups, setCollapsedGrnGroups] = useState<
    Record<string, boolean>
  >({});
  const toggleGrnGroup = (key: string) =>
    setCollapsedGrnGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  // base total (excl. GST) — used for stock ledger and line display
  const grandTotal = formData.items.reduce(
    (sum, i) => sum + (i.totalAmount || 0),
    0,
  );
  // GST amount per item comes from PO's TaxPct (HSN master) × billing value
  const grandGSTAmount = formData.items.reduce(
    (sum, i) => sum + (i.gstAmount || 0),
    0,
  );
  // GRN total incl. GST — compared against poTotalAmount (also incl. GST)
  const grnTotalWithGST = grandTotal + grandGSTAmount;

  // ── Mutations ─────────────────────────────────────────────────────────────────
  // Cache-version bumps (bumpCacheVersion("grns") on the backend) take a
  // beat to propagate across backend workers before a refetch is
  // guaranteed to see fresh data — PurchaseOrderMaster.tsx's approval flow
  // already works around this with the same delay (see its
  // handleApprovalSuccess). GRN's create/update/delete didn't have it,
  // which is why the list looked stale until a manual browser refresh.
  const CACHE_PROPAGATION_DELAY_MS = 400;

  const createMutation = useMutation({
    mutationFn: grnApi.addGRN,
    onSuccess: async (res) => {
      setPage(1);
      await new Promise((r) => setTimeout(r, CACHE_PROPAGATION_DELAY_MS));
      await bridge.queryClient.invalidateQueries({ queryKey: ["grns"] });
      await bridge.queryClient.refetchQueries({ queryKey: ["grns"], type: "all" });
      const generated = res?.grnNo || "";
      setFormData(buildEmptyForm());
      setEditingId(null);
      setShowForm(false);
      setErrors({});
      if (generated) setFormData((p) => ({ ...p, grnNo: generated }));
      toast.success(`GRN ${generated} created and sent for approval`);
    },
    onError: (err: any) => toast.error(err.message || "Failed to create GRN"),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: GRNFormDataPayload) =>
      grnApi.updateGRN(editingId!, payload),
    onSuccess: async () => {
      setPage(1);
      await new Promise((r) => setTimeout(r, CACHE_PROPAGATION_DELAY_MS));
      await bridge.queryClient.invalidateQueries({ queryKey: ["grns"] });
      await bridge.queryClient.refetchQueries({ queryKey: ["grns"], type: "all" });
      setFormData(buildEmptyForm());
      setEditingId(null);
      setShowForm(false);
      setErrors({});
      toast.success("GRN updated successfully");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update GRN"),
  });

  bridge.deleteMutation = useMutation({
    mutationFn: grnApi.deleteGRN,
    onSuccess: async () => {
      setPage(1);
      await new Promise((r) => setTimeout(r, CACHE_PROPAGATION_DELAY_MS));
      await bridge.queryClient.invalidateQueries({ queryKey: ["grns"] });
      await bridge.queryClient.refetchQueries({ queryKey: ["grns"], type: "all" });
      toast.success("GRN deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete GRN"),
  });

  const handleDeleteGrnLocal = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/grns/${id}/can-delete`);
      const data = await res.json();
      if (!data.deletable) {
        setDeleteBlockInfo(data);
        return;
      }
      setDeleteConfirmId(id);
    } catch (err: any) {
      toast.error(`Check failed: ${err.message}`);
    }
  };

  bridge.handleDeleteGrn = handleDeleteGrnLocal;

  const confirmDeleteGrn = () => {
    if (!deleteConfirmId) return;
    bridge.deleteMutation.mutate(deleteConfirmId);
    setDeleteConfirmId(null);
  };

  // ── PO select ─────────────────────────────────────────────────────────────────
  const handlePOSelect = async (poId: string) => {
    if (!poId) {
      setFormData((prev) => ({
        ...prev,
        poId: "",
        poNumber: "",
        vehicleInOutId: "",
        vehicleInOutDocNo: "",
        grnSourceMode: "",
        supplierId: "",
        supplierName: "",
        items: [createEmptyItem()],
        grnNo: "",
        docNo: "",
        docTypeId: null,
        parentDocNo: "",
        rootExBDocNo: "",
        poTotalAmount: 0,
        poSubtotalAmount: 0,
      }));
      setPendingVehicleInOuts([]);
      setPoRemainingItems([]);
      return;
    }
    setLoadingPO(true);
    try {
      const res = await fetchWithAuth(`/api/grns/po/${poId}`);
      if (!res.ok) throw new Error("Failed to fetch PO details");
      const po = await res.json();

      setPoRemainingItems(computeRemainingPOItems(po));

      setFormData((prev) => ({
        ...prev,
        poId,
        poNumber: po.PurchaseOrderNo ?? "",
        vehicleInOutId: "",
        vehicleInOutDocNo: "",
        grnSourceMode: "",
        supplierId: String(po.SupplierID ?? ""),
        supplierName: po.SupplierName ?? "",
        // Auto-fill Company + Project straight from the PO — picking a PO
        // first (without narrowing by company/project beforehand) now
        // works the same as the other direction. Godown follows via the
        // existing projectId-watching effect below.
        companyId: po.CompanyId ? String(po.CompanyId) : prev.companyId,
        projectId: po.ProjectId ? String(po.ProjectId) : prev.projectId,
        items: [createEmptyItem()],
        docTypeId: null,
        parentDocNo: po.DocNo || po.PurchaseOrderNo || "",
        rootExBDocNo: po.RootExBDocNo || "",
        finYear: prev.finYear || activeFinYear || "",
        grnNo: "",
        docNo: "",
        poTotalAmount: Number(po.TotalAmount ?? 0),
        poSubtotalAmount: Number(po.SubtotalAmount ?? 0),
        poReceivedAmount: Number(po.POTotalReceived ?? 0),
      }));

      // GRNs are now raised only against a Vehicle In/Out document linked to
      // this PO — fetch the ones that don't already have a GRN.
      setLoadingVehicleInOuts(true);
      try {
        const vioRes = await fetchWithAuth(
          `/api/vehicle-in-out/po/${poId}/pending-grn`,
        );
        const vios = vioRes.ok ? await vioRes.json() : [];
        setPendingVehicleInOuts(Array.isArray(vios) ? vios : []);
        if (!vios || vios.length === 0) {
          toast.info(
            "No Vehicle In/Out documents pending a GRN were found for this Purchase Order.",
          );
        }
      } catch {
        setPendingVehicleInOuts([]);
      } finally {
        setLoadingVehicleInOuts(false);
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to load PO details");
    } finally {
      setLoadingPO(false);
    }
  };

  // ── Vehicle In/Out select — loads GRN line items from the chosen lot ─────────
  const handleVehicleInOutSelect = async (vehicleInOutId: string) => {
    if (!vehicleInOutId) {
      setFormData((prev) => ({
        ...prev,
        vehicleInOutId: "",
        vehicleInOutDocNo: "",
        grnSourceMode: "",
        grnDate: new Date().toISOString().slice(0, 10),
        items: [createEmptyItem()],
      }));
      return;
    }
    setLoadingPO(true);
    try {
      const res = await fetchWithAuth(
        `/api/vehicle-in-out/${vehicleInOutId}/items-enriched`,
      );
      if (!res.ok) throw new Error("Failed to fetch Vehicle In/Out items");
      const items = await res.json();

      const lineItems: GRNItemLine[] = (items ?? []).map((it: any) => {
        const rate = Number(it.Rate ?? 0);
        const vehicleQty = Number(it.VehicleQty ?? 0);
        const gstPct = Number(it.TaxPct ?? 0);
        const totalAmount = rate * vehicleQty;
        return {
          itemId: String(it.ItemId ?? ""),
          itemName: it.ItemName ?? "",
          orderedQty: vehicleQty,
          receivedQty: vehicleQty,
          remainingQty: 0,
          uom: it.UomName ?? "",
          rate,
          quantity: vehicleQty,
          totalAmount,
          gstPct,
          gstAmount: totalAmount * (gstPct / 100),
          costCenterId: it.CostCenterId != null ? String(it.CostCenterId) : null,
        };
      });

      const vio = pendingVehicleInOuts.find(
        (v) => String(v.VehicleInOutID) === vehicleInOutId,
      );

      setFormData((prev) => ({
        ...prev,
        vehicleInOutId,
        vehicleInOutDocNo: vio?.DocNo ?? "",
        grnSourceMode: "vehicleInOut",
        // Switching to a Vehicle In/Out lot means this is a Gate Inward
        // GRN — any Direct Entry reason left over from a prior "remaining
        // items" pick no longer applies.
        directEntryReason: "",
        // GRN Date now tracks the linked Vehicle In/Out document's own
        // date — the goods were received on that date, not today.
        grnDate: vio?.DocDate
          ? String(vio.DocDate).slice(0, 10)
          : prev.grnDate,
        items: lineItems.length ? lineItems : [createEmptyItem()],
      }));
    } catch (e: any) {
      toast.error(e.message || "Failed to load Vehicle In/Out items");
    } finally {
      setLoadingPO(false);
    }
  };

  // ── Use remaining PO items directly — second way to raise a GRN for
  // what's left on a PO, alongside picking a Vehicle In/Out lot. Lets the
  // same PO be received across as many GRNs as needed without requiring
  // a Vehicle In/Out document for every split.
  const handleUseRemainingItems = () => {
    if (!hasRemainingItems(poRemainingItems)) return;
    setFormData((prev) => ({
      ...prev,
      vehicleInOutId: "",
      vehicleInOutDocNo: "",
      grnSourceMode: "remaining",
      grnDate: new Date().toISOString().slice(0, 10),
      items: buildGRNLineItemsFromRemaining(poRemainingItems),
    }));
    toast.success(
      `Form filled with ${countRemainingItems(poRemainingItems)} remaining item${countRemainingItems(poRemainingItems) !== 1 ? "s" : ""} from this PO`,
    );
  };

  // ── Create new GRN from remaining items ───────────────────────────────────────
  // Called from RemainingItemsPanel "New GRN for Remaining" button.
  // Seeds the form with the same PO but pre-fills receivedQty = remainingQty
  // so the user only needs to confirm quantities and submit.
  const handleCreateGRNFromRemaining = async (pending: PendingItemsData) => {
    // Close the view modal first
    setViewingGrn(null);

    if (!pending.poId) {
      // Fallback: open a blank form and toast a hint
      setFormData((prev) => ({
        ...buildEmptyForm(),
        finYear: prev.finYear || activeFinYear || "",
      }));
      setEditingId(null);
      setShowForm(true);
      toast.info(
        `Open the form and select PO ${pending.poNo ?? ""} to create a follow-up GRN.`,
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    setLoadingPO(true);
    try {
      const res = await fetchWithAuth(`/api/grns/po/${pending.poId}`);
      if (!res.ok) throw new Error("Failed to fetch PO details");
      const po = await res.json();

      // Same "what's left on this PO" logic used by the main form's
      // "Create GRN for Remaining Items" quick action — computed fresh
      // from the PO's own Ordered/ReceivedQty rather than the specific
      // pending-items snapshot passed in, so it reflects anything else
      // received against this PO since that snapshot was taken.
      const remaining = computeRemainingPOItems(po);
      const lineItems = buildGRNLineItemsFromRemaining(remaining);

      setFormData({
        ...buildEmptyForm(),
        poId: String(po.PurchaseOrderID ?? pending.poId),
        poNumber: po.PurchaseOrderNo ?? "",
        vehicleInOutId: "",
        vehicleInOutDocNo: "",
        grnSourceMode: "remaining",
        supplierId: String(po.SupplierID ?? ""),
        supplierName: po.SupplierName ?? "",
        companyId: po.CompanyId ? String(po.CompanyId) : "",
        projectId: po.ProjectId ? String(po.ProjectId) : "",
        items: lineItems.length ? lineItems : [createEmptyItem()],
        docTypeId: null,
        parentDocNo: po.DocNo || po.PurchaseOrderNo || "",
        rootExBDocNo: po.RootExBDocNo || "",
        finYear: po.FinYearName || activeFinYear || "",
        poTotalAmount: Number(po.TotalAmount ?? 0),
        poSubtotalAmount: Number(po.SubtotalAmount ?? 0),
        poReceivedAmount: Number(po.POTotalReceived ?? 0),
      });
      setPoRemainingItems(remaining);
      setEditingId(null);
      setShowForm(true);
      setErrors({});
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.success(
        `Form pre-filled with ${lineItems.length} remaining item${lineItems.length !== 1 ? "s" : ""} from ${pending.poNo ?? "PO"}`,
      );
    } catch (e: any) {
      toast.error(e.message || "Failed to load PO details");
    } finally {
      setLoadingPO(false);
    }
  };

  // ── Validate ──────────────────────────────────────────────────────────────────
  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.poId) errs.poId = "Purchase Order is required";
    // Two valid ways to source this GRN's items: a specific Vehicle
    // In/Out lot, or a direct "remaining items on this PO" quick-fill.
    if (!formData.vehicleInOutId && formData.grnSourceMode !== "remaining")
      errs.vehicleInOutId =
        "Select a Vehicle In/Out document, or use \"Create GRN for Remaining Items\"";
    if (!formData.supplierId)
      errs.supplierId = "Supplier could not be determined";
    if (formData.items.every((i) => i.receivedQty <= 0))
      errs.items = "Enter received quantity for at least one item";
    if (
      formData.items.some((i) => i.receivedQty > 0 && (!i.rate || i.rate <= 0))
    )
      errs.items = errs.items || "Enter a rate (₹) for each received item";
    if (
      formData.items.some(
        (i) => i.receivedQty > 0 && (!i.quantity || i.quantity <= 0),
      )
    )
      errs.items = errs.items || "Enter billing qty for each received item";
    // Received can't exceed what was actually ordered on the PO line —
    // matters most for the "remaining items" flow, where orderedQty is the
    // PO's own line quantity (the Vehicle In/Out flow already locks the
    // input to what the vehicle brought in, and the backend separately
    // rejects any GRN qty over that lot's own recorded quantity).
    const overOrdered = formData.items.find(
      (i) => i.orderedQty > 0 && i.receivedQty > i.orderedQty,
    );
    if (overOrdered)
      errs.items =
        errs.items ||
        `${overOrdered.itemName || "An item"}: received quantity (${overOrdered.receivedQty}) exceeds ordered quantity (${overOrdered.orderedQty})`;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = () => {
    if (!validate()) {
      toast.error("Please fix the errors");
      return;
    }
    const payload: GRNFormDataPayload = {
      grnNo: formData.grnNo || "",
      grnDate: formData.grnDate,
      docDate: formData.docDate,
      supplierId: Number(formData.supplierId),
      poId: Number(formData.poId) || 0,
      vehicleInOutId: formData.vehicleInOutId
        ? Number(formData.vehicleInOutId)
        : null,
      directEntryReason: !formData.vehicleInOutId && formData.directEntryReason
        ? formData.directEntryReason
        : null,
      grnItems: formData.items,
      // On create this is always "Draft". On edit, send the record's own
      // current status (loaded into formData.status when it was fetched) —
      // NOT a hardcoded "Draft", which used to silently downgrade an
      // already-Approved GRN instead of sending it back for re-approval.
      // The backend is authoritative here regardless (an Approved record
      // always gets forced to Pending server-side), but the payload should
      // reflect intent rather than lie about it.
      status: editingId ? formData.status || "Draft" : "Draft",
      remarks: formData.remarks,
      supplierName: formData.supplierName,
      poNumber: formData.poNumber,
      docNo: "",
      finYear: formData.finYear || null,
      parentDocNo: formData.parentDocNo || null,
      rootExBDocNo: formData.rootExBDocNo || null,
      projectId: formData.projectId ? Number(formData.projectId) : null,
      godownId: formData.godownId ? Number(formData.godownId) : null,
    };
    if (editingId) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  // ── Item helpers ──────────────────────────────────────────────────────────────
  const updateItemField = (
    index: number,
    field: "receivedQty" | "rate" | "quantity",
    value: number,
  ) => {
    setFormData((prev) => {
      const nextItems = [...prev.items];
      const current = { ...nextItems[index], [field]: value };
      if (field === "receivedQty") {
        current.remainingQty = round3(current.orderedQty - value);
        if (nextItems[index].quantity === nextItems[index].receivedQty)
          current.quantity = value;
      }
      current.totalAmount =
        Number(current.rate || 0) * Number(current.quantity || 0);
      current.gstAmount =
        current.totalAmount * (Number(current.gstPct || 0) / 100);
      nextItems[index] = current;
      return { ...prev, items: nextItems };
    });
  };

  const updateReceivedQty = (index: number, value: number) =>
    updateItemField(index, "receivedQty", value);

  // ── View / Edit ───────────────────────────────────────────────────────────────
  bridge.onView = async (grn: any) => {
    try {
      const res = await fetchWithAuth(`/api/grns/${grn.GRNID}`);
      if (!res.ok) throw new Error("Failed to fetch GRN details");
      setViewingGrn(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setViewingGrn(grn);
    }
  };

  // Deep-link support — Linked Documents panels navigate here as
  // /material/grn?view=<GRNID> to open this exact GRN.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    bridge.onView({ GRNID: Number(viewId) });
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("view")]);

  bridge.onEdit = async (grn: any) => {
    let fullGrn = grn;
    try {
      const res = await fetchWithAuth(`/api/grns/${grn.GRNID}`);
      if (res.ok) fullGrn = await res.json();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
    const parsedItems = parseJsonArray<GRNItemLine>(fullGrn.GRNItems).map(
      (item) => ({
        ...createEmptyItem(),
        ...item,
        orderedQty: Number(item.orderedQty || 0),
        receivedQty: Number(item.receivedQty || 0),
        remainingQty: Number(item.remainingQty || 0),
        rate: Number(item.rate || 0),
        quantity: Number(item.quantity || 0),
        totalAmount: Number(item.totalAmount || 0),
      }),
    );
    setSelectedFinYear("");
    setFormData({
      grnNo: fullGrn.GRNNo || "",
      grnDate: fullGrn.GRNDate ? String(fullGrn.GRNDate).slice(0, 10) : "",
      docDate: fullGrn.DocDate
        ? String(fullGrn.DocDate).slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      supplierId: String(fullGrn.SupplierID || ""),
      supplierName: fullGrn.SupplierName || "",
      poId: String(fullGrn.POID || ""),
      poNumber: fullGrn.PONumber || "",
      vehicleInOutId: fullGrn.VehicleInOutID
        ? String(fullGrn.VehicleInOutID)
        : "",
      vehicleInOutDocNo: fullGrn.documentChain?.vehicleInOut?.docNo || "",
      grnSourceMode: fullGrn.VehicleInOutID ? "vehicleInOut" : "remaining",
      directEntryReason: fullGrn.DirectEntryReason || "",
      poTotalAmount: Number(fullGrn.POTotalAmount ?? 0),
      poSubtotalAmount: Number(fullGrn.POSubtotalAmount ?? 0),
      poReceivedAmount: Number(fullGrn.POTotalReceived ?? 0),
      remarks: fullGrn.Remarks || "",
      status: (fullGrn.Status as any) || "Draft",
      items: parsedItems.length ? parsedItems : [createEmptyItem()],
      docTypeId: fullGrn.DocTypeId ?? null,
      docNo: fullGrn.DocNo || "",
      parentDocNo: fullGrn.ParentDocNo || "",
      rootExBDocNo: fullGrn.RootExBDocNo || "",
      finYear: fullGrn.FinYear || "",
      companyId: String(fullGrn.CompanyId || ""),
      projectId: String(fullGrn.ProjectId || ""),
      godownId: fullGrn.GodownID ? String(fullGrn.GodownID) : "",
    });
    setEditingId(String(fullGrn.GRNID));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setFormData(buildEmptyForm());
    setEditingId(null);
    setShowForm(false);
    setErrors({});
  };


  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], GRN_TEMPLATE_COLUMNS, "grn-template");
  };
  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };
  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        toast.error("CSV is empty");
        return;
      }
      toast.success(`${rows.length} rows read — full import coming soon`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  // ── Print / PDF a GRN — both render the shared letterhead document
  // (grnDocument.ts → letterheadDocument.ts), a standalone page opened in its
  // own window rather than window.print()'ing the live modal (whose theme CSS
  // variables have no print-safe light-on-white override).
  const handlePrintGRN = (grn: any) => {
    void printGrn(grn);
  };

  const handleGeneratePdfGRN = async (grn: any) => {
    const toastId = toast.loading("Generating PDF...");
    try {
      await downloadGrnPdf(grn);
      toast.success("PDF downloaded", { id: toastId });
    } catch {
      toast.error("Could not generate PDF", { id: toastId });
    }
  };

  // ─── JSX ─────────────────────────────────────────────────────────────────────

  return {
    rights,
    today,
    navigate,
    searchParams,
    setSearchParams,
    debitNoteLine,
    setDebitNoteLine,
    debitNoteQty,
    setDebitNoteQty,
    debitNoteReason,
    setDebitNoteReason,
    debitNoteMut,
    finYears,
    importFileInputRef,
    importing,
    setImporting,
    editingId,
    setEditingId,
    showForm,
    setShowForm,
    viewingGrn,
    setViewingGrn,
    viewModalTab,
    setViewModalTab,
    grnPostingData,
    setGrnPostingData,
    grnPostingLoading,
    setGrnPostingLoading,
    grnPosting,
    setGrnPosting,
    grnPostingError,
    setGrnPostingError,
    search,
    setSearch,
    page,
    setPage,
    grnStatusFilter,
    setGrnStatusFilter,
    loadingPO,
    setLoadingPO,
    pendingVehicleInOuts,
    setPendingVehicleInOuts,
    loadingVehicleInOuts,
    setLoadingVehicleInOuts,
    poRemainingItems,
    setPoRemainingItems,
    selectedFinYear,
    setSelectedFinYear,
    deleteBlockInfo,
    setDeleteBlockInfo,
    deleteConfirmId,
    setDeleteConfirmId,
    limit,
    activeFinYearEntry,
    activeFinYear,
    activeFinYearRange,
    finYearOptions,
    buildEmptyForm,
    formData,
    setFormData,
    errors,
    setErrors,
    grns,
    totalPages,
    totalRecords,
    posData,
    grnNumberPreview,
    loadingPreview,
    godownsData,
    godowns,
    findProjectGodownId,
    filteredProjects,
    companiesData,
    pos,
    filteredGrns,
    groupedGrns,
    grnApprovalTrails,
    grnApprovalTrailsLoading,
    collapsedGrnGroups,
    setCollapsedGrnGroups,
    toggleGrnGroup,
    grandTotal,
    grandGSTAmount,
    grnTotalWithGST,
    CACHE_PROPAGATION_DELAY_MS,
    createMutation,
    updateMutation,
    handleDeleteGrnLocal,
    confirmDeleteGrn,
    handlePOSelect,
    handleVehicleInOutSelect,
    handleUseRemainingItems,
    handleCreateGRNFromRemaining,
    validate,
    onSubmit,
    updateItemField,
    updateReceivedQty,
    resetForm,
    handleDownloadTemplate,
    handleImportClick,
    handleImportFileChange,
    handlePrintGRN,
    handleGeneratePdfGRN,
    grnsPage,
    loadingGrns,
    fetchingGrns,
  };
}

export type GRNState = ReturnType<typeof useGRN>;

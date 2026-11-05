// Everything the Stock Transfer page holds: godowns and companies, the route, the lines and their
// stock, the source material request, inter-company pricing and the two transfer mutations.
import { useSearchParams } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getInventoryMaster } from "@/api/inventoryMasterApi";
import { createStockTransfer } from "@/api/stockTransferApi";
import { createInterCompanyTransfer, previewInterCompanyTransfer, getFaItemIds, type InterCompanyTransferPreview } from "@/api/interCompanyTransferApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getApprovedMRList, getICTMRPrefill, type ApprovedMRSummary } from "@/api/materialRequestApi";
import { usePageRights } from "@/hooks/usePageRights";
import { TItem, AvailableItem, emptyItem } from "./config";

export function useStockTransfer() {
  const rights = usePageRights("stock-transfers");
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  // Deep-link support — the Stock drill-down navigates here as
  // /material/stock-transfer?view=<TransferID> to open that transfer in History.
  const [searchParams, setSearchParams] = useSearchParams();
  const [openTransferId, setOpenTransferId] = useState<number | null>(() => {
    const id = Number(searchParams.get("view"));
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  useEffect(() => {
    if (!searchParams.get("view")) return;
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTab, setActiveTab] = useState<"transfer" | "history">(openTransferId ? "history" : "transfer");
  const [transferMode, setTransferMode] = useState<"intra" | "inter">("intra");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterProjectId, setFilterProjectId] = useState("");
  const [toCompanyId, setToCompanyId] = useState("");
  const [toProjectId, setToProjectId] = useState("");
  // Inter-company only — raising this transfer from a Material Request.
  // Same "prefill items, let the user drop/reduce lines, cap at what's
  // still pending" pattern as PurchaseOrderMaster's own MR-from-PO picker;
  // see getICTMRPrefill's own comment for why the MR's Company/Project
  // land on the Receiver side, not Sender.
  const [sourceMR, setSourceMR] = useState<{ id: number; docNo: string } | null>(null);
  const [mrDropdownValue, setMrDropdownValue] = useState("");
  // The project the picked MR belongs to (= the receiving project). If the
  // user later changes the Receiver Project, the MR no longer applies.
  const [sourceMrProjectId, setSourceMrProjectId] = useState<string | null>(null);
  const [mrDropdownLoading, setMrDropdownLoading] = useState(false);
  const [mrDropdownError, setMrDropdownError] = useState<string | null>(null);
  const [fromGodownId, setFromGodownId] = useState<number | null>(null);
  const [toGodownId, setToGodownId] = useState<number | null>(null);
  const [items, setItems] = useState<TItem[]>([emptyItem()]);
  const [remarks, setRemarks] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  // Whether this Inter-Company Transfer actually applies GST at all — a
  // real business choice (some inter-company movements aren't a taxable
  // supply), not just a display preference. false sends ApplyGst: false to
  // both the preview and the actual create call, which zeroes the GST
  // component server-side (priceItems in interCompanyTransfer.js) rather
  // than just hiding it client-side.
  const [applyGst, setApplyGst] = useState(true);

  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  });
  const allGodowns: Godown[] = godownsData?.data ?? [];

  const { data: enterprisesData } = useQuery({
    queryKey: ["enterprise-options", "C"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
    staleTime: 120_000,
  });

  const { data: projectsData } = useQuery({
    queryKey: ["enterprise-options", "P"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 120_000,
  });

  // MRs available to raise an Inter-Company Transfer from — same
  // approved-list endpoint PurchaseOrderMaster's own MR picker uses.
  // Only Approved / Partially Fulfilled MRs (the server list), and only those
  // of the RECEIVING project — an MR is raised by the project that needs the
  // material, which is the receiver side of this transfer.
  const { data: approvedMRs = [], isLoading: loadingApprovedMRs } = useQuery<ApprovedMRSummary[]>({
    queryKey: ["ict-approved-mrs", toProjectId],
    queryFn: () => getApprovedMRList({ projectId: toProjectId }),
    enabled: transferMode === "inter" && !!toProjectId,
    staleTime: 30_000,
  });
  const allProjects: {
    id: number;
    label: string;
    company_id: number | null;
    tagged_company_ids?: string | null;
  }[] = projectsData ?? [];

  // Collect all project IDs that belong (directly or via tagging) to the FROM company.
  const fromCompanyProjectIds = useMemo(() => {
    if (!filterCompanyId) return new Set<string>();
    return new Set(
      allProjects
        .filter((p) => projectBelongsToCompany(p, filterCompanyId))
        .map((p) => String(p.id)),
    );
  }, [allProjects, filterCompanyId]);

  const companyGodowns = useMemo(() => {
    return allGodowns.filter((g) => {
      if (!filterCompanyId) return true;
      // 1. Godown is directly owned by the company
      if (String(g.EnterpriseID ?? "") === filterCompanyId) return true;
      // 2. Godown is linked to a project that belongs/is tagged to the company
      if (g.ProjectID != null && fromCompanyProjectIds.has(String(g.ProjectID)))
        return true;
      return false;
    });
  }, [allGodowns, filterCompanyId, fromCompanyProjectIds]);

  // The dedicated godown auto-created for the selected project (if any).
  const projectGodown = useMemo(() => {
    if (!filterProjectId) return null;
    // A project tagged to this company but owned by another has its godown
    // under the owning company, so fall back to matching on the project alone.
    return (
      companyGodowns.find((g) => String(g.ProjectID ?? "") === filterProjectId) ??
      allGodowns.find((g) => String(g.ProjectID ?? "") === filterProjectId) ??
      null
    );
  }, [companyGodowns, filterProjectId]);

  const projectOptions = useMemo(() => {
    if (!filterCompanyId) return allProjects;
    return allProjects.filter((p) => projectBelongsToCompany(p, filterCompanyId));
  }, [allProjects, filterCompanyId]);


  // Auto-fill the source godown with the project's own godown once one is selected.
  useEffect(() => {
    if (projectGodown) {
      setFromGodownId(projectGodown.GodownID);
      setItems([emptyItem()]);
    }
  }, [projectGodown]);

  // Receiver-side project filter (inter-company only) — same narrowing
  // pattern as the sender's own Company/Project filters above.
  const toProjectOptions = useMemo(() => {
    if (!toCompanyId) return [];
    return allProjects.filter((p) => projectBelongsToCompany(p, toCompanyId));
  }, [allProjects, toCompanyId]);

  const { data: fromStockData, isLoading: isLoadingStock } = useQuery({
    queryKey: ["inventory-master", today, fromGodownId],
    queryFn: () => getInventoryMaster(today, fromGodownId!),
    staleTime: 60_000,
    enabled: !!fromGodownId,
  });

  const availableItems: AvailableItem[] = useMemo(
    () =>
      (fromStockData?.data ?? [])
        .filter((r) => r.ClosingStock > 0)
        .map((r) => ({
          itemId: r.ItemID,
          itemName: r.ItemName || "",
          uom: r.UOMName || r.UOMCode || "",
          available: r.ClosingStock,
        })),
    [fromStockData],
  );

  const transferMut = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: (res) => {
      setSuccessMsg(`Transfer ${res.DocNo} completed successfully!`);
      setErrorMsg("");
      setFromGodownId(null);
      setToGodownId(null);
      setItems([emptyItem()]);
      setRemarks("");
      qc.invalidateQueries({ queryKey: ["inventory-master"] });
      qc.invalidateQueries({ queryKey: ["stock-transfers"] });
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  // "Inter-Company" mode means this transfer crosses a real legal/GST
  // boundary — stock moves directly (godown OUT at the sender, godown IN at
  // the receiver, same as an intra-company transfer) plus a two-sided GL
  // voucher: the sender's books get a receivable from the receiver, the
  // receiver's books get a payable to the sender, each valued at the
  // sender COMPANY's own most recent purchase rate (excl. GST). See
  // backend/routes/interCompanyTransfer.js.
  const interTransferMut = useMutation({
    mutationFn: createInterCompanyTransfer,
    onSuccess: (res) => {
      setSuccessMsg(
        `Inter-company transfer ${res.DocNo} submitted for super_admin approval — stock will move and the GL voucher will post automatically once approved.`,
      );
      setErrorMsg("");
      setFromGodownId(null);
      setToGodownId(null);
      setItems([emptyItem()]);
      setRemarks("");
      setManualRates({});
      qc.invalidateQueries({ queryKey: ["inventory-master"] });
      qc.invalidateQueries({ queryKey: ["stock-transfers"] });
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const updateItem = (idx: number, patch: Partial<TItem>) =>
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  // Raise this Inter-Company Transfer from a Material Request: prefills the
  // Receiver company/project (the MR's own — it's the project that asked
  // for the material) and the item lines, each capped at what's still
  // pending on that MR item. The user can then remove lines they can't
  // fulfil right now, or reduce a line's quantity below the cap — either
  // way, whatever's left off this transfer simply stays pending on the MR
  // for a later PO or ICT to pick up (see getMRItemFulfillment — nothing
  // here marks the MR "used up", it's always computed live).
  const handleMRDropdownSelect = async (mrId: string) => {
    setMrDropdownValue(mrId);
    if (!mrId) return;
    setMrDropdownLoading(true);
    setMrDropdownError(null);
    try {
      const prefill = await getICTMRPrefill(Number(mrId));
      if (!prefill.items.length) {
        setMrDropdownError("This Material Request has nothing left pending to transfer.");
        return;
      }
      setItems(
        prefill.items.map((it) => ({
          itemId: it.ItemId ?? "",
          itemName: it.ItemName ?? "",
          qty: String(it.PendingQty ?? it.Quantity ?? 0),
          uom: it.UOMName ?? it.UOMCode ?? "",
          availableQty: 0,
          remarks: it.Remarks ?? "",
          mrItemId: it.MRItemId ?? null,
          mrPendingQty: it.PendingQty ?? null,
        })),
      );
      setSourceMR({ id: prefill.MRId, docNo: prefill.DocNo });
      setSourceMrProjectId(prefill.ProjectId ? String(prefill.ProjectId) : null);
      if (prefill.CompanyId) setToCompanyId(String(prefill.CompanyId));
      if (prefill.ProjectId) setToProjectId(String(prefill.ProjectId));
    } catch (err: any) {
      setMrDropdownError(err.message ?? "Could not load Material Request.");
    } finally {
      setMrDropdownLoading(false);
    }
  };

  const clearSourceMR = () => {
    setSourceMR(null);
    setSourceMrProjectId(null);
    setMrDropdownValue("");
    setItems([emptyItem()]);
  };

  // Changing the Receiver Project after picking an MR drops that MR (and its
  // prefilled lines) — it belongs to a different project now.
  useEffect(() => {
    if (sourceMR && sourceMrProjectId && toProjectId !== sourceMrProjectId) {
      setSourceMR(null);
      setSourceMrProjectId(null);
      setMrDropdownValue("");
      setItems([emptyItem()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toProjectId]);

  // ── Live stock check ────────────────────────────────────────────────────
  // Closing stock per item in the SOURCE godown. Every line is checked against
  // it (not just lines picked from the stock list), and an item that appears on
  // more than one line is checked on its combined quantity.
  const stockByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of fromStockData?.data ?? []) {
      const k = String(r.ItemID).toLowerCase();
      m.set(k, (m.get(k) ?? 0) + (Number(r.ClosingStock) || 0));
    }
    return m;
  }, [fromStockData]);
  const stockKnown = !!fromGodownId && !!fromStockData && !isLoadingStock;

  // Inter-company only: which of the picked items are Fixed Assets (they need
  // their FA Item Codes chosen instead of just a quantity).
  const pickedItemIds = useMemo(
    () => [...new Set(items.map((it) => it.itemId).filter(Boolean))].sort(),
    [items],
  );
  const { data: faItemIdList = [] } = useQuery({
    queryKey: ["ict-fa-items", pickedItemIds.join(",")],
    queryFn: () => getFaItemIds(pickedItemIds),
    enabled: transferMode === "inter" && pickedItemIds.length > 0,
    staleTime: 60_000,
  });
  const faItemSet = useMemo(() => new Set(faItemIdList.map((x) => x.toLowerCase())), [faItemIdList]);
  const isFaLine = (it: TItem) => transferMode === "inter" && !!it.itemId && faItemSet.has(it.itemId.toLowerCase());

  const liveItems: TItem[] = useMemo(() => {
    if (!stockKnown) return items.map((it) => ({ ...it, isFa: isFaLine(it) }));
    const demand = new Map<string, number>();
    for (const it of items) {
      if (!it.itemId) continue;
      const k = it.itemId.toLowerCase();
      demand.set(k, (demand.get(k) ?? 0) + (parseFloat(it.qty) || 0));
    }
    return items.map((it) => {
      if (!it.itemId) return it;
      const k = it.itemId.toLowerCase();
      const avail = stockByItem.get(k) ?? 0;
      return { ...it, isFa: isFaLine(it), availableQty: avail, stockKnown: true, stockShort: (demand.get(k) ?? 0) > avail + 0.0001 && (parseFloat(it.qty) || 0) > 0 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, stockKnown, stockByItem, faItemSet, transferMode]);

  // A Fixed Asset line must name exactly one FA Item Code per unit.
  const faLinesIncomplete = liveItems.some((it) => it.isFa && (it.faTagIds?.length ?? 0) === 0);
  const shortLines = liveItems.filter((it) => it.stockShort);
  const hasInsufficientStock = shortLines.length > 0;

  const hasOverLimit =
    hasInsufficientStock ||
    items.some(
      (it) =>
        it.itemId && it.availableQty > 0 && parseFloat(it.qty) > it.availableQty,
    );
  const hasOverMrPending = items.some(
    (it) => it.mrItemId != null && it.mrPendingQty != null && (parseFloat(it.qty) || 0) - it.mrPendingQty > 0.0001,
  );

  const canTransfer =
    !!fromGodownId &&
    !!toGodownId &&
    (transferMode === "inter" || fromGodownId !== toGodownId) &&
    items.some((it) => it.itemId && parseFloat(it.qty) > 0) &&
    !faLinesIncomplete &&
    !hasOverLimit &&
    !hasOverMrPending &&
    !(fromGodownId && isLoadingStock) &&
    !transferMut.isPending &&
    !interTransferMut.isPending;

  const handleTransfer = () => {
    setErrorMsg("");
    const validItems = items
      .filter((it) => it.itemId && parseFloat(it.qty) > 0)
      .map((it) => ({
        itemId: it.itemId,
        itemName: it.itemName,
        qty: parseFloat(it.qty),
        uom: it.uom,
        remarks: it.remarks,
        mrItemId: it.mrItemId ?? null,
        faTagIds: it.faTagIds ?? [],
      }));

    if (transferMode === "inter") {
      const senderProjectId = fromGodown?.ProjectID;
      const receiverProjectId = toGodown?.ProjectID;
      if (!senderProjectId || !receiverProjectId) {
        const missing: string[] = [];
        if (!senderProjectId) missing.push(`source godown "${fromGodown?.GodownName ?? "unknown"}"`);
        if (!receiverProjectId) missing.push(`destination godown "${toGodown?.GodownName ?? "unknown"}"`);
        setErrorMsg(
          `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not linked to a Project. Assign a Project to ${missing.length > 1 ? "them" : "it"} in Godown Admin before transferring across companies.`,
        );
        return;
      }
      interTransferMut.mutate({
        SenderProjectId: senderProjectId,
        ReceiverProjectId: receiverProjectId,
        // Pass selected company overrides for cross-tagged project godowns
        ...(filterCompanyId ? { SenderCompanyId: Number(filterCompanyId) } : {}),
        ...(toCompanyId ? { ReceiverCompanyId: Number(toCompanyId) } : {}),
        ApplyGst: applyGst,
        Remarks: remarks || undefined,
        SourceMRId: sourceMR?.id ?? undefined,
        Items: validItems.map((it) => {
          const manual = parseFloat(manualRates[it.itemId]);
          return {
            itemId: it.itemId,
            itemName: it.itemName,
            uom: it.uom,
            qty: it.qty,
            mrItemId: it.mrItemId ?? undefined,
            ...(Number.isFinite(manual) && manual > 0 ? { manualRate: manual } : {}),
            ...(faItemSet.has(it.itemId.toLowerCase()) ? { faTagIds: it.faTagIds ?? [] } : {}),
          };
        }),
      });
      return;
    }

    transferMut.mutate({
      FromGodownID: fromGodownId!,
      ToGodownID: toGodownId!,
      TransferItems: validItems,
      Remarks: [remarks, "[Intra-Company]"].filter(Boolean).join(" "),
    });
  };

  const handleReset = () => {
    setFromGodownId(null);
    setToGodownId(null);
    setItems([emptyItem()]);
    setRemarks("");
    setErrorMsg("");
    setManualRates({});
    setSourceMR(null);
    setSourceMrProjectId(null);
    setMrDropdownValue("");
  };

  // Collect all project IDs that belong (directly or via tagging) to the TO company.
  const toCompanyProjectIds = useMemo(() => {
    if (!toCompanyId) return new Set<string>();
    return new Set(
      allProjects
        .filter((p) => projectBelongsToCompany(p, toCompanyId))
        .map((p) => String(p.id)),
    );
  }, [allProjects, toCompanyId]);

  const toCompanyGodowns = useMemo(() => {
    if (transferMode === "intra") return companyGodowns;
    if (!toCompanyId)
      return allGodowns.filter(
        (g) => g.EnterpriseID != null && String(g.EnterpriseID) !== filterCompanyId,
      );
    return allGodowns.filter((g) => {
      // 1. Godown is directly owned by the TO company
      if (String(g.EnterpriseID ?? "") === toCompanyId) return true;
      // 2. Godown is linked to a project tagged to the TO company
      if (g.ProjectID != null && toCompanyProjectIds.has(String(g.ProjectID)))
        return true;
      return false;
    });
  }, [allGodowns, transferMode, toCompanyId, filterCompanyId, companyGodowns, toCompanyProjectIds]);

  // The dedicated godown auto-created for the selected receiver project (if any).
  const toProjectGodown = useMemo(() => {
    if (!toProjectId) return null;
    return (
      toCompanyGodowns.find((g) => String(g.ProjectID ?? "") === toProjectId) ?? null
    );
  }, [toCompanyGodowns, toProjectId]);

  // Auto-fill the destination godown with the receiver project's own godown.
  useEffect(() => {
    if (toProjectGodown) {
      setToGodownId(toProjectGodown.GodownID);
    }
  }, [toProjectGodown]);


  const fromGodown =
    companyGodowns.find((g) => g.GodownID === fromGodownId) || null;
  const toGodown =
    (transferMode === "intra" ? companyGodowns : toCompanyGodowns).find((g) => g.GodownID === toGodownId) || null;

  // Posting preview — prices the current item lines at the sender company's
  // most recent purchase rate so the user can see exactly what will post
  // (which company gets debited/credited and how much) before submitting.
  // An item with no purchase history anywhere under the sending company
  // comes back with needsManualRate: true instead of failing the whole
  // preview — manualRates holds whatever the user's typed in for those,
  // keyed by itemId, fed back into both the preview and the actual submit.
  const [manualRates, setManualRates] = useState<Record<string, string>>({});
  // The input itself is bound straight to manualRates (updates every
  // keystroke, so typing feels instant) — but the actual re-price query only
  // fires off this debounced copy. Without the debounce, every keystroke
  // changed the query key, which (a) re-fetched on every character and (b)
  // flipped interPreviewLoading true, swapping the whole item list — the
  // very DOM node the input lives in — out for a "Pricing items…" spinner,
  // unmounting the input and dropping focus after just one character. Same
  // fix as MaterialExpenseBooking.tsx's debouncedDocNoFilter.
  const [debouncedManualRates, setDebouncedManualRates] = useState<Record<string, string>>({});
  useEffect(() => {
    const t = setTimeout(() => setDebouncedManualRates(manualRates), 500);
    return () => clearTimeout(t);
  }, [manualRates]);
  const interPreviewItems = items.filter((it) => it.itemId && parseFloat(it.qty) > 0);
  const interPreviewKey = interPreviewItems
    .map((it) => `${it.itemId}:${it.qty}:${debouncedManualRates[it.itemId] || ""}`)
    .join(",");
  const {
    data: interPreview,
    isFetching: interPreviewLoading,
    error: interPreviewError,
  } = useQuery<InterCompanyTransferPreview>({
    queryKey: ["ict-preview", fromGodown?.ProjectID, toGodown?.ProjectID, filterCompanyId, toCompanyId, interPreviewKey, applyGst],
    queryFn: () =>
      previewInterCompanyTransfer({
        SenderProjectId: fromGodown!.ProjectID!,
        ReceiverProjectId: toGodown!.ProjectID!,
        // Pass the user-selected companies so the preview labels (and GL
        // posting on submit) reflect Delta Gardens, not Yashvi Construction,
        // when Pristine Enclave is tagged to Delta Gardens.
        ...(filterCompanyId ? { SenderCompanyId: Number(filterCompanyId) } : {}),
        ...(toCompanyId ? { ReceiverCompanyId: Number(toCompanyId) } : {}),
        ApplyGst: applyGst,
        Items: interPreviewItems.map((it) => {
          const manual = parseFloat(debouncedManualRates[it.itemId]);
          return {
            itemId: it.itemId,
            itemName: it.itemName,
            uom: it.uom,
            qty: parseFloat(it.qty),
            ...(Number.isFinite(manual) && manual > 0 ? { manualRate: manual } : {}),
          };
        }),
      }),
    enabled:
      transferMode === "inter" &&
      !!fromGodown?.ProjectID &&
      !!toGodown?.ProjectID &&
      interPreviewItems.length > 0,
    // Keep showing the last priced list while a re-price is in flight
    // instead of unmounting it for a loading state — belt-and-suspenders
    // with the debounce above so the manual-rate input never loses its
    // place even if a refetch does land mid-typing (blur, tab, etc.).
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Blocks submit while any priced item is still waiting on a manual rate
  // — only meaningful for inter-company transfers, which are the only ones
  // that price off purchase history at all.
  const hasUnpricedItems =
    transferMode === "inter" && !!interPreview?.items.some((it) => it.needsManualRate);

  const companyOptions = (enterprisesData ?? []).map((e) => ({
    value: String(e.id),
    label: e.label,
  }));

  const projectSelectOptions = projectOptions.map((p) => ({
    value: String(p.id),
    label: p.label,
  }));


  return {
    openTransferId,
    setOpenTransferId,
    rights,
    qc,
    today,
    activeTab,
    setActiveTab,
    transferMode,
    setTransferMode,
    filterCompanyId,
    setFilterCompanyId,
    filterProjectId,
    setFilterProjectId,
    toCompanyId,
    setToCompanyId,
    toProjectId,
    setToProjectId,
    sourceMR,
    setSourceMR,
    mrDropdownValue,
    setMrDropdownValue,
    sourceMrProjectId,
    setSourceMrProjectId,
    mrDropdownLoading,
    setMrDropdownLoading,
    mrDropdownError,
    setMrDropdownError,
    fromGodownId,
    setFromGodownId,
    toGodownId,
    setToGodownId,
    items,
    setItems,
    remarks,
    setRemarks,
    successMsg,
    setSuccessMsg,
    errorMsg,
    setErrorMsg,
    applyGst,
    setApplyGst,
    godownsData,
    allGodowns,
    enterprisesData,
    projectsData,
    approvedMRs,
    loadingApprovedMRs,
    fromCompanyProjectIds,
    companyGodowns,
    projectGodown,
    projectOptions,
    toProjectOptions,
    fromStockData,
    isLoadingStock,
    availableItems,
    transferMut,
    interTransferMut,
    updateItem,
    removeItem,
    addItem,
    handleMRDropdownSelect,
    clearSourceMR,
    stockByItem,
    stockKnown,
    pickedItemIds,
    faItemIdList,
    faItemSet,
    isFaLine,
    liveItems,
    faLinesIncomplete,
    shortLines,
    hasInsufficientStock,
    hasOverLimit,
    hasOverMrPending,
    canTransfer,
    handleTransfer,
    handleReset,
    toCompanyProjectIds,
    toCompanyGodowns,
    toProjectGodown,
    fromGodown,
    toGodown,
    manualRates,
    setManualRates,
    debouncedManualRates,
    setDebouncedManualRates,
    interPreviewItems,
    interPreviewKey,
    hasUnpricedItems,
    companyOptions,
    projectSelectOptions,
    interPreview,
    interPreviewLoading,
    interPreviewError,
  };
}

export type StockTransferState = ReturnType<typeof useStockTransfer>;

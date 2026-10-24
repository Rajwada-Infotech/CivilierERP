// Everything the Material Request page holds: master data, the list query, the
// form state, the mutations and the register columns. The page and its parts read
// from this one object.
import * as mrApi from "@/api/materialRequestApi";
import { generateUUID } from "@/utils/cryptoPolyfill";
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { type WorkOrderMRPrefill } from "@/api/workOrderApi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ItemPicker } from "../ItemPicker";
import { Save, Eye, Trash2, Edit3 } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useAuth } from "@/contexts/AuthContext";
import { isPrivilegedRole } from "@/contexts/auth.utils";
import { fetchNextDocNumber, fetchDocTypes, type DocType } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { useFinYear } from "@/contexts/FinYearContext";
import { toShortFinYear } from "@/utils/finYear";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { usePageRights } from "@/hooks/usePageRights";
import { exportToCsv, parseCsv } from "@/lib/export";
import { planImport, type PlannedRequest } from "./mrImport";
import { getAllItemUomAlternates } from "@/api/itemUomAlternatesApi";
import { MR_TEMPLATE_COLUMNS, CartItem, FormHeader, defaultHeader, blankCartItem, PRIORITY_COLOR, fmtDate, TAG, ACT } from "./config";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";

export function useMaterialRequest() {
  const rights = usePageRights("material-request");
  const { currentUser } = useAuth();
  const isAdmin = !!currentUser && isPrivilegedRole(currentUser.role);
  const queryClient = useQueryClient();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importPlan, setImportPlan] = useState<{ fileName: string; plan: PlannedRequest[] } | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "form" | "view">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>(
    searchParams.get("status") ?? "",
  );
  const limit = 10;
  // ListView() below is called as a plain function (not <ListView/>), so a
  // useState declared inside it would be conditional on viewMode and break
  // the Rules of Hooks — stays at the top level, same reasoning as
  // mrIdsOnPage/approvalTrails above.
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Record<string, boolean>>({});
  const [projectFilter, setProjectFilter] = useState<string>("");

  const [header, setHeader] = useState<FormHeader>(defaultHeader);
  const [cart, setCart] = useState<CartItem[]>([blankCartItem()]);
  // Set when the form was opened from an approved Work Order (items pre-filled, still fully editable).
  const [woSource, setWoSource] = useState<{ id: number; docNo: string } | null>(null);
  const location = useLocation();

  const setH = <K extends keyof FormHeader>(k: K, v: FormHeader[K]) =>
    setHeader((p) => ({ ...p, [k]: v }));

  // ── Master data ──────────────────────────────────────────────────────────────

  const { finYears: ctxFinYears } = useFinYear();
  const activeYear = ctxFinYears.find((y) => y.status === "Active") ?? null;

  const { data: companies = [] } = useQuery({
    queryKey: ["mr-companies"],
    queryFn: mrApi.getMRCompanies,
    staleTime: 5 * 60_000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["mr-projects"],
    queryFn: mrApi.getMRProjects,
    staleTime: 5 * 60_000,
  });

  const filteredProjects = (projects as any[]).filter(
    (p) => !header.companyId || projectBelongsToCompany(p, header.companyId),
  );

  const { data: finYears = [] } = useQuery({
    queryKey: ["mr-finyears"],
    queryFn: mrApi.getMRFinYears,
    staleTime: 5 * 60_000,
  });
  // Prefer the fin year the user has selected in the form; fall back to context active year
  const selectedFY = (finYears as any[]).find(
    (fy) => String(fy.id) === String(header.finYearId),
  );
  const finYearStr = selectedFY
    ? toShortFinYear(String(selectedFY.name))
    : activeYear
      ? `${String(activeYear.startDate).slice(2, 4)}-${String(activeYear.endDate).slice(2, 4)}`
      : undefined;

  const { data: itemOptions = [] } = useQuery({
    queryKey: ["mr-items", header.projectId],
    queryFn: () => mrApi.getMRItemOptions(header.projectId || null),
    staleTime: 60_000,
    enabled: true,
  });

  const { data: uoms = [] } = useQuery({
    queryKey: ["mr-uoms"],
    queryFn: async () => {
      const data = await mrApi.getMRUomOptions();
      return (Array.isArray(data) ? data : []).filter(
        (u: any) => u.IsActive === true || u.IsActive === 1,
      );
    },
    staleTime: 5 * 60_000,
  });

  const { data: itemUomAlternates = [] } = useQuery({
    queryKey: ["item-uom-alternates"],
    queryFn: getAllItemUomAlternates,
    staleTime: 60_000,
  });

  // ── MR doc types (for the plain Request No select) ──────────────────────────

  const [mrDocTypes, setMrDocTypes] = useState<DocType[]>([]);
  const [mrDocTypesLoading, setMrDocTypesLoading] = useState(true);

  useEffect(() => {
    setMrDocTypesLoading(true);
    fetchDocTypes("MR")
      .then(setMrDocTypes)
      .finally(() => setMrDocTypesLoading(false));
  }, []);

  // Auto-select first doc type and fetch preview when list loads or finYear changes
  useEffect(() => {
    if (mrDocTypesLoading || editingId) return;
    if (mrDocTypes.length === 0) return;
    const firstId = mrDocTypes[0].TypeOfDocId;
    if (!header.docTypeId) {
      fetchNextDocNumber(firstId, finYearStr).then((preview) =>
        setHeader((p) => ({ ...p, docTypeId: firstId, docNoPreview: preview })),
      );
    }
  }, [mrDocTypes, mrDocTypesLoading]);

  // Refresh preview whenever finYear or selected doc type changes (create mode only)
  useEffect(() => {
    if (!header.docTypeId || editingId) return;
    fetchNextDocNumber(header.docTypeId, finYearStr).then((preview) =>
      setHeader((p) => ({ ...p, docNoPreview: preview })),
    );
  }, [header.docTypeId, finYearStr]);

  const { data: listData, isLoading: loadingList } = useQuery({
    queryKey: ["mr-list", page, search, statusFilter, projectFilter],
    queryFn: () =>
      mrApi.getMaterialRequests({
        page,
        limit,
        search,
        status: statusFilter,
        projectId: projectFilter ? Number(projectFilter) : undefined,
        groupBy: "project",
      }),
  });

  // Bulk pending-qty totals for every MR that's reached the fulfillment
  // lifecycle (Approved/Partially Fulfilled/Completed) — powers the
  // "Pending - N Qty" / "Completed" pill without an N+1 fetch per row.
  const { data: pendingSummaryList = [] } = useQuery({
    queryKey: ["mr-pending-summary"],
    queryFn: mrApi.getBulkMRPendingSummary,
    staleTime: 30_000,
  });
  const pendingSummaryByMRId = useMemo(() => {
    const m = new Map<number, mrApi.MRPendingSummaryTotals>();
    for (const row of pendingSummaryList) m.set(row.MRId, row);
    return m;
  }, [pendingSummaryList]);

  // One request for every visible row's approval trail instead of one
  // request PER row — see useApprovalTrailsBulk's own comment. ListView()
  // below is called as a plain function (not <ListView/>), so its own hook
  // calls would be conditional on viewMode and break the Rules of Hooks;
  // this stays at the top level and ListView closes over it instead.
  const mrIdsOnPage = useMemo(() => (listData?.data || []).map((r: any) => r.MRId), [listData]);
  const { trails: approvalTrails, isLoading: approvalTrailsLoading } = useApprovalTrailsBulk("MaterialRequests", mrIdsOnPage);

  // ── Auto-select active fin year ──────────────────────────────────────────────

  useEffect(() => {
    if (
      finYears.length > 0 &&
      !header.finYearId &&
      viewMode === "form" &&
      !editingId
    ) {
      const today = new Date().toISOString().slice(0, 10);
      const current = (finYears as any[]).find(
        (f) => f.isActive && f.startDate <= today && f.endDate >= today,
      );
      const fallback = (finYears as any[]).find((f) => f.isActive);
      const active = current ?? fallback;
      if (active) setH("finYearId", String(active.id));
    }
  }, [finYears, viewMode, editingId]);

  // ── Item & UOM lookup ────────────────────────────────────────────────────────

  const itemMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const item of itemOptions as any[]) m[String(item.M_Id)] = item;
    return m;
  }, [itemOptions]);

  // Whole days between Request Date and Required By Date — null when either
  // isn't set yet, meaning "no constraint" (nothing to filter against). Can
  // legitimately be 0 (same-day) or negative (a not-yet-corrected date pair
  // mid-edit); the filter below just excludes anything whose lead time
  // doesn't fit, so 0/negative naturally excludes every item with a real
  // Days of Supply set.
  const availableSupplyDays = useMemo(() => {
    if (!header.requestDate || !header.requiredByDate) return null;
    const start = new Date(`${header.requestDate}T00:00:00`);
    const end = new Date(`${header.requiredByDate}T00:00:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return Math.round((end.getTime() - start.getTime()) / 86_400_000);
  }, [header.requestDate, header.requiredByDate]);

  // An item already picked on some cart row stays selectable everywhere —
  // filtering it out of the list the moment the date window shrinks would
  // make that row's own ItemPicker unable to display its current value.
  const selectedItemIds = useMemo(
    () => new Set(cart.map((ci) => ci.ItemId).filter(Boolean)),
    [cart],
  );

  const pickableItems = useMemo(
    () =>
      (itemOptions as any[])
        .filter((item) => {
          if (availableSupplyDays === null) return true; // no Required By Date chosen yet
          if (selectedItemIds.has(String(item.M_Id))) return true;
          const dos = item.DaysOfSupply;
          // Days of Supply is a new field — most items don't have one set
          // yet. No data means no constraint: show it anyway, exactly like
          // an item whose lead time already fits.
          if (dos === null || dos === undefined || dos === "") return true;
          return Number(dos) <= availableSupplyDays;
        })
        .map((item) => ({
          id: String(item.M_Id),
          name: `${item.M_Name} — Stock: ${Number(item.AvailableStock).toFixed(2)}${item.M_Group ? ` · ${item.M_Group}` : ""}`,
          itemType: item.M_Type ?? "",
        })),
    [itemOptions, availableSupplyDays, selectedItemIds],
  );

  const uomMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const u of uoms as any[]) m[u.UOMCode] = u;
    return m;
  }, [uoms]);

  // ── Required By Date floor ───────────────────────────────────────────────────
  // The slowest item in the cart to supply sets how soon the whole request can
  // realistically be required by: Required By Date >= Request Date + the
  // longest Days of Supply among the cart's items. The user can still push it
  // later, just never earlier.
  const maxDaysOfSupply = useMemo(() => {
    let max = 0;
    for (const ci of cart) {
      const days = Number(itemMap[ci.ItemId]?.DaysOfSupply ?? 0);
      if (days > max) max = days;
    }
    return max;
  }, [cart, itemMap]);

  const minRequiredByDate = useMemo(() => {
    if (!maxDaysOfSupply || !header.requestDate) return "";
    const d = new Date(`${header.requestDate}T00:00:00`);
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + maxDaysOfSupply);
    return d.toISOString().slice(0, 10);
  }, [header.requestDate, maxDaysOfSupply]);

  // Keep Required By Date auto-advanced to the floor: fill it in when it's
  // still blank, and pull it forward if the cart's items (or the request
  // date) push the floor past whatever was already chosen. Never pulls it
  // back once the user has picked something later — only forward.
  useEffect(() => {
    if (!minRequiredByDate) return;
    if (!header.requiredByDate || header.requiredByDate < minRequiredByDate) {
      setH("requiredByDate", minRequiredByDate);
    }
  }, [minRequiredByDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cart helpers ─────────────────────────────────────────────────────────────

  const updateCartItem = useCallback(
    <K extends keyof CartItem>(key: string, field: K, value: CartItem[K]) => {
      setCart((prev) =>
        prev.map((ci) => (ci._key === key ? { ...ci, [field]: value } : ci)),
      );
    },
    [],
  );

  useEffect(() => {
    setCart((prev) => {
      let changed = false;
      const next = prev.map((ci) => {
        const found = ci.ItemId ? itemMap[ci.ItemId] : undefined;
        if (!found || ci.DefaultUOM) return ci;
        changed = true;
        return {
          ...ci,
          DefaultUOM: found.DefaultUOM || ci.UOMCode || undefined,
          AvailableStock: Number(found.AvailableStock ?? ci.AvailableStock ?? 0),
          ItemName: ci.ItemName || found.M_Name,
        };
      });
      return changed ? next : prev;
    });
  }, [itemMap]);

  const pickItem = useCallback(
    (cartKey: string, itemId: string) => {
      const found = itemMap[itemId];
      const defaultUom =
        found?.DefaultUOM || (uoms as any[]).find(Boolean)?.UOMCode || "";
      setCart((prev) =>
        prev.map((ci) =>
          ci._key === cartKey
            ? {
                ...ci,
                ItemId: itemId,
                ItemName: found?.M_Name,
                AvailableStock: Number(found?.AvailableStock ?? 0),
                DefaultUOM: defaultUom,
                UOMCode: defaultUom,
                CostCenterId: found?.M_CostCenterId ? String(found.M_CostCenterId) : "",
              }
            : ci,
        ),
      );
    },
    [itemMap, uoms],
  );

  const addCartRow = () => setCart((p) => [...p, blankCartItem()]);
  const removeCartRow = (key: string) =>
    setCart((p) => (p.length > 1 ? p.filter((ci) => ci._key !== key) : p));

  // ── Validation ───────────────────────────────────────────────────────────────

  const cartIsValid = useMemo(
    () =>
      cart.length > 0 &&
      cart.every(
        (ci) =>
          ci.ItemId && ci.UOMCode && ci.Quantity && Number(ci.Quantity) > 0,
      ),
    [cart],
  );

  const headerIsValid = useMemo(
    () =>
      Boolean(
        header.companyId &&
        header.projectId &&
        header.finYearId &&
        header.requestDate &&
        header.reason.trim(),
      ),
    [header],
  );

  const canSave = headerIsValid && cartIsValid;

  // ── Mutations ────────────────────────────────────────────────────────────────

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["mr-list"] });
  };

  const createMutation = useMutation({
    mutationFn: mrApi.createMaterialRequest,
    onSuccess: (rec: any) => {
      toast.success(
        `Material Request ${rec?.DocNo || ""} created and sent for approval`,
      );
      invalidate();
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        goToList();
      }, 1500);
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to create request"),
  });

  const updateMutation = useMutation({
    mutationFn: (p: any) => mrApi.updateMaterialRequest(editingId!, p),
    onSuccess: (res: any) => {
      toast.success(
        res?.resubmitted
          ? "Material Request updated and re-submitted for approval"
          : "Material Request updated",
      );
      invalidate();
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        goToList();
      }, 1500);
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to update request"),
  });

  const deleteMutation = useMutation({
    mutationFn: mrApi.deleteMaterialRequest,
    onSuccess: () => {
      toast.success("Material Request deleted");
      invalidate();
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to delete request"),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const [saved, setSaved] = useState(false);

  // ── Navigation helpers ───────────────────────────────────────────────────────

  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setViewingRecord(null);
    setHeader(defaultHeader);
    setCart([blankCartItem()]);
    setWoSource(null);
  };

  const resetFields = () => {
    setEditingId(null);
    setHeader(defaultHeader);
    setCart([blankCartItem()]);
    setSaved(false);
    setWoSource(null);
  };

  // Opened from an approved Work Order: /material/material-request with { woPrefill } in the router state.
  // The form is pre-filled but nothing is saved until the user presses Save, so every field can be changed.
  useEffect(() => {
    const woPrefill = (location.state as { woPrefill?: WorkOrderMRPrefill } | null)?.woPrefill;
    if (!woPrefill) return;
    setHeader({
      ...defaultHeader,
      companyId: String(woPrefill.CompanyId ?? ""),
      projectId: String(woPrefill.ProjectId ?? ""),
      reason: woPrefill.Reason,
      remarks: woPrefill.Remarks,
    });
    setCart(
      woPrefill.items.length > 0
        ? woPrefill.items.map((it) => ({
            _key: generateUUID(),
            ItemId: String(it.ItemId),
            ItemName: it.ItemName ?? undefined,
            UOMCode: String(it.UOMCode ?? ""),
            Quantity: String(it.Quantity),
            Remarks: "",
            AvailableStock: 0,
            CostCenterId: "",
          }))
        : [blankCartItem()],
    );
    setWoSource({ id: woPrefill.WOId, docNo: woPrefill.WODocNo });
    setEditingId(null);
    setViewMode("form");
    // Clear the router state so a refresh doesn't re-apply it.
    window.history.replaceState({}, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The table row (and the View overlay's own summary) only carry
  // ItemCount/QtyByUom — the list endpoint never returns the actual item
  // rows (see backend/routes/materialRequests.js's GET / route) — so this
  // always re-fetches the full record first, the same way handleView does,
  // rather than trusting whatever `record` was passed in.
  const handleEdit = async (record: any) => {
    let full = record;
    try {
      full = await mrApi.getMaterialRequestById(record.MRId);
    } catch (err: any) {
      toast.error(err?.message || `Failed to load Material Request #${record.MRId}`);
      return;
    }
    setHeader({
      companyId: String(full.CompanyId ?? ""),
      projectId: String(full.ProjectId ?? ""),
      finYearId: String(full.FinYearId ?? ""),
      docTypeId: full.DocTypeId ?? null,
      docNoPreview: "",
      requestDate: full.RequestDate
        ? String(full.RequestDate).slice(0, 10)
        : defaultHeader.requestDate,
      requiredByDate: full.RequiredByDate
        ? String(full.RequiredByDate).slice(0, 10)
        : "",
      priority: full.Priority ?? "Normal",
      reason: full.Reason ?? "",
      remarks: full.Remarks ?? "",
    });
    const items: CartItem[] = (full.items || []).map((it: any) => ({
      _key: generateUUID(),
      ItemId: String(it.ItemId ?? ""),
      ItemName: it.ItemName,
      UOMCode: String(it.UOMCode ?? ""),
      Quantity: String(it.Quantity ?? ""),
      Remarks: it.Remarks ?? "",
      AvailableStock: Number(itemMap[it.ItemId]?.AvailableStock ?? 0),
      CostCenterId: it.CostCenterId != null ? String(it.CostCenterId) : "",
    }));
    setCart(items.length > 0 ? items : [blankCartItem()]);
    setEditingId(full.MRId);
    setViewMode("form");
  };

  const handleView = async (record: any) => {
    try {
      const full = await mrApi.getMaterialRequestById(record.MRId);
      setViewingRecord(full);
    } catch {
      setViewingRecord(record);
    }
  };

  // Deep-link support — Linked Documents panels elsewhere navigate here as
  // /material/material-request?view=<MRId> to open this exact MR.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    handleView({ MRId: Number(viewId) });
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = () => {
    if (!canSave) {
      if (!headerIsValid) toast.error("Fill all required header fields");
      else toast.error("Each item needs item, UOM, and a valid quantity");
      return;
    }
    const payload = {
      CompanyId: Number(header.companyId) || null,
      ProjectId: Number(header.projectId) || null,
      FinYearId: Number(header.finYearId) || null,
      RequestDate: header.requestDate,
      RequiredByDate: header.requiredByDate || null,
      Priority: header.priority,
      Reason: header.reason,
      Remarks: header.remarks || null,
      DocTypeId: header.docTypeId || null,
      ...(editingId == null && woSource ? { SourceWOId: woSource.id } : {}),
      items: cart.map((ci) => ({
        ItemId: ci.ItemId,
        ItemName: ci.ItemName || itemMap[ci.ItemId]?.M_Name || null,
        UOMCode: ci.UOMCode,
        Quantity: Number(ci.Quantity),
        Remarks: ci.Remarks || null,
        CostCenterId: ci.CostCenterId || null,
      })),
    };
    if (editingId != null) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  // ── Columns ───────────────────────────────────────────────────────────────────

  const columns: ColumnDef<any, unknown>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      header: "Doc No",
      size: 130,
      cell: ({ getValue }) => (
        <span className="font-heading font-semibold tracking-wide text-foreground text-sm">
          {String(getValue() || "—")}
        </span>
      ),
    },
    {
      id: "Priority",
      accessorKey: "Priority",
      header: "Priority",
      size: 90,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => {
        const v = (getValue() as string) || "Normal";
        return (
          <span className={`${TAG} ${PRIORITY_COLOR[v] ?? PRIORITY_COLOR.Normal}`}>
            {v}
          </span>
        );
      },
    },
    {
      id: "CompanyName",
      accessorKey: "CompanyName",
      header: "Company",
      size: 200,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => (
        <span className="block text-sm truncate" title={String(getValue() || "")}>{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "ProjectName",
      accessorKey: "ProjectName",
      header: "Project",
      size: 180,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => (
        <span className="block text-sm text-muted-foreground truncate" title={String(getValue() || "")}>{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "ItemCount",
      accessorKey: "ItemCount",
      header: "Items",
      // Truncating a QtyByUom string like "1,000.00 Numbers" behind a
      // hover tooltip hid the full breakdown by default — show it in full
      // instead, wrapping onto extra lines rather than clipping, so every
      // UOM in the list is visible without hovering. table-layout is fixed
      // (DataTable.tsx), so a taller cell just grows the row — it doesn't
      // break the layout.
      size: 260,
      // Items and Status show from tablet width (with Doc No and the actions they fit 768px); the rest from 1024px.
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => (
        <span className="flex flex-wrap items-baseline gap-x-1 text-sm py-1">
          <span className="font-heading font-semibold tabular-nums shrink-0">{row.original.ItemCount || 0}</span>
          {row.original.QtyByUom && (
            <span className="text-muted-foreground whitespace-normal break-words">({row.original.QtyByUom})</span>
          )}
        </span>
      ),
    },
    {
      id: "RequestDate",
      accessorKey: "RequestDate",
      header: "Requested",
      size: 110,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {fmtDate(getValue() as string)}
        </span>
      ),
    },
    {
      id: "RequiredByDate",
      accessorKey: "RequiredByDate",
      header: "Required By",
      size: 110,
      meta: { className: "hidden lg:table-cell" },
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        const isUrgent = v && new Date(v) < new Date();
        return (
          <span
            className={`text-sm tabular-nums ${isUrgent ? "text-destructive font-semibold" : "text-muted-foreground"}`}
          >
            {fmtDate(v)}
          </span>
        );
      },
    },
    {
      id: "Status",
      accessorKey: "Status",
      header: "Status",
      size: 180,
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => {
        const pending = pendingSummaryByMRId.get(row.original.MRId);
        return (
          <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
            <ApprovalStatusChain
              table="MaterialRequests"
              recordId={row.original.MRId}
              fallback={<SheetMark text={row.original.Status || "Draft"} tone={statusTone(row.original.Status || "Draft")} />}
              preloaded={approvalTrails.get(String(row.original.MRId)) ?? null}
              preloadedLoading={approvalTrailsLoading}
            />
            {pending &&
              (pending.totalPending > 0 ? (
                <SheetMark text={`Pending · ${pending.totalPending} qty`} tone="waiting" />
              ) : pending.totalOrdered > 0 ? (
                <SheetMark text="Completed" tone="done" />
              ) : null)}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      size: 160,
      cell: ({ row }) => {
        const status = row.original.Status as string;
        const isDeleting = deleteMutation.isPending;
        return (
          <div className="flex items-center justify-end gap-1">
            {/* View — always visible */}
            <button data-row-view
              type="button"
              onClick={() => handleView(row.original)}
              className={`${ACT} hover:text-foreground hover:border-foreground`}
              title="View details"
              aria-label="View details"
            >
              <Eye size={14} />
            </button>

            {/* Update — Draft or Approved (post-approval edits get logged
                as amendments), Rejected (saving re-submits it from level 1),
                or any status for admins */}
            {rights.canEdit && status !== "Short Closed" && (status === "Draft" || status === "Approved" || status === "Rejected" || isAdmin) && (
              <button
                type="button"
                onClick={() => handleEdit(row.original)}
                className={`${ACT} hover:text-foreground hover:border-foreground`}
                aria-label="Edit"
                title={
                  status === "Draft"
                    ? "Edit this request"
                    : status === "Approved"
                      ? "Edit (will be logged as an amendment)"
                      : status === "Rejected"
                        ? "Edit and re-submit for approval"
                        : "Edit (admin override)"
                }
              >
                <Edit3 size={14} />
              </button>
            )}

            {/* Delete */}
            {rights.canDelete && (
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  if (confirm("Delete this material request?"))
                    deleteMutation.mutate(row.original.MRId);
                }}
                className={`${ACT} hover:text-destructive hover:border-destructive`}
                title="Delete this request"
                aria-label="Delete this request"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], MR_TEMPLATE_COLUMNS, "material-request-template");
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
      const plan = await planImport(rows, {
        companies: companies as any[],
        projects: projects as any[],
        finYears: finYears as any[],
        docTypes: mrDocTypes,
        uoms: uoms as any[],
        itemsFor: (projectId) => mrApi.getMRItemOptions(projectId),
      });
      if (!plan.length) { toast.error("No rows with data in the CSV"); return; }
      setImportPlan({ fileName: file.name, plan });
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  return {
    rights,
    currentUser,
    isAdmin,
    queryClient,
    importFileInputRef,
    importing,
    setImporting,
    viewMode,
    setViewMode,
    editingId,
    setEditingId,
    viewingRecord,
    setViewingRecord,
    page,
    setPage,
    search,
    setSearch,
    searchParams,
    setSearchParams,
    statusFilter,
    setStatusFilter,
    limit,
    collapsedProjectGroups,
    setCollapsedProjectGroups,
    projectFilter,
    setProjectFilter,
    header,
    setHeader,
    cart,
    setCart,
    woSource,
    setWoSource,
    location,
    setH,
    ctxFinYears,
    activeYear,
    companies,
    projects,
    filteredProjects,
    finYears,
    selectedFY,
    finYearStr,
    itemOptions,
    uoms,
    itemUomAlternates,
    mrDocTypes,
    setMrDocTypes,
    mrDocTypesLoading,
    setMrDocTypesLoading,
    listData,
    loadingList,
    pendingSummaryList,
    pendingSummaryByMRId,
    mrIdsOnPage,
    approvalTrails,
    approvalTrailsLoading,
    itemMap,
    availableSupplyDays,
    selectedItemIds,
    pickableItems,
    uomMap,
    maxDaysOfSupply,
    minRequiredByDate,
    updateCartItem,
    pickItem,
    addCartRow,
    removeCartRow,
    cartIsValid,
    headerIsValid,
    canSave,
    invalidate,
    createMutation,
    updateMutation,
    deleteMutation,
    isSaving,
    saved,
    setSaved,
    goToList,
    resetFields,
    handleEdit,
    handleView,
    onSave,
    columns,
    handleDownloadTemplate,
    handleImportClick,
    handleImportFileChange,
    importPlan,
    setImportPlan,
  };
}

export type MRState = ReturnType<typeof useMaterialRequest>;

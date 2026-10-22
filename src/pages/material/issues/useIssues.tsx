// Everything the Material Issues page holds: master data, the register, the form and cart,
// mutations and CSV import. The page and its parts read from this one object.
import { getCostCenterOptions } from "@/api/costCenterApi";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { ISSUES_TEMPLATE_COLUMNS, planImport, type PlannedIssue } from "./issueImport";
import * as issuesApi from "@/api/issuesApi";
import { generateUUID } from "../../../utils/cryptoPolyfill";
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Trash2, ShoppingCart, Warehouse } from "lucide-react";
import { exportToCsv, parseCsv } from "@/lib/export";
import { type ColumnDef } from "@/components/ui/DataTable";
import { fetchNextDocNumber, fetchDocTypes, type DocType } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { useFinYear } from "@/contexts/FinYearContext";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { usePageRights } from "@/hooks/usePageRights";
import { CartItem, IssueHeader, defaultHeader, blankCartItem, ACT } from "./config";

export function useIssues() {
  const rights = usePageRights("material-issues");
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importPlan, setImportPlan] = useState<{ fileName: string; plan: PlannedIssue[] } | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "form" | "view">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  // The issue whose delete is waiting for confirmation.
  const [deletingIssue, setDeletingIssue] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [issueStatusFilter, setIssueStatusFilter] = useState("");
  const limit = 10;

  const [header, setHeader] = useState<IssueHeader>(defaultHeader);
  const { finYears } = useFinYear();
  const activeYear = finYears.find((y) => y.status === "Active") ?? null;
  const finYearStr = activeYear
    ? `${String(activeYear.startDate).slice(2, 4)}-${String(activeYear.endDate).slice(2, 4)}`
    : undefined;

  const [cart, setCart] = useState<CartItem[]>([blankCartItem()]);

  const setH = <K extends keyof IssueHeader>(k: K, v: IssueHeader[K]) =>
    setHeader((p) => ({ ...p, [k]: v }));

  // ── Master data queries ──────────────────────────────────────────────────

  const { data: companies = [], isLoading: loadingCompanies } = useQuery({
    queryKey: ["issues-companies"],
    queryFn: issuesApi.getCompanies,
    staleTime: 5 * 60_000,
  });

  const { data: projects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["issues-projects"],
    queryFn: issuesApi.getProjects,
    staleTime: 5 * 60_000,
  });

  const { data: godowns = [], isLoading: loadingGodowns } = useQuery({
    queryKey: ["issues-godowns"],
    queryFn: issuesApi.getGodowns,
    staleTime: 5 * 60_000,
  });

  const { data: blocks = [], isLoading: loadingBlocks } = useQuery({
    queryKey: ["issues-blocks"],
    queryFn: issuesApi.getBlocks,
    staleTime: 5 * 60_000,
  });

  const selectedBlockId = header.blockId ? Number(header.blockId) : null;

  const { data: blockFloors = [], isLoading: loadingFloors } = useQuery({
    queryKey: ["issues-block-floors", selectedBlockId],
    queryFn: () => issuesApi.getBlockFloors(selectedBlockId as number),
    enabled: !!selectedBlockId,
    staleTime: 5 * 60_000,
  });

  const { data: contractors = [] } = useQuery<{ id: number; label: string }[]>({
    queryKey: ["issues-contractors"],
    queryFn: async () => {
      const { fetchWithAuth } = await import("@/lib/fetchWithAuth");
      const res = await fetchWithAuth("/api/account-head/options?type=C");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  // Cost centres for the issue's "Cost centre / GL account" field: active ones from the Cost Center master, for this project or for none.
  const { data: costCenterOptions = [] } = useQuery({
    queryKey: ["issues-cost-centers"],
    queryFn: getCostCenterOptions,
    staleTime: 5 * 60_000,
  });
  const issueCostCenters = costCenterOptions.filter(
    (c) => !c.projectId || !header.projectId || String(c.projectId) === header.projectId,
  );
  // GL heads share the same field: an issue is charged to a cost centre or straight to a GL account.
  const { data: glHeads = [] } = useQuery<{ id: number; label: string }[]>({
    queryKey: ["issues-gl-heads"],
    queryFn: async () => {
      const { fetchWithAuth } = await import("@/lib/fetchWithAuth");
      const res = await fetchWithAuth("/api/account-head/options?type=GL");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  // Items re-fetched whenever the selected godown changes
  const selectedGodownId = header.godownId ? Number(header.godownId) : null;

  const { data: itemOptions = [], isLoading: loadingItems } = useQuery({
    queryKey: ["issues-items", selectedGodownId],
    queryFn: () => issuesApi.getItemOptions(selectedGodownId),
    staleTime: 60_000,
    enabled: viewMode === "form" && !!selectedGodownId,
  });

  const { data: uoms = [], isLoading: loadingUoms } = useQuery({
    queryKey: ["issues-uoms"],
    queryFn: async () => {
      const data = await issuesApi.getUomOptions();
      return (Array.isArray(data) ? data : [])
        .map((u: any) => ({
          ...u,
          IsActive: u.IsActive === true || u.IsActive === 1,
        }))
        .filter((u: any) => u.IsActive);
    },
    staleTime: 5 * 60_000,
  });

  // ── ISS doc types (for the Issue No select) ──────────────────────────────
  const [issDocTypes, setIssDocTypes] = useState<DocType[]>([]);
  const [issDocTypesLoading, setIssDocTypesLoading] = useState(true);

  // Load ISS doc types once on mount
  useEffect(() => {
    setIssDocTypesLoading(true);
    fetchDocTypes("ISS")
      .then((types) => setIssDocTypes(types))
      .finally(() => setIssDocTypesLoading(false));
  }, []);

  // Auto-select the first ISS doc type & fetch preview once finYearStr is ready
  // Also re-runs when docTypeId is cleared (e.g. after form reset)
  useEffect(() => {
    if (!finYearStr || issDocTypesLoading || issDocTypes.length === 0) return;
    if (header.docTypeId) return; // already selected — don't overwrite
    if (viewMode !== "form") return; // only run when form is open
    const first = issDocTypes[0];
    fetchNextDocNumber(first.TypeOfDocId, finYearStr).then((next) => {
      setHeader((p) => ({ ...p, docTypeId: first.TypeOfDocId, docNoPreview: next }));
    });
  }, [finYearStr, issDocTypes, issDocTypesLoading, header.docTypeId, viewMode]);

  const { data: issuesData, isLoading: loadingIssues } = useQuery({
    queryKey: ["issues-list", page, search, issueStatusFilter],
    queryFn: () =>
      issuesApi.getIssues({
        page,
        limit,
        search,
        status: issueStatusFilter || undefined,
      }),
  });

  // One request for every visible row's approval trail instead of one per
  // row — see useApprovalTrailsBulk's own comment.
  const { trails: issueApprovalTrails, isLoading: issueApprovalTrailsLoading } = useApprovalTrailsBulk(
    "MaterialIssues",
    (issuesData?.data || []).map((r: any) => r.IssueId),
  );

  // ── Auto-select active fin year ──────────────────────────────────────────

  useEffect(() => {
    if (finYears.length > 0 && !header.finYearId && viewMode === "form") {
      const today = new Date().toISOString().slice(0, 10);
      const current = (finYears as any[]).find(
        (f) =>
          (f.status === "Active" || f.isActive === true || f.isActive === 1) &&
          f.startDate <= today &&
          f.endDate >= today,
      );
      const fallback = (finYears as any[]).find(
        (f) => f.status === "Active" || f.isActive === true || f.isActive === 1,
      );
      const chosen = current ?? fallback;
      if (chosen) setH("finYearId", String(chosen.id));
    }
  }, [finYears, viewMode, header.finYearId]);

  // ── Item & UOM lookup helpers ────────────────────────────────────────────

  const itemMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const item of itemOptions as any[]) m[String(item.M_Id)] = item;
    return m;
  }, [itemOptions]);

  const uomMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const u of uoms as any[]) m[u.UOMCode] = u;
    return m;
  }, [uoms]);

  const selectedGodown = useMemo(
    () => (godowns as any[]).find((g) => String(g.id) === header.godownId),
    [godowns, header.godownId],
  );

  // ── Company → Project filtering ──────────────────────────────────────────

  const filteredProjects = useMemo(() => {
    if (!header.companyId) return projects as any[];
    const cid = Number(header.companyId);
    return (projects as any[]).filter((p) => projectBelongsToCompany(p, cid));
  }, [projects, header.companyId]);

  // Godown is only opened once a Company AND a Project are both selected,
  // scoped to whichever godown is tagged to that exact company + project.
  const filteredGodowns = useMemo(() => {
    if (!header.companyId || !header.projectId) return [];
    const cid = Number(header.companyId);
    const pid = Number(header.projectId);
    return (godowns as any[]).filter(
      (g) => Number(g.companyId) === cid && Number(g.projectId) === pid,
    );
  }, [godowns, header.companyId, header.projectId]);

  // Auto-select the (single) godown tagged to the chosen company+project —
  // there's normally exactly one, so no need to make the user pick again.
  useEffect(() => {
    if (filteredGodowns.length === 1 && header.godownId !== String(filteredGodowns[0].id)) {
      setH("godownId", String(filteredGodowns[0].id));
      setCart([blankCartItem()]);
    } else if (filteredGodowns.length !== 1 && header.godownId) {
      setH("godownId", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredGodowns]);

  // Blocks scoped to the selected project — same fetch-all-filter-client-side
  // pattern as filteredGodowns above.
  const filteredBlocks = useMemo(() => {
    if (!header.projectId) return [];
    const pid = Number(header.projectId);
    return (blocks as any[]).filter(
      (b) => Number(b.ProjectId) === pid && b.IsActive !== false,
    );
  }, [blocks, header.projectId]);

  // Work orders that can be tagged: approved, this company + project, with a Material Request raised.
  const { data: issueWorkOrders = [] } = useQuery({
    queryKey: ["issue-work-orders", header.companyId, header.projectId],
    queryFn: () => issuesApi.getIssueWorkOrders(Number(header.companyId), Number(header.projectId)),
    enabled: viewMode === "form" && !!header.companyId && !!header.projectId,
    staleTime: 60_000,
  });

  const handleCompanyChange = (v: string) => {
    setH("companyId", v);
    setH("projectId", ""); // reset project when company changes
    setH("workOrderId", ""); // the work order belongs to the company + project
    setH("workOrderDocNo", "");
    setH("godownId", "");
    setH("blockId", "");
    setH("floorNo", "");
  };

  const handleProjectChange = (v: string) => {
    setH("projectId", v);
    setH("workOrderId", "");
    setH("workOrderDocNo", "");
    setH("godownId", "");
    setH("blockId", "");
    setH("floorNo", "");
  };

  const handleBlockChange = (v: string) => {
    setH("blockId", v);
    setH("floorNo", ""); // reset floor — it's scoped to the block
  };

  // ── Cart helpers ─────────────────────────────────────────────────────────

  const updateCartItem = useCallback(
    <K extends keyof CartItem>(key: string, field: K, value: CartItem[K]) => {
      setCart((prev) =>
        prev.map((item) =>
          item._key === key ? { ...item, [field]: value } : item,
        ),
      );
    },
    [],
  );

  const pickItem = useCallback(
    (cartKey: string, itemId: string) => {
      const found = itemMap[itemId];
      const rawDefault = found?.DefaultUOM ?? "";
      const uomList = uoms as any[];

      // Resolve DefaultUOM → valid UOMCode:
      // Backend already resolves by code then name, but verify it's in our list.
      // Also try matching by UOMName in case backend returned a display name.
      const resolvedUom =
        uomList.find((u) => u.UOMCode === rawDefault)?.UOMCode ||
        uomList.find((u) => u.UOMName === rawDefault)?.UOMCode ||
        uomList[0]?.UOMCode ||
        "";

      setCart((prev) =>
        prev.map((ci) =>
          ci._key === cartKey
            ? {
                ...ci,
                ItemId: itemId,
                ItemName: found?.M_Name,
                AvailableStock: Number(found?.AvailableStock ?? 0),
                DefaultUOM: resolvedUom,
                UOMCode: resolvedUom,
                CostCenterId: found?.M_CostCenterId ? String(found.M_CostCenterId) : "",
              }
            : ci,
        ),
      );
    },
    [itemMap, uoms],
  );

  // Re-resolve UOMCode for any cart rows that have an item but blank UOM
  // (handles the race where pickItem fired before uoms finished loading).
  useEffect(() => {
    const uomList = uoms as any[];
    if (!uomList.length) return;
    setCart((prev) => {
      let changed = false;
      const next = prev.map((ci) => {
        if (!ci.ItemId || ci.UOMCode) return ci; // already has a UOM
        const found = itemMap[ci.ItemId];
        if (!found) return ci;
        const raw = found.DefaultUOM ?? "";
        const resolved =
          uomList.find((u) => u.UOMCode === raw)?.UOMCode ||
          uomList.find((u) => u.UOMName === raw)?.UOMCode ||
          uomList[0]?.UOMCode ||
          "";
        if (!resolved) return ci;
        changed = true;
        return { ...ci, UOMCode: resolved, DefaultUOM: resolved };
      });
      return changed ? next : prev;
    });
  }, [uoms, itemMap]);

  // When godown changes, reset cart items (stock values no longer valid)
  const handleGodownChange = (val: string) => {
    setH("godownId", val);
    setCart([blankCartItem()]);
  };

  const addCartRow = () => setCart((p) => [...p, blankCartItem()]);
  const removeCartRow = (key: string) =>
    setCart((p) => (p.length > 1 ? p.filter((i) => i._key !== key) : p));

  const getStockForRow = (cartKey: string, itemId: string): number => {
    const base = Number(itemMap[itemId]?.AvailableStock ?? 0);
    const otherQty = cart
      .filter((ci) => ci._key !== cartKey && ci.ItemId === itemId)
      .reduce((s, ci) => s + (Number(ci.Quantity) || 0), 0);
    return base - otherQty;
  };

  // ── Validation ───────────────────────────────────────────────────────────

  const cartIsValid = useMemo(() => {
    return (
      cart.length > 0 &&
      cart.every(
        (ci) =>
          ci.ItemId &&
          ci.UOMCode &&
          ci.Quantity &&
          Number(ci.Quantity) > 0 &&
          Number(ci.Quantity) <= getStockForRow(ci._key, ci.ItemId),
      )
    );
  }, [cart, itemMap]);

  const headerIsValid = useMemo(
    () =>
      Boolean(
        header.companyId &&
        header.projectId &&
        header.finYearId &&
        header.date &&
        header.reason.trim() &&
        header.godownId,
      ),
    [header],
  );

  const canSave = headerIsValid && cartIsValid;

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: issuesApi.createIssue,
    onSuccess: (rec: any) => {
      toast.success(
        `Issue ${rec?.DocNo || rec?.IssueNo || ""} created and sent for approval`,
      );
      queryClient.invalidateQueries({ queryKey: ["issues-list"] });
      queryClient.invalidateQueries({ queryKey: ["issues-items"] });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        goToList();
      }, 1500);
    },
    onError: (err: any) => toast.error(err.message || "Failed to create issue"),
  });

  const updateMutation = useMutation({
    mutationFn: (p: any) => issuesApi.updateIssue(editingId!, p),
    onSuccess: () => {
      toast.success("Issue updated");
      queryClient.invalidateQueries({ queryKey: ["issues-list"] });
      queryClient.invalidateQueries({ queryKey: ["issues-items"] });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        goToList();
      }, 1500);
    },
    onError: (err: any) => toast.error(err.message || "Failed to update issue"),
  });

  const deleteMutation = useMutation({
    mutationFn: issuesApi.deleteIssue,
    onSuccess: () => {
      toast.success("Issue deleted");
      queryClient.invalidateQueries({ queryKey: ["issues-list"] });
      queryClient.invalidateQueries({ queryKey: ["issues-items"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete issue"),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const [saved, setSaved] = useState(false);

  // ── Navigation helpers ───────────────────────────────────────────────────

  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setViewingRecord(null);
    setHeader(defaultHeader);
    setCart([blankCartItem()]);
  };

  const resetFields = () => {
    setEditingId(null);
    setHeader(defaultHeader);
    setCart([blankCartItem()]);
    setSaved(false);
  };

  // Mirrors the backend's own check (PUT /:id in materialIssues.js) —
  // editing a Pending (or Approved) issue restarts its approval cycle
  // rather than being blocked.
  const EDITABLE_STATUSES = ["Draft", "Pending", "Rejected", "Approved"];
  const isEditableStatus = (status?: string | null) =>
    EDITABLE_STATUSES.includes(status || "Draft");

  const handleEdit = (record: any) => {
    if (!isEditableStatus(record.Status)) {
      toast.error(
        `Cannot edit an issue with status "${record.Status}". Only Draft, Pending, Rejected, or Approved issues can be edited.`,
      );
      return;
    }
    setHeader({
      companyId: String(record.CompanyId ?? ""),
      projectId: String(record.ProjectId ?? ""),
      finYearId: String(record.FinYearId ?? ""),
      date: record.Date ? String(record.Date).slice(0, 10) : defaultHeader.date,
      reason: record.Reason ?? "",
      remarks: record.Remarks ?? "",
      godownId: record.GodownId ? String(record.GodownId) : "",
      docTypeId: record.DocTypeId ?? null,
      docNoPreview: "",
      issuedTo: record.IssuedTo ?? "",
      costCenter: record.CostCenter ?? "",
      blockId: record.BlockId ? String(record.BlockId) : "",
      floorNo: record.FloorNo != null ? String(record.FloorNo) : "",
      workOrderId: record.SourceWOId ? String(record.SourceWOId) : "",
      workOrderDocNo: record.SourceWODocNo ?? "",
    });
    const items: CartItem[] = (record.items || []).map((it: any) => ({
      _key: generateUUID(),
      ItemId: String(it.ItemId ?? ""),
      UOMCode: String(it.UOMCode ?? ""),
      Quantity: String(it.Quantity ?? ""),
      Remarks: it.Remarks ?? "",
      ItemName: it.ItemName,
      AvailableStock: Number(itemMap[it.ItemId]?.AvailableStock ?? 0),
      CostCenterId: it.CostCenterId != null ? String(it.CostCenterId) : "",
    }));
    setCart(items.length > 0 ? items : [blankCartItem()]);
    setEditingId(record.IssueId);
    setViewMode("form");
  };

  const handleView = async (record: any) => {
    try {
      const full = await issuesApi.getIssue(record.IssueId);
      setViewingRecord(full);
    } catch {
      setViewingRecord(record);
    }
  };

  // Deep-link support — Linked Documents / Stock drill-down panels navigate
  // here as /material/issues?view=<IssueId> to open this exact issue.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    handleView({ IssueId: Number(viewId) });
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = () => {
    if (!canSave) {
      if (!headerIsValid) toast.error("Fill all required header fields");
      else
        toast.error(
          "Each item needs item, UOM, and valid quantity ≤ available stock",
        );
      return;
    }
    const payload = {
      CompanyId: Number(header.companyId),
      ProjectId: Number(header.projectId),
      FinYearId: Number(header.finYearId) || null,
      Date: header.date,
      Reason: header.reason,
      Remarks: header.remarks || null,
      GodownId: header.godownId ? Number(header.godownId) : null,
      DocTypeId: header.docTypeId || null,
      IssuedTo: header.issuedTo || null,
      CostCenter: header.costCenter || null,
      BlockId: header.blockId ? Number(header.blockId) : null,
      FloorNo: header.floorNo !== "" ? Number(header.floorNo) : null,
      SourceWOId: header.workOrderId ? Number(header.workOrderId) : null,
      items: cart
        .filter((ci) => ci.ItemId && ci.ItemId.trim() !== "")
        .map((ci) => ({
          ItemId: ci.ItemId,
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

  // ── Columns ───────────────────────────────────────────────────────────────

  const columns: ColumnDef<any, unknown>[] = [
    {
      accessorKey: "DocNo",
      header: "Doc No",
      size: 160,
      cell: ({ row, getValue }) => (
        <span className="font-heading font-bold text-foreground text-xs">
          {String(getValue() || row.original.IssueNo || "—")}
        </span>
      ),
    },
    {
      accessorKey: "CompanyName",
      header: "Company",
      size: 140,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => {
        const v = String(getValue() || "—");
        return (
          <div className="flex items-center gap-1.5 text-xs min-w-0" title={v}>
            <span className="truncate">{v}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "ProjectName",
      header: "Project",
      size: 140,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => {
        const v = String(getValue() || "—");
        return (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0" title={v}>
            <span className="truncate">{v}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "GodownName",
      header: "Godown",
      size: 180,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row, getValue }) => {
        const name = getValue() as string;
        if (!name) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="min-w-0 leading-tight">
              <p className="text-xs truncate" title={name}>{name}</p>
              {row.original.GodownCode && (
                <p className="text-[0.625rem] text-muted-foreground font-heading truncate">
                  {row.original.GodownCode}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "ItemCount",
      header: "Items",
      size: 130,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-xs">
          <ShoppingCart size={11} className="text-muted-foreground shrink-0" />
          <span className="font-semibold">
            {row.original.ItemCount || 0}
          </span>
          <span className="text-[0.625rem] text-muted-foreground">
            ({(row.original.TotalQty || 0).toFixed(2)} units)
          </span>
        </div>
      ),
    },
    {
      accessorKey: "Date",
      header: "Date",
      size: 120,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span className="text-xs text-muted-foreground">
            {v
              ? new Date(v).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              : "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "Status",
      header: "Status",
      size: 190,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue, row }) => (
        <div className="min-w-0">
          <ApprovalStatusChain
            table="MaterialIssues"
            recordId={row.original.IssueId}
            fallback={<SheetMark text={row.original.Status || "Draft"} tone={statusTone(row.original.Status || "Draft")} />}
            preloaded={issueApprovalTrails.get(String(row.original.IssueId)) ?? null}
            preloadedLoading={issueApprovalTrailsLoading}
          />
        </div>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      size: 90,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <button data-row-view
            type="button"
            onClick={() => handleView(row.original)}
            className={`${ACT} hover:text-foreground hover:border-foreground`}
            title="View details"
          >
            <Eye size={14} />
          </button>
          {rights.canDelete && (
          <button
            type="button"
            onClick={() => setDeletingIssue(row.original)}
            className={`${ACT} hover:text-destructive hover:border-destructive`}
            title="Delete this issue"
          >
            <Trash2 size={14} />
          </button>
          )}
        </div>
      ),
    },
  ];


  // ── List / form figures ──
  const totalPages = issuesData?.totalPages || 1;
  const listData: any[] = issuesData?.data || [];
  const totalCount: number = issuesData?.total || 0;
  const totalCartQty = cart.reduce(
    (s, ci) => s + (Number(ci.Quantity) || 0),
    0,
  );
  const hasStockError = cart.some(
    (ci) =>
      ci.ItemId &&
      ci.Quantity &&
      Number(ci.Quantity) > getStockForRow(ci._key, ci.ItemId),
  );

  // Low-stock items in this godown (for warning banner)
  const lowStockItems = (itemOptions as any[]).filter(
    (it) => Number(it.AvailableStock) <= 0,
  ).length;

  // ── Import/Export handlers ────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], ISSUES_TEMPLATE_COLUMNS, "material-issues-template");
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
        godowns: godowns as any[],
        finYears: finYears as any[],
        uoms: uoms as any[],
        itemsFor: (gid) => issuesApi.getItemOptions(gid).then((d: any) => (Array.isArray(d) ? d : [])),
      });
      if (!plan.length) { toast.error("No rows to import"); return; }
      setImportPlan({ fileName: file.name, plan });
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  return {
    rights,
    queryClient,
    searchParams,
    setSearchParams,
    importFileInputRef,
    importing,
    importPlan,
    setImportPlan,
    setImporting,
    viewMode,
    setViewMode,
    editingId,
    setEditingId,
    viewingRecord,
    issueCostCenters,
    glHeads,
    deletingIssue,
    setDeletingIssue,
    setViewingRecord,
    page,
    setPage,
    search,
    setSearch,
    issueStatusFilter,
    setIssueStatusFilter,
    limit,
    header,
    setHeader,
    finYears,
    activeYear,
    finYearStr,
    cart,
    setCart,
    setH,
    companies,
    loadingCompanies,
    projects,
    loadingProjects,
    godowns,
    loadingGodowns,
    blocks,
    loadingBlocks,
    selectedBlockId,
    blockFloors,
    loadingFloors,
    contractors,
    selectedGodownId,
    itemOptions,
    loadingItems,
    uoms,
    loadingUoms,
    issDocTypes,
    setIssDocTypes,
    issDocTypesLoading,
    setIssDocTypesLoading,
    issuesData,
    loadingIssues,
    issueApprovalTrails,
    issueApprovalTrailsLoading,
    itemMap,
    uomMap,
    selectedGodown,
    filteredProjects,
    filteredGodowns,
    filteredBlocks,
    issueWorkOrders,
    handleCompanyChange,
    handleProjectChange,
    handleBlockChange,
    updateCartItem,
    pickItem,
    handleGodownChange,
    addCartRow,
    removeCartRow,
    getStockForRow,
    cartIsValid,
    headerIsValid,
    canSave,
    createMutation,
    updateMutation,
    deleteMutation,
    isSaving,
    saved,
    setSaved,
    goToList,
    resetFields,
    EDITABLE_STATUSES,
    isEditableStatus,
    handleEdit,
    handleView,
    onSave,
    columns,
    totalPages,
    listData,
    totalCount,
    totalCartQty,
    hasStockError,
    lowStockItems,
    handleDownloadTemplate,
    handleImportClick,
    handleImportFileChange,
  };
}

export type IssuesState = ReturnType<typeof useIssues>;

import { generateUUID } from "../../utils/cryptoPolyfill";
import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import * as issuesApi from "@/api/issuesApi";
import {
  CalendarDays,
  FileText,
  Save,
  Search,
  Eye,
  Trash2,
  Plus,
  RefreshCw,
  X,
  Edit3,
  Building2,
  FolderOpen,
  Hash,
  AlertTriangle,
  BarChart3,
  ShoppingCart,
  Package,
  CheckCircle2,
  Warehouse,
  ArrowDownToLine,
  User,
  Layers,
  ArrowLeft,
  RotateCcw,
  Check,
  ChevronDown,
  Download,
  Upload,
  Loader2,
  Printer,
} from "lucide-react";
import { printMasterPreview } from "@/utils/masterPreviewPrint";
import { exportToCsv, parseCsv } from "@/lib/export";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  fetchNextDocNumber,
  fetchDocTypes,
  type DocType,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { useFinYear } from "@/contexts/FinYearContext";

import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { usePageRights } from "@/hooks/usePageRights";

// ─── Template columns ─────────────────────────────────────────────────────────
const ISSUES_TEMPLATE_COLUMNS = [
  { header: "Issue Date (YYYY-MM-DD)", accessor: "Issue Date (YYYY-MM-DD)" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "Godown", accessor: "Godown" },
  { header: "Issued To", accessor: "Issued To" },
  { header: "Remarks", accessor: "Remarks" },
  { header: "Item Name", accessor: "Item Name" },
  { header: "UOM", accessor: "UOM" },
  { header: "Quantity", accessor: "Quantity" },
];

// ─── Shared styles (matching PurchaseOrderMaster) ────────────────────────────

const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer";

const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartItem {
  _key: string;
  ItemId: string;
  UOMCode: string;
  Quantity: string;
  Remarks: string;
  ItemName?: string;
  AvailableStock?: number;
  DefaultUOM?: string;
}

interface IssueHeader {
  companyId: string;
  projectId: string;
  finYearId: string;
  date: string;
  reason: string;
  remarks: string;
  godownId: string;
  docTypeId: number | null;
  docNoPreview: string;
  issuedTo: string;
  costCenter: string;
}

const defaultHeader: IssueHeader = {
  companyId: "",
  projectId: "",
  finYearId: "",
  date: new Date().toISOString().slice(0, 10),
  reason: "",
  remarks: "",
  godownId: "",
  docTypeId: null,
  docNoPreview: "",
  issuedTo: "",
  costCenter: "",
};

const blankCartItem = (): CartItem => ({
  _key: generateUUID(),
  ItemId: "",
  UOMCode: "",
  Quantity: "",
  Remarks: "",
});

// ─── Small sub-components ─────────────────────────────────────────────────────

const Field = ({
  label,
  required,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={className}>
    <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

// ─── Godown stock badge shown in the header ───────────────────────────────────

function GodownBadge({
  name,
  code,
  isMain,
}: {
  name: string;
  code?: string;
  isMain?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold border border-emerald-500/20">
      <Warehouse size={11} />
      {name}
      {code && (
        <span className="font-mono text-[10px] text-emerald-600/70 dark:text-emerald-400/70">({code})</span>
      )}
      {isMain && (
        <span className="px-1 py-0 rounded bg-emerald-500/20 text-[9px] font-bold uppercase tracking-wider">
          Main
        </span>
      )}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Issues() {
  const rights = usePageRights("material-issues");
  const queryClient = useQueryClient();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "form" | "view">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
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
    return (projects as any[]).filter((p) => Number(p.company_id) === cid);
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

  const handleCompanyChange = (v: string) => {
    setH("companyId", v);
    setH("projectId", ""); // reset project when company changes
    setH("godownId", "");
  };

  const handleProjectChange = (v: string) => {
    setH("projectId", v);
    setH("godownId", "");
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

  const handleEdit = (record: any) => {
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
    });
    const items: CartItem[] = (record.items || []).map((it: any) => ({
      _key: generateUUID(),
      ItemId: String(it.ItemId ?? ""),
      UOMCode: String(it.UOMCode ?? ""),
      Quantity: String(it.Quantity ?? ""),
      Remarks: it.Remarks ?? "",
      ItemName: it.ItemName,
      AvailableStock: Number(itemMap[it.ItemId]?.AvailableStock ?? 0),
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
      items: cart
        .filter((ci) => ci.ItemId && ci.ItemId.trim() !== "")
        .map((ci) => ({
          ItemId: ci.ItemId,
          UOMCode: ci.UOMCode,
          Quantity: Number(ci.Quantity),
          Remarks: ci.Remarks || null,
        })),
    };
    if (editingId) {
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
        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
          {String(getValue() || row.original.IssueNo || "—")}
        </span>
      ),
    },
    {
      accessorKey: "CompanyName",
      header: "Company",
      size: 140,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => (
        <div className="flex items-center gap-1.5 text-sm">
          <Building2 size={12} className="text-muted-foreground shrink-0" />
          {String(getValue() || "—")}
        </div>
      ),
    },
    {
      accessorKey: "ProjectName",
      header: "Project",
      size: 140,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FolderOpen size={12} className="shrink-0" />
          {String(getValue() || "—")}
        </div>
      ),
    },
    {
      accessorKey: "GodownName",
      header: "Godown",
      size: 180,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row, getValue }) => {
        const name = getValue() as string;
        return name ? (
          <div className="flex items-center gap-1.5 text-sm">
            <Warehouse size={12} className="text-emerald-600/70 dark:text-emerald-400/70 shrink-0" />
            <span>{name}</span>
            {row.original.GodownCode && (
              <span className="text-xs text-muted-foreground font-mono">
                ({row.original.GodownCode})
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        );
      },
    },
    {
      accessorKey: "ItemCount",
      header: "Items",
      size: 130,
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <ShoppingCart size={12} className="text-muted-foreground" />
          <span className="font-semibold text-sm">
            {row.original.ItemCount || 0}
          </span>
          <span className="text-xs text-muted-foreground">
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
          <span className="text-sm text-muted-foreground">
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
          <button
            type="button"
            onClick={() => handleView(row.original)}
            className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
            title="View details"
          >
            <Eye size={15} />
          </button>
          {rights.canDelete && (
          <button
            type="button"
            onClick={() => {
              if (
                confirm(
                  "Delete this issue permanently? This will reverse the stock deduction.",
                )
              )
                deleteMutation.mutate(row.original.IssueId);
            }}
            className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
            title="Delete this issue"
          >
            <Trash2 size={15} />
          </button>
          )}
        </div>
      ),
    },
  ];

  // ── List view ─────────────────────────────────────────────────────────────

  const IssueList = () => {
    const totalPages = issuesData?.totalPages || 1;
    const listData: any[] = issuesData?.data || [];
    const totalCount: number = issuesData?.total || 0;

    return (
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  Issue Register
                </CardTitle>
                {!loadingIssues && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {totalCount} record{totalCount !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
              <div className="relative w-full sm:w-64">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search issue no, company…"
                  className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {["", "Pending", "Approved", "Rejected", "Draft"].map((s) => (
                <button
                  key={s || "all"}
                  type="button"
                  onClick={() => {
                    setIssueStatusFilter(s);
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${issueStatusFilter === s ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white border-transparent shadow-sm" : "bg-background text-muted-foreground border-border hover:border-emerald-500/40"}`}
                >
                  {s || "All"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingIssues ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <RefreshCw size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <DataTable
                data={listData}
                columns={columns}
                searchable={false}
                paginated={false}
                emptyMessage="No material issues found. Click 'New Issue' to create one."
              />
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-6 py-3 text-sm">
                  <span className="text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(p - 1, 1))}
                      disabled={page <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setPage((p) => Math.min(p + 1, totalPages))
                      }
                      disabled={page >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  // ── Form view ─────────────────────────────────────────────────────────────

  const IssueForm = () => {
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

    return (
      <div className="space-y-5">
        {/* ── Header card ── */}
        <Card className="border-border shadow-sm">
          <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 bg-emerald-500/[0.06] border-b border-emerald-500/20">
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={goToList}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ArrowLeft size={15} />
                <span className="hidden sm:inline">Back</span>
              </button>
              <span className="text-emerald-500/40">|</span>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
                  <ArrowDownToLine size={12} className="text-emerald-400" />
                </div>
                <h2 className="text-sm font-heading font-bold text-foreground truncate">
                  {editingId ? "Edit Material Issue" : "New Material Issue"}
                </h2>
              </div>
            </div>
          </div>

          <CardContent className="p-5 space-y-4">
            {/* Doc number */}
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
              <FileText size={13} className="text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest mr-2 whitespace-nowrap">
                Issue No:
              </span>
              {editingId ? (
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                  {viewingRecord?.DocNo ?? "Immutable after creation"}
                </span>
              ) : (
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <div className="relative flex-1">
                    <select
                      value={header.docTypeId ? String(header.docTypeId) : ""}
                      onChange={async (e) => {
                        const id = e.target.value ? parseInt(e.target.value, 10) : null;
                        if (!id) { setH("docTypeId", null); setH("docNoPreview", ""); return; }
                        const preview = await fetchNextDocNumber(id, finYearStr);
                        setHeader((p) => ({ ...p, docTypeId: id, docNoPreview: preview }));
                      }}
                      disabled={issDocTypesLoading}
                      className={selectCls}
                    >
                      {issDocTypesLoading ? (
                        <option value="">Loading…</option>
                      ) : issDocTypes.length === 0 ? (
                        <option value="">No doc types found</option>
                      ) : (
                        issDocTypes.map((dt) => {
                          const label =
                            dt.ProjectCode && dt.ModuleCode
                              ? `${dt.ProjectCode}-${dt.ModuleCode}`
                              : (dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix);
                          return (
                            <option key={dt.TypeOfDocId} value={String(dt.TypeOfDocId)}>
                              {label} — {dt.Description}
                            </option>
                          );
                        })
                      )}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {header.docNoPreview && (
                    <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 tracking-wider whitespace-nowrap">
                      {header.docNoPreview}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Row 1: Company | Project | Fin Year | Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <Field label="Company" required>
                <div className="relative">
                  <select
                    value={header.companyId}
                    onChange={(e) => handleCompanyChange(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">
                      {loadingCompanies ? "Loading…" : "Select company"}
                    </option>
                    {(companies as any[]).map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.label ?? c.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
              </Field>

              <Field label="Project" required>
                <div className="relative">
                  <select
                    value={header.projectId}
                    onChange={(e) => handleProjectChange(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">
                      {loadingProjects
                        ? "Loading…"
                        : header.companyId
                          ? "Select project"
                          : "Select company first"}
                    </option>
                    {filteredProjects.map((p: any) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
              </Field>

              <Field label="Financial Year" required>
                <div className="relative">
                  <select
                    value={header.finYearId}
                    onChange={(e) => setH("finYearId", e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Select fin year</option>
                    {(finYears as any[]).map((fy) => (
                      <option key={fy.id} value={String(fy.id)} disabled={fy.locked}>
                        {fy.year}
                        {fy.locked ? " (locked)" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
              </Field>

              <Field label="Issue Date" required>
                <div className="relative">
                  <CalendarDays
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="date"
                    value={header.date}
                    onChange={(e) => setH("date", e.target.value)}
                    className={`${inputCls} pl-8`}
                  />
                </div>
              </Field>
            </div>

            {/* ── Godown selector — prominent, full-width banner. Only opens
                once Company + Project are both picked, scoped to the godown
                tagged to that exact company + project. ── */}
            <div className="rounded-xl border-2 border-emerald-500/20 bg-gradient-to-r from-emerald-500/[0.05] to-emerald-500/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Warehouse size={16} className="text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold text-foreground">
                  Source Godown
                </span>
                <span className="text-destructive text-sm">*</span>
                <span className="text-xs text-muted-foreground ml-1">
                  {header.companyId && header.projectId
                    ? "Stock will be deducted from this godown"
                    : "Select a company and project to open its godown"}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="flex-1 min-w-0">
                  <div className="relative">
                    <select
                      value={header.godownId}
                      onChange={(e) => handleGodownChange(e.target.value)}
                      disabled={!header.companyId || !header.projectId}
                      className={`${selectCls} border-emerald-500/30 focus:ring-emerald-500/30 disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      <option value="">
                        {!header.companyId || !header.projectId
                          ? "Select company & project first"
                          : loadingGodowns
                            ? "Loading godowns…"
                            : filteredGodowns.length === 0
                              ? "No godown tagged to this company/project"
                              : "Select godown"}
                      </option>
                      {filteredGodowns.map((g) => (
                        <option key={g.id} value={String(g.id)}>
                          {g.name}
                          {g.code ? ` (${g.code})` : ""}
                          {g.isMain ? " · Main" : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                </div>

                {/* Stock summary for selected godown */}
                {selectedGodown && !loadingItems && (
                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-background border border-border">
                      <Layers size={12} className="text-muted-foreground" />
                      <span className="text-muted-foreground">Items:</span>
                      <span className="font-semibold text-foreground">
                        {(itemOptions as any[]).length}
                      </span>
                    </div>
                    {lowStockItems > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                        <AlertTriangle
                          size={12}
                          className="text-amber-600 dark:text-amber-400"
                        />
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          {lowStockItems} out of stock
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Hint: changing godown resets cart */}
              {cart.some((ci) => ci.ItemId) && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                  <AlertTriangle size={10} />
                  Changing the godown will reset all added items
                </p>
              )}
            </div>

            {/* Row 2: Issued To | Cost Center */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Issued To (Contractor)">
                <div className="relative">
                  <User
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <select
                    value={header.issuedTo}
                    onChange={(e) => setH("issuedTo", e.target.value)}
                    className={`${selectCls} pl-9`}
                  >
                    <option value="">— Select contractor —</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={c.label}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </Field>

              <Field label="Cost Center / GL Account">
                <Input
                  value={header.costCenter}
                  onChange={(e) => setH("costCenter", e.target.value)}
                  className="h-9 text-sm"
                  placeholder="Cost centre or GL code…"
                />
              </Field>
            </div>

            {/* Row 3: Reason | Remarks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Reason for Issue" required>
                <Textarea
                  value={header.reason}
                  onChange={(e) => setH("reason", e.target.value)}
                  rows={2}
                  className="resize-none text-sm"
                  placeholder="State the reason for this material issue…"
                />
              </Field>
              <Field label="Remarks">
                <Textarea
                  value={header.remarks}
                  onChange={(e) => setH("remarks", e.target.value)}
                  rows={2}
                  className="resize-none text-sm"
                  placeholder="Optional notes…"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ── Items cart card ── */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShoppingCart size={15} className="text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-base font-semibold">Items</CardTitle>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                {cart.length}
              </span>
              {/* Godown pill — reminds user which godown stock is from */}
              {selectedGodown && (
                <GodownBadge
                  name={selectedGodown.name}
                  code={selectedGodown.code}
                  isMain={selectedGodown.isMain}
                />
              )}
              {hasStockError && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-semibold">
                  <AlertTriangle size={10} /> Stock exceeded
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCartRow}
              disabled={!header.godownId}
              className="gap-1.5 h-8 text-xs"
              title={!header.godownId ? "Select a godown first" : undefined}
            >
              <Plus size={13} /> Add Item
            </Button>
          </CardHeader>

          <CardContent className="p-4 space-y-3">
            {/* Prompt if no godown selected */}
            {!header.godownId && (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                <Warehouse size={32} className="text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Select a source godown above to load available items
                </p>
              </div>
            )}

            {header.godownId && loadingItems && (
              <div className="flex items-center justify-center h-24 gap-2 text-muted-foreground text-sm">
                <RefreshCw size={14} className="animate-spin" />
                Loading stock from {selectedGodown?.name ?? "godown"}…
              </div>
            )}

            {header.godownId &&
              !loadingItems &&
              cart.map((ci, idx) => {
                const availStock = getStockForRow(ci._key, ci.ItemId);
                const reqQty = Number(ci.Quantity) || 0;
                const isOver = reqQty > 0 && reqQty > availStock;
                const uomObj = uomMap[ci.UOMCode];
                const stockPct =
                  availStock > 0
                    ? Math.min((reqQty / availStock) * 100, 100)
                    : 0;

                return (
                  <div
                    key={ci._key}
                    className={`rounded-lg border transition-colors ${
                      isOver
                        ? "border-destructive/50 bg-destructive/5"
                        : "border-border bg-muted/10 hover:bg-muted/20"
                    }`}
                  >
                    {/* Row top: index + item select + remove */}
                    <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                      <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                        {idx + 1}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="relative">
                          <select
                            value={ci.ItemId}
                            onChange={(e) => pickItem(ci._key, e.target.value)}
                            className={`${selectCls} ${isOver ? "border-destructive" : ""}`}
                          >
                            <option value="">
                              {loadingItems ? "Loading…" : "Select item"}
                            </option>
                            {(itemOptions as any[]).length === 0 ? (
                              <option disabled value="">
                                No items found in {selectedGodown?.name ?? "this godown"}
                              </option>
                            ) : (
                              (itemOptions as any[]).map((item) => (
                                <option key={item.M_Id} value={String(item.M_Id)}>
                                  {item.M_Name} — Stock: {Number(item.AvailableStock).toFixed(2)}
                                  {item.M_Group ? ` · ${item.M_Group}` : ""}
                                </option>
                              ))
                            )}
                          </select>
                          <ChevronDown
                            size={13}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeCartRow(ci._key)}
                        disabled={cart.length === 1}
                        title="Remove"
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* Row bottom: UOM + Qty */}
                    <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Unit (UOM) *
                        </label>
                        <div className="relative">
                          <select
                            value={ci.UOMCode}
                            onChange={(e) =>
                              updateCartItem(ci._key, "UOMCode", e.target.value)
                            }
                            className={selectCls}
                          >
                            <option value="">
                              {loadingUoms ? "Loading…" : "Select UOM"}
                            </option>
                            {(uoms as any[]).map((u) => (
                              <option key={u.UOMCode} value={u.UOMCode}>
                                {u.UOMName}
                                {u.Symbol ? ` (${u.Symbol})` : ""}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={13}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Quantity *
                        </label>
                        <div className="relative">
                          <Hash
                            size={12}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                          />
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={ci.Quantity}
                            onChange={(e) =>
                              updateCartItem(
                                ci._key,
                                "Quantity",
                                e.target.value,
                              )
                            }
                            className={`pl-8 h-9 font-mono text-sm ${
                              isOver
                                ? "border-destructive text-destructive focus-visible:ring-destructive"
                                : ""
                            }`}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Stock bar + remarks — only when item selected */}
                    {ci.ItemId && (
                      <div className="border-t border-border/60 mx-3 pt-2.5 pb-3 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <BarChart3 size={10} />
                            Available in{" "}
                            <span className="font-medium text-foreground mx-0.5">
                              {selectedGodown?.name}
                            </span>
                            :{" "}
                            {loadingItems ? (
                              <span className="flex items-center gap-1 text-muted-foreground/70 italic">
                                <RefreshCw size={10} className="animate-spin" />
                                Loading…
                              </span>
                            ) : (
                              <span className="font-semibold text-foreground ml-0.5">
                                {availStock.toFixed(2)}{" "}
                                {uomObj?.Symbol || ci.UOMCode}
                              </span>
                            )}
                          </span>
                          {isOver ? (
                            <span className="flex items-center gap-1 font-semibold text-destructive">
                              <AlertTriangle size={10} /> Exceeds stock
                            </span>
                          ) : reqQty > 0 ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              Remaining: {(availStock - reqQty).toFixed(2)}{" "}
                              {uomObj?.Symbol || ci.UOMCode}
                            </span>
                          ) : null}
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isOver
                                ? "bg-destructive"
                                : stockPct > 80
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            }`}
                            style={{ width: `${isOver ? 100 : stockPct}%` }}
                          />
                        </div>
                        <Input
                          value={ci.Remarks}
                          onChange={(e) =>
                            updateCartItem(ci._key, "Remarks", e.target.value)
                          }
                          placeholder="Line remarks (optional)"
                          className="h-8 text-xs"
                        />
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Footer summary */}
            {header.godownId &&
              !loadingItems &&
              cart.some((ci) => ci.ItemId && ci.Quantity) && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Package size={13} />
                    <span>
                      <span className="font-semibold text-foreground">
                        {cart.filter((ci) => ci.ItemId).length}
                      </span>{" "}
                      item
                      {cart.filter((ci) => ci.ItemId).length !== 1
                        ? "s"
                        : ""} ·{" "}
                      <span className="font-semibold text-foreground font-mono">
                        {totalCartQty.toFixed(2)}
                      </span>{" "}
                      units total
                    </span>
                  </div>
                  {hasStockError ? (
                    <span className="flex items-center gap-1.5 text-destructive font-medium">
                      <AlertTriangle size={13} /> Stock limit exceeded
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 size={13} /> Within stock limits
                    </span>
                  )}
                </div>
              )}
          </CardContent>
        </Card>

        {/* ── Save bar ── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl overflow-hidden">
          <p className="text-[11px] text-muted-foreground hidden sm:block">
            {canSave ? <span className="text-emerald-500 font-medium">Ready to save</span> : !headerIsValid ? !header.godownId ? "Select a source godown" : "Fill in the required fields to save" : "Fix cart errors above"}
          </p>
          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              onClick={resetFields}
              disabled={isSaving || (!header.companyId && !header.projectId && !header.reason.trim() && !header.remarks.trim() && !header.issuedTo && cart.every((ci) => !ci.ItemId && !ci.Quantity))}
              className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={12} /> Reset
            </button>
            <button
              onClick={onSave}
              disabled={!canSave || isSaving || saved}
              className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
            >
              {saved ? <Check size={14} /> : isSaving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
              {saved ? "Saved!" : isSaving ? "Saving…" : editingId ? "Update Issue" : "Save Issue"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── View overlay (portal) ─────────────────────────────────────────────────

  const IssueViewOverlay = () => {
    if (!viewingRecord) return null;
    const items: any[] = viewingRecord.items || [];
    const close = () => setViewingRecord(null);
    const fields = [
      { label: "Doc No", value: viewingRecord.DocNo || viewingRecord.IssueNo, mono: true },
      { label: "Date", value: viewingRecord.Date ? new Date(viewingRecord.Date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
      { label: "Company", value: viewingRecord.CompanyName },
      { label: "Project", value: viewingRecord.ProjectName },
      { label: "Financial Year", value: viewingRecord.FinYearName },
      { label: "Source Godown", value: viewingRecord.GodownName ? `${viewingRecord.GodownName}${viewingRecord.GodownCode ? ` (${viewingRecord.GodownCode})` : ""}` : "—" },
      ...(viewingRecord.IssuedTo ? [{ label: "Issued To", value: viewingRecord.IssuedTo }] : []),
      ...(viewingRecord.CostCenter ? [{ label: "Cost Center", value: viewingRecord.CostCenter }] : []),
    ];

    return createPortal(
      <div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto">

          {/* Header */}
          <div className="sticky top-0 bg-card z-10 border-b border-border">
            <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                    <FileText size={13} className="text-emerald-500" />
                  </div>
                  <h2 className="font-heading font-bold text-sm sm:text-base font-mono truncate max-w-[160px] sm:max-w-none">
                    {viewingRecord.DocNo || viewingRecord.IssueNo || `#${viewingRecord.IssueId}`}
                  </h2>
                  <StatusBadge status={viewingRecord.Status || "Draft"} />
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 ml-9">Material Issue</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => {
                    const rec = viewingRecord;
                    const itms: any[] = rec.items || [];
                    printMasterPreview({
                      title: rec.DocNo || rec.IssueNo || `#${rec.IssueId}`,
                      subtitle: "Material Issue",
                      code: rec.DocNo,
                      status: rec.Status,
                      sections: [
                        {
                          title: "Issue Details",
                          fields: [
                            { label: "Doc No", value: rec.DocNo || rec.IssueNo },
                            { label: "Date", value: rec.Date ? new Date(rec.Date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
                            { label: "Company", value: rec.CompanyName },
                            { label: "Project", value: rec.ProjectName },
                            { label: "Financial Year", value: rec.FinYearName },
                            { label: "Source Godown", value: rec.GodownName },
                            { label: "Issued To", value: rec.IssuedTo },
                            { label: "Cost Center", value: rec.CostCenter },
                            { label: "Reason", value: rec.Reason },
                            { label: "Remarks", value: rec.Remarks },
                          ],
                        },
                        {
                          title: `Issued Items (${itms.length})`,
                          fields: itms.map((it, i) => ({
                            label: `${i + 1}. ${it.ItemName || it.ItemId}`,
                            value: `${Number(it.Quantity).toFixed(2)} ${it.UOMName || it.UOMCode || ""}${it.Remarks ? ` — ${it.Remarks}` : ""}`,
                          })),
                        },
                      ],
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition"
                >
                  <Printer size={13} /><span className="hidden sm:inline">Print</span>
                </button>
                {rights.canEdit && (
                  <button
                    onClick={() => { close(); handleEdit(viewingRecord); }}
                    className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-white text-xs font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 shadow-sm transition"
                  >
                    <Edit3 size={13} /><span className="hidden sm:inline">Edit</span>
                  </button>
                )}
                <button onClick={close} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-5">

            {/* Detail fields */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                <FileText size={10} className="text-emerald-500" /> Issue Details
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {fields.map(({ label, value, mono }: any) => (
                  <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                    <p className={`text-xs font-semibold truncate ${mono ? "font-mono text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{value || "—"}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Reason & Remarks */}
            {(viewingRecord.Reason || viewingRecord.Remarks) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {viewingRecord.Reason && (
                  <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Reason for Issue</p>
                    <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Reason}</p>
                  </div>
                )}
                {viewingRecord.Remarks && (
                  <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Remarks</p>
                    <p className="text-xs text-foreground leading-relaxed">{viewingRecord.Remarks}</p>
                  </div>
                )}
              </div>
            )}

            {/* Items */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                <ShoppingCart size={10} className="text-emerald-500" /> Issued Items
                <span className="ml-1 font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-full border border-border">{items.length}</span>
              </p>
              <div className="rounded-xl border border-border overflow-x-auto">
                <table className="w-full text-xs" style={{ tableLayout: "auto" }}>
                  <thead className="bg-muted/40 border-b border-border">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Item</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">UOM</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Qty</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Balance After</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {items.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No items found</td></tr>
                    ) : items.map((it, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {it.ItemName || it.ItemId}
                          {it.ItemGroup && <span className="text-muted-foreground ml-1">· {it.ItemGroup}</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.UOMName || it.UOMCode || "—"}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">{Number(it.Quantity).toFixed(2)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold hidden sm:table-cell ${Number(it.CurrentBalance) < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {Number(it.CurrentBalance).toFixed(2)} {it.UOMSymbol}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{it.Remarks || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  {items.length > 0 && (
                    <tfoot className="bg-muted/20 border-t border-border">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-muted-foreground">Total</td>
                        <td className="hidden sm:table-cell" />
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {items.reduce((s, it) => s + Number(it.Quantity), 0).toFixed(2)}
                        </td>
                        <td className="hidden sm:table-cell" />
                        <td className="hidden sm:table-cell" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

          </div>
        </div>
      </div>,
      document.body
    );
  };

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
      toast.success(`${rows.length} rows read — full import coming soon`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to parse CSV");
    } finally {
      setImporting(false);
    }
  };

  // ── Page render ───────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Issues"]} />
      <MaterialShell
        title="Material Issues"
        subtitle="Issue materials from godown to projects"
        icon={ArrowDownToLine}
        action={
          viewMode === "list" ? (
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
                <Button
                  onClick={() => {
                    setHeader(defaultHeader);
                    setCart([blankCartItem()]);
                    setEditingId(null);
                    setViewMode("form");
                  }}
                  className="gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 transition-all"
                >
                  <Plus size={15} /> New Issue
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {viewMode === "list" && IssueList()}
        {viewMode === "form" && IssueForm()}
        {IssueViewOverlay()}
      </MaterialShell>
    </>
  );
}
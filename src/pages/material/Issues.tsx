import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import * as issuesApi from "@/api/issuesApi";
import type { IssuePrefill } from "@/api/issuesApi";
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
  PackageMinus,
  Edit3,
  Building2,
  FolderOpen,
  Box,
  Ruler,
  Hash,
  ChevronDown,
  AlertTriangle,
  TrendingDown,
  BarChart3,
  ShoppingCart,
  Package,
  CheckCircle2,
  Calendar,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  DocNumberPreview,
  fetchNextDocNumber,
} from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { useFinYear } from "@/contexts/FinYearContext";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartItem {
  _key: string; // local unique key for React
  ItemId: string;
  UOMCode: string;
  Quantity: string;
  Remarks: string;
  // derived from item master
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
  referenceType: "" | "GRN" | "MR" | "WORK_DONE";
  docTypeId: number | null;
  docNoPreview: string;
  referenceId: string;
  referenceDocNo: string;
  issuedTo: string;
  costCenter: string;
  purpose: string;
}

const defaultHeader: IssueHeader = {
  companyId: "",
  projectId: "",
  finYearId: "",
  date: new Date().toISOString().slice(0, 10),
  reason: "",
  remarks: "",
  referenceType: "",
  docTypeId: null,
  docNoPreview: "",
  referenceId: "",
  referenceDocNo: "",
  issuedTo: "",
  costCenter: "",
  purpose: "",
};

const blankCartItem = (): CartItem => ({
  _key: crypto.randomUUID(),
  ItemId: "",
  UOMCode: "",
  Quantity: "",
  Remarks: "",
});

// ─── Stock badge ──────────────────────────────────────────────────────────────

function StockPill({
  available,
  requested,
  uomSymbol,
}: {
  available: number;
  requested: number;
  uomSymbol?: string;
}) {
  const remaining = available - requested;
  const isOver = remaining < 0;
  const isWarn = remaining >= 0 && remaining < available * 0.1;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BarChart3 size={11} />
        <span>
          Available:{" "}
          <span className="font-semibold text-foreground">
            {available.toFixed(2)} {uomSymbol}
          </span>
        </span>
      </div>
      {requested > 0 && (
        <div
          className={`flex items-center gap-1 text-xs font-semibold ${isOver ? "text-destructive" : isWarn ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
        >
          {isOver ? <AlertTriangle size={11} /> : <TrendingDown size={11} />}
          After: {remaining.toFixed(2)} {uomSymbol}
          {isOver && (
            <span className="ml-1 text-destructive font-bold">
              EXCEEDS STOCK
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

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

const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) => (
  <div>
    <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1">
      {label}
    </p>
    <div className="font-medium text-foreground">{value ?? "—"}</div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

export default function Issues() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"list" | "form" | "view">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 10;

  // Header form
  const [header, setHeader] = useState<IssueHeader>(defaultHeader);
  const { finYears } = useFinYear();
  const activeYear = finYears.find((y) => y.status === "Active") ?? null;
  const finYearStr = activeYear
    ? `${String(activeYear.startDate).slice(2, 4)}-${String(activeYear.endDate).slice(2, 4)}`
    : undefined;
  const [loadingPrefill, setLoadingPrefill] = useState(false);
  // Cart
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

  const { data: itemOptions = [], isLoading: loadingItems } = useQuery({
    queryKey: ["issues-items"],
    queryFn: issuesApi.getItemOptions,
    staleTime: 60_000,
  });

  const { data: uoms = [], isLoading: loadingUoms } = useQuery({
    queryKey: ["issues-uoms"],
    queryFn: async () => {
      const data = await issuesApi.getUomOptions();
      // Normalize IsActive from MSSQL 1/0 (or boolean) to a strict boolean at the boundary.
      return (Array.isArray(data) ? data : [])
        .map((u: any) => ({
          ...u,
          IsActive: u.IsActive === true || u.IsActive === 1,
        }))
        .filter((u: any) => u.IsActive);
    },
    staleTime: 5 * 60_000,
  });

  const { data: issuesData, isLoading: loadingIssues } = useQuery({
    queryKey: ["issues-list", page, search],
    queryFn: () => issuesApi.getIssues({ page, limit, search }),
  });

  // ── Auto-select active fin year ──────────────────────────────────────────

  useEffect(() => {
    if (
      finYears.length > 0 &&
      !header.finYearId &&
      viewMode === "form" &&
      !editingId
    ) {
      const active = (finYears as any[]).find((f) => f.isActive);
      if (active) setH("finYearId", String(active.id));
    }
  }, [finYears, viewMode, editingId]);

  // ── Item lookup helpers ──────────────────────────────────────────────────

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
      // Use DefaultUOM from item master; if absent, fall back to first available UOM
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
              }
            : ci,
        ),
      );
    },
    [itemMap, uoms],
  );

  const addCartRow = () => setCart((p) => [...p, blankCartItem()]);
  const removeCartRow = (key: string) =>
    setCart((p) => (p.length > 1 ? p.filter((i) => i._key !== key) : p));

  // Realtime stock including already-issued qty for other rows in the same item
  const getStockForRow = (cartKey: string, itemId: string): number => {
    const base = Number(itemMap[itemId]?.AvailableStock ?? 0);
    // subtract qty from other cart rows with same item
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
        header.reason.trim(),
      ),
    [header],
  );

  const canSave = headerIsValid && cartIsValid;

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: issuesApi.createIssue,
    onSuccess: (rec: any) => {
      toast.success(`Issue ${rec?.DocNo || rec?.IssueNo || ""} created`);
      queryClient.invalidateQueries({ queryKey: ["issues-list"] });
      queryClient.invalidateQueries({ queryKey: ["issues-items"] });
      goToList();
    },
    onError: (err: any) => toast.error(err.message || "Failed to create issue"),
  });

  const updateMutation = useMutation({
    mutationFn: (p: any) => issuesApi.updateIssue(editingId!, p),
    onSuccess: () => {
      toast.success("Issue updated");
      queryClient.invalidateQueries({ queryKey: ["issues-list"] });
      queryClient.invalidateQueries({ queryKey: ["issues-items"] });
      goToList();
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

  // ── Reference source prefill ─────────────────────────────────────────────

  const handleReferenceTypeChange = (val: string) => {
    const refType = val === "__none__" ? "" : val;
    setH("referenceType", refType as IssueHeader["referenceType"]);
    setH("referenceId", "");
    setH("referenceDocNo", "");
  };

  const handleLoadPrefill = async () => {
    if (!header.referenceType || !header.referenceId) return;
    setLoadingPrefill(true);
    try {
      const prefill: IssuePrefill = await issuesApi.getIssuePrefill(
        header.referenceType as "GRN" | "MR" | "WORK_DONE",
        Number(header.referenceId),
      );
      setH("referenceDocNo", prefill.referenceDocNo);
      if (prefill.companyId) setH("companyId", String(prefill.companyId));
      if (prefill.projectId) setH("projectId", String(prefill.projectId));
      if (prefill.items.length > 0) {
        const newCart: CartItem[] = prefill.items.map((it) => ({
          _key: crypto.randomUUID(),
          ItemId: it.ItemId,
          UOMCode: it.UOMCode,
          Quantity: it.Quantity,
          Remarks: "",
          ItemName: it.ItemName,
          AvailableStock: it.AvailableStock,
        }));
        setCart(newCart);
      }
    } catch (err: any) {
      toast.error("Prefill failed: " + (err?.message ?? "Unknown error"));
    } finally {
      setLoadingPrefill(false);
    }
  };

  // ── Navigation helpers ───────────────────────────────────────────────────

  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setViewingRecord(null);
    setHeader(defaultHeader);
    setCart([blankCartItem()]);
  };

  const handleEdit = (record: any) => {
    setHeader({
      companyId: String(record.CompanyId ?? ""),
      projectId: String(record.ProjectId ?? ""),
      finYearId: String(record.FinYearId ?? ""),
      date: record.Date ? String(record.Date).slice(0, 10) : defaultHeader.date,
      reason: record.Reason ?? "",
      remarks: record.Remarks ?? "",
      referenceType: record.ReferenceType ?? "",
      referenceId: String(record.ReferenceId ?? ""),
      referenceDocNo: record.ReferenceDocNo ?? "",
      docTypeId: record.DocTypeId ?? null,
      docNoPreview: "",
      issuedTo: record.IssuedTo ?? "",
      costCenter: record.CostCenter ?? "",
      purpose: record.Purpose ?? "",
    });
    // Map child items to cart
    const items: CartItem[] = (record.items || []).map((it: any) => ({
      _key: crypto.randomUUID(),
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
    // Fetch full record with items
    try {
      const full = await issuesApi.getIssue(record.IssueId);
      setViewingRecord(full);
    } catch {
      setViewingRecord(record);
    }
    setViewMode("view");
  };

  const onSave = () => {
    if (!canSave) {
      if (!headerIsValid) toast.error("Fill all required header fields");
      else
        toast.error(
          "Each cart item needs item, UOM, and valid quantity ≤ available stock",
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
      ReferenceType: header.referenceType || null,
      ReferenceId: header.referenceId ? Number(header.referenceId) : null,
      ReferenceDocNo: header.referenceDocNo || null,
      DocTypeId: header.docTypeId || null,
      IssuedTo: header.issuedTo || null,
      CostCenter: header.costCenter || null,
      Purpose: header.purpose || null,
      items: cart.map((ci) => ({
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
      cell: ({ row, getValue }) => (
        <span className="font-mono font-bold text-primary text-sm">
          {String(getValue() || row.original.IssueNo || "—")}
        </span>
      ),
    },
    {
      accessorKey: "CompanyName",
      header: "Company",
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
      cell: ({ getValue }) => (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FolderOpen size={12} className="shrink-0" />
          {String(getValue() || "—")}
        </div>
      ),
    },
    {
      accessorKey: "FinYearName",
      header: "Fin Year",
      cell: ({ getValue }) => (
        <span className="text-xs font-medium text-muted-foreground">
          {String(getValue() || "—")}
        </span>
      ),
    },
    {
      accessorKey: "ItemCount",
      header: "Items",
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
      cell: ({ getValue }) => (
        <StatusBadge status={(getValue() as string) || "Draft"} />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleView(row.original)}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="View"
          >
            <Eye size={14} />
          </button>
          <button
            type="button"
            onClick={() => handleEdit(row.original)}
            className="p-1.5 rounded hover:bg-primary/10 text-primary transition-colors"
            title="Edit"
          >
            <Edit3 size={14} />
          </button>
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
            className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
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
                className="pl-9 h-9 text-sm"
              />
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

    return (
      <div className="space-y-5">
        {/* ── Header card ── */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              {editingId ? (
                <Edit3 size={15} className="text-primary" />
              ) : (
                <FileText size={15} className="text-primary" />
              )}
              {editingId ? "Edit Material Issue" : "New Material Issue"}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToList}
              className="h-8 w-8"
            >
              <X size={15} />
            </Button>
          </CardHeader>

          <CardContent className="p-5 space-y-4">
            {/* Doc number / Type of Doc */}
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
              <FileText size={13} className="text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest mr-2 whitespace-nowrap">
                Issue No:
              </span>
              {editingId ? (
                <span className="font-mono font-bold text-primary text-sm">
                  {viewingRecord?.DocNo ?? "Immutable after creation"}
                </span>
              ) : (
                <div className="flex-1">
                  <DocNumberPreview
                    module="ISS"
                    finYear={finYearStr}
                    selectedDocTypeId={header.docTypeId}
                    preview={header.docNoPreview}
                    onSelect={(id, preview) =>
                      setHeader((p) => ({
                        ...p,
                        docTypeId: id,
                        docNoPreview: preview,
                      }))
                    }
                  />
                </div>
              )}
            </div>

            {/* Row 1: Company | Project | Fin Year | Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <Field label="Company" required>
                <Select
                  value={header.companyId}
                  onValueChange={(v) => setH("companyId", v)}
                >
                  <SelectTrigger className="h-9 gap-2">
                    <Building2
                      size={13}
                      className="text-muted-foreground shrink-0"
                    />
                    <SelectValue
                      placeholder={
                        loadingCompanies ? "Loading…" : "Select company"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(companies as any[]).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.label ?? c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Project" required>
                <Select
                  value={header.projectId}
                  onValueChange={(v) => setH("projectId", v)}
                >
                  <SelectTrigger className="h-9 gap-2">
                    <FolderOpen
                      size={13}
                      className="text-muted-foreground shrink-0"
                    />
                    <SelectValue
                      placeholder={
                        loadingProjects ? "Loading…" : "Select project"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects as any[]).map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Financial Year" required>
                <Select
                  value={header.finYearId}
                  onValueChange={(v) => setH("finYearId", v)}
                >
                  <SelectTrigger className="h-9 gap-2">
                    <Calendar
                      size={13}
                      className="text-muted-foreground shrink-0"
                    />
                    <SelectValue placeholder={"Select fin year"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(finYears as any[]).map((fy) => (
                      <SelectItem
                        key={fy.id}
                        value={String(fy.id)}
                        disabled={fy.isLocked}
                      >
                        {fy.name}
                        {fy.isLocked && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (locked)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Issue Date" required>
                <div className="relative">
                  <CalendarDays
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <Input
                    type="date"
                    value={header.date}
                    onChange={(e) => setH("date", e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </Field>
            </div>

            {/* Row 2: Reason | Remarks */}
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

            {/* Row 3: Reference Source */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Reference Source">
                <Select
                  value={header.referenceType || "__none__"}
                  onValueChange={handleReferenceTypeChange}
                >
                  <SelectTrigger className="h-9 gap-2">
                    <FileText
                      size={13}
                      className="text-muted-foreground shrink-0"
                    />
                    <SelectValue placeholder="None (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    <SelectItem value="GRN">
                      GRN (Goods Receipt Note)
                    </SelectItem>
                    <SelectItem value="MR">MR (Material Request)</SelectItem>
                    <SelectItem value="WORK_DONE">Work Done</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {header.referenceType ? (
                <Field
                  label={`${header.referenceType === "GRN" ? "GRN" : header.referenceType === "MR" ? "MR" : "Work Done"} ID / Doc No`}
                >
                  <div className="flex gap-2">
                    <Input
                      value={header.referenceId}
                      onChange={(e) => setH("referenceId", e.target.value)}
                      className="h-9 text-sm font-mono"
                      placeholder="Enter numeric ID…"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 shrink-0"
                      disabled={!header.referenceId || loadingPrefill}
                      onClick={handleLoadPrefill}
                    >
                      {loadingPrefill ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Search size={13} />
                      )}
                      Load
                    </Button>
                  </div>
                  {header.referenceDocNo && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
                      ✓ Loaded: {header.referenceDocNo}
                    </p>
                  )}
                </Field>
              ) : (
                <div />
              )}

              <Field label="Issued To (Dept / Employee / Project)">
                <Input
                  value={header.issuedTo}
                  onChange={(e) => setH("issuedTo", e.target.value)}
                  className="h-9 text-sm"
                  placeholder="Department, employee, or project name…"
                />
              </Field>
            </div>

            {/* Row 4: Cost Center | Purpose */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Cost Center / GL Account">
                <Input
                  value={header.costCenter}
                  onChange={(e) => setH("costCenter", e.target.value)}
                  className="h-9 text-sm"
                  placeholder="Cost centre or GL code…"
                />
              </Field>
              <Field label="Purpose of Consumption">
                <Input
                  value={header.purpose}
                  onChange={(e) => setH("purpose", e.target.value)}
                  className="h-9 text-sm"
                  placeholder="Brief purpose or work order reference…"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ── Cart card ── */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShoppingCart size={15} className="text-primary" />
              <CardTitle className="text-base font-semibold">Items</CardTitle>
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                {cart.length}
              </span>
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
              className="gap-1.5 h-8 text-xs"
            >
              <Plus size={13} /> Add Item
            </Button>
          </CardHeader>

          <CardContent className="p-4 space-y-3">
            {cart.map((ci, idx) => {
              const availStock = getStockForRow(ci._key, ci.ItemId);
              const reqQty = Number(ci.Quantity) || 0;
              const isOver = reqQty > 0 && reqQty > availStock;
              const uomObj = uomMap[ci.UOMCode];
              const stockPct =
                availStock > 0 ? Math.min((reqQty / availStock) * 100, 100) : 0;

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
                      <Select
                        value={ci.ItemId}
                        onValueChange={(v) => pickItem(ci._key, v)}
                      >
                        <SelectTrigger
                          className={`h-9 ${isOver ? "border-destructive" : ""}`}
                        >
                          <div className="flex items-center gap-2 min-w-0 text-sm">
                            <Box
                              size={12}
                              className="text-muted-foreground shrink-0"
                            />
                            <SelectValue
                              placeholder={
                                loadingItems ? "Loading…" : "Select item"
                              }
                            />
                          </div>
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {(itemOptions as any[]).map((item) => (
                            <SelectItem
                              key={item.M_Id}
                              value={String(item.M_Id)}
                            >
                              <div className="flex flex-col">
                                <span>{item.M_Name}</span>
                                <span
                                  className={`text-xs ${Number(item.AvailableStock) <= 0 ? "text-destructive" : "text-muted-foreground"}`}
                                >
                                  Stock:{" "}
                                  {Number(item.AvailableStock).toFixed(2)}
                                  {item.M_Group && ` · ${item.M_Group}`}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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

                  {/* Row bottom: UOM + Qty + stock status */}
                  <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                    {/* UOM */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Unit (UOM) *
                      </label>
                      <Select
                        value={ci.UOMCode}
                        onValueChange={(v) =>
                          updateCartItem(ci._key, "UOMCode", v)
                        }
                      >
                        <SelectTrigger className="h-9">
                          <div className="flex items-center gap-2 min-w-0 text-sm">
                            <Ruler
                              size={12}
                              className="text-muted-foreground shrink-0"
                            />
                            <SelectValue
                              placeholder={
                                loadingUoms ? "Loading…" : "Select UOM"
                              }
                            />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {(uoms as any[]).map((u) => (
                            <SelectItem key={u.UOMCode} value={u.UOMCode}>
                              {u.UOMName}
                              {u.Symbol && (
                                <span className="text-muted-foreground ml-1">
                                  ({u.Symbol})
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Quantity */}
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
                            updateCartItem(ci._key, "Quantity", e.target.value)
                          }
                          className={`pl-8 h-9 font-mono text-sm ${isOver ? "border-destructive text-destructive focus-visible:ring-destructive" : ""}`}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Stock bar + remarks — only when item selected */}
                  {ci.ItemId && (
                    <div className="border-t border-border/60 mx-3 pt-2.5 pb-3 space-y-2">
                      {/* Stock indicator */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <BarChart3 size={10} />
                          Available:{" "}
                          <span className="font-semibold text-foreground ml-0.5">
                            {availStock.toFixed(2)}{" "}
                            {uomObj?.Symbol || ci.UOMCode}
                          </span>
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
                      {/* Progress bar */}
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
                      {/* Remarks */}
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
            {cart.some((ci) => ci.ItemId && ci.Quantity) && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Package size={13} />
                  <span>
                    <span className="font-semibold text-foreground">
                      {cart.filter((ci) => ci.ItemId).length}
                    </span>{" "}
                    item{cart.filter((ci) => ci.ItemId).length !== 1 ? "s" : ""}{" "}
                    ·{" "}
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
        <div className="flex items-center gap-3 pt-1">
          <Button
            variant="outline"
            onClick={goToList}
            disabled={isSaving}
            className="px-6"
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="gradient-accent px-6 gap-2"
          >
            {isSaving ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {isSaving ? "Saving…" : editingId ? "Update Issue" : "Save Issue"}
          </Button>
          {!canSave && (
            <span className="text-xs text-muted-foreground">
              {!headerIsValid
                ? "Fill required header fields"
                : "Fix cart errors above"}
            </span>
          )}
        </div>
      </div>
    );
  };

  // ── View mode ─────────────────────────────────────────────────────────────

  const IssueView = () => {
    if (!viewingRecord) return null;
    const items: any[] = viewingRecord.items || [];

    return (
      <div className="space-y-5">
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText size={15} className="text-primary" />
              Issue —{" "}
              {viewingRecord.DocNo ||
                viewingRecord.IssueNo ||
                `#${viewingRecord.IssueId}`}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleEdit(viewingRecord)}
                className="gap-1.5 h-8"
              >
                <Edit3 size={13} /> Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={goToList}
                className="h-8 w-8"
              >
                <X size={15} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-5">
              <DetailRow
                label="Doc No"
                value={
                  <span className="font-mono font-bold text-primary">
                    {viewingRecord.DocNo || viewingRecord.IssueNo}
                  </span>
                }
              />
              <DetailRow label="Company" value={viewingRecord.CompanyName} />
              <DetailRow label="Project" value={viewingRecord.ProjectName} />
              <DetailRow
                label="Financial Year"
                value={viewingRecord.FinYearName}
              />
              <DetailRow
                label="Date"
                value={
                  viewingRecord.Date
                    ? new Date(viewingRecord.Date).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"
                }
              />
              <DetailRow
                label="Status"
                value={<StatusBadge status={viewingRecord.Status || "Draft"} />}
              />
              {viewingRecord.ReferenceType && (
                <DetailRow
                  label="Reference"
                  value={
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                      {viewingRecord.ReferenceType}:{" "}
                      {viewingRecord.ReferenceDocNo ||
                        viewingRecord.ReferenceId}
                    </span>
                  }
                />
              )}
              {viewingRecord.IssuedTo && (
                <DetailRow label="Issued To" value={viewingRecord.IssuedTo} />
              )}
              {viewingRecord.CostCenter && (
                <DetailRow
                  label="Cost Center"
                  value={viewingRecord.CostCenter}
                />
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
                  Reason for Issue
                </p>
                <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm min-h-[56px]">
                  {viewingRecord.Reason || "—"}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
                  Remarks
                </p>
                <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm min-h-[56px]">
                  {viewingRecord.Remarks || "—"}
                </div>
              </div>
            </div>
            {viewingRecord.Purpose && (
              <div>
                <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
                  Purpose of Consumption
                </p>
                <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm">
                  {viewingRecord.Purpose}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Items table */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border bg-muted/20">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart size={14} className="text-primary" />
              Issued Items
              <Badge variant="secondary" className="text-xs">
                {items.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1.5fr_1.5fr] px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <span>Item</span>
              <span>UOM</span>
              <span>Quantity</span>
              <span>Current Stock</span>
              <span>Remarks</span>
            </div>
            <div className="divide-y divide-border">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No items found
                </div>
              ) : (
                items.map((it, i) => (
                  <div
                    key={i}
                    className="grid md:grid-cols-[2fr_1fr_1fr_1.5fr_1.5fr] gap-3 px-4 py-3 items-center hover:bg-muted/20 transition-colors text-sm"
                  >
                    <div>
                      <span className="font-medium">
                        {it.ItemName || it.ItemId}
                      </span>
                      {it.ItemGroup && (
                        <span className="text-xs text-muted-foreground ml-1">
                          · {it.ItemGroup}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground">
                      {it.UOMName || it.UOMCode}
                    </span>
                    <span className="font-mono font-semibold">
                      {Number(it.Quantity).toFixed(2)}
                    </span>
                    <span
                      className={`font-mono text-xs font-semibold ${Number(it.CurrentBalance) < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                    >
                      {Number(it.CurrentBalance).toFixed(2)} {it.UOMSymbol}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {it.Remarks || "—"}
                    </span>
                  </div>
                ))
              )}
            </div>
            {items.length > 0 && (
              <div className="border-t border-border bg-muted/20 px-4 py-2.5 flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">Total issued:</span>
                <span className="font-bold font-mono">
                  {items
                    .reduce((s, it) => s + Number(it.Quantity), 0)
                    .toFixed(2)}{" "}
                  units
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  // ── Page render ───────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Issues"]} />
      <div className="relative space-y-8 mt-6">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">
            Material Issues
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Issue stock items to projects with real-time availability tracking.
          </p>
        </div>
        {viewMode === "list" && (
          <Button
            onClick={() => setViewMode("form")}
            className="gradient-accent gap-1.5 shrink-0"
          >
            <Plus size={15} /> New Issue
          </Button>
        )}
      </div>

      {viewMode === "list" && IssueList()}
      {viewMode === "form" && IssueForm()}
      {viewMode === "view" && IssueView()}
      </div>{/* end space-y-8 */}
    </>
  );
}
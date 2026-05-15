import React, { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import * as mrApi from "@/api/materialRequestApi";
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
  ClipboardList,
  Edit3,
  Building2,
  FolderOpen,
  Box,
  Ruler,
  Hash,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Send,
  Flag,
  ShoppingCart,
  Package,
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
import { Badge } from "@/components/ui/badge";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CartItem {
  _key: string;
  ItemId: string;
  ItemName?: string;
  UOMCode: string;
  Quantity: string;
  Remarks: string;
  AvailableStock?: number;
  DefaultUOM?: string;
}

interface FormHeader {
  companyId: string;
  projectId: string;
  finYearId: string;
  requestDate: string;
  requiredByDate: string;
  priority: string;
  reason: string;
  remarks: string;
}

const defaultHeader: FormHeader = {
  companyId: "",
  projectId: "",
  finYearId: "",
  requestDate: new Date().toISOString().slice(0, 10),
  requiredByDate: "",
  priority: "Normal",
  reason: "",
  remarks: "",
};

const blankCartItem = (): CartItem => ({
  _key: crypto.randomUUID(),
  ItemId: "",
  UOMCode: "",
  Quantity: "",
  Remarks: "",
});

const PRIORITY_OPTIONS = ["Low", "Normal", "High", "Urgent"];

const PRIORITY_COLOR: Record<string, string> = {
  Low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  Normal: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  High: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Urgent: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// ─── Sub-components ────────────────────────────────────────────────────────────

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

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

// ─── Main component ────────────────────────────────────────────────────────────

export default function MaterialRequest() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"list" | "form" | "view">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 10;

  const [header, setHeader] = useState<FormHeader>(defaultHeader);
  const [cart, setCart] = useState<CartItem[]>([blankCartItem()]);

  const setH = <K extends keyof FormHeader>(k: K, v: FormHeader[K]) =>
    setHeader((p) => ({ ...p, [k]: v }));

  // ── Master data ──────────────────────────────────────────────────────────────

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

  const { data: finYears = [] } = useQuery({
    queryKey: ["mr-finyears"],
    queryFn: mrApi.getMRFinYears,
    staleTime: 5 * 60_000,
  });

  const { data: itemOptions = [] } = useQuery({
    queryKey: ["mr-items"],
    queryFn: mrApi.getMRItemOptions,
    staleTime: 60_000,
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

  const { data: listData, isLoading: loadingList } = useQuery({
    queryKey: ["mr-list", page, search],
    queryFn: () => mrApi.getMaterialRequests({ page, limit, search }),
  });

  const { data: numberPreview } = useQuery({
    queryKey: ["mr-next-number"],
    queryFn: mrApi.previewNextMRNumber,
    enabled: viewMode === "form" && !editingId,
    staleTime: 15_000,
  });

  // ── Auto-select active fin year ──────────────────────────────────────────────

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

  // ── Item & UOM lookup ────────────────────────────────────────────────────────

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

  // ── Cart helpers ─────────────────────────────────────────────────────────────

  const updateCartItem = useCallback(
    <K extends keyof CartItem>(key: string, field: K, value: CartItem[K]) => {
      setCart((prev) =>
        prev.map((ci) => (ci._key === key ? { ...ci, [field]: value } : ci)),
      );
    },
    [],
  );

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
      toast.success(`Material Request ${rec?.DocNo || ""} created`);
      invalidate();
      goToList();
    },
    onError: (err: any) =>
      toast.error(err.message || "Failed to create request"),
  });

  const updateMutation = useMutation({
    mutationFn: (p: any) => mrApi.updateMaterialRequest(editingId!, p),
    onSuccess: () => {
      toast.success("Material Request updated");
      invalidate();
      goToList();
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

  const submitMutation = useMutation({
    mutationFn: mrApi.submitMaterialRequest,
    onSuccess: () => {
      toast.success("Submitted for approval");
      invalidate();
      goToList();
    },
    onError: (err: any) => toast.error(err.message || "Failed to submit"),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Navigation helpers ───────────────────────────────────────────────────────

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
      requestDate: record.RequestDate
        ? String(record.RequestDate).slice(0, 10)
        : defaultHeader.requestDate,
      requiredByDate: record.RequiredByDate
        ? String(record.RequiredByDate).slice(0, 10)
        : "",
      priority: record.Priority ?? "Normal",
      reason: record.Reason ?? "",
      remarks: record.Remarks ?? "",
    });
    const items: CartItem[] = (record.items || []).map((it: any) => ({
      _key: crypto.randomUUID(),
      ItemId: String(it.ItemId ?? ""),
      ItemName: it.ItemName,
      UOMCode: String(it.UOMCode ?? ""),
      Quantity: String(it.Quantity ?? ""),
      Remarks: it.Remarks ?? "",
      AvailableStock: Number(itemMap[it.ItemId]?.AvailableStock ?? 0),
    }));
    setCart(items.length > 0 ? items : [blankCartItem()]);
    setEditingId(record.MRId);
    setViewMode("form");
  };

  const handleView = async (record: any) => {
    try {
      const full = await mrApi.getMaterialRequestById(record.MRId);
      setViewingRecord(full);
    } catch {
      setViewingRecord(record);
    }
    setViewMode("view");
  };

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
      items: cart.map((ci) => ({
        ItemId: ci.ItemId,
        ItemName: ci.ItemName || itemMap[ci.ItemId]?.M_Name || null,
        UOMCode: ci.UOMCode,
        Quantity: Number(ci.Quantity),
        Remarks: ci.Remarks || null,
      })),
    };
    editingId ? updateMutation.mutate(payload) : createMutation.mutate(payload);
  };

  // ── Columns ───────────────────────────────────────────────────────────────────

  const columns: ColumnDef<any, unknown>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      header: "Doc No",
      cell: ({ getValue }) => (
        <span className="font-mono font-bold text-primary text-sm">
          {String(getValue() || "—")}
        </span>
      ),
    },
    {
      id: "Priority",
      accessorKey: "Priority",
      header: "Priority",
      cell: ({ getValue }) => {
        const v = (getValue() as string) || "Normal";
        return (
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[v] ?? PRIORITY_COLOR.Normal}`}
          >
            {v}
          </span>
        );
      },
    },
    {
      id: "CompanyName",
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
      id: "ProjectName",
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
      id: "ItemCount",
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
      id: "RequestDate",
      accessorKey: "RequestDate",
      header: "Requested",
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {fmtDate(getValue() as string)}
        </span>
      ),
    },
    {
      id: "RequiredByDate",
      accessorKey: "RequiredByDate",
      header: "Required By",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        const isUrgent = v && new Date(v) < new Date();
        return (
          <span
            className={`text-sm ${isUrgent ? "text-destructive font-semibold" : "text-muted-foreground"}`}
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
          {row.original.Status === "Draft" && (
            <>
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
                  if (confirm("Delete this material request?"))
                    deleteMutation.mutate(row.original.MRId);
                }}
                className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  // ── List view ─────────────────────────────────────────────────────────────────

  const ListView = () => {
    const totalPages = listData?.totalPages || 1;
    const rows: any[] = listData?.data || [];
    const totalCount = listData?.total || 0;

    return (
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">
                Request Register
              </CardTitle>
              {!loadingList && (
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
                placeholder="Search doc no, company…"
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingList ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <RefreshCw size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <DataTable
                data={rows}
                columns={columns}
                searchable={false}
                paginated={false}
                emptyMessage="No material requests found. Click 'New Request' to create one."
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

  // ── Form view ─────────────────────────────────────────────────────────────────

  const FormView = () => (
    <div className="space-y-5">
      {/* Header card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            {editingId ? (
              <Edit3 size={15} className="text-primary" />
            ) : (
              <FileText size={15} className="text-primary" />
            )}
            {editingId ? "Edit Material Request" : "New Material Request"}
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
          {/* Doc number preview */}
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5">
            <FileText size={13} className="text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest mr-2">
              Request No:
            </span>
            {editingId ? (
              <span className="font-mono font-bold text-primary text-sm">
                {viewingRecord?.DocNo ?? "Immutable after creation"}
              </span>
            ) : numberPreview?.nextDocNo ? (
              <span className="font-mono font-bold text-primary text-sm">
                {numberPreview.nextDocNo}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground/50 italic">
                Auto-generated on save
              </span>
            )}
          </div>

          {/* Row 1: Company | Project | Fin Year | Priority */}
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
                  <SelectValue placeholder="Select company" />
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
                  <SelectValue placeholder="Select project" />
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

            <Field label="Financial Year">
              <Select
                value={header.finYearId}
                onValueChange={(v) => setH("finYearId", v)}
              >
                <SelectTrigger className="h-9 gap-2">
                  <Calendar
                    size={13}
                    className="text-muted-foreground shrink-0"
                  />
                  <SelectValue placeholder="Select fin year" />
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

            <Field label="Priority">
              <Select
                value={header.priority}
                onValueChange={(v) => setH("priority", v)}
              >
                <SelectTrigger className="h-9 gap-2">
                  <Flag size={13} className="text-muted-foreground shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Row 2: Request Date | Required By */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Request Date" required>
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <Input
                  type="date"
                  value={header.requestDate}
                  onChange={(e) => setH("requestDate", e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </Field>
            <Field label="Required By Date">
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <Input
                  type="date"
                  value={header.requiredByDate}
                  onChange={(e) => setH("requiredByDate", e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </Field>
          </div>

          {/* Row 3: Reason | Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Reason for Request" required>
              <Textarea
                value={header.reason}
                onChange={(e) => setH("reason", e.target.value)}
                rows={2}
                className="resize-none text-sm"
                placeholder="State the reason for this material request…"
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

      {/* Items card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="px-6 py-4 border-b border-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <ShoppingCart size={15} className="text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">
                Requested Items
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {cart.length} line item{cart.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCartRow}
            className="gap-2 h-9 px-4"
          >
            <Plus size={13} /> Add Item
          </Button>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          {/* Column headers — visible on md+ */}
          <div className="hidden md:grid md:grid-cols-[2fr_1fr_1fr_auto] gap-4 px-1 pb-1 border-b border-border/50">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Item
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Unit (UOM)
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Quantity
            </span>
            <span className="w-8" />
          </div>

          {cart.map((ci, idx) => (
            <div
              key={ci._key}
              className="group relative rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all duration-150"
            >
              {/* Row number pill */}
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shadow-sm">
                {idx + 1}
              </div>

              <div className="p-4 pl-5">
                {/* Main row: item | uom | qty | remove — all on one line on desktop */}
                <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-start">
                  {/* Item selector */}
                  <div className="space-y-1.5">
                    <label className="md:hidden text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Item *
                    </label>
                    <Select
                      value={ci.ItemId}
                      onValueChange={(v) => pickItem(ci._key, v)}
                    >
                      <SelectTrigger className="h-10">
                        <div className="flex items-center gap-2 min-w-0">
                          <Box
                            size={13}
                            className="text-muted-foreground shrink-0"
                          />
                          <SelectValue placeholder="Select item…" />
                        </div>
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {(itemOptions as any[]).map((item) => (
                          <SelectItem key={item.M_Id} value={String(item.M_Id)}>
                            <div className="flex flex-col py-0.5">
                              <span className="font-medium">{item.M_Name}</span>
                              <span className="text-xs text-muted-foreground">
                                Stock: {Number(item.AvailableStock).toFixed(2)}
                                {item.M_Group && ` · ${item.M_Group}`}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* UOM selector */}
                  <div className="space-y-1.5">
                    <label className="md:hidden text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Unit (UOM) *
                    </label>
                    <Select
                      value={ci.UOMCode}
                      onValueChange={(v) =>
                        updateCartItem(ci._key, "UOMCode", v)
                      }
                    >
                      <SelectTrigger className="h-10">
                        <div className="flex items-center gap-2 min-w-0">
                          <Ruler
                            size={12}
                            className="text-muted-foreground shrink-0"
                          />
                          <SelectValue placeholder="UOM…" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {ci.DefaultUOM && uomMap[ci.DefaultUOM] && (
                          <SelectItem
                            key={"default-" + ci.DefaultUOM}
                            value={ci.DefaultUOM}
                          >
                            <span className="font-medium">
                              {uomMap[ci.DefaultUOM].UOMName}
                            </span>
                            {uomMap[ci.DefaultUOM].Symbol && (
                              <span className="text-muted-foreground ml-1.5 text-xs">
                                {uomMap[ci.DefaultUOM].Symbol} · default
                              </span>
                            )}
                          </SelectItem>
                        )}
                        {(uoms as any[])
                          .filter((u) => u.UOMCode !== ci.DefaultUOM)
                          .map((u) => (
                            <SelectItem key={u.UOMCode} value={u.UOMCode}>
                              {u.UOMName}
                              {u.Symbol && (
                                <span className="text-muted-foreground ml-1.5 text-xs">
                                  {u.Symbol}
                                </span>
                              )}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Quantity */}
                  <div className="space-y-1.5">
                    <label className="md:hidden text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
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
                        className="pl-8 h-10 font-mono"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {/* Remove */}
                  <div className="flex items-start pt-0 md:pt-0">
                    <button
                      type="button"
                      onClick={() => removeCartRow(ci._key)}
                      disabled={cart.length === 1}
                      title="Remove row"
                      className="h-10 w-10 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-25"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* Remarks — always full width below, only shown when item picked */}
                {ci.ItemId && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <Input
                      value={ci.Remarks}
                      onChange={(e) =>
                        updateCartItem(ci._key, "Remarks", e.target.value)
                      }
                      placeholder="Line remarks (optional)"
                      className="h-9 text-sm text-muted-foreground placeholder:text-muted-foreground/50"
                    />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Cart summary */}
          {cart.some((ci) => ci.ItemId && ci.Quantity) && (
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-5 py-3.5 text-sm mt-2">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Package size={14} />
                <span>
                  <span className="font-semibold text-foreground">
                    {cart.filter((ci) => ci.ItemId).length}
                  </span>{" "}
                  item{cart.filter((ci) => ci.ItemId).length !== 1 ? "s" : ""} ·{" "}
                  <span className="font-semibold text-foreground font-mono">
                    {cart
                      .reduce((s, ci) => s + (Number(ci.Quantity) || 0), 0)
                      .toFixed(2)}
                  </span>{" "}
                  units total
                </span>
              </div>
              {cartIsValid ? (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 size={13} /> Ready to save
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-600 font-medium">
                  <AlertTriangle size={13} /> Complete all items
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save bar */}
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
          className="px-6 gap-2"
        >
          {isSaving ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {isSaving ? "Saving…" : editingId ? "Update Request" : "Save Request"}
        </Button>
        {!canSave && (
          <span className="text-xs text-muted-foreground">
            {!headerIsValid
              ? "Fill required header fields"
              : "Complete all cart items"}
          </span>
        )}
      </div>
    </div>
  );

  // ── View mode ─────────────────────────────────────────────────────────────────

  const ViewMode = () => {
    if (!viewingRecord) return null;
    const items: any[] = viewingRecord.items || [];
    const priority = viewingRecord.Priority || "Normal";

    return (
      <div className="space-y-5">
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText size={15} className="text-primary" />
              Request — {viewingRecord.DocNo || `#${viewingRecord.MRId}`}
            </CardTitle>
            <div className="flex items-center gap-2">
              {viewingRecord.Status === "Draft" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(viewingRecord)}
                    className="gap-1.5 h-8"
                  >
                    <Edit3 size={13} /> Edit
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => submitMutation.mutate(viewingRecord.MRId)}
                    disabled={submitMutation.isPending}
                    className="gap-1.5 h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {submitMutation.isPending ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                    Submit
                  </Button>
                </>
              )}
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
                    {viewingRecord.DocNo || "—"}
                  </span>
                }
              />
              <DetailRow
                label="Priority"
                value={
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.Normal}`}
                  >
                    {priority}
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
                label="Request Date"
                value={fmtDate(viewingRecord.RequestDate)}
              />
              <DetailRow
                label="Required By"
                value={fmtDate(viewingRecord.RequiredByDate)}
              />
              <DetailRow
                label="Status"
                value={<StatusBadge status={viewingRecord.Status || "Draft"} />}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
                  Reason for Request
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
          </CardContent>
        </Card>

        {/* Items table */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border bg-muted/20">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart size={14} className="text-primary" />
              Requested Items
              <Badge variant="secondary" className="text-xs">
                {items.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1.5fr] px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <span>Item</span>
              <span>UOM</span>
              <span>Quantity</span>
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
                    className="grid md:grid-cols-[2fr_1fr_1fr_1.5fr] gap-3 px-4 py-3 items-center hover:bg-muted/20 transition-colors text-sm"
                  >
                    <span className="font-medium">
                      {it.ItemName || it.ItemId}
                    </span>
                    <span className="text-muted-foreground">
                      {it.UOMName || it.UOMCode}
                    </span>
                    <span className="font-mono font-semibold">
                      {Number(it.Quantity).toFixed(2)}
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
                <span className="text-muted-foreground">Total requested:</span>
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

  // ── Page render ───────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Material Request"]} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList size={22} className="text-primary" />
            Material Requests
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage material requisitions for projects.
          </p>
        </div>
        {viewMode === "list" && (
          <Button
            onClick={() => setViewMode("form")}
            className="gap-2 shrink-0"
          >
            <Plus size={15} /> New Request
          </Button>
        )}
      </div>

      {viewMode === "list" && <ListView />}
      {viewMode === "form" && <FormView />}
      {viewMode === "view" && <ViewMode />}
    </>
  );
}

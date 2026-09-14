import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import * as qtApi from "@/api/quotationApi";
import * as mrApi from "@/api/materialRequestApi";
import { getSuppliers, getCompanies, getProjects } from "@/api/purchaseOrdersApi";
import { getTCRecords } from "@/api/tcMasterApi";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import {
  CalendarDays,
  FileText,
  Save,
  Search,
  Eye,
  Trash2,
  Edit3,
  ArrowLeft,
  RefreshCw,
  ChevronDown,
  FileSpreadsheet,
  ClipboardList,
  Users,
  Send,
  X,
  Plus,
  Check,
  Package,
  Building2,
  Printer,
} from "lucide-react";
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
import { MaterialShell } from "@/components/material/MaterialShell";
import { usePageRights } from "@/hooks/usePageRights";

// ─── Shared styles ──────────────────────────────────────────────────────────────

const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer";

const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

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

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN");
};

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Date", accessor: (r) => fmtDate(r.DocDate as string) },
  { header: "Suppliers", accessor: (r) => Number(r.SupplierCount) || 0 },
  { header: "Items", accessor: (r) => Number(r.ItemCount) || 0 },
  { header: "Status", accessor: "Status" },
];

const SectionHeader = ({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) => (
  <div className="flex items-center gap-3 pb-3 border-b border-border mb-4">
    <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
      <Icon size={13} className="text-emerald-600 dark:text-emerald-400" />
    </div>
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  </div>
);

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FormHeader {
  companyId: string;
  projectId: string;
  finYearId: string;
  sourceMRId: string;
  sourceMRDocNo: string;
  docDate: string;
  dueDate: string;
  remarks: string;
  docTypeId: number | null;
  docNoPreview: string;
}

const defaultHeader: FormHeader = {
  companyId: "",
  projectId: "",
  finYearId: "",
  sourceMRId: "",
  sourceMRDocNo: "",
  docDate: new Date().toISOString().slice(0, 10),
  dueDate: "",
  remarks: "",
  docTypeId: null,
  docNoPreview: "",
};

// ─── Main component ─────────────────────────────────────────────────────────────

export default function Quotation() {
  const rights = usePageRights("quotation");
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"list" | "form" | "view">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRecord, setViewingRecord] = useState<qtApi.Quotation | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchParams, setSearchParams] = useSearchParams();

  const [header, setHeader] = useState<FormHeader>(defaultHeader);
  const [items, setItems] = useState<qtApi.QuotationLineItem[]>([]);
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [tcIds, setTcIds] = useState<string[]>([]);
  const [tcDropdownOpen, setTcDropdownOpen] = useState(false);
  const [addSupplierId, setAddSupplierId] = useState("");

  const setH = <K extends keyof FormHeader>(k: K, v: FormHeader[K]) =>
    setHeader((p) => ({ ...p, [k]: v }));

  // ── Master data ───────────────────────────────────────────────────────────────

  const { data: companies = [] } = useQuery({
    queryKey: ["qt-companies"],
    queryFn: getCompanies,
    staleTime: 5 * 60_000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["qt-projects"],
    queryFn: getProjects,
    staleTime: 5 * 60_000,
  });

  const filteredProjects = (projects as any[]).filter(
    (p) => !header.companyId || String(p.company_id ?? p.enterprise_id) === String(header.companyId) || !p.company_id,
  );

  const { data: finYears = [] } = useQuery({
    queryKey: ["qt-finyears"],
    queryFn: mrApi.getMRFinYears,
    staleTime: 5 * 60_000,
  });

  const selectedFY = (finYears as any[]).find((fy) => String(fy.id) === String(header.finYearId));
  const finYearStr = selectedFY ? String(selectedFY.name).slice(-5) : undefined;

  const { data: suppliers = [] } = useQuery({
    queryKey: ["qt-suppliers"],
    queryFn: getSuppliers,
    staleTime: 5 * 60_000,
  });

  const { data: tcRecords = [] } = useQuery({
    queryKey: ["qt-tc-records"],
    queryFn: getTCRecords,
    staleTime: 5 * 60_000,
  });

  const { data: approvedMRs = [] } = useQuery({
    queryKey: ["qt-approved-mrs", header.companyId, header.projectId, header.finYearId],
    queryFn: () =>
      mrApi.getApprovedMRList({
        companyId: header.companyId || undefined,
        projectId: header.projectId || undefined,
        finYearId: header.finYearId || undefined,
      }),
    enabled: viewMode === "form",
  });

  const supplierMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const s of suppliers as any[]) m[String(s.LHeadId ?? s.id)] = s;
    return m;
  }, [suppliers]);

  // ── QT doc types ──────────────────────────────────────────────────────────────

  const [qtDocTypes, setQtDocTypes] = useState<DocType[]>([]);
  const [qtDocTypesLoading, setQtDocTypesLoading] = useState(true);

  useEffect(() => {
    setQtDocTypesLoading(true);
    fetchDocTypes("QT")
      .then(setQtDocTypes)
      .finally(() => setQtDocTypesLoading(false));
  }, []);

  useEffect(() => {
    if (qtDocTypesLoading || editingId || viewMode !== "form") return;
    if (qtDocTypes.length === 0) return;
    const firstId = qtDocTypes[0].TypeOfDocId;
    if (!header.docTypeId) {
      fetchNextDocNumber(firstId, finYearStr).then((preview) =>
        setHeader((p) => ({ ...p, docTypeId: firstId, docNoPreview: preview })),
      );
    }
  }, [qtDocTypes, qtDocTypesLoading, viewMode]);

  useEffect(() => {
    if (!header.docTypeId || editingId) return;
    fetchNextDocNumber(header.docTypeId, finYearStr).then((preview) =>
      setHeader((p) => ({ ...p, docNoPreview: preview })),
    );
  }, [header.docTypeId, finYearStr]);

  // ── List ───────────────────────────────────────────────────────────────────────

  const { data: listData = [], isLoading: loadingList } = useQuery({
    queryKey: ["qt-list", statusFilter],
    queryFn: () => qtApi.getQuotations({ status: statusFilter || undefined }),
  });

  const rows = (listData as qtApi.Quotation[]).filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (r.DocNo || "").toLowerCase().includes(s) ||
      (r.CompanyName || "").toLowerCase().includes(s) ||
      (r.ProjectName || "").toLowerCase().includes(s)
    );
  });

  // ── Tag MR ────────────────────────────────────────────────────────────────────

  const tagMR = async (mrId: string) => {
    if (!mrId) {
      setH("sourceMRId", "");
      setH("sourceMRDocNo", "");
      setItems([]);
      return;
    }
    try {
      const prefill = await mrApi.getMRPOPrefill(mrId);
      setH("sourceMRId", String(prefill.MRId));
      setH("sourceMRDocNo", prefill.DocNo);
      setItems(
        prefill.items.map((it) => ({
          MRItemId: it.MRItemId,
          ItemId: it.ItemId,
          ItemName: it.ItemName,
          UOMCode: it.UOMCode,
          UOMName: it.UOMName,
          Quantity: it.Quantity,
          Remarks: it.Remarks,
        })),
      );
      toast.success(`Pulled ${prefill.items.length} item(s) from ${prefill.DocNo}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to load items from that Material Request");
    }
  };

  // ── Supplier tagging ──────────────────────────────────────────────────────────

  const addSupplier = () => {
    if (!addSupplierId) return;
    if (supplierIds.includes(addSupplierId)) {
      toast.error("Supplier already tagged");
      return;
    }
    setSupplierIds((p) => [...p, addSupplierId]);
    setAddSupplierId("");
  };

  const removeSupplier = (id: string) =>
    setSupplierIds((p) => p.filter((s) => s !== id));

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["qt-list"] });

  const buildPayload = (): qtApi.CreateQuotationPayload => ({
    CompanyId: Number(header.companyId) || null,
    ProjectId: Number(header.projectId) || null,
    FinYearId: Number(header.finYearId) || null,
    SourceMRId: Number(header.sourceMRId) || null,
    SourceMRDocNo: header.sourceMRDocNo || null,
    DocDate: header.docDate,
    DueDate: header.dueDate || null,
    Remarks: header.remarks || null,
    TermsConditionIds: tcIds,
    items,
    supplierLHeadIds: supplierIds,
  });

  const createMutation = useMutation({
    mutationFn: qtApi.createQuotation,
    onSuccess: (rec: any) => {
      toast.success(`Quotation ${rec?.DocNo || ""} saved as Draft`);
      invalidate();
      goToList();
    },
    onError: (err: any) => toast.error(err.message || "Failed to create quotation"),
  });

  const updateMutation = useMutation({
    mutationFn: (p: qtApi.CreateQuotationPayload) => qtApi.updateQuotation(editingId!, p),
    onSuccess: () => {
      toast.success("Quotation updated");
      invalidate();
      goToList();
    },
    onError: (err: any) => toast.error(err.message || "Failed to update quotation"),
  });

  const deleteMutation = useMutation({
    mutationFn: qtApi.deleteQuotation,
    onSuccess: () => {
      toast.success("Quotation deleted");
      invalidate();
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete quotation"),
  });

  const sendMutation = useMutation({
    mutationFn: qtApi.sendQuotation,
    onSuccess: async () => {
      toast.success("Quotation sent to tagged suppliers");
      invalidate();
      if (viewingRecord) {
        const full = await qtApi.getQuotationById(viewingRecord.QuotationId);
        setViewingRecord(full);
      }
    },
    onError: (err: any) => toast.error(err.message || "Failed to send quotation"),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Navigation helpers ────────────────────────────────────────────────────────

  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setViewingRecord(null);
    setHeader(defaultHeader);
    setItems([]);
    setSupplierIds([]);
    setTcIds([]);
  };

  const startNew = () => {
    setHeader(defaultHeader);
    setItems([]);
    setSupplierIds([]);
    setTcIds([]);
    setEditingId(null);
    setViewMode("form");
  };

  const handleEdit = (record: qtApi.Quotation) => {
    setHeader({
      companyId: String(record.CompanyId ?? ""),
      projectId: String(record.ProjectId ?? ""),
      finYearId: String(record.FinYearId ?? ""),
      sourceMRId: String(record.SourceMRId ?? ""),
      sourceMRDocNo: record.SourceMRDocNo ?? "",
      docDate: record.DocDate ? String(record.DocDate).slice(0, 10) : defaultHeader.docDate,
      dueDate: record.DueDate ? String(record.DueDate).slice(0, 10) : "",
      remarks: record.Remarks ?? "",
      docTypeId: null,
      docNoPreview: record.DocNo ?? "",
    });
    setItems((record.items || []) as qtApi.QuotationLineItem[]);
    setSupplierIds((record.suppliers || []).map((s) => String(s.SupplierLHeadId)));
    try {
      setTcIds(record.TermsConditionIds ? JSON.parse(record.TermsConditionIds) : []);
    } catch {
      setTcIds([]);
    }
    setEditingId(record.QuotationId);
    setViewMode("form");
  };

  const handleView = async (record: qtApi.Quotation) => {
    try {
      const full = await qtApi.getQuotationById(record.QuotationId);
      setViewingRecord(full);
      setViewMode("view");
    } catch {
      setViewingRecord(record);
      setViewMode("view");
    }
  };

  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    handleView({ QuotationId: Number(viewId) } as qtApi.Quotation);
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerIsValid = useMemo(
    () => Boolean(header.companyId && header.projectId && header.docDate && items.length > 0),
    [header, items],
  );

  const onSave = () => {
    if (!headerIsValid) {
      toast.error("Select company, project, date and tag a Material Request with items");
      return;
    }
    const payload = buildPayload();
    if (editingId) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  // ── Columns ───────────────────────────────────────────────────────────────────

  const columns: ColumnDef<qtApi.Quotation, unknown>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      header: "Doc No",
      cell: ({ getValue }) => (
        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
          {String(getValue() || "—")}
        </span>
      ),
    },
    {
      id: "CompanyName",
      accessorKey: "CompanyName",
      header: "Company",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => <span className="text-sm">{String(getValue() || "—")}</span>,
    },
    {
      id: "ProjectName",
      accessorKey: "ProjectName",
      header: "Project",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">{String(getValue() || "—")}</span>
      ),
    },
    {
      id: "SupplierCount",
      header: "Suppliers",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ row }) => (
        <span className="text-sm">
          <span className="font-semibold">{row.original.SubmittedCount || 0}</span>
          <span className="text-muted-foreground">/{row.original.SupplierCount || 0} quoted</span>
        </span>
      ),
    },
    {
      id: "ItemCount",
      accessorKey: "ItemCount",
      header: "Items",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => (
        <span className="inline-flex items-center gap-1 text-xs font-medium bg-muted px-2 py-0.5 rounded-full">
          {Number(getValue() || 0)}
        </span>
      ),
    },
    {
      id: "DocDate",
      accessorKey: "DocDate",
      header: "Date",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{fmtDate(getValue() as string)}</span>,
    },
    {
      id: "Status",
      accessorKey: "Status",
      header: "Status",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const status = row.original.Status;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => handleView(row.original)}
              className="p-1.5 rounded-md text-sky-500 hover:bg-sky-500/10 transition-colors"
              title="View"
            >
              <Eye size={14} />
            </button>
            {rights.canEdit && status === "Draft" && (
              <button
                type="button"
                onClick={() => handleEdit(row.original)}
                className="p-1.5 rounded-md text-blue-400 hover:bg-blue-400/10 transition-colors"
                title="Edit"
              >
                <Edit3 size={14} />
              </button>
            )}
            {rights.canDelete && (
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm("Delete this quotation?")) deleteMutation.mutate(row.original.QuotationId);
                }}
                className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  // ── List view ──────────────────────────────────────────────────────────────────

  const ListView = () => (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Quotation Register</CardTitle>
              {!loadingList && (
                <p className="text-xs text-muted-foreground mt-0.5">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
              )}
            </div>
            <div className="relative w-full sm:w-64">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search doc no, company…"
                className="pl-9 h-9 text-sm focus-visible:ring-emerald-500/30 focus-visible:ring-offset-0"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {["", "Draft", "Sent", "PartiallyQuoted", "Quoted", "Closed"].map((s) => (
              <button
                key={s || "all"}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  statusFilter === s
                    ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white border-transparent shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:border-emerald-500/40"
                }`}
              >
                {s || "All"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loadingList ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            searchable={false}
            paginated={false}
            emptyMessage="No quotations found. Click 'New Quotation' to create one."
          />
        )}
      </CardContent>
    </Card>
  );

  // ── Form view ──────────────────────────────────────────────────────────────────

  const FormView = () => (
    <div className="space-y-4">
      {/* Page header bar */}
      <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 py-3.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
        <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
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
            <div className="w-6 h-6 rounded-md flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
              <FileSpreadsheet size={12} className="text-emerald-400" />
            </div>
            <h2 className="text-sm font-bold text-foreground truncate">
              {editingId ? "Edit Quotation" : "New Quotation"}
            </h2>
          </div>
        </div>
        {/* Doc number preview */}
        <div className="flex items-center gap-2 shrink-0">
          {editingId ? (
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
              {header.docNoPreview}
            </span>
          ) : (
            <div className="flex items-center gap-2">
              {qtDocTypes.length > 1 && (
                <div className="relative">
                  <select
                    value={header.docTypeId ? String(header.docTypeId) : ""}
                    onChange={async (e) => {
                      const id = e.target.value ? parseInt(e.target.value, 10) : null;
                      if (!id) { setHeader((p) => ({ ...p, docTypeId: null, docNoPreview: "" })); return; }
                      const preview = await fetchNextDocNumber(id, finYearStr);
                      setHeader((p) => ({ ...p, docTypeId: id, docNoPreview: preview }));
                    }}
                    disabled={qtDocTypesLoading}
                    className="text-xs rounded-md border border-border px-2 py-1.5 pr-6 bg-background appearance-none focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                  >
                    {qtDocTypesLoading ? (
                      <option value="">Loading…</option>
                    ) : (
                      qtDocTypes.map((dt) => (
                        <option key={dt.TypeOfDocId} value={String(dt.TypeOfDocId)}>
                          {dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix}
                        </option>
                      ))
                    )}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              )}
              {header.docNoPreview && (
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm tracking-wider">
                  {header.docNoPreview}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main form card */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-6 space-y-6">

          {/* Section 1: Scope */}
          <div>
            <SectionHeader icon={Building2} title="Scope" sub="Company, project and financial year" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Company" required>
                <div className="relative">
                  <select
                    value={header.companyId}
                    onChange={(e) => { setH("companyId", e.target.value); setH("projectId", ""); setH("sourceMRId", ""); setItems([]); }}
                    className={selectCls}
                  >
                    <option value="">Select company</option>
                    {(companies as any[]).map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.label ?? c.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </Field>

              <Field label="Project" required>
                <div className="relative">
                  <select
                    value={header.projectId}
                    onChange={(e) => { setH("projectId", e.target.value); setH("sourceMRId", ""); setItems([]); }}
                    className={selectCls}
                    disabled={!header.companyId}
                  >
                    <option value="">{!header.companyId ? "Select company first" : "Select project"}</option>
                    {filteredProjects.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.label ?? p.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </Field>

              <Field label="Financial Year">
                <div className="relative">
                  <select
                    value={header.finYearId}
                    onChange={(e) => { setH("finYearId", e.target.value); setH("sourceMRId", ""); setItems([]); }}
                    className={selectCls}
                  >
                    <option value="">All years</option>
                    {(finYears as any[]).map((fy) => (
                      <option key={fy.id} value={String(fy.id)}>{fy.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </Field>
            </div>
          </div>

          {/* Section 2: Dates & MR */}
          <div>
            <SectionHeader icon={CalendarDays} title="Timeline & Source" sub="Tag the approved MR and set response deadline" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Tag Material Request" required>
                <div className="relative">
                  <select
                    value={header.sourceMRId}
                    onChange={(e) => tagMR(e.target.value)}
                    className={selectCls}
                    disabled={!header.companyId || !header.projectId}
                  >
                    <option value="">
                      {!header.companyId || !header.projectId ? "Select company & project first" : "Select approved MR…"}
                    </option>
                    {(approvedMRs as any[]).map((mr) => (
                      <option key={mr.MRId} value={String(mr.MRId)}>{mr.DocNo}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </Field>

              <Field label="Quotation Date" required>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input type="date" value={header.docDate} onChange={(e) => setH("docDate", e.target.value)} className={`${inputCls} pl-8`} />
                </div>
              </Field>

              <Field label="Response Due Date">
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input type="date" value={header.dueDate} onChange={(e) => setH("dueDate", e.target.value)} className={`${inputCls} pl-8`} />
                </div>
              </Field>
            </div>
          </div>

          {/* Section 3: Items from MR */}
          <div>
            <SectionHeader
              icon={Package}
              title="Items"
              sub={items.length > 0 ? `${items.length} items from ${header.sourceMRDocNo}` : "Pulled automatically from tagged MR"}
            />
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
                <ClipboardList size={20} className="mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Tag an approved Material Request above to populate items.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      <th className="px-4 py-2.5 w-8">#</th>
                      <th className="px-4 py-2.5">Item</th>
                      <th className="px-4 py-2.5 w-24 text-right">UOM</th>
                      <th className="px-4 py-2.5 w-20 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{idx + 1}</td>
                        <td className="px-4 py-2.5 font-medium">{it.ItemName || it.ItemId}</td>
                        <td className="px-4 py-2.5 text-muted-foreground text-right">{it.UOMName || it.UOMCode}</td>
                        <td className="px-4 py-2.5 font-semibold text-right">{it.Quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 4: Suppliers */}
          <div>
            <SectionHeader icon={Users} title="Suppliers to Quote" sub="Tag every supplier who should receive this RFQ" />
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1 max-w-sm">
                <select value={addSupplierId} onChange={(e) => setAddSupplierId(e.target.value)} className={selectCls}>
                  <option value="">Select a supplier…</option>
                  {(suppliers as any[])
                    .filter((s) => !supplierIds.includes(String(s.LHeadId ?? s.id)))
                    .map((s) => (
                      <option key={s.LHeadId ?? s.id} value={String(s.LHeadId ?? s.id)}>
                        {s.LHeadName ?? s.label ?? s.name}
                      </option>
                    ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addSupplier} disabled={!addSupplierId} className="gap-1.5 shrink-0">
                <Plus size={13} /> Add
              </Button>
            </div>
            {supplierIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suppliers tagged yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {supplierIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    {supplierMap[id]?.LHeadName ?? supplierMap[id]?.label ?? `Supplier #${id}`}
                    <button type="button" onClick={() => removeSupplier(id)} className="hover:text-destructive transition-colors">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Section 5: Terms & Remarks.
              Previously gated on `(tcRecords as any[]).length > 0 || true` —
              the `|| true` already made this always render regardless of
              tcRecords, so the dead check is removed here rather than
              reintroducing conditional hiding, which would change current
              behavior. */}
          <div>
              <SectionHeader icon={FileText} title="Remarks & Terms" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Remarks">
                  <Textarea
                    value={header.remarks}
                    onChange={(e) => setH("remarks", e.target.value)}
                    rows={3}
                    className="resize-none text-sm"
                    placeholder="Optional notes…"
                  />
                </Field>
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                      <ClipboardList size={11} className="text-emerald-600 dark:text-emerald-400" />
                      Terms &amp; Conditions
                    </h3>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setTcDropdownOpen((o) => !o)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted transition-colors"
                      >
                        <Plus size={13} /> Add T&amp;C
                      </button>
                      {tcDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setTcDropdownOpen(false)} />
                          <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                            <div className="px-3 py-2 border-b border-border">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Select Terms &amp; Conditions</p>
                            </div>
                            <div className="max-h-56 overflow-y-auto divide-y divide-border">
                              {(tcRecords as any[]).length === 0 ? (
                                <p className="px-4 py-6 text-xs text-center text-muted-foreground">No T&amp;C records found</p>
                              ) : (
                                (tcRecords as any[]).map((tc) => {
                                  const isSelected = tcIds.includes(String(tc.Id));
                                  return (
                                    <button
                                      key={tc.Id}
                                      type="button"
                                      onClick={() => setTcIds((p) => isSelected ? p.filter((id) => id !== String(tc.Id)) : [...p, String(tc.Id)])}
                                      className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-muted/40 transition ${isSelected ? "bg-emerald-500/[0.05]" : ""}`}
                                    >
                                      <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${isSelected ? "bg-emerald-500 border-emerald-500" : "border-border"}`}>
                                        {isSelected && <Check size={10} className="text-primary-foreground" />}
                                      </span>
                                      <span className="block text-sm font-medium text-foreground truncate">{tc.Name}</span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                            <div className="px-3 py-2 border-t border-border">
                              <button type="button" onClick={() => setTcDropdownOpen(false)} className="w-full text-xs text-center text-muted-foreground hover:text-foreground transition py-1">Done</button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {tcIds.length > 0 ? (
                    <div className="space-y-2">
                      {(tcRecords as any[]).filter((tc) => tcIds.includes(String(tc.Id))).map((tc, idx) => (
                        <div key={tc.Id} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center mt-0.5">{idx + 1}</span>
                          <p className="flex-1 text-sm font-semibold text-foreground min-w-0 truncate">{tc.Name}</p>
                          <button
                            type="button"
                            onClick={() => setTcIds((p) => p.filter((id) => id !== String(tc.Id)))}
                            className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 transition"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-4 text-muted-foreground text-xs">
                      <ClipboardList size={14} className="opacity-40" />
                      <span>No terms selected — click <strong>+ Add T&amp;C</strong> to add from master</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={goToList}>Cancel</Button>
        <Button type="button" onClick={onSave} disabled={isSaving || !headerIsValid} className="gap-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white hover:opacity-90 border-0 disabled:opacity-40">
          <Save size={14} /> {isSaving ? "Saving…" : "Save as Draft"}
        </Button>
      </div>
    </div>
  );

  // ── Print helper ──────────────────────────────────────────────────────────────

  const handlePrint = (r: qtApi.Quotation) => {
    const printItems = (r.items || []) as any[];
    const printSuppliers = (r.suppliers || []) as any[];
    const esc = (v: unknown) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Quotation ${esc(r.DocNo)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:24px}
  h1{font-size:18px;font-weight:700;margin-bottom:4px}
  .sub{color:#555;font-size:11px;margin-bottom:20px}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;border:1px solid #ddd;border-radius:6px;padding:12px}
  .meta-item label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#777;display:block;margin-bottom:2px}
  .meta-item span{font-weight:600}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#f4f4f4;font-size:9px;text-transform:uppercase;letter-spacing:.08em;padding:6px 10px;text-align:left;border-bottom:2px solid #ddd}
  td{padding:6px 10px;border-bottom:1px solid #eee}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;color:#333}
  @media print{body{padding:0}}
</style></head><body>
<h1>Request for Quotation</h1>
<div class="sub">${esc(r.DocNo)} &nbsp;·&nbsp; ${esc(r.Status)}</div>
<div class="meta">
  <div class="meta-item"><label>Company</label><span>${esc(r.CompanyName || "—")}</span></div>
  <div class="meta-item"><label>Project</label><span>${esc(r.ProjectName || "—")}</span></div>
  <div class="meta-item"><label>Date</label><span>${esc(fmtDate(r.DocDate))}</span></div>
  <div class="meta-item"><label>Source MR</label><span>${esc(r.SourceMRDocNo || "—")}</span></div>
</div>
<div class="section-title">Items</div>
<table><thead><tr><th>#</th><th>Item</th><th>UOM</th><th>Qty</th></tr></thead><tbody>
${printItems.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.ItemName || it.ItemId)}</td><td>${esc(it.UOMName || it.UOMCode || "")}</td><td>${esc(it.Quantity)}</td></tr>`).join("")}
</tbody></table>
<div class="section-title">Suppliers</div>
<table><thead><tr><th>Supplier</th><th>Status</th><th>Invited</th></tr></thead><tbody>
${printSuppliers.map(s => `<tr><td>${esc(s.SupplierName)}</td><td>${esc(s.Status)}</td><td>${esc(fmtDate(s.InvitedAt))}</td></tr>`).join("")}
</tbody></table>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) { toast.error("Pop-up blocked — allow pop-ups and try again"); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  // ── View mode ──────────────────────────────────────────────────────────────────

  const ViewMode = () => {
    if (!viewingRecord) return null;
    const r = viewingRecord;
    return (
      <div className="space-y-4">
        {/* View header */}
        <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 py-3.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
          <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
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
            <span className="font-mono font-bold text-foreground text-sm">{r.DocNo}</span>
            <StatusBadge status={r.Status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handlePrint(r)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Print"
            >
              <Printer size={13} /> <span className="hidden sm:inline">Print</span>
            </button>
            {rights.canDelete && r.Status === "Draft" && (
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm(`Delete quotation ${r.DocNo}?`)) {
                    deleteMutation.mutate(r.QuotationId, { onSuccess: goToList });
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                title="Delete"
              >
                <Trash2 size={13} /> <span className="hidden sm:inline">Delete</span>
              </button>
            )}
            {rights.canEdit && r.Status === "Draft" && (
              <Button type="button" size="sm" onClick={() => sendMutation.mutate(r.QuotationId)} disabled={sendMutation.isPending} className="gap-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white hover:opacity-90 border-0">
                <Send size={13} /> Send to Suppliers
              </Button>
            )}
          </div>
        </div>

        {/* Meta grid */}
        <Card className="border-border shadow-sm">
          <CardContent className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-5">
            {[
              { label: "Company", value: r.CompanyName },
              { label: "Project", value: r.ProjectName },
              { label: "Date", value: fmtDate(r.DocDate) },
              { label: "Source MR", value: r.SourceMRDocNo },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">{label}</p>
                <p className="text-sm font-medium">{value || "—"}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="border-border shadow-sm">
          <CardHeader className="px-5 py-3.5 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package size={14} className="text-emerald-500" /> Items
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <th className="px-5 py-2.5 w-8">#</th>
                  <th className="px-5 py-2.5">Item</th>
                  <th className="px-5 py-2.5 text-right">UOM</th>
                  <th className="px-5 py-2.5 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {(r.items || []).map((it: any, idx: number) => (
                  <tr key={idx} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-2.5 text-muted-foreground text-xs">{idx + 1}</td>
                    <td className="px-5 py-2.5 font-medium">{it.ItemName || it.ItemId}</td>
                    <td className="px-5 py-2.5 text-muted-foreground text-right">{it.UOMName || it.UOMCode}</td>
                    <td className="px-5 py-2.5 font-semibold text-right">{it.Quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Suppliers */}
        <Card className="border-border shadow-sm">
          <CardHeader className="px-5 py-3.5 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users size={14} className="text-emerald-500" /> Suppliers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(!r.suppliers || r.suppliers.length === 0) ? (
              <p className="text-sm text-muted-foreground p-5 text-center">No suppliers tagged.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    <th className="px-5 py-2.5">Supplier</th>
                    <th className="px-5 py-2.5">Status</th>
                    <th className="px-5 py-2.5">Invited</th>
                  </tr>
                </thead>
                <tbody>
                  {r.suppliers.map((s) => (
                    <tr key={s.Id} className="border-b border-border/50 last:border-0">
                      <td className="px-5 py-2.5 font-medium">{s.SupplierName}</td>
                      <td className="px-5 py-2.5">
                        <StatusBadge status={s.Status} />
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground">{fmtDate(s.InvitedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <MaterialShell
      title="Quotation"
      subtitle="Request and compare supplier quotes against a tagged Material Request"
      icon={FileSpreadsheet}
      action={
        viewMode === "list" ? (
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              data={rows as unknown as Record<string, unknown>[]}
              columns={EXPORT_COLUMNS}
              title="Quotations"
              filename="quotations"
              disabled={loadingList || !rows.length || !rights.canExport}
            />
            {rights.canCreate && (
              <button
                type="button"
                onClick={startNew}
                className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 transition-all"
              >
                <Plus size={13} />
                New Quotation
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Material", path: "/material" }, { label: "Quotation" }]} />
      {viewMode === "list" && <ListView />}
      {viewMode === "form" && <FormView />}
      {viewMode === "view" && <ViewMode />}
    </MaterialShell>
  );
}

// Everything the Quotation page holds: master data, the list query, the form state,
// the mutations, the register columns and the print helper. The page and its parts
// read from this one object.
import * as qtApi from "@/api/quotationApi";
import * as mrApi from "@/api/materialRequestApi";
import { useEffect, useMemo, useState } from "react";
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSuppliers, getCompanies, getProjects } from "@/api/purchaseOrdersApi";
import { getTCRecords } from "@/api/tcMasterApi";
import { printStatusLabel } from "@/utils/printStatus";
import { Eye, Trash2, Edit3 } from "lucide-react";
import { type ColumnDef } from "@/components/ui/DataTable";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";
import { fetchNextDocNumber, fetchDocTypes, type DocType } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { usePageRights } from "@/hooks/usePageRights";
import { fmtDate, FormHeader, defaultHeader, ACT, spaced } from "./config";

export function useQuotation() {
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
    (p) => !header.companyId || projectBelongsToCompany(p, header.companyId) || String(p.enterprise_id) === String(header.companyId) || !p.company_id,
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
    if (editingId != null) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  // ── Columns ───────────────────────────────────────────────────────────────────

  const columns: ColumnDef<qtApi.Quotation, unknown>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      header: "Doc No",
      cell: ({ getValue }) => (
        <span className="font-heading font-semibold tracking-wide text-foreground text-sm">
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
          <span className="font-heading font-semibold tabular-nums">{row.original.SubmittedCount || 0}</span>
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
        <span className="font-heading text-xs font-semibold tabular-nums">
          {Number(getValue() || 0)}
        </span>
      ),
    },
    {
      id: "DocDate",
      accessorKey: "DocDate",
      header: "Date",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => <span className="text-sm text-muted-foreground tabular-nums">{fmtDate(getValue() as string)}</span>,
    },
    {
      id: "Status",
      accessorKey: "Status",
      header: "Status",
      meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => {
        const s = (getValue() as string) || "Draft";
        return <SheetMark text={spaced(printStatusLabel(s))} tone={statusTone(s)} />;
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const status = row.original.Status;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <button data-row-view
              type="button"
              onClick={() => handleView(row.original)}
              className={`${ACT} hover:text-foreground hover:border-foreground`}
              title="View"
              aria-label="View"
            >
              <Eye size={14} />
            </button>
            {rights.canEdit && status === "Draft" && (
              <button
                type="button"
                onClick={() => handleEdit(row.original)}
                className={`${ACT} hover:text-foreground hover:border-foreground`}
                title="Edit"
                aria-label="Edit"
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
                className={`${ACT} hover:text-destructive hover:border-destructive`}
                title="Delete"
                aria-label="Delete"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

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
<div class="sub">${esc(r.DocNo)} &nbsp;·&nbsp; ${esc(printStatusLabel(r.Status))}</div>
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

  return {
    rights,
    queryClient,
    viewMode,
    setViewMode,
    editingId,
    setEditingId,
    viewingRecord,
    setViewingRecord,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    searchParams,
    setSearchParams,
    header,
    setHeader,
    items,
    setItems,
    supplierIds,
    setSupplierIds,
    tcIds,
    setTcIds,
    tcDropdownOpen,
    setTcDropdownOpen,
    addSupplierId,
    setAddSupplierId,
    setH,
    companies,
    projects,
    filteredProjects,
    finYears,
    selectedFY,
    finYearStr,
    suppliers,
    tcRecords,
    approvedMRs,
    supplierMap,
    qtDocTypes,
    setQtDocTypes,
    qtDocTypesLoading,
    setQtDocTypesLoading,
    listData,
    loadingList,
    rows,
    tagMR,
    addSupplier,
    removeSupplier,
    invalidate,
    buildPayload,
    createMutation,
    updateMutation,
    deleteMutation,
    sendMutation,
    isSaving,
    goToList,
    startNew,
    handleEdit,
    handleView,
    headerIsValid,
    onSave,
    columns,
    handlePrint,
  };
}

export type QtState = ReturnType<typeof useQuotation>;

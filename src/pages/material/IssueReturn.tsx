import React, { useState, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell, MaterialGlassCard } from "@/components/material/MaterialShell";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Textarea } from "@/components/ui/textarea";
import { usePageRights } from "@/hooks/usePageRights";
import { useTheme } from "@/contexts/ThemeContext";
import {
  CalendarDays, FileText, Save, Search, Trash2, Plus, RefreshCw,
  X, Edit3, Building2, FolderOpen, RotateCcw, ArrowLeft, Package,
  CheckCircle2, Eye, ChevronDown, ClipboardList, RotateCw,
  AlertCircle, Hash, TrendingDown, Download, Upload, Loader2,
} from "lucide-react";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { ExportMenu } from "@/components/ExportMenu";
import { format } from "date-fns";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/material-issue-returns";

const ISSUE_RETURN_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "Return Date", accessor: (r) => r.ReturnDate ? new Date(r.ReturnDate as string).toLocaleDateString("en-IN") : "" },
  { header: "Issue Doc No", accessor: "IssueDocNo" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Status", accessor: "Status" },
];


const inp =
  "w-full text-sm rounded-xl border border-border px-3 py-2.5 bg-muted text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition";
const sel =
  "w-full text-sm rounded-xl border border-border px-3 py-2.5 bg-muted text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

interface ReturnRow {
  ReturnId: number;
  DocNo: string;
  ReturnDate: string;
  Status: string;
  IssueDocNo: string | null;
  Reason: string | null;
  CompanyName: string | null;
  ProjectName: string | null;
  CreatedAt: string;
}
interface IssueOption { IssueId: number; DocNo: string; IssueDate: string; }
interface IssueItem { ItemId: number; M_Id: string; ItemName: string; Quantity: number; UOMSymbol: string | null; }
interface ReturnItem { origIssueItemId: number | null; M_Id: string; ItemName: string; Quantity: number; UOMSymbol: string; maxQty?: number; }
interface FormState { ReturnDate: string; IssueId: string; CompanyId: string; ProjectId: string; Reason: string; Remarks: string; items: ReturnItem[]; }

// ─── Template columns ─────────────────────────────────────────────────────────
const ISSUE_RETURN_TEMPLATE_COLUMNS = [
  { header: "Return Date (YYYY-MM-DD)", accessor: "Return Date (YYYY-MM-DD)" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "Issue Reference", accessor: "Issue Reference" },
  { header: "Reason", accessor: "Reason" },
  { header: "Remarks", accessor: "Remarks" },
  { header: "Item Name", accessor: "Item Name" },
  { header: "UOM", accessor: "UOM" },
  { header: "Quantity", accessor: "Quantity" },
];

const today = new Date().toISOString().split("T")[0];
const emptyForm = (): FormState =>({ ReturnDate: today, IssueId: "", CompanyId: "", ProjectId: "", Reason: "", Remarks: "", items: [] });

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(url, opts);
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as any).error || res.statusText); }
  return res.json().catch(() => ({}));
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

export default function IssueReturn() {
  const qc = useQueryClient();
  const rights = usePageRights("material-issue-return");
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<"list" | "form" | "detail">("list");
  const [editId, setEditId] = useState<number | null>(null);
  const [detailRecord, setDetailRecord] = useState<any | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading: loading } = useQuery<ReturnRow[]>({
    queryKey: ["issue-returns"],
    queryFn: () => apiFetch<ReturnRow[]>(API),
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["issue-return-companies"],
    queryFn: () => apiFetch<any[]>("/api/enterprises/options?business_type=C"),
  });

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["issue-return-projects"],
    queryFn: () => apiFetch<any[]>("/api/enterprises/options?business_type=P"),
  });

  const { data: issues = [] } = useQuery<IssueOption[]>({
    queryKey: ["issue-return-issues", form.CompanyId, form.ProjectId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (form.CompanyId) p.set("companyId", form.CompanyId);
      if (form.ProjectId) p.set("projectId", form.ProjectId);
      return apiFetch<IssueOption[]>(`${API}/issues?${p}`);
    },
    enabled: view === "form",
  });

  const { data: issueItems = [] } = useQuery<IssueItem[]>({
    queryKey: ["issue-return-items", form.IssueId],
    queryFn: () => apiFetch<IssueItem[]>(`${API}/issues/${form.IssueId}/items`),
    enabled: !!form.IssueId,
  });

  const saveMut = useMutation({
    mutationFn: (payload: any) =>
      editId
        ? apiFetch(`${API}/${editId}`, { method: "PUT", body: JSON.stringify(payload) })
        : apiFetch(API, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["issue-returns"] }); toast.success(editId ? "Updated" : "Created"); setView("list"); setEditId(null); setForm(emptyForm()); },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitMut = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}/submit`, { method: "PUT" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["issue-returns"] }); toast.success("Submitted for approval"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMut = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}/approve`, { method: "PUT" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["issue-returns"] }); toast.success("Approved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}/reject`, { method: "PUT" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["issue-returns"] }); toast.success("Rejected"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["issue-returns"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredProjects = useMemo(
    () => form.CompanyId ? (projects as any[]).filter((p: any) => Number(p.company_id) === Number(form.CompanyId)) : projects,
    [projects, form.CompanyId]
  );

  const loadIssueItems = useCallback(() => {
    if (!issueItems.length) return;
    setForm((f) => ({
      ...f,
      items: issueItems.map((ii) => ({ origIssueItemId: ii.ItemId, M_Id: ii.M_Id, ItemName: ii.ItemName, Quantity: ii.Quantity, UOMSymbol: ii.UOMSymbol || "", maxQty: ii.Quantity })),
    }));
  }, [issueItems]);

  // Auto-load items when issue is selected (skip when editing an existing return)
  React.useEffect(() => {
    if (!editId && issueItems.length > 0) loadIssueItems();
  }, [issueItems, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setItemQty = (idx: number, qty: number) =>
    setForm((f) => { const items = [...f.items]; items[idx] = { ...items[idx], Quantity: qty }; return { ...f, items }; });
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const openNew = () => { setEditId(null); setForm(emptyForm()); setView("form"); };
  const openEdit = async (row: ReturnRow) => {
    const rec = await apiFetch<any>(`${API}/${row.ReturnId}`);
    setEditId(rec.ReturnId);
    setForm({ ReturnDate: rec.ReturnDate?.split("T")[0] || today, IssueId: String(rec.IssueId || ""), CompanyId: String(rec.CompanyId || ""), ProjectId: String(rec.ProjectId || ""), Reason: rec.Reason || "", Remarks: rec.Remarks || "", items: (rec.items || []).map((i: any) => ({ origIssueItemId: i.OrigIssueItemId, M_Id: i.M_Id || "", ItemName: i.ItemName || "", Quantity: i.Quantity, UOMSymbol: i.UOMSymbol || "" })) });
    setView("form");
  };
  const openDetail = async (row: ReturnRow) => { const rec = await apiFetch<any>(`${API}/${row.ReturnId}`); setDetailRecord(rec); setView("detail"); };

  const handleSave = () => {
    if (!form.ReturnDate) return void toast.error("Return date is required");
    if (!form.items.length) return void toast.error("Add at least one item");
    const overMax = form.items.find(i => i.maxQty != null && i.Quantity > i.maxQty);
    if (overMax) return void toast.error(`Return qty for "${overMax.ItemName}" exceeds issued quantity`);
    if (!form.items.some(i => i.Quantity > 0)) return void toast.error("All items have zero quantity");
    saveMut.mutate({ ...form });
  };

  // Stats
  const stats = useMemo(() => ({
    total: rows.length,
    draft: rows.filter(r => r.Status === "Draft").length,
    pending: rows.filter(r => r.Status === "Pending").length,
    approved: rows.filter(r => r.Status === "Approved").length,
  }), [rows]);

  const columns: ColumnDef<ReturnRow>[] = [
    {
      accessorKey: "DocNo", header: "Doc No", size: 400,
      cell: ({ getValue }) => <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 font-semibold">{getValue() as string}</span>,
    },
    {
      accessorKey: "ReturnDate", header: "Date", size: 90, meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => { const v = getValue() as string; return <span className="text-xs text-muted-foreground">{v ? format(new Date(v), "dd/MM/yy") : "—"}</span>; },
    },
    {
      accessorKey: "IssueDocNo", header: "Issue Ref", size: 120, meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{(getValue() as string) || "—"}</span>,
    },
    {
      id: "CompanyProject", header: "Company / Project", size: 200, meta: { className: "hidden sm:table-cell" },
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium truncate">{row.original.CompanyName || "—"}</span>
          <span className="text-[10px] text-muted-foreground truncate">{row.original.ProjectName || "—"}</span>
        </div>
      ),
    },
    {
      accessorKey: "Status", header: "Status", size: 100, meta: { className: "hidden sm:table-cell" },
      cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
    },
    {
      id: "actions", header: () => <div className="text-right">Actions</div>, size: 140, enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center justify-end gap-1">
          <button className="p-1.5 rounded-lg text-sky-500 hover:bg-sky-500/10 transition-colors" title="View" onClick={() => openDetail(r)}><Eye size={14} /></button>
          {(r.Status === "Draft" || r.Status === "Approved") && rights.canEdit && <button className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors" title="Edit" onClick={() => openEdit(r)}><Edit3 size={14} /></button>}
          {r.Status === "Draft" && rights.canEdit && (
            <button className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="Submit for approval" onClick={() => submitMut.mutate(r.ReturnId)}>
              <CheckCircle2 size={14} />
            </button>
          )}
          {r.Status === "Pending" && rights.canEdit && (
            <>
              <button className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="Approve" onClick={() => approveMut.mutate(r.ReturnId)}><CheckCircle2 size={14} /></button>
              <button className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors" title="Reject" onClick={() => rejectMut.mutate(r.ReturnId)}><X size={14} /></button>
            </>
          )}
          {["Draft", "Rejected"].includes(r.Status) && rights.canDelete && (
            <button className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors" title="Delete" onClick={() => { if (confirm("Delete this return?")) deleteMut.mutate(r.ReturnId); }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const filtered = useMemo(
    () => rows.filter((r) => !search || r.DocNo.toLowerCase().includes(search.toLowerCase()) || (r.IssueDocNo || "").toLowerCase().includes(search.toLowerCase()) || (r.CompanyName || "").toLowerCase().includes(search.toLowerCase()) || (r.ProjectName || "").toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const glassSection = {
    background: isDark ? "rgba(10,18,15,0.45)" : "rgba(255,255,255,0.72)",
    border: `1px solid ${isDark ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.18)"}`,
    backdropFilter: "blur(16px) saturate(160%)",
    WebkitBackdropFilter: "blur(16px) saturate(160%)",
    boxShadow: isDark ? "0 4px 24px rgba(0,0,0,0.25)" : "0 4px 24px rgba(16,185,129,0.07)",
  };

  return (
    <MaterialShell title="Issue Return" subtitle="Return materials from projects back to godown" icon={RotateCw}>
      <Breadcrumbs items={[{ label: "Material", path: "/material" }, { label: "Issue Return" }]} />

      <AnimatePresence mode="wait">

        {/* ── LIST ────────────────────────────────────────────────────────── */}
        {view === "list" && (
          <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }} className="space-y-5">

            {/* Stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MaterialGlassCard label="Total Returns" value={stats.total} icon={ClipboardList} accentColor="#10b981" />
              <MaterialGlassCard label="Draft" value={stats.draft} icon={FileText} accentColor="#f59e0b" />
              <MaterialGlassCard label="Pending" value={stats.pending} icon={AlertCircle} accentColor="#3b82f6" />
              <MaterialGlassCard label="Approved" value={stats.approved} icon={CheckCircle2} accentColor="#22c55e" />
            </div>

            {/* Table card */}
            <div className="rounded-2xl overflow-hidden" style={glassSection}>
              {/* Toolbar */}
              <div className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-heading font-bold text-foreground">Issue Returns Register</h2>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="text" placeholder="Search doc, project…" value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 rounded-xl text-xs bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 w-44"
                    />
                  </div>
                  <ExportMenu
                    data={rows as unknown as Record<string, unknown>[]}
                    columns={ISSUE_RETURN_EXPORT_COLUMNS}
                    title="Issue Returns"
                    filename="issue-returns"
                    disabled={!rows.length || !rights.canExport}
                  />
                  <button
                    onClick={() => qc.invalidateQueries({ queryKey: ["issue-returns"] })}
                    className="p-1.5 rounded-xl border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <input ref={importFileInputRef} type="file" accept=".csv" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    e.target.value = "";
                    setImporting(true);
                    try {
                      const text = await file.text();
                      const parsedRows = parseCsv(text);
                      if (!parsedRows.length) { toast.error("CSV is empty"); return; }
                      toast.success(`${parsedRows.length} rows read — full import coming soon`);
                    } catch (err: any) {
                      toast.error(err?.message || "Failed to parse CSV");
                    } finally {
                      setImporting(false);
                    }
                  }} className="hidden" />
                  <button
                    onClick={() => exportToCsv([], ISSUE_RETURN_TEMPLATE_COLUMNS, "issue-return-template")}
                    title="Download a blank CSV template"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                  >
                    <Download size={13} />
                    <span className="hidden sm:inline">Download Template</span>
                  </button>
                  <button
                    onClick={() => importFileInputRef.current?.click()}
                    disabled={importing}
                    title="Import from CSV"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    <span className="hidden sm:inline">{importing ? "Importing..." : "Import CSV"}</span>
                  </button>
                  {rights.canCreate && (
                    <button
                      onClick={openNew}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 transition shadow-sm shadow-emerald-500/20"
                    >
                      <Plus size={13} /> New Return
                    </button>
                  )}
                </div>
              </div>

              <DataTable
                columns={columns}
                data={filtered}
                loading={loading}
                searchable={false}
                emptyMessage="No issue return records yet. Click 'New Return' to create one."
              />
            </div>
          </motion.div>
        )}

        {/* ── FORM ────────────────────────────────────────────────────────── */}
        {view === "form" && (
          <motion.div key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.22 }} className="space-y-5">

            {/* Form header */}
            <div className="rounded-2xl px-5 py-4 flex items-center justify-between gap-3" style={glassSection}>
              <div className="flex items-center gap-3">
                <button onClick={() => { setView("list"); setEditId(null); setForm(emptyForm()); }} className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground transition-colors">
                  <ArrowLeft size={16} />
                </button>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
                  <RotateCw size={14} className="text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-sm font-heading font-bold text-foreground">{editId ? "Edit Issue Return" : "New Issue Return"}</h2>
                  <p className="text-[10px] text-muted-foreground">Fill header details and load items from the issue</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setView("list"); setEditId(null); setForm(emptyForm()); }} className="px-3 py-1.5 rounded-xl text-xs border border-border hover:bg-muted transition-colors font-medium">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saveMut.isPending} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 transition shadow-sm shadow-emerald-500/20">
                  <Save size={13} /> {editId ? "Update" : "Save"}
                </button>
              </div>
            </div>

            {/* Header details */}
            <div className="rounded-2xl overflow-hidden" style={glassSection}>
              <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
                  <FileText size={11} className="text-emerald-500" />
                </div>
                <h3 className="text-[10px] font-heading font-bold uppercase tracking-widest text-muted-foreground">Header Details</h3>
              </div>
              <div className="p-5 space-y-4">
                {/* Row 1: Return Date | Company | Project / Site | Issue Reference */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <FieldLabel required>Return Date</FieldLabel>
                    <div className="relative">
                      <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <input type="date" className={inp + " pl-9"} value={form.ReturnDate} onChange={(e) => setForm((f) => ({ ...f, ReturnDate: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Company</FieldLabel>
                    <div className="relative">
                      <Building2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <select className={sel + " pl-9"} value={form.CompanyId} onChange={(e) => setForm((f) => ({ ...f, CompanyId: e.target.value, ProjectId: "", IssueId: "", items: [] }))}>
                        <option value="">— Select Company —</option>
                        {(companies as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Project / Site</FieldLabel>
                    <div className="relative">
                      <FolderOpen size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <select className={sel + " pl-9"} value={form.ProjectId} onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value, IssueId: "", items: [] }))}>
                        <option value="">— Select Project —</option>
                        {(filteredProjects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Issue Reference</FieldLabel>
                    <div className="relative">
                      <Hash size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <select className={sel + " pl-9"} value={form.IssueId} onChange={(e) => setForm((f) => ({ ...f, IssueId: e.target.value, items: [] }))}>
                        <option value="">— Select Issue —</option>
                        {issues.map((i) => <option key={i.IssueId} value={i.IssueId}>{i.DocNo} — {i.IssueDate?.split("T")[0]}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>
                {/* Row 2: Reason | Remarks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel>Reason</FieldLabel>
                    <input className={inp} placeholder="Reason for return…" value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))} />
                  </div>
                  <div>
                    <FieldLabel>Remarks</FieldLabel>
                    <Textarea rows={1} placeholder="Additional remarks…" value={form.Remarks} onChange={(e) => setForm((f) => ({ ...f, Remarks: e.target.value }))} className="rounded-xl text-sm" />
                  </div>
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="rounded-2xl overflow-hidden" style={glassSection}>
              <div className="px-5 py-3 border-b border-border/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
                    <Package size={11} className="text-emerald-500" />
                  </div>
                  <h3 className="text-[10px] font-heading font-bold uppercase tracking-widest text-muted-foreground">Return Items</h3>
                  {form.items.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">{form.items.length}</span>
                  )}
                </div>
                {form.IssueId && issueItems.length > 0 && (
                  <button
                    onClick={loadIssueItems}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  >
                    <RotateCcw size={11} /> Load from Issue
                  </button>
                )}
              </div>

              {form.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <TrendingDown size={22} className="text-emerald-400 opacity-60" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground/70">No items added</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {form.IssueId ? 'Click "Load from Issue" to pull all items' : "Select an issue reference first"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Item Name", "Issued Qty", "Return Qty", "UOM", ""].map((h, i) => (
                          <th key={i} className="px-4 py-2.5 text-left text-[9px] uppercase tracking-widest font-heading text-muted-foreground" style={{ width: i === 0 ? "40%" : i === 4 ? "5%" : "15%" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {form.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 text-sm font-medium truncate">{item.ItemName}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground text-right">{item.maxQty ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            <input
                              type="number" min={0.0001} max={item.maxQty} step="any"
                              className="w-full text-right rounded-lg border border-border px-2.5 py-1.5 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                              value={item.Quantity}
                              onChange={(e) => setItemQty(idx, parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{item.UOMSymbol || "—"}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button onClick={() => removeItem(idx)} className="p-1 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"><X size={12} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {/* ── DETAIL OVERLAY (portal) ──────────────────────────────────────── */}
      {detailRecord && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setDetailRecord(null); }}
        >
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto">

            {/* Sticky header */}
            <div className="sticky top-0 bg-card z-10 border-b border-border">
              <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                      <RotateCw size={13} className="text-emerald-500" />
                    </div>
                    <h2 className="font-heading font-bold text-sm sm:text-base font-mono truncate max-w-[160px] sm:max-w-none">
                      {detailRecord.DocNo}
                    </h2>
                    <StatusBadge status={detailRecord.Status} />
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 ml-9">Issue Return</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(detailRecord.Status === "Draft" || detailRecord.Status === "Approved") && rights.canEdit && (
                    <button
                      onClick={() => { setDetailRecord(null); openEdit(detailRecord); }}
                      className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-white text-xs font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 shadow-sm"
                    >
                      <Edit3 size={13} /><span className="hidden sm:inline">Edit</span>
                    </button>
                  )}
                  {detailRecord.Status === "Draft" && rights.canEdit && (
                    <button
                      onClick={() => { submitMut.mutate(detailRecord.ReturnId); setDetailRecord(null); }}
                      className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-white text-xs font-semibold bg-gradient-to-r from-blue-500 to-violet-500 shadow-sm"
                    >
                      <CheckCircle2 size={13} /><span className="hidden sm:inline">Submit</span>
                    </button>
                  )}
                  <button onClick={() => setDetailRecord(null)} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5">

              {/* Meta fields */}
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                  <RotateCw size={10} className="text-emerald-500" /> Return Details
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Return Date", value: detailRecord.ReturnDate?.split("T")[0] || "—" },
                    { label: "Issue Reference", value: detailRecord.IssueDocNo || "—", color: "text-blue-600 dark:text-blue-400 font-mono" },
                    { label: "Company", value: detailRecord.CompanyName || "—" },
                    { label: "Project / Site", value: detailRecord.ProjectName || "—" },
                    { label: "Reason", value: detailRecord.Reason || "—" },
                    { label: "Created", value: detailRecord.CreatedAt ? format(new Date(detailRecord.CreatedAt), "dd MMM yyyy") : "—" },
                  ].map(({ label, value, color }: any) => (
                    <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                      <p className={`text-xs font-semibold truncate ${color || "text-foreground"}`}>{value}</p>
                    </div>
                  ))}
                </div>
                {detailRecord.Remarks && (
                  <div className="mt-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Remarks</p>
                    <p className="text-xs text-foreground">{detailRecord.Remarks}</p>
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Package size={10} className="text-emerald-500" /> Return Items
                  <span className="ml-1 font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-full border border-border">{(detailRecord.items || []).length}</span>
                </p>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-xs" style={{ tableLayout: "auto" }}>
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Item</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Qty</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground hidden sm:table-cell">UOM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {(detailRecord.items || []).length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No items</td></tr>
                      ) : (detailRecord.items || []).map((item: any, idx: number) => (
                        <tr key={idx} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 font-medium">{item.ItemName}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            {Number.isFinite(Number(item.Quantity)) ? Number(item.Quantity).toLocaleString("en-IN", { maximumFractionDigits: 4 }) : item.Quantity}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{item.UOMSymbol || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
        </div>,
        document.body
      )}

    </MaterialShell>
  );
}

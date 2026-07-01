import React, { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageRights } from "@/hooks/usePageRights";
import {
  CalendarDays, FileText, Save, Search, Trash2, Plus, RefreshCw,
  X, Edit3, Building2, FolderOpen, RotateCcw, ArrowLeft, Package, CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/material-issue-returns";

const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition";
const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition";

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

interface IssueOption {
  IssueId: number;
  DocNo: string;
  IssueDate: string;
}

interface IssueItem {
  ItemId: number;
  M_Id: string;
  ItemName: string;
  Quantity: number;
  UOMSymbol: string | null;
}

interface ReturnItem {
  origIssueItemId: number | null;
  M_Id: string;
  ItemName: string;
  Quantity: number;
  UOMSymbol: string;
  maxQty?: number;
}

interface FormState {
  ReturnDate: string;
  IssueId: string;
  CompanyId: string;
  ProjectId: string;
  Reason: string;
  Remarks: string;
  items: ReturnItem[];
}

const today = new Date().toISOString().split("T")[0];
const emptyForm = (): FormState => ({
  ReturnDate: today, IssueId: "", CompanyId: "", ProjectId: "",
  Reason: "", Remarks: "", items: [],
});

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || res.statusText);
  }
  return res.json();
}

export default function IssueReturn() {
  const qc = useQueryClient();
  const rights = usePageRights("material-issue-return");

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue-returns"] });
      toast.success(editId ? "Updated" : "Created");
      setView("list"); setEditId(null); setForm(emptyForm());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitMut = useMutation({
    mutationFn: (id: number) => apiFetch(`${API}/${id}/submit`, { method: "PUT" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["issue-returns"] }); toast.success("Submitted"); },
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
    () => form.CompanyId ? projects.filter((p: any) => Number(p.company_id) === Number(form.CompanyId)) : projects,
    [projects, form.CompanyId]
  );

  const loadIssueItems = useCallback(() => {
    if (!issueItems.length) return;
    setForm((f) => ({
      ...f,
      items: issueItems.map((ii) => ({
        origIssueItemId: ii.ItemId, M_Id: ii.M_Id,
        ItemName: ii.ItemName, Quantity: ii.Quantity,
        UOMSymbol: ii.UOMSymbol || "", maxQty: ii.Quantity,
      })),
    }));
  }, [issueItems]);

  const setItemQty = (idx: number, qty: number) =>
    setForm((f) => { const items = [...f.items]; items[idx] = { ...items[idx], Quantity: qty }; return { ...f, items }; });
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const openNew = () => { setEditId(null); setForm(emptyForm()); setView("form"); };

  const openEdit = async (row: ReturnRow) => {
    const rec = await apiFetch<any>(`${API}/${row.ReturnId}`);
    setEditId(rec.ReturnId);
    setForm({
      ReturnDate: rec.ReturnDate?.split("T")[0] || today,
      IssueId: String(rec.IssueId || ""),
      CompanyId: String(rec.CompanyId || ""),
      ProjectId: String(rec.ProjectId || ""),
      Reason: rec.Reason || "",
      Remarks: rec.Remarks || "",
      items: (rec.items || []).map((i: any) => ({
        origIssueItemId: i.OrigIssueItemId,
        M_Id: i.M_Id || "", ItemName: i.ItemName || "",
        Quantity: i.Quantity, UOMSymbol: i.UOMSymbol || "",
      })),
    });
    setView("form");
  };

  const openDetail = async (row: ReturnRow) => {
    const rec = await apiFetch<any>(`${API}/${row.ReturnId}`);
    setDetailRecord(rec); setView("detail");
  };

  const handleSave = () => {
    if (!form.ReturnDate) return void toast.error("Return date is required");
    if (!form.items.length) return void toast.error("Add at least one item");
    const overMax = form.items.find(i => i.maxQty != null && i.Quantity > i.maxQty);
    if (overMax) return void toast.error(`Return qty for "${overMax.ItemName}" exceeds issued quantity`);
    const hasValid = form.items.some(i => i.Quantity > 0);
    if (!hasValid) return void toast.error("All items have zero quantity");
    saveMut.mutate({ ...form });
  };

  const columns: ColumnDef<ReturnRow>[] = [
    { header: "Doc No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.DocNo}</span> },
    { header: "Date", cell: ({ row }) => row.original.ReturnDate ? format(new Date(row.original.ReturnDate), "dd/MM/yyyy") : "—" },
    { header: "Issue Ref", cell: ({ row }) => row.original.IssueDocNo || "—" },
    { header: "Company", cell: ({ row }) => row.original.CompanyName || "—" },
    { header: "Project", cell: ({ row }) => row.original.ProjectName || "—" },
    { header: "Status", cell: ({ row }) => <StatusBadge status={row.original.Status} /> },
    {
      header: "Actions",
      cell: ({ row: { original: r } }) => (
        <div className="flex gap-1.5">
          <button className="p-1.5 rounded text-blue-400 hover:bg-blue-500/10" title="View" onClick={() => openDetail(r)}>
            <Search size={14} />
          </button>
          {r.Status === "Draft" && rights.canEdit && (
            <button className="p-1.5 rounded text-amber-400 hover:bg-amber-500/10" title="Edit" onClick={() => openEdit(r)}>
              <Edit3 size={14} />
            </button>
          )}
          {r.Status === "Draft" && rights.canEdit && (
            <button className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10" title="Submit" onClick={() => submitMut.mutate(r.ReturnId)}>
              <CheckCircle2 size={14} />
            </button>
          )}
          {r.Status === "Pending" && rights.canEdit && (
            <>
              <button className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10" title="Approve" onClick={() => approveMut.mutate(r.ReturnId)}>
                <CheckCircle2 size={14} />
              </button>
              <button className="p-1.5 rounded text-red-400 hover:bg-red-500/10" title="Reject" onClick={() => rejectMut.mutate(r.ReturnId)}>
                <X size={14} />
              </button>
            </>
          )}
          {["Draft", "Rejected"].includes(r.Status) && rights.canDelete && (
            <button className="p-1.5 rounded text-red-400 hover:bg-red-500/10" title="Delete" onClick={() => { if (confirm("Delete this return?")) deleteMut.mutate(r.ReturnId); }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const filtered = useMemo(
    () => rows.filter((r) =>
      !search ||
      r.DocNo.toLowerCase().includes(search.toLowerCase()) ||
      (r.IssueDocNo || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.CompanyName || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.ProjectName || "").toLowerCase().includes(search.toLowerCase())
    ),
    [rows, search]
  );

  return (
    <MaterialShell title="Issue Return" subtitle="Return materials from projects to godown">
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <Breadcrumbs items={[{ label: "Material", path: "/material" }, { label: "Issue Return" }]} />

        {/* ── LIST ── */}
        {view === "list" && (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="text-xl font-semibold">Issue Returns</h1>
              <div className="flex gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-8 h-8 text-sm w-52" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                {rights.canCreate && (
                  <Button size="sm" className="gap-1.5" onClick={openNew}><Plus size={14} /> New Return</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["issue-returns"] })}>
                  <RefreshCw size={14} />
                </Button>
              </div>
            </div>
            <DataTable columns={columns} data={filtered} loading={loading} />
          </>
        )}

        {/* ── FORM ── */}
        {view === "form" && (
          <div className="max-w-4xl mx-auto w-full space-y-4">
            <div className="flex items-center gap-3">
              <button className="p-1.5 rounded hover:bg-muted text-muted-foreground" onClick={() => { setView("list"); setEditId(null); setForm(emptyForm()); }}>
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-lg font-semibold">{editId ? "Edit Issue Return" : "New Issue Return"}</h1>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Header Details</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Return Date *</label>
                  <div className="relative">
                    <CalendarDays size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input type="date" className={inputCls + " pl-9"} value={form.ReturnDate} onChange={(e) => setForm((f) => ({ ...f, ReturnDate: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Company</label>
                  <div className="relative">
                    <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <select className={selectCls + " pl-9"} value={form.CompanyId} onChange={(e) => setForm((f) => ({ ...f, CompanyId: e.target.value, ProjectId: "", IssueId: "", items: [] }))}>
                      <option value="">All Companies</option>
                      {(companies as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Project</label>
                  <div className="relative">
                    <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <select className={selectCls + " pl-9"} value={form.ProjectId} onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value, IssueId: "", items: [] }))}>
                      <option value="">All Projects</option>
                      {(filteredProjects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Issue Reference</label>
                  <div className="relative">
                    <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <select className={selectCls + " pl-9"} value={form.IssueId} onChange={(e) => setForm((f) => ({ ...f, IssueId: e.target.value, items: [] }))}>
                      <option value="">Select Issue</option>
                      {issues.map((i) => <option key={i.IssueId} value={i.IssueId}>{i.DocNo} — {i.IssueDate?.split("T")[0]}</option>)}
                    </select>
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Reason</label>
                  <input className={inputCls} placeholder="Reason for return…" value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))} />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Remarks</label>
                  <Textarea rows={2} placeholder="Additional remarks…" value={form.Remarks} onChange={(e) => setForm((f) => ({ ...f, Remarks: e.target.value }))} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Return Items</CardTitle>
                  {form.IssueId && issueItems.length > 0 && (
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadIssueItems}>
                      <RotateCcw size={12} /> Load from Issue
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {form.items.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <Package size={32} className="mx-auto mb-2 opacity-30" />
                    {form.IssueId ? 'Click "Load from Issue" to populate items' : "Select an issue reference first"}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                          <th className="text-left py-2 pr-3">Item Name</th>
                          <th className="text-right py-2 pr-3">Return Qty</th>
                          <th className="text-left py-2 pr-3">UOM</th>
                          <th className="py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.items.map((item, idx) => (
                          <tr key={idx} className="border-b border-border/50">
                            <td className="py-2 pr-3">{item.ItemName}</td>
                            <td className="py-2 pr-3 text-right">
                              <input
                                type="number" min={0.0001} max={item.maxQty} step="any"
                                className="w-24 text-right rounded border border-border px-2 py-1 bg-background text-sm"
                                value={item.Quantity}
                                onChange={(e) => setItemQty(idx, parseFloat(e.target.value) || 0)}
                              />
                            </td>
                            <td className="py-2 pr-3 text-muted-foreground">{item.UOMSymbol || "—"}</td>
                            <td className="py-2">
                              <button className="p-1 rounded text-red-400 hover:bg-red-500/10" onClick={() => removeItem(idx)}><X size={12} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setView("list"); setEditId(null); setForm(emptyForm()); }}>Cancel</Button>
              <Button className="gap-1.5" onClick={handleSave} disabled={saveMut.isPending}>
                <Save size={14} /> {editId ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        )}

        {/* ── DETAIL ── */}
        {view === "detail" && detailRecord && (
          <div className="max-w-3xl mx-auto w-full space-y-4">
            <div className="flex items-center gap-3">
              <button className="p-1.5 rounded hover:bg-muted text-muted-foreground" onClick={() => setView("list")}><ArrowLeft size={18} /></button>
              <h1 className="text-lg font-semibold">{detailRecord.DocNo}</h1>
              <StatusBadge status={detailRecord.Status} />
            </div>
            <Card>
              <CardContent className="pt-4 grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Return Date: </span>{detailRecord.ReturnDate?.split("T")[0]}</div>
                <div><span className="text-muted-foreground">Issue Ref: </span>{detailRecord.IssueDocNo || "—"}</div>
                <div><span className="text-muted-foreground">Company: </span>{detailRecord.CompanyName || "—"}</div>
                <div><span className="text-muted-foreground">Project: </span>{detailRecord.ProjectName || "—"}</div>
                {detailRecord.Reason && <div className="col-span-2"><span className="text-muted-foreground">Reason: </span>{detailRecord.Reason}</div>}
                {detailRecord.Remarks && <div className="col-span-2"><span className="text-muted-foreground">Remarks: </span>{detailRecord.Remarks}</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Items</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-3">Item</th>
                      <th className="text-right py-2 pr-3">Qty</th>
                      <th className="text-left py-2">UOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailRecord.items || []).map((item: any, idx: number) => (
                      <tr key={idx} className="border-b border-border/50">
                        <td className="py-2 pr-3">{item.ItemName}</td>
                        <td className="py-2 pr-3 text-right">{Number.isFinite(Number(item.Quantity)) ? Number(item.Quantity).toLocaleString("en-IN", { maximumFractionDigits: 4 }) : item.Quantity}</td>
                        <td className="py-2 text-muted-foreground">{item.UOMSymbol || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </MaterialShell>
  );
}

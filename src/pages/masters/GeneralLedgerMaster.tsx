import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccountGroups } from "@/api/accountApi";
import { getLedgers, addLedger, updateLedger as updateLedgerApi, deleteLedger as deleteLedgerApi } from "@/api/generalLedgerApi";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Pencil, Trash2, X, Check, RotateCcw, Plus, BookOpen, Hash, ChevronDown, AlertCircle } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

interface AccountGroup { _id: string; name: string; }
interface LedgerHead { LHeadId: number; LHeadName: string; LHeadCode: string | null; LBelongsTo: number | null; GroupName: string | null; LHeadStatus: boolean; }
interface LedgerForm { LHeadName: string; LHeadCode: string; LBelongsTo: string; }

const EMPTY_FORM: LedgerForm = { LHeadName: "", LHeadCode: "", LBelongsTo: "" };

function generateShortCode(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9\s]/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].substring(0, 4).toUpperCase();
  if (words.length === 2) return (words[0].substring(0, 3) + words[1].substring(0, 1)).toUpperCase();
  return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
}

function buildColumns(
  editingId: number | null, deleteConfirm: number | null,
  onEdit: (l: LedgerHead) => void,
  onDeleteRequest: (id: number) => void,
  onDeleteConfirm: (id: number) => void,
  onDeleteCancel: () => void,
): ColumnDef<LedgerHead, unknown>[] {
  return [
    {
      accessorKey: "LHeadName", header: "Account Name",
      cell: ({ getValue }) => (
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-primary/40 shrink-0" />
          <span className="text-sm font-medium text-foreground">{getValue() as string}</span>
        </div>
      ),
    },
    {
      accessorKey: "LHeadCode", header: "Code",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? (
          <span className="text-xs font-mono bg-muted text-foreground/80 rounded px-2 py-0.5 flex items-center gap-1 w-fit">
            <Hash size={10} className="text-muted-foreground" />{v}
          </span>
        ) : <span className="text-xs text-muted-foreground/50">—</span>;
      },
    },
    {
      accessorKey: "GroupName", header: "Group",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? <span className="text-xs text-muted-foreground bg-muted/60 border border-border rounded-full px-2 py-0.5">{v}</span> : <span className="text-xs text-muted-foreground/50">—</span>;
      },
    },
    {
      id: "actions", header: "Actions", enableSorting: false,
      cell: ({ row }) => {
        const l = row.original;
        return (
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(l)} className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"><Pencil size={13} /></button>
            {deleteConfirm === l.LHeadId ? (
              <>
                <button onClick={() => onDeleteConfirm(l.LHeadId)} className="w-7 h-7 flex items-center justify-center rounded text-red-500 hover:bg-red-50"><Check size={13} /></button>
                <button onClick={onDeleteCancel} className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"><X size={13} /></button>
              </>
            ) : (
              <button onClick={() => onDeleteRequest(l.LHeadId)} className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={13} /></button>
            )}
          </div>
        );
      },
    },
  ];
}

const GeneralLedgerMaster: React.FC = () => {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LedgerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof LedgerForm, boolean>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [filterGroup, setFilterGroup] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;
  const hasManuallyEditedCode = useRef(false);

  // Server-side search is handled via page/filterGroup params; DataTable search is client-side on the page data
  const { data: groupsData, isLoading: groupsLoading } = useQuery({ queryKey: ["account-groups"], queryFn: getAccountGroups, staleTime: 5 * 60 * 1000 });
  const { data: ledgersData, isLoading: ledgersLoading, isError: ledgersError } = useQuery({ queryKey: ["ledger-heads", page, limit, "", filterGroup], queryFn: () => getLedgers({ page, limit, search: "", groupId: filterGroup }) });

  const accountGroups: AccountGroup[] = useMemo(() => {
    if (!Array.isArray(groupsData)) return [];
    return (groupsData as any[]).filter((item) => item.AGId != null && item.Name).map((item) => ({ _id: String(item.AGId), name: item.Name as string }));
  }, [groupsData]);

  const ledgers: LedgerHead[] = useMemo(() => ledgersData?.data ?? [], [ledgersData]);
  const totalPages = Math.max(ledgersData?.totalPages ?? 1, 1);
  const totalRecords = ledgersData?.total ?? ledgers.length;

  useEffect(() => { setPage(1); }, [filterGroup]);

  useEffect(() => {
    if (editingId !== null) return;
    const name = form.LHeadName.trim();
    if (!name) { setForm((prev) => ({ ...prev, LHeadCode: "" })); hasManuallyEditedCode.current = false; return; }
    if (!hasManuallyEditedCode.current) setForm((prev) => ({ ...prev, LHeadCode: generateShortCode(name) }));
  }, [form.LHeadName, editingId]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ledger-heads"] });

  const createMut = useMutation({
    mutationFn: (data: LedgerForm) => addLedger({ LHeadName: data.LHeadName, LHeadCode: data.LHeadCode || null, LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null }),
    onSuccess: () => { toast.success("Ledger account created"); invalidate(); resetForm(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: LedgerForm }) => updateLedgerApi(id, { LHeadName: data.LHeadName, LHeadCode: data.LHeadCode || null, LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null }),
    onSuccess: () => { toast.success("Ledger account updated"); invalidate(); resetForm(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteLedgerApi(id),
    onSuccess: () => { toast.success("Ledger account deleted"); invalidate(); setDeleteConfirm(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;

  const startEdit = (l: LedgerHead) => {
    setEditingId(l.LHeadId);
    setForm({ LHeadName: l.LHeadName ?? "", LHeadCode: l.LHeadCode ?? "", LBelongsTo: l.LBelongsTo != null ? String(l.LBelongsTo) : "" });
    hasManuallyEditedCode.current = true;
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); setErrors({}); hasManuallyEditedCode.current = false; };

  const handleSave = () => {
    const e: Partial<Record<keyof LedgerForm, boolean>> = {};
    if (!form.LHeadName.trim()) e.LHeadName = true;
    if (Object.keys(e).length) { setErrors(e); return; }
    if (editingId !== null) updateMut.mutate({ id: editingId, data: form });
    else createMut.mutate(form);
  };

  const columns = useMemo(
    () => buildColumns(editingId, deleteConfirm, startEdit, setDeleteConfirm, (id) => deleteMut.mutate(id), () => setDeleteConfirm(null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteConfirm],
  );

  return (
    <>
      <Breadcrumbs items={["Masters", "General Ledger"]} />
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-foreground">General Ledger Master</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Define ledger accounts with a name, short code and account group</p>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-border bg-card mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{editingId ? "Edit Ledger Account" : "Add Ledger Account"}</h2>
          <p className="text-xs text-muted-foreground">{editingId ? "Modify the selected ledger account" : "Fill in the details to create a new record."}</p>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Account Name <span className="text-red-500">*</span></label>
              <input value={form.LHeadName} onChange={(e) => { setForm((p) => ({ ...p, LHeadName: e.target.value })); setErrors((p) => ({ ...p, LHeadName: false })); }} placeholder="e.g. Cash in Hand" className={`w-full text-sm rounded-lg border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${errors.LHeadName ? "border-red-400" : "border-border"}`} />
              {errors.LHeadName && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} /> Required</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Short Code</label>
              <div className="relative">
                <Hash size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input value={form.LHeadCode} onChange={(e) => { setForm((p) => ({ ...p, LHeadCode: e.target.value.toUpperCase() })); hasManuallyEditedCode.current = true; }} placeholder="e.g. CIH" maxLength={20} className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Auto-generated from account name (you can override manually)</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Account Group</label>
              {groupsLoading ? <div className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-muted/40 text-muted-foreground">Loading…</div> : (
                <div className="relative">
                  <select value={form.LBelongsTo} onChange={(e) => setForm((p) => ({ ...p, LBelongsTo: e.target.value }))} className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none">
                    <option value="">Select group…</option>
                    {accountGroups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-6 pt-5 border-t border-border">
            <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center gap-2">
              {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : editingId ? <><Check size={14} />Update Account</> : <><Plus size={14} />Save Account</>}
            </button>
            {editingId && <button onClick={resetForm} className="px-5 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors flex items-center gap-2"><RotateCcw size={13} />Cancel</button>}
          </div>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <div className="relative">
          <select value={filterGroup} onChange={(e) => setFilterGroup(e.target.value)} className="text-sm rounded-lg border border-border pl-3 pr-8 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none">
            <option value="">All Groups</option>
            {accountGroups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        {filterGroup && <button onClick={() => setFilterGroup("")} className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"><X size={11} />Clear</button>}
        <span className="ml-auto text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">{totalRecords} Accounts</span>
      </div>

      {/* Table with server-side pagination — DataTable search still works on the current page */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <DataTable
          data={ledgers}
          columns={columns}
          loading={ledgersLoading}
          paginated={false}
          searchPlaceholder="Search current page…"
          emptyMessage="No ledger accounts found."
          rowClassName={(row) => editingId === row.original.LHeadId ? "bg-primary/5" : ""}
        />
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">Previous</button>
            <button onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </>
  );
};

export default GeneralLedgerMaster;

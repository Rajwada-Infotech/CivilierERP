import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
  getAccountGroups,
} from "@/api/accountHeadApi";
import { usePageRights } from "@/hooks/usePageRights";
import {
  DataTable,
  type ColumnDef,
  type ExportColumn,
} from "@/components/ui/DataTable";
import {
  Pencil, Trash2, X, Check, Plus, Search, AlertCircle, Eye, XCircle,
  User, Phone, Mail, MapPin, CreditCard, UserRound,
} from "lucide-react";
import { GroupTreePicker } from "@/components/common/GroupTreePicker";

const BROKER_TYPE = "BR";

interface Broker {
  LHeadId: number;
  LHeadName: string;
  LHeadContactPerson: string | null;
  LHeadPhone: string | null;
  LHeadEmail: string | null;
  LGST: string | null;
  LHeadPan: string | null;
  LHeadPaymentTerms: string | null;
  LHeadAddress: string | null;
  LBelongsTo: number | null;
  LHeadStatus: boolean;
}

interface AccountGroup { _id: string; name: string; code: string; parentId: string | null; }
interface TreeNode extends AccountGroup { children: TreeNode[]; }

function buildTree(items: AccountGroup[]): TreeNode[] {
  const map: Record<string, TreeNode> = {};
  items.forEach((i) => (map[i._id] = { ...i, children: [] }));
  const roots: TreeNode[] = [];
  items.forEach((i) => {
    if (i.parentId && map[i.parentId]) map[i.parentId].children.push(map[i._id]);
    else roots.push(map[i._id]);
  });
  return roots;
}

interface BrokerForm {
  LHeadName: string;
  LHeadContactPerson: string;
  LHeadPhone: string;
  LHeadEmail: string;
  LGST: string;
  LHeadPan: string;
  LHeadPaymentTerms: string;
  LHeadAddress: string;
  LBelongsTo: number | "";
  LHeadStatus: boolean;
}

const EMPTY_FORM: BrokerForm = {
  LHeadName: "", LHeadContactPerson: "", LHeadPhone: "", LHeadEmail: "",
  LGST: "", LHeadPan: "", LHeadPaymentTerms: "", LHeadAddress: "",
  LBelongsTo: "", LHeadStatus: true,
};

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Broker Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "PAN Number", accessor: "LHeadPan" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  { header: "Status", accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive") },
];

const CrmBrokerMaster: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("broker-master");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BrokerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof BrokerForm, boolean>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<Broker | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const { data: rawData, isLoading, isError } = useQuery({
    queryKey: ["account-head", BROKER_TYPE],
    queryFn: () => getList(BROKER_TYPE),
    staleTime: 5 * 60 * 1000,
  });

  const { data: groupsData } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    staleTime: 10 * 60 * 1000,
  });

  const accountGroups: AccountGroup[] = useMemo(() => {
    if (!Array.isArray(groupsData)) return [];
    return (groupsData as any[])
      .filter((item) => item.AGId != null && item.Name)
      .map((item) => ({
        _id: String(item.AGId), name: item.Name as string,
        code: item.Code || "", parentId: item.ParentGroupId ? String(item.ParentGroupId) : null,
      }));
  }, [groupsData]);

  const accountGroupTree = useMemo(() => buildTree(accountGroups), [accountGroups]);

  const brokers: Broker[] = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    return rawData.map((item: any) => ({
      LHeadId: item.LHeadId,
      LHeadName: item.LHeadName || "",
      LHeadContactPerson: item.LHeadContactPerson || null,
      LHeadPhone: item.LHeadPhone || null,
      LHeadEmail: item.LHeadEmail || null,
      LGST: item.LGST || null,
      LHeadPan: item.LHeadPan || null,
      LHeadPaymentTerms: item.LHeadPaymentTerms || null,
      LHeadAddress: item.LHeadAddress || null,
      LBelongsTo: item.LBelongsTo != null ? Number(item.LBelongsTo) : null,
      LHeadStatus: Boolean(item.LHeadStatus),
    }));
  }, [rawData]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["account-head", BROKER_TYPE] });

  const buildPayload = (f: BrokerForm) => ({
    LHeadName: f.LHeadName,
    LHeadType: BROKER_TYPE,
    LHeadContactPerson: f.LHeadContactPerson || null,
    LHeadPhone: f.LHeadPhone || null,
    LHeadEmail: f.LHeadEmail || null,
    LGST: f.LGST || null,
    LHeadPan: f.LHeadPan || null,
    LHeadPaymentTerms: f.LHeadPaymentTerms || null,
    LHeadAddress: f.LHeadAddress || null,
    LHeadStatus: f.LHeadStatus,
    LBranchName: null,
    LGSTState: null,
    LCountry: "India",
    LBelongsTo: f.LBelongsTo ? Number(f.LBelongsTo) : null,
    LDescription: null,
  });

  const createMut = useMutation({
    mutationFn: (f: BrokerForm) => addRecord(buildPayload(f), BROKER_TYPE),
    onSuccess: () => { toast.success("Broker created"); invalidate(); resetForm(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: BrokerForm }) => updateRecord(id, buildPayload(data), BROKER_TYPE),
    onSuccess: () => { toast.success("Broker updated"); invalidate(); resetForm(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => { toast.success("Broker deleted"); invalidate(); setDeleteConfirm(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;
  const canSave = form.LHeadName.trim() !== "";

  const startEdit = (b: Broker) => {
    setEditingId(b.LHeadId);
    setForm({
      LHeadName: b.LHeadName ?? "", LHeadContactPerson: b.LHeadContactPerson ?? "",
      LHeadPhone: b.LHeadPhone ?? "", LHeadEmail: b.LHeadEmail ?? "",
      LGST: b.LGST ?? "", LHeadPan: b.LHeadPan ?? "",
      LHeadPaymentTerms: b.LHeadPaymentTerms ?? "", LHeadAddress: b.LHeadAddress ?? "",
      LBelongsTo: b.LBelongsTo ?? "", LHeadStatus: b.LHeadStatus,
    });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); setErrors({}); };

  const handleSave = () => {
    if (!form.LHeadName.trim()) { setErrors({ LHeadName: true }); return; }
    if (editingId !== null) updateMut.mutate({ id: editingId, data: form });
    else createMut.mutate(form);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brokers.filter((b) => {
      const matchSearch = !q || b.LHeadName?.toLowerCase().includes(q)
        || (b.LHeadPhone ?? "").toLowerCase().includes(q) || (b.LHeadContactPerson ?? "").toLowerCase().includes(q);
      const matchStatus = !filterStatus || (filterStatus === "active" ? b.LHeadStatus : !b.LHeadStatus);
      return matchSearch && matchStatus;
    });
  }, [brokers, search, filterStatus]);

  const columns: ColumnDef<Broker, unknown>[] = useMemo(() => [
    { accessorKey: "LHeadName", header: "Broker Name", cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: "LHeadContactPerson", header: "Contact Person", cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{(getValue() as string) || "—"}</span> },
    { accessorKey: "LHeadPhone", header: "Phone", cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string) || "—"}</span> },
    { accessorKey: "LHeadPaymentTerms", header: "Payment Terms", cell: ({ getValue }) => <span className="text-sm text-muted-foreground">{(getValue() as string) || "—"}</span> },
    {
      accessorKey: "LHeadStatus", header: "Status",
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{active ? "Active" : "Inactive"}</span>;
      },
    },
    {
      id: "actions", header: "Actions", enableSorting: false,
      meta: { align: "right", className: "text-right" },
      cell: ({ row }) => {
        const id = row.original.LHeadId;
        if (deleteConfirm === id) {
          return (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground mr-1">Delete?</span>
              <button onClick={() => deleteMut.mutate(id)} className="p-1 rounded text-destructive hover:bg-destructive/10"><Check size={12} /></button>
              <button onClick={() => setDeleteConfirm(null)} className="p-1 rounded text-muted-foreground hover:bg-muted"><X size={12} /></button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2">
            <button onClick={() => setViewRecord(row.original)} className="p-1 rounded text-sky-500 hover:bg-sky-500/10" title="View"><Eye size={15} /></button>
            {rights.canEdit && <button onClick={() => startEdit(row.original)} className="p-1 rounded text-blue-400 hover:bg-blue-400/10" title="Edit"><Pencil size={15} /></button>}
            {rights.canDelete && <button onClick={() => setDeleteConfirm(id)} className="p-1 rounded text-destructive hover:bg-destructive/10" title="Delete"><Trash2 size={15} /></button>}
          </div>
        );
      },
    },
  ], [deleteConfirm, rights.canEdit, rights.canDelete]);

  const inputCls = "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

  return (
    <SalesAutoShell title="Broker Master" subtitle="Manage broker ledger accounts — same account-head pattern as Contractors">
      {(rights.canCreate || rights.canEdit) && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-muted/20 border-b border-border">
            <UserRound size={16} className="text-primary" />
            <div>
              <h2 className="text-sm font-semibold">{editingId ? "Edit Broker" : "Add Broker"}</h2>
              <p className="text-[11px] text-muted-foreground">Brokers are ledger accounts (LHeadType='BR'), same as Contractors</p>
            </div>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Broker Name *</label>
                <input value={form.LHeadName}
                  onChange={(e) => { setForm((p) => ({ ...p, LHeadName: e.target.value })); setErrors((p) => ({ ...p, LHeadName: false })); }}
                  placeholder="e.g. Ramesh Realty Brokers"
                  className={`${inputCls} ${errors.LHeadName ? "border-red-400" : ""}`} />
                {errors.LHeadName && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} /> Required</p>}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Contact Person</label>
                <div className="relative">
                  <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadContactPerson} onChange={(e) => setForm((p) => ({ ...p, LHeadContactPerson: e.target.value }))}
                    className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Account Group</label>
                <GroupTreePicker value={String(form.LBelongsTo)} onChange={(v) => setForm((p) => ({ ...p, LBelongsTo: v === "" ? "" : Number(v) }))}
                  tree={accountGroupTree} allGroups={accountGroups} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Phone Number</label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadPhone} onChange={(e) => setForm((p) => ({ ...p, LHeadPhone: e.target.value }))}
                    className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background font-mono" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Email</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadEmail} onChange={(e) => setForm((p) => ({ ...p, LHeadEmail: e.target.value }))}
                    className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">PAN Number</label>
                <input value={form.LHeadPan} onChange={(e) => setForm((p) => ({ ...p, LHeadPan: e.target.value.toUpperCase() }))}
                  maxLength={10} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Terms</label>
                <div className="relative">
                  <CreditCard size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadPaymentTerms} onChange={(e) => setForm((p) => ({ ...p, LHeadPaymentTerms: e.target.value }))}
                    placeholder="e.g. Post-registration" className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Address</label>
                <div className="relative">
                  <MapPin size={13} className="absolute left-3 top-3 text-muted-foreground" />
                  <textarea value={form.LHeadAddress} onChange={(e) => setForm((p) => ({ ...p, LHeadAddress: e.target.value }))}
                    rows={2} className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background resize-none" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setForm((p) => ({ ...p, LHeadStatus: !p.LHeadStatus }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.LHeadStatus ? "bg-emerald-500" : "bg-muted-foreground/30"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.LHeadStatus ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              <span className="text-xs text-muted-foreground">{form.LHeadStatus ? "Active" : "Inactive"}</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
            <button onClick={resetForm} className="px-4 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted">{editingId ? "Cancel" : "Reset"}</button>
            <button onClick={handleSave} disabled={saving || !canSave}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1.5">
              {editingId ? <Check size={14} /> : <Plus size={14} />} {saving ? "Saving..." : editingId ? "Update Broker" : "Save Broker"}
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 sm:flex-none">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone..."
              className="w-full sm:w-56 text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background" />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-background">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <DataTable
            data={filtered} columns={columns} loading={isLoading} searchable={false}
            getRowId={(row) => String(row.LHeadId)}
            emptyMessage={isError ? "Failed to load brokers." : brokers.length === 0 ? "No brokers yet." : "No results match your search."}
            exportConfig={rights.canExport ? { title: "Broker Master", filename: "broker-master", columns: EXPORT_COLUMNS } : undefined}
          />
        </div>
      </div>

      {viewRecord && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setViewRecord(null)} />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-sm">Broker Details</h3>
              <button onClick={() => setViewRecord(null)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"><XCircle size={15} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {[
                { label: "Broker Name", value: viewRecord.LHeadName },
                { label: "Contact Person", value: viewRecord.LHeadContactPerson || "—" },
                { label: "Phone", value: viewRecord.LHeadPhone || "—" },
                { label: "Email", value: viewRecord.LHeadEmail || "—" },
                { label: "PAN Number", value: viewRecord.LHeadPan || "—" },
                { label: "Payment Terms", value: viewRecord.LHeadPaymentTerms || "—" },
                { label: "Address", value: viewRecord.LHeadAddress || "—" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
                  <p className="text-sm">{value}</p>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
              <button onClick={() => setViewRecord(null)} className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted">Close</button>
              {rights.canEdit && (
                <button onClick={() => { startEdit(viewRecord); setViewRecord(null); }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground flex items-center gap-1.5">
                  <Pencil size={13} /> Edit Broker
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </SalesAutoShell>
  );
};

export default CrmBrokerMaster;

import React, { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  DataTable,
  type ColumnDef,
  type ExportColumn,
} from "@/components/ui/DataTable";
import {
  Pencil, Trash2, X, Check, Plus, Search, AlertCircle, Eye, XCircle,
  User, Phone, Mail, MapPin, CreditCard, UserRound, FileBadge, Upload, FileText, Lock,
} from "lucide-react";

const BROKER_TYPE = "BR";

interface Broker {
  LHeadId: number;
  LHeadName: string;
  LHeadContactPerson: string | null;
  LHeadPhone: string | null;
  LHeadEmail: string | null;
  LGST: string | null;
  LHeadPan: string | null;
  LHeadRera: string | null;
  LHeadCertificateUrl: string | null;
  LHeadCertificateFileName: string | null;
  LHeadPaymentTerms: string | null;
  LHeadAddress: string | null;
  LHeadStatus: boolean;
  isTdsApplicable: boolean;
  tdsLimitApplicable: boolean;
}

interface BrokerForm {
  LHeadName: string;
  LHeadContactPerson: string;
  LHeadPhone: string;
  LHeadEmail: string;
  LGST: string;
  LHeadPan: string;
  LHeadRera: string;
  LHeadPaymentTerms: string;
  LHeadAddress: string;
  LHeadStatus: boolean;
  isTdsApplicable: boolean;
  tdsLimitApplicable: boolean;
}

const EMPTY_FORM: BrokerForm = {
  LHeadName: "", LHeadContactPerson: "", LHeadPhone: "", LHeadEmail: "",
  LGST: "", LHeadPan: "", LHeadRera: "", LHeadPaymentTerms: "", LHeadAddress: "",
  LHeadStatus: true,
  // Brokerage almost always falls under TDS Sec. 194H — default ON
  isTdsApplicable: true,
  tdsLimitApplicable: true,
};

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Broker Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "PAN Number", accessor: "LHeadPan" },
  { header: "RERA Number", accessor: "LHeadRera" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  { header: "TDS Applicable", accessor: (r) => (r.isTdsApplicable ? "Yes" : "No") },
  { header: "Status", accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive") },
];

const CrmBrokerMaster: React.FC = () => {
  const qc = useQueryClient();
  // Matches the route's real gating key (App.tsx: /masters/brokers ->
  // pageKey="broker-master") — this internal check used a different,
  // ungrantable key ("crm-broker-master") that had no Menu Rights row.
  const rights = usePageRights("broker-master");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BrokerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof BrokerForm, boolean>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<Broker | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);
  const certInputRef = useRef<HTMLInputElement>(null);
  // Panel opens locked whenever editing an existing broker — "Add Broker"
  // (no editingId yet) opens unlocked since there's nothing to protect.
  const [locked, setLocked] = useState(false);

  const { data: rawData, isLoading, dataUpdatedAt, isFetching, refetch, isError } = useQuery({
    queryKey: ["account-head", BROKER_TYPE],
    queryFn: () => getList(BROKER_TYPE),
    staleTime: 5 * 60 * 1000,
  });

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
      LHeadRera: item.LHeadRera || null,
      LHeadCertificateUrl: item.LHeadCertificateUrl || null,
      LHeadCertificateFileName: item.LHeadCertificateFileName || null,
      LHeadPaymentTerms: item.LHeadPaymentTerms || null,
      LHeadAddress: item.LHeadAddress || null,
      LHeadStatus: Boolean(item.LHeadStatus),
      isTdsApplicable: Boolean(item.IsTdsApplicable),
      tdsLimitApplicable: item.TdsLimitApplicable == null ? true : Boolean(item.TdsLimitApplicable),
    }));
  }, [rawData]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["account-head", BROKER_TYPE] });

  // LBelongsTo (Account Group) is intentionally never sent from here — the
  // backend always auto-assigns brokers to SUNDRY CREDITORS server-side
  // (accountHeadMaster.js), same reasoning as LHeadType itself not being
  // staff-editable here.
  const buildPayload = (f: BrokerForm) => ({
    LHeadName: f.LHeadName,
    LHeadType: BROKER_TYPE,
    LHeadContactPerson: f.LHeadContactPerson || null,
    LHeadPhone: f.LHeadPhone || null,
    LHeadEmail: f.LHeadEmail || null,
    LGST: f.LGST || null,
    LHeadPan: f.LHeadPan || null,
    LHeadRera: f.LHeadRera || null,
    LHeadPaymentTerms: f.LHeadPaymentTerms || null,
    LHeadAddress: f.LHeadAddress || null,
    LHeadStatus: f.LHeadStatus,
    IsTdsApplicable: f.isTdsApplicable,
    TdsLimitApplicable: f.tdsLimitApplicable,
    LBranchName: null,
    LGSTState: null,
    LCountry: "India",
    LDescription: null,
  });

  const createMut = useMutation({
    mutationFn: (f: BrokerForm) => addRecord(buildPayload(f), BROKER_TYPE),
    onSuccess: (data: any) => {
      toast.success("Broker created");
      invalidate();
      // Stay in edit mode on the just-created broker (rather than resetting
      // to a blank form) so staff can immediately attach the RERA
      // certificate — the upload endpoint needs a real LHeadId to attach to.
      if (data?.LHeadId) setEditingId(data.LHeadId);
      else resetForm();
    },
    onError: (e: Error) => toast.error(translateError(e.message)),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: BrokerForm }) => updateRecord(id, buildPayload(data), BROKER_TYPE),
    onSuccess: () => { toast.success("Broker updated"); invalidate(); resetForm(); },
    onError: (e: Error) => toast.error(translateError(e.message)),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => { toast.success("Broker deleted"); invalidate(); setDeleteConfirm(null); },
    onError: (e: Error) => toast.error(translateError(e.message)),
  });

  const saving = createMut.isPending || updateMut.isPending;
  const canSave = form.LHeadName.trim() !== "";
  const editingBroker = editingId !== null ? brokers.find((b) => b.LHeadId === editingId) : null;

  const handleUploadCertificate = async () => {
    if (!certFile || editingId === null) return;
    setUploadingCert(true);
    try {
      const formData = new FormData();
      formData.append("file", certFile);
      const res = await fetchWithAuth(`/api/account-head/${editingId}/certificate`, { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
      toast.success("Certificate uploaded");
      setCertFile(null);
      if (certInputRef.current) certInputRef.current.value = "";
      invalidate();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUploadingCert(false);
    }
  };

  const startEdit = (b: Broker) => {
    setEditingId(b.LHeadId);
    setForm({
      LHeadName: b.LHeadName ?? "", LHeadContactPerson: b.LHeadContactPerson ?? "",
      LHeadPhone: b.LHeadPhone ?? "", LHeadEmail: b.LHeadEmail ?? "",
      LGST: b.LGST ?? "", LHeadPan: b.LHeadPan ?? "", LHeadRera: b.LHeadRera ?? "",
      LHeadPaymentTerms: b.LHeadPaymentTerms ?? "", LHeadAddress: b.LHeadAddress ?? "",
      LHeadStatus: b.LHeadStatus,
      isTdsApplicable: b.isTdsApplicable,
      tdsLimitApplicable: b.tdsLimitApplicable,
    });
    setErrors({});
    setLocked(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); setErrors({}); setLocked(false); };

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
    { accessorKey: "LHeadRera", header: "RERA Number", cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string) || "—"}</span> },
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

  const inputCls = `w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${locked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;

  return (
    <CrmShell title="Broker Master" subtitle="Manage broker ledger accounts — same account-head pattern as Contractors"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      {(rights.canCreate || rights.canEdit) && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 bg-muted/20 border-b border-border">
            <div className="flex items-center gap-3">
              <UserRound size={16} className="text-primary" />
              <div>
                <h2 className="text-sm font-semibold">{editingId ? "Edit Broker" : "Add Broker"}</h2>
                <p className="text-[11px] text-muted-foreground">Brokers are ledger accounts (LHeadType='BR'), same as Contractors</p>
              </div>
            </div>
            {editingId != null && locked && (
              <button onClick={() => setLocked(false)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>
          {editingId != null && locked && (
            <div className="mx-5 mt-3 flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5">
              <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
            </div>
          )}
          <div className="px-5 py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Broker Name *</label>
                <input value={form.LHeadName} readOnly={locked}
                  onChange={(e) => { setForm((p) => ({ ...p, LHeadName: e.target.value })); setErrors((p) => ({ ...p, LHeadName: false })); }}
                  placeholder="e.g. Ramesh Realty Brokers"
                  className={`${inputCls} ${errors.LHeadName ? "border-red-400" : ""}`} />
                {errors.LHeadName && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={11} /> Required</p>}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Contact Person</label>
                <div className="relative">
                  <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadContactPerson} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadContactPerson: e.target.value }))}
                    className={`${inputCls} pl-8`} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">RERA Number</label>
                <div className="relative">
                  <FileBadge size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadRera} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadRera: e.target.value.toUpperCase() }))}
                    placeholder="e.g. A51800000123"
                    className={`${inputCls} pl-8 font-mono`} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Phone Number</label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadPhone} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadPhone: e.target.value }))}
                    className={`${inputCls} pl-8 font-mono`} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Email</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadEmail} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadEmail: e.target.value }))}
                    className={`${inputCls} pl-8`} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">PAN Number</label>
                <input value={form.LHeadPan} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadPan: e.target.value.toUpperCase() }))}
                  maxLength={10} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment Terms</label>
                <div className="relative">
                  <CreditCard size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={form.LHeadPaymentTerms} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadPaymentTerms: e.target.value }))}
                    placeholder="e.g. Post-registration" className={`${inputCls} pl-8`} />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Address</label>
                <div className="relative">
                  <MapPin size={13} className="absolute left-3 top-3 text-muted-foreground" />
                  <textarea value={form.LHeadAddress} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadAddress: e.target.value }))}
                    rows={2} className={`${inputCls} pl-8 resize-none`} />
                </div>
              </div>
            </div>

            {/* Certificate upload needs a real LHeadId to attach to — only
                available once the broker exists (edit mode, including right
                after a fresh create, since createMut switches into edit mode
                on success instead of resetting the form). */}
            {editingId !== null && (
              <div className="rounded-lg border border-border p-3">
                <label className="text-xs text-muted-foreground block mb-2 flex items-center gap-1.5"><FileBadge size={13} /> RERA / Broker Certificate</label>
                {editingBroker?.LHeadCertificateFileName && (
                  <a href={`/api/account-head/${editingId}/certificate/file`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline mb-2">
                    <FileText size={12} /> {editingBroker.LHeadCertificateFileName} (uploaded — click to view)
                  </a>
                )}
                <div className="flex items-center gap-2">
                  <input ref={certInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={locked}
                    onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                    className="flex-1 text-xs text-muted-foreground file:mr-2 file:px-2.5 file:py-1.5 file:rounded-md file:border-0 file:text-xs file:bg-muted file:text-foreground disabled:opacity-40" />
                  <button type="button" onClick={handleUploadCertificate} disabled={!certFile || uploadingCert || locked}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 flex items-center gap-1">
                    <Upload size={12} /> {uploadingCert ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button type="button" disabled={locked} onClick={() => setForm((p) => ({ ...p, LHeadStatus: !p.LHeadStatus }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${form.LHeadStatus ? "bg-emerald-500" : "bg-muted-foreground/30"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.LHeadStatus ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              <span className="text-xs text-muted-foreground">Status — <span className={form.LHeadStatus ? "text-emerald-600 font-medium" : ""}>{form.LHeadStatus ? "Active" : "Inactive"}</span></span>
            </div>

            {/* TDS Applicable — Sec. 194H applies to brokerage payments */}
            <div className="flex items-center gap-3">
              <button type="button" disabled={locked} onClick={() => setForm((p) => ({ ...p, isTdsApplicable: !p.isTdsApplicable }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${form.isTdsApplicable ? "bg-amber-500" : "bg-muted-foreground/30"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.isTdsApplicable ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              <span className="text-xs text-muted-foreground">TDS Applicable — <span className={form.isTdsApplicable ? "text-amber-600 font-medium" : ""}>{form.isTdsApplicable ? "Yes (Sec. 194H)" : "No"}</span></span>
            </div>

            {/* TDS Limit — only shown when TDS is on */}
            {form.isTdsApplicable && (
              <div className="flex items-center gap-3">
                <button type="button" disabled={locked} onClick={() => setForm((p) => ({ ...p, tdsLimitApplicable: !p.tdsLimitApplicable }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${form.tdsLimitApplicable ? "bg-amber-500" : "bg-muted-foreground/30"}`}>
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.tdsLimitApplicable ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
                <span className="text-xs text-muted-foreground">TDS Limit (₹30k / ₹1L threshold) — <span className={form.tdsLimitApplicable ? "text-amber-600 font-medium" : ""}>{form.tdsLimitApplicable ? "Applied" : "Deduct on every bill"}</span></span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
            {editingId != null && locked ? (
              <button onClick={resetForm} className="px-4 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted">Close</button>
            ) : (
              <>
                <button onClick={resetForm} className="px-4 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted">{editingId ? "Cancel" : "Reset"}</button>
                <button onClick={handleSave} disabled={saving || !canSave}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1.5">
                  {editingId ? <Check size={14} /> : <Plus size={14} />} {saving ? "Saving..." : editingId ? "Update Broker" : "Save Broker"}
                </button>
              </>
            )}
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
                { label: "RERA Number", value: viewRecord.LHeadRera || "—" },
                { label: "Payment Terms", value: viewRecord.LHeadPaymentTerms || "—" },
                { label: "TDS Applicable", value: viewRecord.isTdsApplicable ? "Yes (Sec. 194H)" : "No" },
                { label: "TDS Limit", value: viewRecord.isTdsApplicable ? (viewRecord.tdsLimitApplicable ? "Applied (₹30k / ₹1L threshold)" : "Deduct on every bill") : "—" },
                { label: "Address", value: viewRecord.LHeadAddress || "—" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
                  <p className="text-sm">{value}</p>
                </div>
              ))}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Certificate</p>
                {viewRecord.LHeadCertificateFileName ? (
                  <a href={`/api/account-head/${viewRecord.LHeadId}/certificate/file`} target="_blank" rel="noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1">
                    <FileText size={13} /> {viewRecord.LHeadCertificateFileName}
                  </a>
                ) : <p className="text-sm text-muted-foreground">Not uploaded</p>}
              </div>
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
    </CrmShell>
  );
};

export default CrmBrokerMaster;

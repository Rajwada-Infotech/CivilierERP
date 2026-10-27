import React, { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DataTable,
  type ColumnDef,
  type ExportColumn,
} from "@/components/ui/DataTable";
import { Pencil, Trash2, Plus, Eye, Upload, FileText, RefreshCw, X } from "lucide-react";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";

function AuthDownloadLink({ url, filename, label }: { url: string; filename: string; label: string }) {
  const [loading, setLoading] = useState(false);
  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error("Failed to load file");
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => window.URL.revokeObjectURL(objectUrl), 10000);
    } catch (err: any) {
      toast.error(err.message || "Could not download file");
    } finally {
      setLoading(false);
    }
  };
  return (
    <button onClick={handleDownload} disabled={loading} className="inline-flex items-center gap-1.5 text-xs underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground disabled:opacity-50">
      <FileText size={12} /> {loading ? "Downloading…" : label}
    </button>
  );
}

const BROKER_TYPE = "BR";
const NUM = "font-heading tabular-nums";

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
  { header: "PAN (Permanent Account Number)", accessor: "LHeadPan" },
  { header: "RERA Number", accessor: "LHeadRera" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  { header: "TDS Applicable", accessor: (r) => (r.isTdsApplicable ? "Yes" : "No") },
  { header: "Status", accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive") },
];

/** A square on / off key with its meaning beside it. */
const Switch: React.FC<{ on: boolean; disabled?: boolean; onToggle: () => void; label: string; state: string }> = ({ on, disabled, onToggle, label, state }) => (
  <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onToggle}
    className="flex items-center gap-3 text-left disabled:opacity-50 disabled:cursor-not-allowed">
    <span className={`relative h-4 w-7 shrink-0 border border-foreground transition-colors ${on ? "bg-foreground" : "bg-card"}`}>
      <span className={`absolute top-[2px] h-2.5 w-2.5 transition-all ${on ? "left-[14px] bg-card" : "left-[2px] bg-foreground"}`} />
    </span>
    <span className="text-xs">
      <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]">{label}</span>
      <span className="text-muted-foreground"> — {state}</span>
    </span>
  </button>
);

const CrmBrokerMaster: React.FC = () => {
  const qc = useQueryClient();
  const ask = useSheetAsk();
  // Matches the route's real gating key (App.tsx: /masters/brokers -> pageKey="broker-master").
  const rights = usePageRights("broker-master");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BrokerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof BrokerForm, boolean>>>({});
  const [viewRecord, setViewRecord] = useState<Broker | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "active" | "inactive">("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);
  const certInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  // An existing broker opens locked; "Edit" unlocks it. A new one opens unlocked.
  const [locked, setLocked] = useState(false);

  const { data: rawData, isLoading, isFetching, refetch, isError, error } = useQuery({
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

  // LBelongsTo (Account Group) is never sent from here — the server always files brokers under SUNDRY CREDITORS
  // (accountHeadMaster.js), as LHeadType itself isn't staff-editable here.
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
      // Stay on the just-created broker so its RERA certificate can be attached (the upload needs a real id).
      if (data?.LHeadId && rights.canEdit) setEditingId(data.LHeadId);
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
    onSuccess: () => { toast.success("Broker deleted"); invalidate(); },
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
    // The page scrolls inside the app shell, not the window, so bring the form itself into view.
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); setErrors({}); setLocked(false); setCertFile(null); };

  const handleSave = () => {
    if (!form.LHeadName.trim()) { setErrors({ LHeadName: true }); return; }
    if (editingId !== null) updateMut.mutate({ id: editingId, data: form });
    else createMut.mutate(form);
  };

  const confirmDelete = async (b: Broker) => {
    if (!(await ask.confirm(`Delete broker ${b.LHeadName}?`, { okLabel: "Delete", danger: true }))) return;
    deleteMut.mutate(b.LHeadId);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brokers.filter((b) => {
      const matchSearch = !q || b.LHeadName?.toLowerCase().includes(q)
        || (b.LHeadPhone ?? "").toLowerCase().includes(q) || (b.LHeadContactPerson ?? "").toLowerCase().includes(q)
        || (b.LHeadRera ?? "").toLowerCase().includes(q);
      const matchStatus = !filterStatus || (filterStatus === "active" ? b.LHeadStatus : !b.LHeadStatus);
      return matchSearch && matchStatus;
    });
  }, [brokers, search, filterStatus]);

  const columns: ColumnDef<Broker, unknown>[] = useMemo(() => [
    { accessorKey: "LHeadName", header: "Broker", cell: ({ row }) => (
      <div><div className="text-xs font-semibold">{row.original.LHeadName}</div>
        {row.original.LHeadContactPerson && <div className="mt-1 text-[0.6875rem] text-muted-foreground">{row.original.LHeadContactPerson}</div>}</div>
    ) },
    { accessorKey: "LHeadPhone", header: "Phone", cell: ({ getValue }) => <span className={`text-xs ${NUM}`}>{(getValue() as string) || "—"}</span> },
    { accessorKey: "LHeadRera", header: "RERA number", cell: ({ getValue }) => <span className={`text-xs ${NUM}`}>{(getValue() as string) || "—"}</span> },
    { accessorKey: "LHeadPaymentTerms", header: "Payment terms", cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{(getValue() as string) || "—"}</span> },
    { accessorKey: "isTdsApplicable", header: "TDS", cell: ({ row }) => <span className="text-xs">{row.original.isTdsApplicable ? "194H" : "—"}</span> },
    {
      accessorKey: "LHeadStatus", header: "State",
      cell: ({ getValue }) => <SheetMark text={getValue() ? "Active" : "Inactive"} tone={getValue() ? "done" : "draft"} />,
    },
    {
      id: "actions", header: "Actions", enableSorting: false,
      meta: { align: "right", className: "text-right" },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button data-row-view onClick={() => setViewRecord(row.original)} className="w-7 h-7 inline-flex items-center justify-center border border-transparent hover:border-foreground" title="View"><Eye size={14} /></button>
          {rights.canEdit && <button onClick={() => startEdit(row.original)} className="w-7 h-7 inline-flex items-center justify-center border border-transparent hover:border-foreground" title="Edit"><Pencil size={14} /></button>}
          {rights.canDelete && <button onClick={() => confirmDelete(row.original)} className="w-7 h-7 inline-flex items-center justify-center border border-transparent text-destructive hover:border-destructive" title="Delete"><Trash2 size={14} /></button>}
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rights.canEdit, rights.canDelete]);

  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const activeCount = brokers.filter((b) => b.LHeadStatus).length;
  const figures = [
    { label: "Brokers", value: brokers.length, note: "ledger accounts", onClick: () => setFilterStatus("") },
    { label: "Active", value: activeCount, note: "offered on bookings", onClick: () => setFilterStatus("active") },
    { label: "With RERA no.", value: brokers.filter((b) => b.LHeadRera).length, note: `${brokers.filter((b) => b.LHeadCertificateFileName).length} with a certificate on file` },
    { label: "Inactive", value: brokers.length - activeCount, note: "kept on old records", onClick: () => setFilterStatus("inactive") },
  ];
  const STATUS_TABS = [
    { k: "" as const, l: "All", n: brokers.length },
    { k: "active" as const, l: "Active", n: activeCount },
    { k: "inactive" as const, l: "Inactive", n: brokers.length - activeCount },
  ];
  const field = (label: string, children: React.ReactNode, wide = false, required = false) => (
    <label className={`block space-y-1 min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <span className={`block ${LBL}`}>{label}{required && <span className="text-destructive"> *</span>}</span>
      {children}
    </label>
  );
  const showForm = rights.canCreate || (rights.canEdit && editingId != null);

  return (
    <>
      {ask.node}
      <Breadcrumbs items={["Masters", "Broker Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Brokers"
        subtitle="The brokers who bring bookings: their contact, RERA registration and certificate, payment terms and TDS. Each is a ledger account (Sundry Creditors)."
        action={
          <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  {x.onClick ? <button onClick={x.onClick} className="label link">{x.label}</button> : <p className="label">{x.label}</p>}
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          {showForm && (
            <section ref={formRef} className="bg-card" style={{ border: RULE, boxShadow: editingId != null ? "inset 3px 0 0 hsl(var(--foreground))" : undefined }}>
              <header className="px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ borderBottom: RULE }}>
                <div>
                  <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{editingId != null ? `Broker · ${editingBroker?.LHeadName ?? form.LHeadName}` : "New broker"}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {editingId != null && locked ? "Locked for viewing — Edit to make changes." : "Brokers are ledger accounts (type BR), like contractors."}
                  </p>
                </div>
                {editingId != null && locked && rights.canEdit && (
                  <button onClick={() => setLocked(false)} className={`${KEY_LINE} h-8 px-3`}><Pencil size={12} /> Edit</button>
                )}
              </header>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {field("Broker name", (
                    <>
                      <input value={form.LHeadName} readOnly={locked}
                        onChange={(e) => { setForm((p) => ({ ...p, LHeadName: e.target.value })); setErrors((p) => ({ ...p, LHeadName: false })); }}
                        placeholder="e.g. Ramesh Realty Brokers" className={`${INP} ${errors.LHeadName ? "!border-destructive" : ""}`} />
                      {errors.LHeadName && <p className="text-xs text-destructive">Required</p>}
                    </>
                  ), false, true)}
                  {field("Contact person", <input value={form.LHeadContactPerson} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadContactPerson: e.target.value }))} className={INP} />)}
                  {field("RERA number", <input value={form.LHeadRera} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadRera: e.target.value.toUpperCase() }))} placeholder="e.g. A51800000123" className={`${INP} ${NUM}`} />)}
                  {field("Phone", <input value={form.LHeadPhone} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadPhone: e.target.value }))} className={`${INP} ${NUM}`} />)}
                  {field("Email", <input value={form.LHeadEmail} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadEmail: e.target.value }))} className={INP} />)}
                  {field("PAN (Permanent Account Number)", <input value={form.LHeadPan} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadPan: e.target.value.toUpperCase() }))} maxLength={10} className={`${INP} ${NUM}`} />)}
                  {field("Payment terms", <input value={form.LHeadPaymentTerms} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadPaymentTerms: e.target.value }))} placeholder="e.g. Post-registration" className={INP} />)}
                  {field("Address", <textarea value={form.LHeadAddress} readOnly={locked} onChange={(e) => setForm((p) => ({ ...p, LHeadAddress: e.target.value }))} rows={2} className={TEXTAREA} />, true)}
                </div>

                {/* The certificate needs a real broker to attach to — after it is created (the form stays on it). */}
                {editingId !== null && rights.canEdit && (
                  <div className="p-3 space-y-2" style={{ border: RULE_SOFT }}>
                    <p className={LBL}>RERA / broker certificate</p>
                    {editingBroker?.LHeadCertificateFileName && (
                      <AuthDownloadLink url={`/api/account-head/${editingId}/certificate/file`} filename={editingBroker.LHeadCertificateFileName}
                        label={`${editingBroker.LHeadCertificateFileName} (on file — download)`} />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <input ref={certInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={locked}
                        onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                        className="flex-1 min-w-[12rem] text-xs text-muted-foreground file:mr-2 file:px-2.5 file:py-1.5 file:border file:border-foreground file:bg-card file:text-foreground file:text-[0.625rem] file:font-heading file:font-semibold file:uppercase file:tracking-[0.1em] disabled:opacity-40" />
                      <button type="button" onClick={handleUploadCertificate} disabled={!certFile || uploadingCert || locked} className={`${KEY_LINE} h-8 px-3`}>
                        <Upload size={12} /> {uploadingCert ? "Uploading…" : "Upload"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  <Switch on={form.LHeadStatus} disabled={locked} onToggle={() => setForm((p) => ({ ...p, LHeadStatus: !p.LHeadStatus }))} label="Status" state={form.LHeadStatus ? "Active" : "Inactive"} />
                  {/* Sec. 194H applies to brokerage payments. */}
                  <Switch on={form.isTdsApplicable} disabled={locked} onToggle={() => setForm((p) => ({ ...p, isTdsApplicable: !p.isTdsApplicable }))} label="TDS applicable" state={form.isTdsApplicable ? "Yes (Sec. 194H)" : "No"} />
                  {form.isTdsApplicable && (
                    <Switch on={form.tdsLimitApplicable} disabled={locked} onToggle={() => setForm((p) => ({ ...p, tdsLimitApplicable: !p.tdsLimitApplicable }))}
                      label="TDS limit" state={form.tdsLimitApplicable ? "Applied (₹30k / ₹1L threshold)" : "Deduct on every bill"} />
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: RULE }}>
                {editingId != null && locked ? (
                  <button onClick={resetForm} className={`${KEY_LINE} h-9 px-4`}>Close</button>
                ) : (
                  <>
                    <button onClick={resetForm} className={`${KEY_LINE} h-9 px-4`}>{editingId != null ? "Cancel" : "Reset"}</button>
                    <button onClick={handleSave} disabled={saving || !canSave} className={`${KEY_INK} h-9 px-4`}>
                      {editingId == null && <Plus size={13} />} {saving ? "Saving…" : editingId != null ? "Update broker" : "Save broker"}
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-4 py-3 flex flex-wrap items-center gap-2.5" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {STATUS_TABS.map((t) => (
                  <button key={t.k || "all"} onClick={() => setFilterStatus(t.k)} className={tabClass(filterStatus === t.k)} style={{ borderRight: RULE_SOFT }}>
                    {t.l} <span className="tabular-nums">{t.n}</span>
                  </button>
                ))}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, contact, phone, RERA…"
                className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              {(search || filterStatus) && <button onClick={() => { setSearch(""); setFilterStatus(""); }} className={`${KEY_LINE} h-9 px-3`}><X size={12} /> Clear</button>}
            </div>
            <DataTable
              data={filtered} columns={columns} loading={isLoading} searchable={false}
              getRowId={(row) => String(row.LHeadId)}
              // A failed load gives its reason; it used to read "Failed to load brokers." whatever went wrong.
              emptyMessage={isError ? ((error as Error)?.message || "Failed to load brokers.") : brokers.length === 0 ? "No brokers yet." : "No broker matches."}
              exportConfig={rights.canExport ? { title: "Broker Master", filename: "broker-master", columns: EXPORT_COLUMNS } : undefined}
            />
          </div>
        </div>
      </SheetShell>

      <Dialog open={!!viewRecord} onOpenChange={(o) => { if (!o) setViewRecord(null); }}>
        <DialogContent className="max-w-lg rounded-none p-5 gap-4" style={{ border: RULE }}>
          {viewRecord && (
            <>
              <div className="pb-3" style={{ borderBottom: RULE }}>
                <p className={LBL}>Broker</p>
                <DialogTitle className="mt-1 flex flex-wrap items-center gap-3 font-heading text-lg font-bold tracking-tight">
                  {viewRecord.LHeadName}
                  <SheetMark text={viewRecord.LHeadStatus ? "Active" : "Inactive"} tone={viewRecord.LHeadStatus ? "done" : "draft"} />
                </DialogTitle>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {([
                  ["Contact person", viewRecord.LHeadContactPerson, false],
                  ["Phone", viewRecord.LHeadPhone, true],
                  ["Email", viewRecord.LHeadEmail, false],
                  ["PAN", viewRecord.LHeadPan, true],
                  ["RERA number", viewRecord.LHeadRera, true],
                  ["Payment terms", viewRecord.LHeadPaymentTerms, false],
                  ["TDS", viewRecord.isTdsApplicable ? "Yes (Sec. 194H)" : "No", false],
                  ["TDS limit", viewRecord.isTdsApplicable ? (viewRecord.tdsLimitApplicable ? "Applied (₹30k / ₹1L threshold)" : "Deduct on every bill") : null, false],
                ] as const).map(([label, value, num]) => (
                  <div key={label} className="min-w-0">
                    <p className={LBL}>{label}</p>
                    <p className={`mt-1 text-sm break-words ${num ? NUM : ""}`}>{value || "—"}</p>
                  </div>
                ))}
                <div className="col-span-2 min-w-0">
                  <p className={LBL}>Address</p>
                  <p className="mt-1 text-sm whitespace-pre-line">{viewRecord.LHeadAddress || "—"}</p>
                </div>
                <div className="col-span-2 min-w-0">
                  <p className={LBL}>Certificate</p>
                  <div className="mt-1">
                    {viewRecord.LHeadCertificateFileName ? (
                      <AuthDownloadLink url={`/api/account-head/${viewRecord.LHeadId}/certificate/file`} filename={viewRecord.LHeadCertificateFileName}
                        label={`${viewRecord.LHeadCertificateFileName} (download)`} />
                    ) : <p className="text-sm text-muted-foreground">Not uploaded</p>}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
                <button onClick={() => setViewRecord(null)} className={`${KEY_LINE} h-9 px-4`}>Close</button>
                {rights.canEdit && (
                  <button onClick={() => { startEdit(viewRecord); setViewRecord(null); }} className={`${KEY_INK} h-9 px-4`}><Pencil size={13} /> Edit broker</button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmBrokerMaster;

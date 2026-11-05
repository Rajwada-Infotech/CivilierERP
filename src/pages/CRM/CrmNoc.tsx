// CRM NOC: one No Objection Certificate per booking, once the Agreement for Sale is registered: from the bank when the
// booking is loan-financed (the lender releases its charge), from the developer otherwise (no dues outstanding).
// Requested, approved, then issued; Handover waits for it.
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Building2, CheckSquare, Landmark, Lock, PenSquare, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/noc";
const STATUSES = ["Pending", "Approved", "Issued", "Rejected"] as const;
const TYPES = ["Organisation", "Bank"] as const;
const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none read-only:bg-muted/30 read-only:border-foreground/20";

// Issued is settled; approved and pending are in hand; rejected has stopped.
const nocTone = (s: string): "done" | "waiting" | "stopped" => (s === "Issued" ? "done" : statusTone(s === "Approved" ? "Pending" : s));
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const PAGE_SIZE = 20;
interface NocListFilters { type: string; status: string; search: string; companyId: string; projectId: string; blockId: string }
// Throws, so a failed load shows as one instead of an empty list.
async function fetchNocList(filters: NocListFilters, page: number, pageSize: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.type !== "All") params.set("type", filters.type);
  if (filters.status !== "All") params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the NOCs (${r.status}).`);
  return {
    rows: (data.rows || []) as any[], total: Number(data.total || 0),
    statusCounts: (data.statusCounts || {}) as Record<string, number>, typeCounts: (data.typeCounts || {}) as Record<string, number>,
  };
}
// The NOC type is resolved per booking from how it is financed, never chosen.
async function fetchEligibleBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookingContext(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try { const r = await fetchWithAuth(`${API}/booking/${bookingId}/context`); return r.ok ? r.json() : null; } catch { return null; }
}
// The NOC of one booking, straight from the server (the list is paged). No type unless the link names one: it used to
// assume Organisation, so a Bank NOC was not found and the Request dialog opened for a booking that had one.
async function fetchNocByBooking(bookingId: string, nocType?: string | null): Promise<any | null> {
  try {
    const params = new URLSearchParams({ bookingId });
    if (nocType) params.set("nocType", nocType);
    const r = await fetchWithAuth(`${API}/by-booking?${params}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const EMPTY_FORM = { BookingId: "", NocType: "Organisation" as string, NocDate: "", Reason: "", BankName: "", LoanAccountNo: "", LoanAmount: "" };

const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DialogHeader><DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">{children}</DialogTitle></DialogHeader>
);
const Foot: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>{children}</div>;
const TypeMark: React.FC<{ type: string }> = ({ type }) => (
  <span className="inline-flex items-center gap-1.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]">
    {type === "Bank" ? <Landmark size={11} /> : <Building2 size={11} />} {type === "Bank" ? "Bank" : "Developer"}
  </span>
);

// Only the notes are kept here: loan sanction and disbursement live on Loan Tracking (the real record).
function EditNocDialog({ noc, onClose, onSaved }: { noc: any; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState(noc.Notes || "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${noc.Id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Notes: notes || null }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save the notes.");
      toast.success("Notes saved");
      onSaved();
      onClose();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <Title><PenSquare size={14} /> Notes · {noc.NocNo}</Title>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={`${INP} h-auto py-2 resize-none`} />
        <Foot>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={save} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Saving…" : "Save"}</button>
        </Foot>
      </DialogContent>
    </Dialog>
  );
}

const CrmNoc: React.FC = () => {
  const rights = usePageRights("crm-noc");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const deepLinkNocType = sp.get("nocType");

  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [bankFieldsLocked, setBankFieldsLocked] = useState(true);
  // The open NOC is kept as a record, not looked up on the page in view: one on another page, or filtered out, opened
  // an empty dialog.
  const [openNoc, setOpenNoc] = useState<any | null>(null);
  const [markingIssued, setMarkingIssued] = useState(false);
  const [editNoc, setEditNoc] = useState<any>(null);

  const listFilters: NocListFilters = useMemo(
    () => ({ type: typeFilter, status: statusFilter, search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [typeFilter, statusFilter, search, cpb],
  );
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-noc", listFilters, page, pageSize],
    queryFn: () => fetchNocList(listFilters, page, pageSize),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const nocs = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const sCounts = listResult?.statusCounts ?? {};
  const tCounts = listResult?.typeCounts ?? {};
  const all = Object.values(sCounts).reduce((a, b) => a + b, 0);

  // A fresher copy from the list replaces the open one.
  const detail = openNoc ? (nocs.find((n: any) => n.Id === openNoc.Id) ?? openNoc) : null;

  const { data: eligibleBookings = [], isFetching: bkgFetching } = useQuery({ queryKey: ["crm-noc-eligible"], queryFn: fetchEligibleBookings, enabled: dialogOpen, staleTime: 0 });
  const { data: context, isFetching: contextLoading } = useQuery({
    queryKey: ["crm-noc-context", form.BookingId], queryFn: () => fetchBookingContext(form.BookingId), enabled: !!form.BookingId,
  });

  // The server's gate: the Agreement for Sale must be registered.
  const agreementRegistered = context?.agreement?.Status === CrmStatus.REGISTERED;
  const canRequest = !!form.BookingId && agreementRegistered && !contextLoading && !saving;

  // ?bookingId=X[&nocType=…] opens that booking's NOC, or the Request dialog for it.
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);
  useEffect(() => {
    if (!deepLinkBookingId || deepLinkResolved) return;
    setDeepLinkResolved(true);
    setSp((prev) => { prev.delete("bookingId"); prev.delete("nocType"); return prev; }, { replace: true });
    fetchNocByBooking(deepLinkBookingId, deepLinkNocType).then((existing) => {
      if (existing) setOpenNoc(existing);
      else if (rights.canCreate) { setForm({ ...EMPTY_FORM, BookingId: deepLinkBookingId }); setDialogOpen(true); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId]);

  // The type follows the booking's financing (resolved by the server on the eligible list). A deep-linked booking gets
  // it once that list is in.
  useEffect(() => {
    if (!form.BookingId) return;
    const bk = (eligibleBookings as any[]).find((b: any) => String(b.Id) === form.BookingId);
    if (!bk) return;
    const resolved = bk.NocType || (bk.HasLoan ? "Bank" : "Organisation");
    setForm((f) => (f.NocType === resolved ? f : { ...f, NocType: resolved }));
  }, [form.BookingId, eligibleBookings]);

  // Bank NOC fills its lender details from Loan Tracking.
  useEffect(() => {
    if (form.NocType !== "Bank" || !context) return;
    setForm((f) => ({
      ...f,
      BankName: f.BankName || context.loanDetail?.BankName || "",
      LoanAccountNo: f.LoanAccountNo || context.loanDetail?.LoanAccountNo || "",
      LoanAmount: f.LoanAmount || (context.loanDetail?.LoanAmount != null ? String(context.loanDetail.LoanAmount) : ""),
    }));
    setBankFieldsLocked(true);
  }, [form.NocType, context]);

  const invalidate = () => ["crm-noc", "crm-noc-eligible", "crm-legal-milestones", "crm-booking-lifecycle", "crm-dashboard", "crm-handover-eligible"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const closeRequest = () => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); };

  const handleCreate = async () => {
    if (!form.BookingId) return void toast.error("Select a booking.");
    if (!agreementRegistered) return void toast.error("The Agreement for Sale must be registered before a NOC can be requested.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, BookingId: parseInt(form.BookingId), LoanAmount: form.LoanAmount || null }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not request the NOC.");
      toast.success(`NOC ${data.NocNo} requested`);
      const bookingId = form.BookingId;
      closeRequest();
      invalidate();
      // Open what was just requested.
      fetchNocByBooking(bookingId).then((n) => n && setOpenNoc(n));
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleMarkIssued = async () => {
    if (!detail) return;
    setMarkingIssued(true);
    try {
      const res = await fetchWithAuth(`${API}/${detail.Id}/mark-issued`, { method: "PUT" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not mark it issued.");
      toast.success("NOC issued");
      setOpenNoc(null);
      invalidate();
      // The issued NOC is what Handover waits for (it pointed at Pre-Possession, which doesn't need it).
      promptNextStep(navigate, "NOC issued: the handover can be scheduled once the possession notice is acknowledged.", "/crm/handover", "Go to Handover");
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setMarkingIssued(false); }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "NocNo", header: "NOC", size: 120, cell: (i) => <span className="font-heading text-xs font-semibold tabular-nums">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 220,
      cell: (i) => (
        <div className="min-w-0">
          <div className="font-medium truncate"><ApplicantNames name={i.row.original.ApplicantName} bookingId={i.row.original.BookingId} applicationId={i.row.original.ApplicationId} /></div>
          <div className="text-xs text-muted-foreground tabular-nums truncate">{[i.row.original.BookingNo, i.row.original.UnitNo].filter(Boolean).join(" · ")}</div>
        </div>
      ) },
    { accessorKey: "NocType", header: "From", size: 120, cell: (i) => <TypeMark type={i.getValue() as string} /> },
    { id: "bankLoan", header: "Lender / loan", size: 190, enableSorting: false,
      cell: (i) => {
        const n = i.row.original;
        return n.NocType === "Bank"
          ? <span className="text-xs tabular-nums">{n.BankName || "—"}{n.LoanAmount ? ` · ${fmtRupees(n.LoanAmount)}` : ""}</span>
          : <span className="text-xs text-muted-foreground">—</span>;
      } },
    { accessorKey: "Status", header: "Status", size: 110, cell: (i) => <SheetMark text={i.row.original.Status} tone={nocTone(i.row.original.Status)} /> },
    { accessorKey: "IssuedDate", header: "Issued", size: 110, cell: (i) => <span className="text-xs text-muted-foreground tabular-nums">{fmtDate(i.row.original.IssuedDate)}</span> },
  ];

  const figures = [
    { label: "NOCs", value: all, note: `${tCounts.Bank ?? 0} bank · ${tCounts.Organisation ?? 0} developer`, go: () => { updateFilter(setStatusFilter)("All"); setTypeFilter("All"); } },
    { label: "Pending", value: sCounts.Pending ?? 0, note: "Waiting for approval", go: () => updateFilter(setStatusFilter)("Pending") },
    { label: "Approved", value: sCounts.Approved ?? 0, note: "To be issued", go: () => updateFilter(setStatusFilter)("Approved") },
    { label: "Issued", value: sCounts.Issued ?? 0, note: `${sCounts.Rejected ?? 0} rejected`, go: () => updateFilter(setStatusFilter)("Issued") },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "NOC"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · NOC"
        title="No Objection Certificates"
        subtitle="One per booking once the agreement is registered: from the bank when it is loan-financed (the lender releases its charge), from the developer otherwise (no dues outstanding)."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => setDialogOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Request NOC</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={x.go} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              <div className="flex items-stretch" style={{ border: RULE }}>
                {(["All", ...TYPES] as const).map((t) => (
                  <button key={t} onClick={() => updateFilter(setTypeFilter)(t)} className={tabClass(typeFilter === t)} style={{ borderRight: RULE_SOFT }}>
                    {t === "All" ? "All" : t === "Bank" ? "Bank" : "Developer"} <span className="tabular-nums">{t === "All" ? all : tCounts[t] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-stretch flex-wrap" style={{ border: RULE }}>
                {(["All", ...STATUSES] as const).map((s) => (
                  <button key={s} onClick={() => updateFilter(setStatusFilter)(s)} className={tabClass(statusFilter === s)} style={{ borderRight: RULE_SOFT }}>
                    {s} <span className="tabular-nums">{s === "All" ? all : sCounts[s] ?? 0}</span>
                  </button>
                ))}
              </div>
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
                placeholder="Search customer or booking…"
                className="h-9 w-full sm:w-64 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
            </div>
            {isError ? (
              <p className="px-5 py-10 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : (
              <DataTable serverPagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
                data={nocs} columns={columns} loading={isLoading} searchable={false} className="border-0"
                emptyMessage={typeFilter !== "All" || statusFilter !== "All" || search || cpb.projectId ? "No NOC matches these filters." : "No NOC requested yet."}
                onRowClick={(row) => setOpenNoc(row.original)} getRowId={(n: any) => String(n.Id)} />
            )}
          </div>
        </div>
      </SheetShell>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeRequest(); }}>
        <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <Title><ShieldCheck size={14} /> Request NOC</Title>
          <p className="text-xs text-muted-foreground -mt-2">One NOC per booking: from the bank if it is loan-financed, from the developer if self-funded. Decided by how the booking is financed.</p>
          <label className="block space-y-1">
            <span className={`block ${LBL}`}>Booking *</span>
            {bkgFetching ? (
              <span className="block text-xs text-muted-foreground py-2">Loading eligible bookings…</span>
            ) : (eligibleBookings as any[]).length === 0 && !form.BookingId ? (
              <span className="flex items-start gap-2 text-xs px-3 py-2.5" style={{ border: RULE_SOFT }}>
                <AlertTriangle size={13} className="shrink-0 mt-0.5" /> No booking can request one: it needs the Agreement for Sale registered and no NOC already on file.
              </span>
            ) : (
              <SearchableSelect value={form.BookingId} onChange={(v) => { setForm((f) => ({ ...f, BookingId: v, BankName: "", LoanAccountNo: "", LoanAmount: "" })); setBankFieldsLocked(true); }}
                placeholder="Select booking" searchPlaceholder="Search booking, customer or unit…"
                options={(eligibleBookings as any[]).map((b: any) => ({ value: String(b.Id), label: [b.BookingNo, b.ApplicantName, b.UnitNo, b.HasLoan ? "home loan" : null].filter(Boolean).join(" · ") }))} />
            )}
          </label>

          {form.BookingId && (
            <div className="px-3 py-2.5 space-y-2 bg-card" style={{ border: RULE }}>
              <div className="flex items-center justify-between gap-2">
                <span className={LBL}>Issued by</span>
                <TypeMark type={form.NocType} />
              </div>
              {contextLoading ? (
                <p className="text-xs text-muted-foreground">Checking the agreement…</p>
              ) : context ? (
                <div className="text-xs space-y-1">
                  <p className="font-semibold"><ApplicantNames name={context.booking.ApplicantName} bookingId={context.booking.Id} applicationId={context.booking.ApplicationId} /><span className="text-muted-foreground font-normal"> · {context.booking.UnitNo}</span></p>
                  {context.agreement ? (
                    <p className={`flex items-center gap-1.5 ${agreementRegistered ? "" : "text-destructive"}`}>
                      {agreementRegistered ? <CheckSquare size={12} /> : <AlertTriangle size={12} />}
                      <span className="tabular-nums">{context.agreement.AgreementNo}</span> · {context.agreement.Status}{!agreementRegistered && " (must be Registered)"}
                    </p>
                  ) : <p className="flex items-center gap-1.5 text-destructive"><AlertTriangle size={12} /> No agreement on file</p>}
                </div>
              ) : null}
            </div>
          )}

          {form.NocType === "Bank" && form.BookingId && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className={`flex items-center gap-1 ${LBL}`}><Landmark size={11} /> Lender (from Loan Tracking)</span>
                <button type="button" onClick={() => setBankFieldsLocked((l) => !l)} className={`${KEY_LINE} h-7 px-2`}>
                  {bankFieldsLocked ? <><PenSquare size={10} /> Edit</> : <><Lock size={10} /> Lock</>}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {([["Bank", "BankName", "text"], ["Loan account no", "LoanAccountNo", "text"], ["Loan amount", "LoanAmount", "number"]] as const).map(([ph, key, type]) => (
                  <input key={key} type={type} placeholder={ph} value={form[key]} readOnly={bankFieldsLocked}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={`${INP} tabular-nums`} />
                ))}
              </div>
            </div>
          )}

          <label className="block space-y-1">
            <span className={`block ${LBL}`}>Reason</span>
            <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))} rows={2} placeholder="Purpose (optional)" className={`${INP} h-auto py-2 resize-none`} />
          </label>
          <Foot>
            <button onClick={closeRequest} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleCreate} disabled={!canRequest || !rights.canCreate} title={!agreementRegistered && form.BookingId ? "The agreement must be registered first" : undefined}
              className={`${KEY_INK} h-9 px-4`}>{saving ? "Requesting…" : "Request NOC"}</button>
          </Foot>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setOpenNoc(null); }}>
        <DialogContent className="max-w-lg p-5 gap-4 rounded-none" style={{ border: RULE }}>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-start justify-between gap-3 pr-6">
                  <span className="min-w-0">
                    <span className={`block ${LBL}`}>{detail.NocType === "Bank" ? "Bank NOC" : "Developer NOC"}</span>
                    <span className="font-heading text-lg font-bold flex items-center gap-2 tabular-nums"><ShieldCheck size={16} /> {detail.NocNo}</span>
                    <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                      <ApplicantNames name={detail.ApplicantName} bookingId={detail.BookingId} applicationId={detail.ApplicationId} /> · <span className="tabular-nums">{[detail.BookingNo, detail.UnitNo, detail.Mobile].filter(Boolean).join(" · ")}</span>
                    </span>
                  </span>
                  <SheetMark text={detail.Status} tone={nocTone(detail.Status)} />
                </DialogTitle>
              </DialogHeader>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: "hsl(var(--foreground) / 0.12)", border: RULE_SOFT }}>
                {([
                  ["Requested on", fmtDate(detail.NocDate)],
                  ["Reason", detail.Reason || "—"],
                  ...(detail.NocType === "Bank" ? [["Bank", detail.BankName || "—"], ["Loan account no", detail.LoanAccountNo || "—"], ["Loan amount", detail.LoanAmount ? fmtRupees(detail.LoanAmount) : "—"]] : []),
                  ["Approved on", fmtDate(detail.ApprovalDate)],
                  ["Issued on", fmtDate(detail.IssuedDate)],
                ] as [string, string][]).map(([k, v], i, arr) => (
                  // An odd last fact spans the row, so no empty cell is left.
                  <div key={k} className={`bg-card px-3 py-2 min-w-0 ${arr.length % 2 && i === arr.length - 1 ? "sm:col-span-2" : ""}`}><dt className={LBL}>{k}</dt><dd className="text-sm font-medium mt-0.5 tabular-nums break-words">{v}</dd></div>
                ))}
              </dl>
              {detail.Notes && <p className="text-sm px-3 py-2" style={{ border: RULE_SOFT }}><span className={`block ${LBL}`}>Notes</span>{detail.Notes}</p>}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3" style={{ borderTop: RULE }}>
                <div className="flex flex-wrap items-center gap-2">
                  {detail.Status === "Issued" ? (
                    <span className="flex items-center gap-1.5 text-sm"><CheckSquare size={14} /> Issued {fmtDate(detail.IssuedDate)}; nothing more to do.</span>
                  ) : detail.Status === CrmStatus.APPROVED && rights.canEdit ? (
                    <button onClick={handleMarkIssued} disabled={markingIssued} className={`${KEY_INK} h-9 px-4`}>{markingIssued ? "Marking…" : "Mark issued"}</button>
                  ) : detail.Status === CrmStatus.PENDING ? (
                    // Approve / Reject for approvers; a "waiting for approval" note for others.
                    <ApprovalActions sheet status={detail.Status} recordId={detail.Id} endpoint={API} module="crm-noc" onSuccess={() => { invalidate(); setOpenNoc(null); }} />
                  ) : detail.Status === CrmStatus.REJECTED ? (
                    <ApprovalActions sheet status={detail.Status} recordId={detail.Id} endpoint={API} submitOnly onSuccess={() => { invalidate(); setOpenNoc(null); }} />
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {/* Notes stay editable until issued, with the edit right (it was offered to anyone). */}
                  {rights.canEdit && detail.Status !== "Issued" && <button onClick={() => setEditNoc(detail)} className={`${KEY_LINE} h-9 px-3`}><PenSquare size={12} /> Notes</button>}
                  <button onClick={() => setOpenNoc(null)} className={`${KEY_LINE} h-9 px-4`}>Close</button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {editNoc && <EditNocDialog noc={editNoc} onClose={() => setEditNoc(null)} onSaved={() => { invalidate(); fetchNocByBooking(String(editNoc.BookingId), editNoc.NocType).then((n) => n && setOpenNoc(n)); }} />}
    </>
  );
};

export default CrmNoc;

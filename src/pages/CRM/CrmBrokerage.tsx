import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, IndianRupee, Lock, RefreshCw, ExternalLink, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { usePageRights } from "@/hooks/usePageRights";
import { useAuth } from "@/contexts/AuthContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useTds } from "@/contexts/TdsContext";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell } from "@/components/sheet/Sheet";
import { API, BrokerageMark, fmt, trancheText } from "./brokerage/config";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";

const BKG_API = "/api/crm/bookings";
const BROKER_API = "/api/account-head?type=BR";
const PAGE_SIZE = 20;
const DIALOG = "rounded-none p-5 gap-4";
// Who sees "Approve & send to Finance" — the approval workflow decides on the server.
const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];
const EMPTY_FORM = { BookingId: "", BrokerId: "", BrokerFirm: "", RateType: "Percentage", RateValue: "", ComputedAmount: "", TDSId: "", Notes: "" };
const STATUS_TABS = [
  { value: "", label: "All" },
  { value: CrmStatus.PENDING, label: "Pending" },
  { value: CrmStatus.APPROVED, label: "With Finance" },
  { value: CrmStatus.PAID, label: "Paid" },
];

type StatusCounts = Record<string, { count: number; net: number }>;
interface ListFilters { search: string; status: string; companyId: string; projectId: string; blockId: string }

async function fetchBrokerageList(f: ListFilters, page: number): Promise<{ rows: any[]; total: number; statusCounts: StatusCounts }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const k of ["search", "status", "companyId", "projectId", "blockId"] as const) if (f[k]) params.set(k, f[k]);
  const r = await fetchWithAuth(`${API}?${params}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load the brokerage records.");
  return { rows: d.rows || [], total: d.total || 0, statusCounts: d.statusCounts || {} };
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBrokers(): Promise<any[]> {
  try { const r = await fetchWithAuth(BROKER_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmBrokerage: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const rights = usePageRights("crm-brokerage");
  const { canEdit: hasApprovalInboxEdit } = usePageRights("approval-inbox");
  const { currentUser } = useAuth();
  const isApprover = CRM_APPROVER_ROLES.includes(String(currentUser?.role || "")) || hasApprovalInboxEdit;
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const reset = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => reset(setSearch)(v));

  const listFilters: ListFilters = useMemo(() => ({ search, status, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }), [search, status, cpb]);
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-brokerage", listFilters, page],
    queryFn: () => fetchBrokerageList(listFilters, page),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const records = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000, enabled: dialogOpen && !editing });
  const { data: brokers = [] } = useQuery({ queryKey: ["broker-master"], queryFn: fetchBrokers, staleTime: 5 * 60_000, enabled: dialogOpen });
  const { tdsRecords } = useTds();
  // Broker Master is the broker's identity — shown read-only once picked; firm and rate are per deal.
  const selectedBroker = useMemo(() => (brokers as any[]).find((b: any) => String(b.LHeadId) === form.BrokerId) || null, [brokers, form.BrokerId]);

  const closeDialog = () => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); setEditing(null); };
  const openCreate = () => { setEditing(null); setForm({ ...EMPTY_FORM }); setDialogOpen(true); };
  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      BookingId: String(r.BookingId || ""), BrokerId: String(r.BrokerId || ""), BrokerFirm: r.BrokerFirm || "",
      RateType: r.RateType || "Percentage", RateValue: r.RateValue != null ? String(r.RateValue) : "",
      ComputedAmount: r.ComputedAmount != null ? String(r.ComputedAmount) : "", TDSId: r.TDSId != null ? String(r.TDSId) : "", Notes: r.Notes || "",
    });
    setDialogOpen(true);
  };

  // ?view= (the Approval Inbox's Review & Approve, Broker Payments' Review) opens that record — looked up directly,
  // since it's often not on the page loaded.
  const viewId = searchParams.get("view");
  useEffect(() => {
    if (!viewId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchWithAuth(`${API}/${encodeURIComponent(viewId)}`);
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error || "Brokerage record not found");
        if (cancelled) return;
        if (rights.canEdit && d.brokerage.Status === CrmStatus.PENDING && !d.brokerage.IsLocked) openEdit(d.brokerage);
        else setSearchInput(d.brokerage.BookingNo || "");
      } catch (e: any) {
        if (!cancelled) toast.error(e.message);
      } finally {
        if (!cancelled) setSearchParams((sp) => { sp.delete("view"); return sp; }, { replace: true });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  const handleApprove = async () => {
    if (!editing) return;
    setApproving(true);
    try {
      const res = await fetchWithAuth(`${API}/${editing.Id}/approve`, { method: "PUT", headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.financeHandoffError) toast.warning(data.financeHandoffError);
      else toast.success("Brokerage approved and sent to Finance");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["crm-brokerage"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setApproving(false);
    }
  };

  const handleSave = async () => {
    if (!editing && (!form.BookingId || !form.BrokerId || !form.RateValue)) { toast.error("Booking, broker and rate are required"); return; }
    if (editing && (!form.RateValue || !form.ComputedAmount)) { toast.error("Rate and approved amount are required"); return; }
    if (!(Number(form.RateValue) > 0)) { toast.error("Enter a rate above zero"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(editing ? `${API}/${editing.Id}` : API, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          BookingId: form.BookingId ? parseInt(form.BookingId, 10) : undefined,
          BrokerId: form.BrokerId ? parseInt(form.BrokerId, 10) : undefined,
          RateValue: form.RateValue ? Number(form.RateValue) : undefined,
          ComputedAmount: form.ComputedAmount ? Number(form.ComputedAmount) : undefined,
          TDSId: form.TDSId ? parseInt(form.TDSId, 10) : null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error);
      toast.success(editing ? "Brokerage updated" : "Brokerage recorded");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["crm-brokerage"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const c = (k: string) => counts[k] ?? { count: 0, net: 0 };
  const allCount = Object.values(counts).reduce((s, x) => s + x.count, 0);
  const figures = [
    { label: "Pending", value: fmt(c(CrmStatus.PENDING).net), note: `${c(CrmStatus.PENDING).count} to approve`, tab: CrmStatus.PENDING as string },
    { label: "With Finance", value: fmt(c(CrmStatus.APPROVED).net), note: `${c(CrmStatus.APPROVED).count} approved, being paid`, tab: CrmStatus.APPROVED as string },
    { label: "Paid", value: fmt(c(CrmStatus.PAID).net), note: `${c(CrmStatus.PAID).count} paid out`, tab: CrmStatus.PAID as string },
    { label: "Locked", value: String(c("Locked").count), note: "Unlock when the agreement is executed", tab: "" },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3";
  const SEL = `${INP} text-sm`;
  const tdsAllowed = selectedBroker?.IsTdsApplicable !== false;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Brokerage"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Brokerage"
        subtitle="Each booking's broker and the brokerage owed — approved here, paid by Finance. Internal only: never shown to the customer."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            <button onClick={() => navigate("/crm/broker-payments")} className={`${KEY_LINE} h-9 px-4`}><IndianRupee size={13} /> Broker payments</button>
            {rights.canCreate && <button onClick={openCreate} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Add broker</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => reset(setStatus)(x.tab)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9 }}>{isLoading && !listResult ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                  {STATUS_TABS.map((t) => (
                    <button key={t.value || "all"} onClick={() => reset(setStatus)(t.value)} className={tabClass(status === t.value)} style={{ borderRight: RULE_SOFT }}>
                      {t.label} <span className="tabular-nums">{t.value ? c(t.value).count : allCount}</span>
                    </button>
                  ))}
                </div>
                <span className="ml-auto text-[0.6875rem] text-muted-foreground inline-flex items-center gap-1.5"><ShieldAlert size={12} /> Internal only — never in the customer portal</span>
              </div>
              <div className="flex gap-2.5 flex-wrap items-center">
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") reset(setSearch)(searchInput.trim()); }}
                  placeholder="Search customer, booking, broker…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <CrmCompanyProjectBlockFilter value={cpb} onChange={reset(setCpb)} />
              </div>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[1000px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Booking</th><th className={th}>Broker</th><th className={th}>Rate · tranche</th>
                    <th className={`${th} !text-right`}>Amount · TDS · net</th><th className={th}>State</th><th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={6} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading && !listResult ? (
                    <tr><td colSpan={6} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={6} className={`${td} text-center text-muted-foreground`}>{search || status || cpb.projectId ? "No brokerage matches." : "No brokerage recorded yet."}</td></tr>
                  ) : records.map((r: any) => {
                    const gross = Number(r.ComputedAmount || 0);
                    const tds = Number(r.TDSAmount || 0);
                    const net = Number(r.NetPayable ?? gross);
                    return (
                      <tr key={r.Id} className={`align-top ${r.IsLocked ? "text-muted-foreground" : ""}`} style={{ borderBottom: RULE_SOFT }}>
                        <td className={td}>
                          <div className="font-heading text-xs font-semibold tabular-nums text-foreground">{r.BookingNo}</div>
                          {r.ApplicantName && <div className="mt-1 text-[0.6875rem] text-muted-foreground truncate max-w-[180px]"><ApplicantNames name={r.ApplicantName} bookingId={r.BookingId} /></div>}
                        </td>
                        <td className={td}>
                          <div className="text-xs font-medium text-foreground">{r.BrokerName}</div>
                          {r.BrokerFirm && <div className="mt-1 text-[0.6875rem] text-muted-foreground">{r.BrokerFirm}</div>}
                        </td>
                        <td className={td}>
                          <div className="font-heading text-xs tabular-nums">{r.RateType === "Percentage" ? `${r.RateValue}%` : fmt(r.RateValue)}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground inline-flex items-center gap-1">{r.IsLocked && <Lock size={10} />}{trancheText(r)}</div>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          <div className="font-heading text-xs">{fmt(gross)}</div>
                          {tds > 0 && <div className="mt-1 text-[0.6875rem] text-muted-foreground">− TDS {r.TDSPercentage}%: {fmt(tds)}</div>}
                          <div className="mt-1 font-heading font-semibold text-foreground">{fmt(net)}</div>
                        </td>
                        <td className={td}><BrokerageMark r={r} /></td>
                        <td className={`${td} text-right`}>
                          {r.IsLocked ? (
                            <span className="text-[0.6875rem]">Unlocks once the agreement is executed</span>
                          ) : (
                            <div className="inline-flex items-center gap-2 flex-wrap justify-end">
                              {/* Approve / reject happen in the Approval Inbox; this only submits. */}
                              <ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} submitOnly sheet onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-brokerage"] })} />
                              {rights.canEdit && r.Status === CrmStatus.PENDING && <button onClick={() => openEdit(r)} className={`${KEY_LINE} h-8 px-3`}>Customise amount</button>}
                              {r.Status === CrmStatus.APPROVED && (
                                <button onClick={() => navigate(r.FinancePaymentId != null ? `/payments?view=${r.FinancePaymentId}` : "/payments")} className={`${KEY_LINE} h-8 px-3`}>
                                  {r.FinancePaymentDocNo ? `Finance ${r.FinancePaymentDocNo}` : "In Finance"} <ExternalLink size={11} />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
          </div>
        </div>

        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
          <DialogContent className={`max-w-md max-h-[90vh] overflow-y-auto ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">{editing ? "Customise brokerage" : "Add broker to a booking"}</DialogTitle>
              {editing && <DialogDescription className="text-xs tabular-nums">{editing.BookingNo} · {editing.BrokerName} · {trancheText(editing)}</DialogDescription>}
            </DialogHeader>
            <div className="space-y-3">
              {!editing && (
                <>
                  <div>
                    <label className={`block mb-1 ${LBL}`}>Booking *</label>
                    <SearchableNativeSelect value={form.BookingId} searchPlaceholder="Search booking, customer…" onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))} className={SEL}>
                      <option value="">Select booking</option>
                      {(bookings as any[]).map((b: any) => (
                        <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} — ${b.ApplicantName} (${fmt(b.TotalValue)})`}</option>
                      ))}
                    </SearchableNativeSelect>
                  </div>
                  <div>
                    <label className={`block mb-1 ${LBL}`}>Broker * (from Broker Master)</label>
                    <SearchableNativeSelect value={form.BrokerId} searchPlaceholder="Search broker…"
                      onChange={(e) => {
                        const broker = (brokers as any[]).find((b: any) => String(b.LHeadId) === e.target.value);
                        // A broker marked TDS not applicable clears the TDS choice.
                        setForm((f) => ({ ...f, BrokerId: e.target.value, TDSId: broker && !broker.IsTdsApplicable ? "" : f.TDSId }));
                      }} className={SEL}>
                      <option value="">Select broker</option>
                      {(brokers as any[]).map((b: any) => (
                        <option key={b.LHeadId} value={String(b.LHeadId)}>{`${b.LHeadName}${b.LHeadPhone ? ` — ${b.LHeadPhone}` : ""}`}</option>
                      ))}
                    </SearchableNativeSelect>
                    {!brokers.length && <p className="mt-1 text-xs text-muted-foreground">No brokers yet — add one in Broker Master first.</p>}
                  </div>
                </>
              )}
              {selectedBroker && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2 text-xs" style={{ border: RULE_SOFT }}>
                  {selectedBroker.LHeadPhone && <div><span className="text-muted-foreground">Phone </span><span className="tabular-nums">{selectedBroker.LHeadPhone}</span></div>}
                  {selectedBroker.LHeadPan && <div><span className="text-muted-foreground">PAN </span><span className="font-heading tabular-nums">{selectedBroker.LHeadPan}</span></div>}
                  {selectedBroker.LHeadRera && <div><span className="text-muted-foreground">RERA </span><span className="font-heading tabular-nums">{selectedBroker.LHeadRera}</span></div>}
                  {selectedBroker.LHeadPaymentTerms && <div><span className="text-muted-foreground">Terms </span>{selectedBroker.LHeadPaymentTerms}</div>}
                  <div><span className="text-muted-foreground">TDS </span><span className="font-medium">{tdsAllowed ? "Applicable (s.194H)" : "Not applicable"}</span></div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block mb-1 ${LBL}`}>Firm (this deal)</label>
                  <input value={form.BrokerFirm} onChange={(e) => setForm((f) => ({ ...f, BrokerFirm: e.target.value }))} className={INP} />
                </div>
                <div>
                  <label className={`block mb-1 ${LBL}`}>Rate type</label>
                  <select value={form.RateType} onChange={(e) => setForm((f) => ({ ...f, RateType: e.target.value }))} className={SEL}>
                    <option value="Percentage">Percentage</option>
                    <option value="Amount">Fixed amount</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block mb-1 ${LBL}`}>Rate * ({form.RateType === "Percentage" ? "%" : "₹"})</label>
                  <input type="number" value={form.RateValue} onChange={(e) => setForm((f) => ({ ...f, RateValue: e.target.value }))} className={`${INP} tabular-nums`} />
                </div>
                <div>
                  <label className={`block mb-1 ${LBL}`}>TDS (s.194H)</label>
                  <select value={form.TDSId} onChange={(e) => setForm((f) => ({ ...f, TDSId: e.target.value }))} disabled={!tdsAllowed} className={`${SEL} disabled:opacity-50`}>
                    <option value="">None / nil certificate</option>
                    {tdsRecords.filter((t) => t.status).map((t) => <option key={t.id} value={t.id}>{`${t.name} (${t.percentage}%)`}</option>)}
                  </select>
                </div>
              </div>
              {editing && (
                <div>
                  <label className={`block mb-1 ${LBL}`}>Approved amount *</label>
                  <input type="number" value={form.ComputedAmount} onChange={(e) => setForm((f) => ({ ...f, ComputedAmount: e.target.value }))} className={`${INP} tabular-nums`} />
                </div>
              )}
              <div>
                <label className={`block mb-1 ${LBL}`}>Notes</label>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))} rows={2} className={TEXTAREA} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <button onClick={closeDialog} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleSave} disabled={saving || approving} className={`${KEY_LINE} h-9 px-4 ${editing ? "" : "!bg-foreground !text-card"}`}>
                {saving ? "Saving…" : editing ? "Save changes" : "Add"}
              </button>
              {editing && editing.Status === CrmStatus.PENDING && isApprover && (
                <button onClick={handleApprove} disabled={saving || approving} className={`${KEY_INK} h-9 px-4`}>{approving ? "Approving…" : "Approve & send to Finance"}</button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmBrokerage;

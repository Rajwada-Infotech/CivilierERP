import React, { useEffect, useState, useMemo } from "react";
import { AutoInput } from "@/components/ui/date-input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Landmark, Pencil, Lock, Sparkles, Check, X, CalendarDays, RefreshCw, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";
import { localDay } from "./salesDeed/config";

const BKG_API = "/api/crm/bookings";
const WC_API  = "/api/crm/welcome-calls";

// "Closed" is set by the system only — a previous owner's loan after a resale.
type LoanStatus = "NotApplied" | "Applied" | "Sanctioned" | "Disbursed" | "Rejected" | "Closed";
const STATUS_ORDER: LoanStatus[] = ["NotApplied", "Applied", "Sanctioned", "Disbursed"];
const SANCTION_STATUSES: LoanStatus[] = ["NotApplied", "Applied", "Sanctioned", "Disbursed", "Rejected"];
const statusText = (s: string) => (s === "NotApplied" ? "Not applied" : s === "Closed" ? "Closed (previous owner)" : s);
const statusTone = (s: string): "done" | "waiting" | "stopped" | "none" =>
  s === "Disbursed" || s === "Sanctioned" ? "done" : s === "Rejected" ? "stopped" : s === "Applied" ? "waiting" : "none";

const EMPTY_FORM = {
  BankName: "", BranchName: "", LoanAmount: "", SanctionStatus: "NotApplied" as LoanStatus,
  SanctionDate: "", LoanAccountNo: "", RmName: "", RmContact: "", Notes: "",
};

const fmt = (n: number | null | undefined) => (n != null && n !== 0 ? fmtRupees(Number(n)) : "—");

interface LoanCpb { companyId: string; projectId: string; blockId: string }
// Fetched in full: the status counts and disbursed total are worked out from the whole set; company / project / block
// narrow it server-side.
async function fetchLoanSummary(cpb?: LoanCpb): Promise<any[]> {
  const params = new URLSearchParams();
  if (cpb?.companyId) params.set("companyId", cpb.companyId);
  if (cpb?.projectId) params.set("projectId", cpb.projectId);
  if (cpb?.blockId) params.set("blockId", cpb.blockId);
  const qs = params.toString();
  // A failed load used to read as "No bookings match".
  const r = await fetchWithAuth(`/api/crm/loan-summary${qs ? `?${qs}` : ""}`);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || `Could not load the loans (${r.status}).`);
  return Array.isArray(data) ? data : [];
}
async function fetchBankPreferences(bookingId: number): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${WC_API}/${bookingId}/bank-preferences`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}

/** The loan's four steps as squares, inked once reached; a rejected loan ends in a red square. */
function LoanStepper({ status }: { status: string }) {
  const idx = STATUS_ORDER.indexOf(status as LoanStatus);
  const rejected = status === "Rejected";
  return (
    <div className="flex items-center w-full">
      {STATUS_ORDER.map((step, i) => {
        const done = !rejected && idx >= i;
        const curr = !rejected && idx === i;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center flex-1 min-w-0">
              <span className={`w-7 h-7 flex items-center justify-center font-heading text-[0.6875rem] font-bold tabular-nums ${
                done && !curr ? "bg-foreground text-card border border-foreground" : curr ? "bg-card text-foreground border-2 border-foreground" : "bg-card text-muted-foreground border border-foreground/25"}`}>
                {done && !curr ? <Check size={13} /> : i + 1}
              </span>
              <span className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em] mt-1.5 text-center leading-tight ${done ? "text-foreground" : "text-muted-foreground"}`}>{statusText(step)}</span>
            </div>
            {i < STATUS_ORDER.length - 1 && <div className={`shrink-0 h-px w-6 mx-0.5 ${!rejected && idx > i ? "bg-foreground" : "bg-foreground/20"}`} />}
          </React.Fragment>
        );
      })}
      {rejected && (
        <div className="flex flex-col items-center ml-2">
          <span className="w-7 h-7 flex items-center justify-center bg-destructive text-white"><X size={13} /></span>
          <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em] mt-1.5 text-destructive">Rejected</span>
        </div>
      )}
    </div>
  );
}

const Mark = ({ status }: { status: string }) => statusTone(status) === "none"
  ? <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground whitespace-nowrap">{statusText(status)}</span>
  : <SheetMark text={statusText(status)} tone={statusTone(status) as "done" | "waiting" | "stopped"} />;

const CrmLoanTracking: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-loan-details");
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");

  const [activeTab, setActiveTab] = useState<string>("All");
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });

  const { data: rows = [], isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-loan-summary", cpb],
    queryFn: () => fetchLoanSummary(cpb),
    staleTime: 30_000,
  });
  const { data: bankPreferences = [] } = useQuery({
    queryKey: ["crm-bank-preferences", editingRow?.BookingId],
    queryFn: () => fetchBankPreferences(editingRow!.BookingId),
    enabled: !!editingRow && !locked,
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    const r = rows as any[];
    const count = (s: string) => r.filter((x) => x.SanctionStatus === s).length;
    return {
      notApplied: count("NotApplied"), applied: count("Applied"), sanctioned: count("Sanctioned"), disbursed: count("Disbursed"), rejected: count("Rejected"),
      totalDisbursedAmt: r.reduce((s, x) => s + (x.DisbursedAmount || 0), 0),
      sanctionedAmt: r.filter((x) => ["Sanctioned", "Disbursed"].includes(x.SanctionStatus)).reduce((s, x) => s + Number(x.LoanAmount || 0), 0),
    };
  }, [rows]);

  const TABS = [
    { key: "All", label: "All", count: (rows as any[]).length },
    { key: "NotApplied", label: "Not applied", count: stats.notApplied },
    { key: "Applied", label: "Applied", count: stats.applied },
    { key: "Sanctioned", label: "Sanctioned", count: stats.sanctioned },
    { key: "Disbursed", label: "Disbursed", count: stats.disbursed },
    { key: "Rejected", label: "Rejected", count: stats.rejected },
  ];
  const filtered = useMemo(() => (rows as any[]).filter((r: any) => activeTab === "All" || r.SanctionStatus === activeTab), [rows, activeTab]);

  const openRow = (row: any) => {
    setEditingRow(row);
    setForm(row.LoanId != null ? {
      BankName: row.BankName || "",
      BranchName: row.BranchName || "",
      LoanAmount: row.LoanAmount != null ? String(row.LoanAmount) : "",
      SanctionStatus: row.SanctionStatus || "NotApplied",
      SanctionDate: row.SanctionDate ? String(row.SanctionDate).slice(0, 10) : "",
      LoanAccountNo: row.LoanAccountNo || "",
      RmName: row.RmName || "",
      RmContact: row.RmContact || "",
      Notes: row.Notes || "",
    } : { ...EMPTY_FORM });
    // A recorded loan opens read-only (Edit unlocks it); without the edit right everything does — a booking with
    // no loan used to open straight into a form the server would refuse to save.
    setLocked(row.LoanId != null || !rights.canEdit);
  };
  const closeDialog = () => { setEditingRow(null); setLocked(false); setForm({ ...EMPTY_FORM }); };

  // Deep link: open that booking's loan once the list is in.
  useEffect(() => {
    if (!deepLinkBookingId || editingRow || (rows as any[]).length === 0) return;
    const row = (rows as any[]).find((r: any) => r.BookingId === parseInt(deepLinkBookingId, 10));
    if (row) openRow(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, (rows as any[]).length]);

  const handleSave = async () => {
    if (!editingRow) return;
    if (["Sanctioned", "Disbursed"].includes(form.SanctionStatus) && !(Number(form.LoanAmount) > 0)) { toast.error("Enter the sanctioned amount"); return; }
    if (["Applied", "Sanctioned", "Disbursed"].includes(form.SanctionStatus) && !form.BankName.trim()) { toast.error("Enter the bank"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${BKG_API}/${editingRow.BookingId}/loan`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error);
      toast.success("Loan details saved");
      closeDialog();
      qc.invalidateQueries({ queryKey: ["crm-loan-summary"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const figures = [
    { label: "Not applied", value: String(stats.notApplied), note: "Bookings without a loan yet", tab: "NotApplied" },
    { label: "Applied", value: String(stats.applied), note: `${stats.rejected} rejected`, tab: "Applied" },
    { label: "Sanctioned", value: String(stats.sanctioned + stats.disbursed), note: fmt(stats.sanctionedAmt), tab: "Sanctioned" },
    { label: "Disbursed", value: String(stats.disbursed), note: `${fmt(stats.totalDisbursedAmt)} via home-loan receipts`, tab: "Disbursed" },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3.5";
  const field = (key: keyof typeof EMPTY_FORM, label: string, type = "text", span2 = false) => (
    <div key={key} className={span2 ? "sm:col-span-2" : ""}>
      <label className={`block mb-1 ${LBL}`}>{label}</label>
      {locked ? (
        <p className={`text-sm px-2.5 py-2 ${type === "number" ? "font-heading tabular-nums" : ""}`} style={{ border: RULE_SOFT }}>
          {type === "number" ? fmt(Number(form[key]) || null) : (form[key] as string) || <span className="text-muted-foreground">—</span>}
        </p>
      ) : (
        <AutoInput type={type} value={form[key] as string} max={type === "date" ? localDay() : undefined}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={`${INP} ${type === "number" ? "tabular-nums" : ""}`} />
      )}
    </div>
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Home Loan Tracking"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Home Loan Tracking"
        subtitle="Every booking's home loan: the bank, sanction and disbursement, compared with what actually came in on home-loan receipts."
        action={<button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>}
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => setActiveTab(x.tab)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {TABS.map((t) => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)} className={tabClass(activeTab === t.key)} style={{ borderRight: RULE_SOFT }}>
                    {t.label} <span className="tabular-nums">{t.count}</span>
                  </button>
                ))}
              </div>
              <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />
            </div>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Booking</th><th className={th}>Customer</th><th className={`${th} !text-right`}>Booking value</th><th className={th}>Bank</th>
                    <th className={`${th} !text-right`}>Sanctioned</th><th className={`${th} !text-right`}>Disbursed (actual)</th><th className={th}>Status</th><th className={th}>Bank RM</th>
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={8} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading ? (
                    <tr><td colSpan={8} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className={`${td} text-center text-muted-foreground`}>No booking matches this filter.</td></tr>
                  ) : filtered.map((r: any) => {
                    const mismatch = r.SanctionStatus === "Disbursed" && r.LoanAmount > 0 && Math.abs((r.DisbursedAmount || 0) - r.LoanAmount) > 1;
                    return (
                      <tr key={r.BookingId} onClick={() => openRow(r)} className="align-top cursor-pointer hover:bg-primary/5 transition-colors" style={{ borderBottom: RULE_SOFT }}>
                        <td className={`${td} font-heading text-xs font-semibold tabular-nums whitespace-nowrap`}>{r.BookingNo}</td>
                        <td className={td}>
                          <div className="font-medium leading-snug"><ApplicantNames name={r.ApplicantName} bookingId={r.BookingId} applicationId={r.ApplicationId} /></div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{r.UnitNo} · {r.Mobile}</div>
                        </td>
                        <td className={`${td} text-right font-heading tabular-nums whitespace-nowrap`}>{fmt(r.TotalValue)}</td>
                        <td className={td}>
                          <div>{r.BankName || <span className="text-muted-foreground">—</span>}</div>
                          {r.BranchName && <div className="mt-1 text-[0.6875rem] text-muted-foreground">{r.BranchName}</div>}
                        </td>
                        <td className={`${td} text-right font-heading tabular-nums whitespace-nowrap`}>{fmt(r.LoanAmount)}</td>
                        <td className={`${td} text-right whitespace-nowrap`} title={mismatch ? "Sanctioned and disbursed amounts don't match — check with Accounts" : undefined}>
                          <span className={`font-heading font-semibold tabular-nums ${mismatch ? "text-destructive" : r.DisbursedAmount > 0 ? "" : "text-muted-foreground"}`}>{fmt(r.DisbursedAmount)}</span>
                        </td>
                        <td className={td}><Mark status={r.SanctionStatus} /></td>
                        <td className={td}>
                          {r.RmName ? <><div>{r.RmName}</div><div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{r.RmContact}</div></> : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <Dialog open={!!editingRow} onOpenChange={(o) => { if (!o) closeDialog(); }}>
          <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto thin-scroll rounded-none p-5 gap-4" style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
                <span className="flex items-center gap-2"><Landmark size={16} /> Home loan</span>
                {locked && rights.canEdit && <button onClick={() => setLocked(false)} className={`${KEY_LINE} h-8 px-2.5 shrink-0`}><Pencil size={11} /> Edit</button>}
              </DialogTitle>
            </DialogHeader>

            {editingRow && (
              <div className="space-y-4">
                <div className="px-4 py-3" style={{ border: RULE }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className={`block ${LBL}`}>Booking</span>
                      <div className="font-heading font-bold leading-tight mt-0.5"><ApplicantNames name={editingRow.ApplicantName} bookingId={editingRow.BookingId} applicationId={editingRow.ApplicationId} /></div>
                    </div>
                    <Mark status={editingRow.SanctionStatus} />
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                    {editingRow.BookingNo} · unit {editingRow.UnitNo} · {editingRow.Mobile} · <span className="font-heading">{fmt(editingRow.TotalValue)}</span> booking value
                  </div>
                </div>

                <div className="px-3 pt-3 pb-2.5" style={{ border: RULE_SOFT }}>
                  <p className={`${LBL} mb-3`}>Loan progress</p>
                  <LoanStepper status={editingRow.SanctionStatus} />
                </div>

                {editingRow.LoanId != null && (() => {
                  const mismatch = editingRow.SanctionStatus === "Disbursed" && editingRow.LoanAmount > 0 && Math.abs((editingRow.DisbursedAmount || 0) - editingRow.LoanAmount) > 1;
                  return (
                    <div className="px-4 py-3 text-sm" style={{ border: RULE_SOFT, borderLeft: mismatch ? "3px solid hsl(var(--destructive))" : RULE_SOFT }}>
                      <div className="flex items-center justify-between gap-4">
                        <div><p className={LBL}>Sanctioned</p><p className="font-heading font-semibold tabular-nums mt-0.5">{fmt(editingRow.LoanAmount)}</p></div>
                        <div className="text-right"><p className={LBL}>Disbursed via receipts</p><p className="font-heading font-semibold tabular-nums mt-0.5">{fmt(editingRow.DisbursedAmount)}</p></div>
                      </div>
                      {mismatch && <p className="text-xs text-destructive mt-2">Sanctioned and disbursed amounts don't match — check with Accounts.</p>}
                    </div>
                  );
                })()}

                {locked && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5" style={{ border: RULE_SOFT }}>
                    <Lock size={11} /> {rights.canEdit ? "Viewing only — Edit to make changes." : "Viewing only."}
                  </p>
                )}

                {!locked && (bankPreferences as any[]).length > 0 && (
                  <div className="px-4 py-3" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
                    <div className={`flex items-center gap-1.5 ${LBL} mb-2`}><Sparkles size={11} /> Bank preferences from the welcome call</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(bankPreferences as any[]).map((bp: any) => (
                        <button key={bp.Id} type="button" onClick={() => setForm((f) => ({ ...f, BankName: bp.BankName }))}
                          title={bp.Remarks ? `Note: ${bp.Remarks}` : `Use ${bp.BankName}`}
                          className={`${KEY_LINE} h-7 px-2 normal-case tracking-normal font-sans text-xs`}>
                          <Landmark size={10} /> {bp.BankName}{bp.Remarks && <span className="text-muted-foreground"> · {bp.Remarks}</span>}
                        </button>
                      ))}
                    </div>
                    <p className="text-[0.625rem] text-muted-foreground mt-1.5">Pick one to fill in the bank below.</p>
                  </div>
                )}

                {!locked && (
                  <div>
                    <label className={`block mb-1 ${LBL}`}>Sanction status</label>
                    <select value={form.SanctionStatus} onChange={(e) => {
                      const next = e.target.value as LoanStatus;
                      if (next === "NotApplied" && (Number(editingRow?.DisbursedAmount) > 0 || editingRow?.SanctionStatus === "Disbursed")) {
                        toast.error("A disbursed loan can't go back to Not Applied");
                        return;
                      }
                      setForm((f) => ({ ...f, SanctionStatus: next }));
                    }} className={INP}>
                      {SANCTION_STATUSES.map((s) => <option key={s} value={s}>{statusText(s)}</option>)}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {field("BankName", "Bank")}
                  {field("BranchName", "Branch")}
                  {field("LoanAmount", "Sanctioned amount (₹)", "number")}
                  {field("SanctionDate", "Sanction date", "date")}
                  {field("LoanAccountNo", "Loan account no.", "text", true)}
                  {field("RmName", "Bank RM")}
                  {field("RmContact", "RM contact")}
                </div>

                <div>
                  <label className={`block mb-1 ${LBL}`}>Notes</label>
                  {locked
                    ? <p className="text-sm px-2.5 py-2 min-h-[60px] whitespace-pre-wrap" style={{ border: RULE_SOFT }}>{form.Notes || <span className="text-muted-foreground">—</span>}</p>
                    : <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))} rows={3} className={TEXTAREA} />}
                </div>

                {editingRow.LoanCreatedAt && (
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
                    <span className="flex items-center gap-1"><CalendarDays size={10} /> Added {new Date(editingRow.LoanCreatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                    {editingRow.LoanUpdatedAt && <span>Updated {new Date(editingRow.LoanUpdatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}
                  </div>
                )}

              </div>
            )}
            {/* Its own block: the dialog hides a footer that only says Close (the × does that) — inside the body it
                took the whole body with it, so a loan opened read-only showed nothing. */}
            {editingRow && (
              <DialogFooter className="gap-2">
                {locked ? (
                  <button onClick={closeDialog} className={`${KEY_LINE} h-9 px-4`}>Close</button>
                ) : (
                  <>
                    <button onClick={closeDialog} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                    <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-4`}><Wallet size={13} /> {saving ? "Saving…" : editingRow.LoanId != null ? "Update" : "Save"}</button>
                  </>
                )}
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default CrmLoanTracking;

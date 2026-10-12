import React, { useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DateInput } from "@/components/ui/date-input";
import {
  ArrowLeft, ArrowRightLeft, Check, CircleDashed, Clock, ExternalLink, FileText, Loader2, Lock, ShieldCheck, Undo2, Upload, X,
} from "lucide-react";

// One resale / buy-back CASE: the stages a sold property goes through before
// it passes to a new buyer (or back to us). Every stage is worked out on the
// server from the real records (GET /api/crm/resales/:id/case) — this page
// only shows them and offers the next action. Existing pages do their own
// part: the buyer's application (Applications), the fee receipt (Finance →
// Received Payments), approvals (Approval Inbox).

const API = "/api/crm/resales";
const fmt = (n: any) => (n == null || n === "" ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const date = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const label = "text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1.5";
const input = "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
const btn = "inline-flex items-center justify-center gap-1.5 px-3 h-9 text-sm rounded-lg font-medium disabled:opacity-40 transition-colors";
const primary = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`;
const ghost = `${btn} border border-border text-foreground hover:bg-muted`;

interface Stage { key: string; label: string; ok: boolean; na: boolean; state: "done" | "current" | "waiting" | "stopped"; blockers: string[]; detail: string | null }
interface CaseDoc { Id: number; DocumentType: string; FileName: string; Status: string; Remarks: string | null; CreatedAt: string; UploadedByName: string | null; VerifiedByName: string | null }
interface CaseState {
  case: any;
  seller: { overdue: any[]; openCancellation: any; openRefund: any; loans: any[]; agreement: any };
  documents: CaseDoc[];
  docTypes: Record<string, string>;
  stages: Stage[];
  currentStage: string | null;
}

const DEED_STEPS = ["Draft", "LegalApproved", "Consented", "Executed", "DutyPaid", "Registered"];
const DEED_LABEL: Record<string, string> = {
  Draft: "Drafted", LegalApproved: "Legal approval", Consented: "Seller & buyer consent", Executed: "Executed", DutyPaid: "Stamp duty paid", Registered: "Registered",
};

const StageDot = ({ s }: { s: Stage }) => {
  if (s.state === "done") return <span className="w-6 h-6 rounded-full bg-emerald-500 text-white grid place-items-center"><Check size={13} /></span>;
  if (s.state === "current") return <span className="w-6 h-6 rounded-full border-2 border-primary bg-primary/10 text-primary grid place-items-center"><Clock size={12} /></span>;
  if (s.state === "stopped") return <span className="w-6 h-6 rounded-full border border-border bg-muted text-muted-foreground grid place-items-center"><X size={12} /></span>;
  return <span className="w-6 h-6 rounded-full border border-dashed border-border text-muted-foreground grid place-items-center"><Lock size={11} /></span>;
};

const CrmResaleCase: React.FC = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const rights = usePageRights("crm-resales");
  const [busy, setBusy] = useState<string | null>(null);
  const [deedForm, setDeedForm] = useState<any>({ method: "", seller: false, buyer: false, executionDate: "", stampDuty: "", registrationFee: "", paidRef: "", paidBy: "Buyer", regNo: "", regDate: "", regOffice: "" });
  const [fee, setFee] = useState({ PaymentMode: "", TransactionRef: "", ReceivedDate: new Date().toISOString().slice(0, 10) });
  const [docType, setDocType] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery<CaseState>({
    queryKey: ["crm-resale-case", id],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${id}/case`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load the case");
      return r.json();
    },
    enabled: !!id,
  });
  const st = q.data;
  const c = st?.case;
  const isResale = c?.Kind !== "BuyBack";
  const finished = c && ["Completed", "Cancelled", "Rejected"].includes(c.Status);
  const canEdit = rights.canEdit && !finished;

  const refresh = (data?: CaseState) => {
    if (data?.stages) qc.setQueryData(["crm-resale-case", id], data);
    else qc.invalidateQueries({ queryKey: ["crm-resale-case", id] });
    qc.invalidateQueries({ queryKey: ["crm-resales"] });
  };
  const call = async (key: string, path: string, body?: object, ok?: string, method = "PUT") => {
    setBusy(key);
    try {
      const r = await fetchWithAuth(`${API}/${id}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Could not do that");
      toast.success(out.message || ok || "Done");
      if (out.ledger && out.ledger.posted === false && out.ledger.reason) toast.warning(out.ledger.reason);
      if (out.ledgerWarning) toast.warning(out.ledgerWarning);
      refresh(out.state || out);
      return out;
    } catch (e: any) { toast.error(translateError(e.message)); return null; }
    finally { setBusy(null); }
  };
  const upload = async (file: File) => {
    if (!docType) { toast.error("Choose what the document is"); return; }
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("DocumentType", docType);
      const r = await fetchWithAuth(`${API}/${id}/documents`, { method: "POST", body: fd });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Upload failed");
      toast.success("Uploaded — someone else verifies it");
      setDocType("");
      refresh(out);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };
  const openDoc = async (d: CaseDoc) => {
    const r = await fetchWithAuth(`${API}/${id}/documents/${d.Id}/file`);
    if (!r.ok) { toast.error("Could not open the file"); return; }
    const url = URL.createObjectURL(await r.blob());
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const review = (d: CaseDoc, decision: "Verified" | "Rejected") => {
    let remarks = "";
    if (decision === "Rejected") {
      remarks = window.prompt("Why is it rejected? (the uploader sees this)") || "";
      if (!remarks.trim()) return;
    }
    call(`doc-${d.Id}`, `documents/${d.Id}/review`, { decision, remarks }, decision === "Verified" ? "Verified" : "Rejected");
  };

  if (q.isLoading) return <CrmShell title="Resale case" subtitle=""><div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div></CrmShell>;
  if (q.isError || !st || !c) return (
    <CrmShell title="Resale case" subtitle="">
      <div className="p-6 text-sm text-red-600">{(q.error as any)?.message || "Case not found"} · <Link className="underline" to="/crm/resales">All cases</Link></div>
    </CrmShell>
  );

  const stage = (k: string) => st.stages.find((s) => s.key === k);
  const cur = st.currentStage;
  const nextDeed: string | null = c.DeedNext;
  const docsBy = (t: string) => st.documents.filter((d) => d.DocumentType === t);
  const docBadge = (s: string) => s === "Verified" ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900"
    : s === "Rejected" ? "text-red-700 bg-red-50 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"
    : "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900";

  // Which document types make sense now (the rest stay in the list for later).
  const docOptions = Object.entries(st.docTypes).filter(([k]) => isResale ? k !== "CancellationLetter" : !["DeveloperNoc"].includes(k));
  const last = st.stages[st.stages.length - 1];
  const readyToFinish = st.stages.filter((s) => s !== last).every((s) => s.ok || s.na);

  return (
    <CrmShell title={`${isResale ? "Resale" : "Buy-back"} · ${c.Property}`} subtitle={isResale ? `${c.FromName} → ${c.ToName || "new buyer"}` : `${c.FromName} → back to us`}>
      <Breadcrumbs items={["CRM", "Resale & Buy-back", `Case #${c.Id}`]} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => nav("/crm/resales")} className={ghost}><ArrowLeft size={14} /> All cases</button>
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border border-border">
          {isResale ? <><ArrowRightLeft size={11} /> Resale</> : <><Undo2 size={11} /> Buy-back</>}
        </span>
        <span className="text-xs px-2 py-1 rounded-full border border-border text-muted-foreground">{c.Status === "Pending" ? "Awaiting approval" : c.Status}</span>
        <span className="text-xs text-muted-foreground ml-auto">Booking {c.BookingNo} · paid so far {fmt(c.OriginalValue)}{c.AgreedValue ? ` · agreed price ${fmt(c.AgreedValue)}` : ""}</span>
      </div>

      {/* Stage tracker */}
      <ol className="rounded-xl border border-border bg-card p-4 mb-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
        {st.stages.map((s, i) => (
          <li key={s.key} className={`flex items-start gap-2 ${s.na ? "opacity-50" : ""}`}>
            <StageDot s={s} />
            <div className="min-w-0">
              <div className={`text-xs font-semibold ${s.state === "current" ? "text-primary" : "text-foreground"}`}>{i + 1}. {s.label}</div>
              <div className="text-[0.6875rem] text-muted-foreground truncate" title={s.detail || undefined}>{s.na ? "Not needed" : s.detail || (s.state === "waiting" ? "Waiting for earlier steps" : "")}</div>
            </div>
          </li>
        ))}
      </ol>

      {c.Status === "Rejected" && c.RejectionNote && <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 text-sm text-red-700 dark:text-red-300 px-3 py-2 mb-4">Rejected: {c.RejectionNote}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* What's blocking the current stage */}
          {cur && !finished && (
            <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <h3 className="text-sm font-semibold mb-1">Now: {stage(cur)?.label}</h3>
              {stage(cur)!.blockers.length ? (
                <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">{stage(cur)!.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              ) : <p className="text-sm text-muted-foreground">{stage(cur)?.detail || "Ready."}</p>}
            </section>
          )}

          {/* 2 Seller clearance */}
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><ShieldCheck size={15} /> Seller clearance</h3>
            <div className="grid sm:grid-cols-3 gap-3 text-sm mb-3">
              <div>
                <span className={label}>Demanded & unpaid</span>
                {st.seller.overdue.length ? st.seller.overdue.map((m) => <div key={`${m.BookingId}-${m.MilestoneName}`} className="text-red-600">{m.MilestoneName} · {fmt(m.Balance)}</div>) : <span className="text-emerald-600">Nothing overdue</span>}
              </div>
              <div>
                <span className={label}>Open cancellation / refund</span>
                {st.seller.openCancellation || st.seller.openRefund
                  ? <span className="text-red-600">{[st.seller.openCancellation?.CancellationNo, st.seller.openRefund?.RefundNo].filter(Boolean).join(", ")}</span>
                  : <span className="text-emerald-600">None</span>}
              </div>
              <div>
                <span className={label}>Seller's home loan</span>
                <div>{c.SellerHasLoan ? "Yes — bank NOC needed" : "No loan"}{st.seller.loans.length ? <span className="block text-[0.6875rem] text-muted-foreground">Loan Tracking: {st.seller.loans.map((l) => l.BankName).join(", ")}</span> : null}</div>
                {canEdit && !c.SellerClearedAt && (
                  <button className="text-xs text-primary underline mt-1" onClick={() => call("loan", "case/seller-loan", { hasLoan: !c.SellerHasLoan }, "Saved")}>
                    {c.SellerHasLoan ? "No — the seller has no loan" : "The seller has a loan"}
                  </button>
                )}
              </div>
            </div>
            {c.SellerClearedAt
              ? <p className="text-xs text-emerald-700 dark:text-emerald-300">Confirmed {date(c.SellerClearedAt)}</p>
              : canEdit && <button className={primary} disabled={busy === "clear" || stage("clearance")!.blockers.length > 0} onClick={() => call("clear", "case/clearance", {}, "Seller clearance confirmed")}>Confirm seller is clear</button>}
          </section>

          {/* 3 NOC + 4 buyer + 6 fee (resale) */}
          {isResale && (
            <section className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className={label}>Developer NOC</span><span className="text-sm">{c.NocNo ? `${c.NocNo} · ${date(c.NocIssuedAt)}` : "Not issued"}</span></div>
                {canEdit && !c.NocNo && <button className={primary} disabled={!c.SellerClearedAt || busy === "noc"} onClick={() => call("noc", "case/noc", {}, "NOC issued")}>Issue NOC</button>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                <div>
                  <span className={label}>New buyer</span>
                  <span className="text-sm">{c.ToName || "—"}</span>
                  {stage("buyer")!.blockers.length > 0 && <ul className="text-[0.6875rem] text-muted-foreground list-disc pl-4 mt-1">{stage("buyer")!.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
                </div>
                <div className="flex gap-2">
                  {c.ToCustomerId && <Link className={ghost} to={`/crm/customers?customerId=${c.ToCustomerId}`}>Buyer's KYC <ExternalLink size={12} /></Link>}
                  {c.BuyerApplicationId
                    ? <Link className={ghost} to={`/crm/applications?id=${c.BuyerApplicationId}`}>Buyer's application & co-applicants <ExternalLink size={12} /></Link>
                    : canEdit && c.ToCustomerId && <button className={primary} disabled={busy === "app"} onClick={() => call("app", "case/buyer-application", {}, "Buyer's application opened")}>Open buyer's application</button>}
                </div>
              </div>
              {Number(c.DeveloperFeeAmount) > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div>
                      <span className={label}>Transfer fee (billed to the buyer)</span>
                      <span className="text-sm">{fmt(c.DeveloperFeeAmount)} + GST {fmt(c.DeveloperFeeGstAmount)} = <b>{fmt(c.FeeTotal)}</b></span>
                      <span className="block text-[0.6875rem] text-muted-foreground">
                        {c.FeeInvoiceNo ? `Invoice ${c.FeeInvoiceNo}` : "No invoice yet"}{c.FeeReceiptNo ? ` · payment ${c.FeeReceiptNo} — ${c.FeeReceiptStatus === "Approved" ? "approved by Finance" : c.FeeReceiptStatus === "Rejected" ? "rejected by Finance" : "waiting for Finance"}` : ""}
                      </span>
                    </div>
                    {canEdit && (!c.FeeInvoiceNo || c.FeeInvoiceStatus === "Void") && <button className={primary} disabled={busy === "inv" || c.Status !== "Approved"} title={c.Status !== "Approved" ? "After approval" : undefined} onClick={() => call("inv", "case/fee-invoice", {}, "Fee invoice issued")}>Issue fee invoice</button>}
                  </div>
                  {canEdit && c.FeeInvoiceNo && c.FeeInvoiceStatus !== "Void" && (!c.FeeReceiptNo || c.FeeReceiptStatus === "Rejected") && (
                    <div className="grid sm:grid-cols-4 gap-2 items-end">
                      <div><span className={label}>Mode</span>
                        <select className={input} value={fee.PaymentMode} onChange={(e) => setFee({ ...fee, PaymentMode: e.target.value })}>
                          <option value="">Choose</option>{["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash"].map((m) => <option key={m}>{m}</option>)}
                        </select></div>
                      <div><span className={label}>Reference</span><input className={input} value={fee.TransactionRef} onChange={(e) => setFee({ ...fee, TransactionRef: e.target.value })} placeholder="UTR / cheque no." /></div>
                      <div><span className={label}>Received on</span><DateInput value={fee.ReceivedDate} onChange={(e: any) => setFee({ ...fee, ReceivedDate: e.target.value })} /></div>
                      <button className={primary} disabled={busy === "fee"} onClick={() => call("fee", "case/fee-payment", fee, "Sent to Finance for approval")}>Record payment</button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* 7 Deed */}
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2"><FileText size={15} /> {stage("deed")?.label}</h3>
            <p className="text-[0.6875rem] text-muted-foreground mb-3">
              {c.DeedType === "Assignment" && "Tripartite deed (seller, buyer and us), stamped and registered at the Sub-Registrar. The final sale deed is later made in the buyer's name."}
              {c.DeedType === "CancellationDeed" && "The agreement is registered, so the buy-back needs a registered cancellation deed."}
              {c.DeedType === "CancellationLetter" && "The agreement isn't registered: a signed cancellation letter is enough — upload it below and have it verified."}
            </p>
            {c.DeedType !== "CancellationLetter" && (
              <>
                <ol className="flex flex-wrap gap-1.5 mb-3">
                  {DEED_STEPS.map((s, i) => (
                    <li key={s} className={`text-[0.6875rem] px-2 py-1 rounded-full border ${c.DeedStep >= i ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300" : s === nextDeed ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                      {DEED_LABEL[s]}
                    </li>
                  ))}
                </ol>
                {c.DeedRegNo && <p className="text-sm mb-2">Registered: {c.DeedRegNo} · {date(c.DeedRegDate)} · {c.DeedRegOffice}</p>}
                {c.DeedDutyPaidAt && <p className="text-xs text-muted-foreground mb-2">Stamp duty {fmt(c.DeedStampDuty)} + registration {fmt(c.DeedRegistrationFee)} · {c.DeedDutyPaidRef}</p>}
                {canEdit && nextDeed && (
                  <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                    <div className="text-xs font-medium">Next: {DEED_LABEL[nextDeed]}</div>
                    {stage("deed")!.blockers[0] && <p className="text-[0.6875rem] text-muted-foreground">{stage("deed")!.blockers[0]}</p>}
                    {nextDeed === "Consented" && (
                      <div className="grid sm:grid-cols-3 gap-2 items-end">
                        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={deedForm.seller} onChange={(e) => setDeedForm({ ...deedForm, seller: e.target.checked })} /> Seller consents</label>
                        {isResale && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={deedForm.buyer} onChange={(e) => setDeedForm({ ...deedForm, buyer: e.target.checked })} /> Buyer consents</label>}
                        <div><span className={label}>How</span><input className={input} value={deedForm.method} onChange={(e) => setDeedForm({ ...deedForm, method: e.target.value })} placeholder="Signed draft, in person, email…" /></div>
                      </div>
                    )}
                    {nextDeed === "Executed" && <div className="max-w-xs"><span className={label}>Signed on</span><DateInput value={deedForm.executionDate} onChange={(e: any) => setDeedForm({ ...deedForm, executionDate: e.target.value })} /></div>}
                    {nextDeed === "DutyPaid" && (
                      <div className="grid sm:grid-cols-4 gap-2">
                        <div><span className={label}>Stamp duty (assessed)</span><input type="number" min={0} className={input} value={deedForm.stampDuty} onChange={(e) => setDeedForm({ ...deedForm, stampDuty: e.target.value })} /></div>
                        <div><span className={label}>Registration fee</span><input type="number" min={0} className={input} value={deedForm.registrationFee} onChange={(e) => setDeedForm({ ...deedForm, registrationFee: e.target.value })} /></div>
                        <div><span className={label}>GRN / challan no.</span><input className={input} value={deedForm.paidRef} onChange={(e) => setDeedForm({ ...deedForm, paidRef: e.target.value })} /></div>
                        <div><span className={label}>Paid by</span><select className={input} value={deedForm.paidBy} onChange={(e) => setDeedForm({ ...deedForm, paidBy: e.target.value })}>{["Buyer", "Seller", "Developer", "Shared"].map((x) => <option key={x}>{x}</option>)}</select></div>
                      </div>
                    )}
                    {nextDeed === "Registered" && (
                      <div className="grid sm:grid-cols-3 gap-2">
                        <div><span className={label}>Registration no.</span><input className={input} value={deedForm.regNo} onChange={(e) => setDeedForm({ ...deedForm, regNo: e.target.value })} /></div>
                        <div><span className={label}>Registered on</span><DateInput value={deedForm.regDate} onChange={(e: any) => setDeedForm({ ...deedForm, regDate: e.target.value })} /></div>
                        <div><span className={label}>Sub-Registrar office</span><input className={input} value={deedForm.regOffice} onChange={(e) => setDeedForm({ ...deedForm, regOffice: e.target.value })} /></div>
                      </div>
                    )}
                    <button className={primary} disabled={busy === "deed"} onClick={() => call("deed", `case/deed/${nextDeed}`, deedForm, `${DEED_LABEL[nextDeed]} — saved`)}>
                      {nextDeed === "Draft" ? "Start the deed" : `Record: ${DEED_LABEL[nextDeed]}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Last stage */}
          {!finished && rights.canEdit && (
            <section className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{last.label}</h3>
                <p className="text-[0.6875rem] text-muted-foreground">
                  {isResale ? "The booking, its schedule and everything paid pass to the buyer; the seller's agreement stays as history and the buyer gets portal access." : "Finance pays the agreed price; when they approve it the property returns to stock."}
                </p>
              </div>
              {isResale
                ? <button className={primary} disabled={!readyToFinish || busy === "finish"} onClick={() => { if (window.confirm(`Pass ${c.Property} to ${c.ToName}?`)) call("finish", "transfer", {}, "Transferred to the buyer"); }}>Transfer to buyer</button>
                : <button className={primary} disabled={!readyToFinish || busy === "finish"} onClick={() => call("finish", "send-to-finance", {}, "Sent to Finance")}>Send payout to Finance</button>}
            </section>
          )}
        </div>

        {/* Documents */}
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Documents</h3>
            {st.documents.length === 0 && <p className="text-xs text-muted-foreground mb-3">None yet.</p>}
            <ul className="space-y-2 mb-3">
              {st.documents.map((d) => (
                <li key={d.Id} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <button className="text-sm font-medium text-left hover:underline truncate" onClick={() => openDoc(d)}>{st.docTypes[d.DocumentType] || d.DocumentType}</button>
                    <span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full border ${docBadge(d.Status)}`}>{d.Status === "Uploaded" ? "To verify" : d.Status}</span>
                  </div>
                  <div className="text-[0.6875rem] text-muted-foreground truncate">{d.FileName} · {d.UploadedByName || "—"} · {date(d.CreatedAt)}</div>
                  {d.Remarks && <div className="text-[0.6875rem] text-muted-foreground mt-0.5">{d.Remarks}</div>}
                  {canEdit && d.Status === "Uploaded" && (
                    <div className="flex gap-1.5 mt-2">
                      <button className="text-[0.6875rem] px-2 h-7 rounded-md bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy === `doc-${d.Id}`} onClick={() => review(d, "Verified")}>Verify</button>
                      <button className="text-[0.6875rem] px-2 h-7 rounded-md border border-border hover:bg-muted" disabled={busy === `doc-${d.Id}`} onClick={() => review(d, "Rejected")}>Reject</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="space-y-2">
                <select className={input} value={docType} onChange={(e) => setDocType(e.target.value)}>
                  <option value="">What are you uploading?</option>
                  {docOptions.map(([k, v]) => <option key={k} value={k}>{v}{docsBy(k).some((d) => d.Status === "Verified") ? " ✓" : ""}</option>)}
                </select>
                <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <button className={`${ghost} w-full`} disabled={!docType || busy === "upload"} onClick={() => fileRef.current?.click()}>
                  {busy === "upload" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload PDF or image
                </button>
              </div>
            )}
          </section>
          <section className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5"><CircleDashed size={12} /> Every step is checked against the real records each time.</div>
            <div>Approval: <Link className="underline" to="/admin/approval/inbox">Approval Inbox</Link>{isResale ? <> · Fee payment: Finance → Received Payments</> : <> · Payout: Finance → Payments</>}</div>
          </section>
        </aside>
      </div>
    </CrmShell>
  );
};

export default CrmResaleCase;

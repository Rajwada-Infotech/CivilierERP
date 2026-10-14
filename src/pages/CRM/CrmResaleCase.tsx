import React, { useEffect, useRef, useState } from "react";
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
  ArrowLeft, ArrowRight, ArrowRightLeft, Check, ChevronDown, Eye, Loader2, Lock, Undo2, Upload, X, ExternalLink,
} from "lucide-react";

// One resale / buy-back CASE, as a guided flow: the step you're on is open
// with its checklist (✓ done / ○ still needed), the documents that step needs
// right inside it, and one clear action. Finished steps fold to a summary;
// later steps stay locked until their turn. Everything is worked out on the
// server from the real records (GET /api/crm/resales/:id/case).

const API = "/api/crm/resales";
const fmt = (n: any) => (n == null || n === "" ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const date = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const label = "text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1";
const input = "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
const btn = "inline-flex items-center justify-center gap-1.5 px-3 h-8 text-xs rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap";
const primary = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`;
const ghost = `${btn} border border-border text-foreground hover:bg-muted`;

interface CheckItem { label: string; ok: boolean; hint?: string | null; doc?: string; action?: string; link?: string | null; step?: string }
interface Stage { key: string; label: string; ok: boolean; na: boolean; state: "done" | "current" | "waiting" | "stopped"; blockers: string[]; detail: string | null; checks: CheckItem[] }
interface CaseDoc { Id: number; DocumentType: string; FileName: string; Status: string; Remarks: string | null; CreatedAt: string; UploadedByName: string | null }
interface CaseState { case: any; seller: any; documents: CaseDoc[]; docTypes: Record<string, string>; stages: Stage[]; currentStage: string | null }

const DEED_ACTION: Record<string, string> = {
  Draft: "Start the deed", LegalApproved: "Give legal approval", Consented: "Record both parties' consent", Executed: "Record the signing date",
  DutyPaid: "Record stamp duty paid", Registered: "Record the registration",
};
const ACTION_LABEL: Record<string, string> = {
  clearance: "Confirm seller is clear", noc: "Issue NOC", "buyer-application": "Open buyer's application", "fee-invoice": "Issue fee invoice",
};

const Tick = ({ ok }: { ok: boolean }) => ok
  ? <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-emerald-500 text-white grid place-items-center"><Check size={12} /></span>
  : <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30" aria-label="still needed" />;

const CrmResaleCase: React.FC = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const rights = usePageRights("crm-resales");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deed, setDeed] = useState<any>({ method: "", seller: false, buyer: false, executionDate: "", stampDuty: "", registrationFee: "", paidRef: "", paidBy: "Buyer", regNo: "", regDate: "", regOffice: "" });
  const [fee, setFee] = useState({ PaymentMode: "", TransactionRef: "", ReceivedDate: new Date().toISOString().slice(0, 10) });
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingDocType = useRef<string>("");

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
  // The current step opens by itself — and again whenever the case moves on.
  useEffect(() => { if (st) setOpen(st.currentStage || st.stages[st.stages.length - 1]?.key || null); }, [st?.currentStage]); // eslint-disable-line react-hooks/exhaustive-deps

  const isResale = c?.Kind !== "BuyBack";
  const finished = !!c && ["Completed", "Cancelled", "Rejected"].includes(c.Status);
  const canEdit = rights.canEdit && !finished;

  const apply = (out: any) => {
    const next = out?.stages ? out : out?.state?.stages ? out.state : null;
    if (next) qc.setQueryData(["crm-resale-case", id], next); else qc.invalidateQueries({ queryKey: ["crm-resale-case", id] });
    qc.invalidateQueries({ queryKey: ["crm-resales"] });
  };
  const call = async (key: string, path: string, body?: object, ok?: string) => {
    setBusy(key);
    try {
      const r = await fetchWithAuth(`${API}/${id}/${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Could not do that");
      toast.success(out.message || ok || "Done");
      if (out.ledger?.posted === false && out.ledger.reason) toast.warning(out.ledger.reason);
      if (out.ledgerWarning) toast.warning(out.ledgerWarning);
      apply(out);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(null); }
  };
  const pickFile = (type: string) => { pendingDocType.current = type; fileRef.current?.click(); };
  const upload = async (file: File) => {
    const type = pendingDocType.current;
    setBusy(`up-${type}`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("DocumentType", type);
      const r = await fetchWithAuth(`${API}/${id}/documents`, { method: "POST", body: fd });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Upload failed");
      toast.success("Uploaded — now someone else verifies it");
      apply(out);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };
  const viewDoc = async (d: CaseDoc) => {
    const r = await fetchWithAuth(`${API}/${id}/documents/${d.Id}/file`);
    if (!r.ok) { toast.error("Could not open the file"); return; }
    const url = URL.createObjectURL(await r.blob());
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const review = (d: CaseDoc, decision: "Verified" | "Rejected") => {
    let remarks = "";
    if (decision === "Rejected") { remarks = window.prompt("Why is it rejected? The uploader sees this.") || ""; if (!remarks.trim()) return; }
    call(`doc-${d.Id}`, `documents/${d.Id}/review`, { decision, remarks }, decision);
  };

  if (q.isLoading) return <CrmShell title="Resale case" subtitle=""><div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div></CrmShell>;
  if (q.isError || !st || !c) return (
    <CrmShell title="Resale case" subtitle="">
      <div className="p-6 text-sm text-red-600">{(q.error as any)?.message || "Case not found"} · <Link className="underline" to="/crm/resales">All cases</Link></div>
    </CrmShell>
  );

  const steps = st.stages;
  const curIdx = steps.findIndex((s) => s.key === st.currentStage);
  const doneCount = steps.filter((s) => s.ok || s.na).length;
  const latestDoc = (t: string) => st.documents.filter((d) => d.DocumentType === t).pop();
  const last = steps[steps.length - 1];
  const readyToFinish = steps.filter((s) => s !== last).every((s) => s.ok || s.na);

  // A document slot inside a checklist row: its state, and what can be done with it now.
  const DocSlot = ({ type, active }: { type: string; active: boolean }) => {
    const d = latestDoc(type);
    const chip = !d ? null
      : d.Status === "Verified" ? <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900">Verified</span>
      : d.Status === "Rejected" ? <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900" title={d.Remarks || undefined}>Rejected</span>
      : <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900">Waiting to be verified</span>;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {chip}
        {d && <button className={ghost} onClick={() => viewDoc(d)}><Eye size={12} /> View</button>}
        {canEdit && active && d?.Status === "Uploaded" && <>
          <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={busy === `doc-${d.Id}`} onClick={() => review(d, "Verified")}>Verify</button>
          <button className={ghost} disabled={busy === `doc-${d.Id}`} onClick={() => review(d, "Rejected")}>Reject</button>
        </>}
        {canEdit && active && (!d || d.Status === "Rejected") && (
          <button className={ghost} disabled={busy === `up-${type}`} onClick={() => pickFile(type)}>
            {busy === `up-${type}` ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {d ? "Upload again" : "Upload"}
          </button>
        )}
      </div>
    );
  };

  // The fields a deed step needs, shown under its row when it is next.
  const deedFields = (step: string) => {
    if (step === "Consented") return (
      <div className="grid sm:grid-cols-3 gap-2 items-end">
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={deed.seller} onChange={(e) => setDeed({ ...deed, seller: e.target.checked })} /> Seller consents</label>
        {isResale && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={deed.buyer} onChange={(e) => setDeed({ ...deed, buyer: e.target.checked })} /> Buyer consents</label>}
        <div><span className={label}>How</span><input className={input} value={deed.method} onChange={(e) => setDeed({ ...deed, method: e.target.value })} placeholder="Signed draft, in person, email…" /></div>
      </div>
    );
    if (step === "Executed") return <div className="max-w-xs"><span className={label}>Signed on</span><DateInput value={deed.executionDate} onChange={(e: any) => setDeed({ ...deed, executionDate: e.target.value })} /></div>;
    if (step === "DutyPaid") return (
      <div className="grid sm:grid-cols-4 gap-2">
        <div><span className={label}>Stamp duty (as assessed)</span><input type="number" min={0} className={input} value={deed.stampDuty} onChange={(e) => setDeed({ ...deed, stampDuty: e.target.value })} /></div>
        <div><span className={label}>Registration fee</span><input type="number" min={0} className={input} value={deed.registrationFee} onChange={(e) => setDeed({ ...deed, registrationFee: e.target.value })} /></div>
        <div><span className={label}>GRN / challan no.</span><input className={input} value={deed.paidRef} onChange={(e) => setDeed({ ...deed, paidRef: e.target.value })} /></div>
        <div><span className={label}>Paid by</span><select className={input} value={deed.paidBy} onChange={(e) => setDeed({ ...deed, paidBy: e.target.value })}>{["Buyer", "Seller", "Developer", "Shared"].map((x) => <option key={x}>{x}</option>)}</select></div>
      </div>
    );
    if (step === "Registered") return (
      <div className="grid sm:grid-cols-3 gap-2">
        <div><span className={label}>Registration no.</span><input className={input} value={deed.regNo} onChange={(e) => setDeed({ ...deed, regNo: e.target.value })} /></div>
        <div><span className={label}>Registered on</span><DateInput value={deed.regDate} onChange={(e: any) => setDeed({ ...deed, regDate: e.target.value })} /></div>
        <div><span className={label}>Sub-Registrar office</span><input className={input} value={deed.regOffice} onChange={(e) => setDeed({ ...deed, regOffice: e.target.value })} /></div>
      </div>
    );
    return null;
  };

  const renderCheck = (s: Stage, ch: CheckItem, i: number, active: boolean) => {
    // Items that depend on the ones above them (confirming clearance, the fee
    // payment after its invoice) act only when they are the first one left;
    // independent items (opening the buyer's application, issuing the NOC)
    // can be done in any order.
    const firstOpen = s.checks.findIndex((x) => !x.ok) === i;
    const sequential = ch.action === "clearance" || ch.action === "fee-payment";
    const canAct = sequential ? firstOpen : true;
    const isNextDeed = !!ch.step && ch.step === c.DeedNext;
    const docReady = ch.doc ? latestDoc(ch.doc)?.Status === "Verified" : true;
    return (
      <li key={i} className="py-2.5 flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <Tick ok={ch.ok} />
          <div className="flex-1 min-w-0">
            <div className={`text-sm ${ch.ok ? "text-muted-foreground" : "font-medium text-foreground"}`}>{ch.label}</div>
            {ch.hint && <div className="text-[0.6875rem] text-muted-foreground">{ch.hint}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 justify-end">
            {ch.link === "kyc" && c.ToCustomerId && !ch.ok && <Link className={ghost} to={`/crm/customers?customerId=${c.ToCustomerId}`}>Edit buyer <ExternalLink size={11} /></Link>}
            {ch.link === "application" && <Link className={ghost} to={`/crm/applications?id=${c.BuyerApplicationId}`}>Open application <ExternalLink size={11} /></Link>}
            {ch.link === "inbox" && !ch.ok && <Link className={ghost} to="/admin/approval/inbox">Approval Inbox <ExternalLink size={11} /></Link>}
            {ch.link === "deed" && c.TransferDeedId && <Link className={primary} to={`/crm/transfer-deeds?id=${c.TransferDeedId}`}>Work on {c.TransferDeedNo} <ExternalLink size={11} /></Link>}
            {ch.action === "open-deed" && canEdit && active && (
              <button className={primary} disabled={!!busy} onClick={async () => {
                setBusy("deed");
                try {
                  const r = await fetchWithAuth(`/api/crm/transfer-deeds/for-case/${c.Id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                  const out = await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(out.error || "Could not open the deed");
                  nav(`/crm/transfer-deeds?id=${out.deed.Id}`);
                } catch (e: any) { toast.error(translateError(e.message)); }
                finally { setBusy(null); }
              }}>Open the deed</button>
            )}
            {ch.doc && <DocSlot type={ch.doc} active={active} />}
            {canEdit && active && canAct && !ch.ok && ch.action && ACTION_LABEL[ch.action] && (
              <button className={primary} disabled={!!busy || (ch.action === "clearance" && s.checks.slice(0, i).some((x) => !x.ok))}
                onClick={() => call(ch.action!, `case/${ch.action}`, {}, "Done")}>{ACTION_LABEL[ch.action]}</button>
            )}
          </div>
        </div>
        {canEdit && active && firstOpen && ch.action === "fee-payment" && (
          <div className="ml-8 grid sm:grid-cols-4 gap-2 items-end rounded-lg border border-dashed border-border p-3">
            <div><span className={label}>Mode</span>
              <select className={input} value={fee.PaymentMode} onChange={(e) => setFee({ ...fee, PaymentMode: e.target.value })}>
                <option value="">Choose</option>{["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash"].map((m) => <option key={m}>{m}</option>)}
              </select></div>
            <div><span className={label}>Reference</span><input className={input} value={fee.TransactionRef} onChange={(e) => setFee({ ...fee, TransactionRef: e.target.value })} placeholder="UTR / cheque no." /></div>
            <div><span className={label}>Received on</span><DateInput value={fee.ReceivedDate} onChange={(e: any) => setFee({ ...fee, ReceivedDate: e.target.value })} /></div>
            <button className={primary} disabled={busy === "fee"} onClick={() => call("fee", "case/fee-payment", fee, "Sent to Finance for approval")}>Send to Finance</button>
          </div>
        )}
        {canEdit && active && isNextDeed && (
          <div className="ml-8 rounded-lg border border-dashed border-border p-3 space-y-2">
            {deedFields(ch.step!)}
            {ch.doc && !docReady && <p className="text-[0.6875rem] text-muted-foreground">{ch.step === "Draft" ? "Upload the draft above first." : "Upload the document above and have it verified first."}</p>}
            <button className={primary} disabled={busy === "deed" || (ch.step === "Draft" ? !latestDoc("DeedDraft") : !docReady)}
              onClick={() => call("deed", `case/deed/${ch.step}`, deed, "Saved")}>{DEED_ACTION[ch.step!]}</button>
          </div>
        )}
      </li>
    );
  };

  return (
    <CrmShell title={`${isResale ? "Resale" : "Buy-back"} · ${c.Property}`} subtitle={`Case #${c.Id} · Booking ${c.BookingNo}`}>
      <Breadcrumbs items={["CRM", "Resale", `Case #${c.Id}`]} />
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />

      {/* Who → who, and where it stands */}
      <section className="rounded-xl border border-border bg-card p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => nav("/crm/resales")} className={ghost}><ArrowLeft size={13} /> All cases</button>
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border border-border">
            {isResale ? <><ArrowRightLeft size={11} /> Resale</> : <><Undo2 size={11} /> Buy-back</>}
          </span>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{c.FromName}</span>
            <ArrowRight size={14} className="text-muted-foreground" />
            <span className="font-semibold">{isResale ? c.ToName || "new buyer" : "back to us"}</span>
          </div>
          <span className="ml-auto text-xs font-medium">
            {finished ? (c.Status === "Completed" ? `Completed ${date(c.CompletedAt)}` : c.Status) : `Step ${curIdx + 1} of ${steps.length}: ${steps[curIdx]?.label}`}
          </span>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={doneCount} aria-valuemax={steps.length}>
          <div className={`h-full ${c.Status === "Rejected" || c.Status === "Cancelled" ? "bg-muted-foreground/40" : "bg-emerald-500"}`} style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }} />
        </div>
        {["Rejected", "Cancelled"].includes(c.Status) && c.RejectionNote && <p className="mt-3 text-sm text-red-600">{c.Status === "Rejected" ? "Rejected: " : ""}{c.RejectionNote}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* The guided steps */}
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const isOpen = open === s.key;
            const active = s.state === "current";
            const locked = s.state === "waiting";
            const todo = s.checks.filter((x) => !x.ok).length;
            return (
              <li key={s.key} className={`rounded-xl border bg-card ${active ? "border-primary/60 ring-1 ring-primary/20" : "border-border"} ${s.na ? "opacity-60" : ""}`}>
                <button className="w-full flex items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(isOpen ? null : s.key)} aria-expanded={isOpen}>
                  <span className={`w-7 h-7 shrink-0 rounded-full grid place-items-center text-xs font-semibold ${s.ok || s.na ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground" : s.state === "stopped" ? "bg-muted text-muted-foreground" : "border border-dashed border-border text-muted-foreground"}`}>
                    {s.ok || s.na ? <Check size={14} /> : s.state === "stopped" ? <X size={13} /> : locked ? <Lock size={12} /> : i + 1}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm font-semibold ${active ? "text-primary" : ""}`}>{s.label}</span>
                    <span className="block text-[0.6875rem] text-muted-foreground truncate">
                      {s.na ? "Not needed" : s.ok ? s.detail || "Done" : active ? `${todo} thing${todo === 1 ? "" : "s"} left` : locked ? "Opens after the steps above" : s.detail || ""}
                    </span>
                  </span>
                  {active && <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-primary">You are here</span>}
                  <ChevronDown size={16} className={`text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-border">
                    {locked && <p className="pt-3 text-xs text-muted-foreground">Opens once "{steps[curIdx]?.label}" is done. It will need:</p>}
                    <ul className="divide-y divide-border">{s.checks.map((ch, ci) => renderCheck(s, ch, ci, active))}</ul>
                    {s.key === "clearance" && active && canEdit && !c.SellerClearedAt && (
                      <button className="text-xs text-primary underline mt-1" onClick={() => call("loan", "case/seller-loan", { hasLoan: !c.SellerHasLoan }, "Saved")}>
                        {c.SellerHasLoan ? "The seller has no home loan" : "The seller has a home loan"}
                      </button>
                    )}
                    {s === last && active && rights.canEdit && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground max-w-prose">
                          {isResale ? "The booking, its schedule and everything paid pass to the buyer. The seller's agreement stays as history and the buyer gets portal access."
                            : "Finance pays the agreed price; when they approve it the property returns to stock."}
                        </p>
                        {isResale
                          ? <button className={primary} disabled={!readyToFinish || busy === "finish"} onClick={() => { if (window.confirm(`Pass ${c.Property} to ${c.ToName}?`)) call("finish", "transfer", {}, "Transferred to the buyer"); }}>Transfer to buyer</button>
                          : <button className={primary} disabled={!readyToFinish || busy === "finish" || !!c.PayoutNewPaymentId} onClick={() => call("finish", "send-to-finance", {}, "Sent to Finance")}>Send payout to Finance</button>}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Summary rail */}
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4 text-sm space-y-3">
            <div><span className={label}>Property</span>{c.Property}<span className="block text-[0.6875rem] text-muted-foreground">Booking {c.BookingNo}{c.BookingIds?.length > 1 ? ` + ${c.BookingIds.length - 1} more, moving as one property` : ""}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className={label}>Paid so far</span><span className="tabular-nums">{fmt(c.OriginalValue)}</span></div>
              <div><span className={label}>{isResale ? "Price between buyers" : "Buy-back price"}</span><span className="tabular-nums">{fmt(c.AgreedValue)}</span></div>
            </div>
            {isResale && <div><span className={label}>Our transfer fee</span><span className="tabular-nums">{Number(c.DeveloperFeeAmount) > 0 ? `${fmt(c.DeveloperFeeAmount)} + GST = ${fmt(c.FeeTotal)}` : "None"}</span></div>}
            {c.NocNo && <div><span className={label}>NOC</span>{c.NocNo}</div>}
            {c.DeedRegNo && <div><span className={label}>Registered deed</span>{c.DeedRegNo}<span className="block text-[0.6875rem] text-muted-foreground">{date(c.DeedRegDate)} · {c.DeedRegOffice}</span></div>}
          </section>
          <section className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-2">All documents</h3>
            {st.documents.length === 0 ? <p className="text-xs text-muted-foreground">Each step asks for its own documents.</p> : (
              <ul className="space-y-1.5">
                {st.documents.map((d) => (
                  <li key={d.Id} className="flex items-center justify-between gap-2 text-xs">
                    <button className="text-left truncate hover:underline" onClick={() => viewDoc(d)}>{st.docTypes[d.DocumentType] || d.DocumentType}</button>
                    <span className={d.Status === "Verified" ? "text-emerald-600" : d.Status === "Rejected" ? "text-red-600" : "text-amber-600"}>{d.Status === "Uploaded" ? "To verify" : d.Status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </CrmShell>
  );
};

export default CrmResaleCase;

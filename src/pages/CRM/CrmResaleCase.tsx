import { useSheetAsk } from "@/components/sheet/SheetAsk";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DateInput } from "@/components/ui/date-input";
import {
  ArrowLeft, ArrowRight, ArrowRightLeft, Check, ChevronDown, Eye, Loader2, Lock, Undo2, Upload, X, ExternalLink,
} from "lucide-react";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";
import { localDay } from "./salesDeed/config";

// One resale / buy-back CASE, as a guided flow: the step you're on is open
// with its checklist (✓ done / ○ still needed), the documents that step needs
// right inside it, and one clear action. Finished steps fold to a summary;
// later steps stay locked until their turn. Everything is worked out on the
// server from the real records (GET /api/crm/resales/:id/case).

const API = "/api/crm/resales";
const fmt = (n: any) => (n == null || n === "" ? "—" : fmtRupees(Number(n)));
const date = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const label = `block mb-1 ${LBL}`;
const input = INP;
const primary = `${KEY_INK} h-8 px-3 whitespace-nowrap`;
const ghost = `${KEY_LINE} h-8 px-3 whitespace-nowrap`;
const headTitle = "px-4 py-2.5 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]";

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
  submit: "Send for approval",
};
const docTone = (s: string): "done" | "waiting" | "stopped" => (s === "Verified" ? "done" : s === "Rejected" ? "stopped" : "waiting");

const Tick = ({ ok }: { ok: boolean }) => ok
  ? <span className="mt-0.5 w-5 h-5 shrink-0 bg-foreground text-card grid place-items-center"><Check size={12} /></span>
  : <span className="mt-0.5 w-5 h-5 shrink-0 border-2 border-foreground/50 bg-card" aria-label="still needed" />;

const CrmResaleCase: React.FC = () => {
  const ask = useSheetAsk();
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const rights = usePageRights("crm-resales");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deed, setDeed] = useState<any>({ method: "", seller: false, buyer: false, executionDate: "", stampDuty: "", registrationFee: "", paidRef: "", paidBy: "Buyer", regNo: "", regDate: "", regOffice: "" });
  // Local today: toISOString gave yesterday before 05:30 IST.
  const [fee, setFee] = useState({ PaymentMode: "", TransactionRef: "", ReceivedDate: localDay() });
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
  // A rejected case is sent back to be fixed and sent again — not finished.
  const finished = !!c && ["Completed", "Cancelled"].includes(c.Status);
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
  const review = async (d: CaseDoc, decision: "Verified" | "Rejected") => {
    let remarks = "";
    if (decision === "Rejected") { remarks = (await ask.prompt("Why is it rejected? The uploader sees this.", { title: "Reject document", okLabel: "Reject", danger: true })) || ""; if (!remarks.trim()) return; }
    call(`doc-${d.Id}`, `documents/${d.Id}/review`, { decision, remarks }, decision);
  };

  if (q.isLoading) return (
    <SheetShell eyebrow="CivilierERP · CRM · Resale" title="Resale case">
      <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
    </SheetShell>
  );
  if (q.isError || !st || !c) return (
    <SheetShell eyebrow="CivilierERP · CRM · Resale" title="Resale case">
      <div className="p-6 text-sm text-destructive">{(q.error as any)?.message || "Case not found"} · <Link className="underline" to="/crm/resales">All cases</Link></div>
    </SheetShell>
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
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {d && (
          <span title={d.Status === "Rejected" ? d.Remarks || undefined : undefined}>
            <SheetMark text={d.Status === "Uploaded" ? "Waiting to be verified" : d.Status} tone={docTone(d.Status)} />
          </span>
        )}
        {d && <button className={ghost} onClick={() => viewDoc(d)}><Eye size={12} /> View</button>}
        {canEdit && active && d?.Status === "Uploaded" && <>
          <button className={primary} disabled={busy === `doc-${d.Id}`} onClick={() => review(d, "Verified")}>Verify</button>
          <button className={`${ghost} !text-destructive !border-destructive`} disabled={busy === `doc-${d.Id}`} onClick={() => review(d, "Rejected")}>Reject</button>
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
        <label className="text-sm flex items-center gap-2"><input type="checkbox" className="accent-foreground" checked={deed.seller} onChange={(e) => setDeed({ ...deed, seller: e.target.checked })} /> Seller consents</label>
        {isResale && <label className="text-sm flex items-center gap-2"><input type="checkbox" className="accent-foreground" checked={deed.buyer} onChange={(e) => setDeed({ ...deed, buyer: e.target.checked })} /> Buyer consents</label>}
        <div><span className={label}>How</span><input className={input} value={deed.method} onChange={(e) => setDeed({ ...deed, method: e.target.value })} placeholder="Signed draft, in person, email…" /></div>
      </div>
    );
    if (step === "Executed") return <div className="max-w-xs"><span className={label}>Signed on</span><DateInput className={input} max={localDay()} value={deed.executionDate} onChange={(e: any) => setDeed({ ...deed, executionDate: e.target.value })} /></div>;
    if (step === "DutyPaid") return (
      <div className="grid sm:grid-cols-4 gap-2">
        <div><span className={label}>Stamp duty (as assessed)</span><input type="number" min={0} className={`${input} tabular-nums`} value={deed.stampDuty} onChange={(e) => setDeed({ ...deed, stampDuty: e.target.value })} /></div>
        <div><span className={label}>Registration fee</span><input type="number" min={0} className={`${input} tabular-nums`} value={deed.registrationFee} onChange={(e) => setDeed({ ...deed, registrationFee: e.target.value })} /></div>
        <div><span className={label}>GRN / challan no.</span><input className={input} value={deed.paidRef} onChange={(e) => setDeed({ ...deed, paidRef: e.target.value })} /></div>
        <div><span className={label}>Paid by</span><select className={input} value={deed.paidBy} onChange={(e) => setDeed({ ...deed, paidBy: e.target.value })}>{["Buyer", "Seller", "Developer", "Shared"].map((x) => <option key={x}>{x}</option>)}</select></div>
      </div>
    );
    if (step === "Registered") return (
      <div className="grid sm:grid-cols-3 gap-2">
        <div><span className={label}>Registration no.</span><input className={input} value={deed.regNo} onChange={(e) => setDeed({ ...deed, regNo: e.target.value })} /></div>
        <div><span className={label}>Registered on</span><DateInput className={input} max={localDay()} value={deed.regDate} onChange={(e: any) => setDeed({ ...deed, regDate: e.target.value })} /></div>
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
      <li key={i} className="py-2.5 flex flex-col gap-2" style={i ? { borderTop: RULE_SOFT } : undefined}>
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
                onClick={() => call(ch.action!, `case/${ch.action}`, {}, ch.action === "submit" ? "Sent — waiting in the Approval Inbox" : "Done")}>{ACTION_LABEL[ch.action]}</button>
            )}
          </div>
        </div>
        {canEdit && active && firstOpen && ch.action === "fee-payment" && (
          <div className="ml-8 grid sm:grid-cols-4 gap-2 items-end p-3" style={{ border: RULE_SOFT }}>
            <div><span className={label}>Mode</span>
              <select className={input} value={fee.PaymentMode} onChange={(e) => setFee({ ...fee, PaymentMode: e.target.value })}>
                <option value="">Choose</option>{["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash"].map((m) => <option key={m}>{m}</option>)}
              </select></div>
            <div><span className={label}>Reference</span><input className={input} value={fee.TransactionRef} onChange={(e) => setFee({ ...fee, TransactionRef: e.target.value })} placeholder="UTR / cheque no." /></div>
            <div><span className={label}>Received on</span><DateInput className={input} max={localDay()} value={fee.ReceivedDate} onChange={(e: any) => setFee({ ...fee, ReceivedDate: e.target.value })} /></div>
            <button className={`${primary} h-9`} disabled={busy === "fee"} onClick={() => call("fee", "case/fee-payment", fee, "Sent to Finance for approval")}>Send to Finance</button>
          </div>
        )}
        {canEdit && active && isNextDeed && (
          <div className="ml-8 p-3 space-y-2" style={{ border: RULE_SOFT }}>
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
    <>
      <Breadcrumbs items={["CRM", "Resale", `Case #${c.Id}`]} />
      {ask.node}
      <SheetShell
        eyebrow="CivilierERP · CRM · Resale"
        title={`${isResale ? "Resale" : "Buy-back"} · ${c.Property}`}
        subtitle={`Case #${c.Id} · Booking ${c.BookingNo}`}
        action={<button onClick={() => nav("/crm/resales")} className={`${KEY_LINE} h-9 px-3`}><ArrowLeft size={13} /> All cases</button>}
      >
        <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />

        {/* Who → who, and where it stands */}
        <section className="bg-card p-4 mb-4" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-2 h-7" style={{ border: RULE }}>
              {isResale ? <><ArrowRightLeft size={11} /> Resale</> : <><Undo2 size={11} /> Buy-back</>}
            </span>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{c.FromName}</span>
              <ArrowRight size={14} className="text-muted-foreground" />
              <span className="font-semibold">{isResale ? c.ToName || "new buyer" : "back to us"}</span>
            </div>
            <span className="ml-auto">
              {finished
                ? <SheetMark text={c.Status === "Completed" ? `Completed ${date(c.CompletedAt)}` : c.Status} tone={c.Status === "Completed" ? "done" : "stopped"} />
                : <span className="text-xs font-medium"><span className="font-heading tabular-nums">Step {curIdx + 1} of {steps.length}</span>: {steps[curIdx]?.label}</span>}
            </span>
          </div>
          <div className="mt-3 h-2" style={{ border: RULE_SOFT }} role="progressbar" aria-valuenow={doneCount} aria-valuemax={steps.length}>
            <div className={`h-full ${c.Status === "Rejected" || c.Status === "Cancelled" ? "bg-foreground/30" : "bg-foreground"}`} style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }} />
          </div>
          {["Rejected", "Cancelled"].includes(c.Status) && c.RejectionNote && <p className="mt-3 text-sm text-destructive">{c.Status === "Rejected" ? "Sent back: " : ""}{c.RejectionNote}</p>}
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
                <li key={s.key} className={`bg-card ${s.na ? "opacity-60" : ""}`} style={{ border: RULE, borderLeft: active ? "3px solid hsl(var(--foreground))" : RULE }}>
                  <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 transition-colors" onClick={() => setOpen(isOpen ? null : s.key)} aria-expanded={isOpen}>
                    <span className={`w-7 h-7 shrink-0 grid place-items-center font-heading text-xs font-bold tabular-nums ${
                      s.ok || s.na ? "bg-foreground text-card border border-foreground"
                      : active ? "bg-card text-foreground border-2 border-foreground"
                      : s.state === "stopped" ? "bg-destructive text-white border border-destructive"
                      : "border border-dashed border-foreground/30 text-muted-foreground"}`}>
                      {s.ok || s.na ? <Check size={14} /> : s.state === "stopped" ? <X size={13} /> : locked ? <Lock size={12} /> : i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em]">{s.label}</span>
                      <span className="block text-[0.6875rem] text-muted-foreground truncate">
                        {s.na ? "Not needed" : s.ok ? s.detail || "Done" : active ? `${todo} thing${todo === 1 ? "" : "s"} left` : locked ? "Opens after the steps above" : s.detail || ""}
                      </span>
                    </span>
                    {active && <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] px-1.5 py-0.5 bg-foreground text-card">You are here</span>}
                    <ChevronDown size={16} className={`text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4" style={{ borderTop: RULE_SOFT }}>
                      {locked && <p className="pt-3 text-xs text-muted-foreground">Opens once "{steps[curIdx]?.label}" is done. It will need:</p>}
                      <ul>{s.checks.map((ch, ci) => renderCheck(s, ch, ci, active))}</ul>
                      {s.key === "clearance" && active && canEdit && !c.SellerClearedAt && (
                        <button className="text-xs underline underline-offset-2 mt-1" onClick={() => call("loan", "case/seller-loan", { hasLoan: !c.SellerHasLoan }, "Saved")}>
                          {c.SellerHasLoan ? "The seller has no home loan" : "The seller has a home loan"}
                        </button>
                      )}
                      {s === last && active && canEdit && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 p-3" style={{ border: RULE_SOFT }}>
                          <p className="text-xs text-muted-foreground max-w-prose">
                            {isResale ? "The booking, its schedule and everything paid pass to the buyer. The seller's agreement stays as history and the buyer gets portal access."
                              : "Finance pays the agreed price; when they approve it the property returns to stock."}
                          </p>
                          {isResale
                            ? <button className={primary} disabled={!readyToFinish || busy === "finish" || (!!c.FromCustomerId && c.FromCustomerId === c.ToCustomerId)}
                                title={c.FromCustomerId && c.FromCustomerId === c.ToCustomerId ? "The seller and the buyer are the same customer" : undefined}
                                onClick={async () => { if (await ask.confirm(`Pass ${c.Property} to ${c.ToName}?`, { okLabel: "Transfer" })) call("finish", "transfer", {}, "Transferred to the buyer"); }}>Transfer to buyer</button>
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
            <section className="bg-card" style={{ border: RULE }}>
              <h3 className={headTitle} style={{ borderBottom: RULE }}>The property</h3>
              <div className="p-4 text-sm space-y-3">
                <div><span className={label}>Property</span>{c.Property}<span className="block text-[0.6875rem] text-muted-foreground tabular-nums">Booking {c.BookingNo}{c.BookingIds?.length > 1 ? ` + ${c.BookingIds.length - 1} more, moving as one property` : ""}</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><span className={label}>Paid so far</span><span className="font-heading tabular-nums">{fmt(c.OriginalValue)}</span></div>
                  <div><span className={label}>{isResale ? "Price between buyers" : "Buy-back price"}</span><span className="font-heading tabular-nums">{fmt(c.AgreedValue)}</span></div>
                </div>
                {isResale && <div><span className={label}>Our transfer fee</span><span className="font-heading tabular-nums">{Number(c.DeveloperFeeAmount) > 0 ? (Number(c.DeveloperFeeGstAmount) > 0 ? `${fmt(c.DeveloperFeeAmount)} + GST = ${fmt(c.FeeTotal)}` : `${fmt(c.DeveloperFeeAmount)} (no GST)`) : "None"}</span></div>}
                {c.NocNo && <div><span className={label}>NOC</span><span className="tabular-nums">{c.NocNo}</span></div>}
                {c.DeedRegNo && <div><span className={label}>Registered deed</span><span className="tabular-nums">{c.DeedRegNo}</span><span className="block text-[0.6875rem] text-muted-foreground">{date(c.DeedRegDate)} · {c.DeedRegOffice}</span></div>}
              </div>
            </section>
            <section className="bg-card" style={{ border: RULE }}>
              <h3 className={headTitle} style={{ borderBottom: RULE }}>All documents</h3>
              {st.documents.length === 0 ? <p className="p-4 text-xs text-muted-foreground">Each step asks for its own documents.</p> : (
                <ul>
                  {st.documents.map((d) => (
                    <li key={d.Id} className="flex items-center justify-between gap-2 text-xs px-4 py-2" style={{ borderBottom: RULE_SOFT }}>
                      <button className="text-left truncate hover:underline" onClick={() => viewDoc(d)}>{st.docTypes[d.DocumentType] || d.DocumentType}</button>
                      <SheetMark text={d.Status === "Uploaded" ? "To verify" : d.Status} tone={docTone(d.Status)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </SheetShell>
    </>
  );
};

export default CrmResaleCase;

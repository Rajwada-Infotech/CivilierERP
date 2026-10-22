import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";
import { Check, ExternalLink, Eye, Loader2, ScrollText, Upload, UserCheck } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// The detail of one TRANSFER DEED (a resale's deed of assignment: seller +
// buyer + us; a buy-back's cancellation deed: seller + us), laid out like the
// Sale Deed page: a stage stepper, the next-action banner, and the tabs
// Overview / Documents / Legal & Approval / Stamp Duty / Registry / History.
// Stages: Legal Assigned -> Papers -> Legal Head -> Parties -> Signing Date
// -> Stamp Duty -> Executed -> Registered. Every rule lives on the server
// (services/crmTransferDeed.js) — this only shows the stages and acts.

const API = "/api/crm/transfer-deeds";
type Tab = "Overview" | "Documents" | "Legal & Approval" | "Stamp Duty" | "Registry" | "History";
const TABS: Tab[] = ["Overview", "Documents", "Legal & Approval", "Stamp Duty", "Registry", "History"];
const label = "text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground block mb-1";
const input = "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";
const btn = "inline-flex items-center justify-center gap-1.5 px-3 h-8 text-xs rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap";
const primary = `${btn} btn-module text-white hover:shadow-lg`;
const ghost = `${btn} border border-border text-foreground hover:bg-muted`;
const danger = `${btn} border border-red-200 text-red-600 bg-red-50/50 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300`;
const card = "rounded-xl border border-border p-4 space-y-3";
const money = (n: any) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const when = (d: any) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const docChip = (s: string) => s === "Verified" ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900"
  : s === "Rejected" ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"
  : s === "Uploaded" ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900"
  : "bg-muted text-muted-foreground border-border";
const docWord: Record<string, string> = { Requested: "Not uploaded", Uploaded: "To verify", Verified: "Verified", Rejected: "Rejected" };
const STEP_TAB: Record<string, Tab> = { papers: "Documents", legal: "Legal & Approval", parties: "Legal & Approval", date: "Legal & Approval", duty: "Stamp Duty", executed: "Legal & Approval", registry: "Registry" };

const Tick = ({ ok }: { ok: boolean }) => ok
  ? <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-emerald-500 text-white grid place-items-center"><Check size={12} /></span>
  : <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30" aria-label="still needed" />;

/** "Who told us, and how" — the record staff keep when acting for a party (proxy). */
function ProxyFields({ methods, value, onChange, who }: { methods: string[]; value: { ProxyMethod: string; ProxyRemarks: string }; onChange: (v: any) => void; who: string }) {
  return (
    <div className="grid sm:grid-cols-[170px_1fr] gap-2">
      <div><span className={label}>How the {who} told you</span>
        <select className={input} value={value.ProxyMethod} onChange={(e) => onChange({ ...value, ProxyMethod: e.target.value })}>
          <option value="">Choose</option>{methods.map((m) => <option key={m} value={m}>{m === "InPerson" ? "In person" : m}</option>)}
        </select>
      </div>
      <div><span className={label}>Note</span><input className={input} value={value.ProxyRemarks} onChange={(e) => onChange({ ...value, ProxyRemarks: e.target.value })} placeholder="e.g. called on 98300…, confirmed" /></div>
    </div>
  );
}

export function TransferDeedDetail({ id, canEdit: canEditRight, initialTab }: { id: number; canEdit: boolean; initialTab?: Tab }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab || "Overview");
  const [proxy, setProxy] = useState<Record<string, { ProxyMethod: string; ProxyRemarks: string }>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [f, setF] = useState<any>({ date: "", dateBy: "Company", StampDuty: "", RegistrationFee: "", PayableBy: "", DutyRemarks: "", PaidRef: "", AmountPaid: "", PaidOn: new Date().toISOString().slice(0, 10), Office: "", ScheduledAt: "", Attendees: "", RegNo: "", RegDate: "", newDoc: "", newDocParty: "Company", exec: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<{ url: string; fields: Record<string, string> } | null>(null);
  const P = (k: string) => proxy[k] || { ProxyMethod: "", ProxyRemarks: "" };

  // Replaces window.confirm
  const [confirmDialog, setConfirmDialog] = useState<{ msg: string; onOk: () => void } | null>(null);
  const requestConfirm = (msg: string, onOk: () => void) => setConfirmDialog({ msg, onOk });
  // Replaces window.prompt
  const [rejectPrompt, setRejectPrompt] = useState<{ label: string; pendingKey: string; pendingPath: string; pendingOk: string } | null>(null);
  const [rejectInput, setRejectInput] = useState("");
  const requestRejectRemarks = (label: string, key: string, path: string, ok: string) => {
    setRejectInput("");
    setRejectPrompt({ label, pendingKey: key, pendingPath: path, pendingOk: ok });
  };

  const q = useQuery<any>({
    queryKey: ["crm-transfer-deed", id],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${id}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load the deed");
      return r.json();
    },
  });
  const execs = useQuery<any[]>({ queryKey: ["crm-transfer-deed-execs"], queryFn: async () => (await fetchWithAuth(`${API}/legal-executives`)).json(), staleTime: 300_000 });
  const st = q.data;
  const d = st?.deed;
  // A new deed (or one that moved on) opens on the tab its current stage lives on.
  useEffect(() => { if (st?.currentStep && !initialTab) setTab(STEP_TAB[st.currentStep] || "Overview"); }, [id, st?.currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const finished = !!d && ["Registered", "Cancelled"].includes(d.Status);
  const canEdit = canEditRight && !finished;
  const apply = (out: any) => {
    if (out?.steps) qc.setQueryData(["crm-transfer-deed", id], out); else qc.invalidateQueries({ queryKey: ["crm-transfer-deed", id] });
    qc.invalidateQueries({ queryKey: ["crm-transfer-deeds"] });
    qc.invalidateQueries({ queryKey: ["crm-resale-case"] });
  };
  const call = async (key: string, path: string, body?: object, ok?: string, method = "PUT") => {
    setBusy(key);
    try {
      const r = await fetchWithAuth(`${API}/${id}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Could not do that");
      toast.success(ok || "Done");
      apply(out);
      return true;
    } catch (e: any) { toast.error(translateError(e.message)); return false; }
    finally { setBusy(null); }
  };
  const pickFile = (url: string, fields: Record<string, string> = {}) => { pending.current = { url, fields }; fileRef.current?.click(); };
  const sendFile = async (file: File) => {
    const p = pending.current;
    if (!p) return;
    setBusy("file");
    try {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(p.fields)) if (v) fd.append(k, v);
      const r = await fetchWithAuth(`${API}/${id}/${p.url}`, { method: "POST", body: fd });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || "Upload failed");
      toast.success("Uploaded");
      apply(out);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; pending.current = null; }
  };
  const view = async (url: string) => {
    const r = await fetchWithAuth(`${API}/${id}/${url}`);
    if (!r.ok) { toast.error("Could not open the file"); return; }
    const u = URL.createObjectURL(await r.blob());
    window.open(u, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  };
  const reject = (key: string, path: string, what: string) => {
    // Replaces window.prompt — uses Radix Dialog instead
    requestRejectRemarks(`${what} — say why (they see this):`, key, path, "Sent back");
  };

  if (q.isLoading) return <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>;
  if (q.isError || !st || !d) return <div className="p-6 text-sm text-red-600">{(q.error as any)?.message || "Not found"}</div>;

  const methods: string[] = st.proxyMethods || [];
  const docs: any[] = st.documents;
  const payment = st.payment;
  const registry = st.registry;
  const steps: any[] = st.steps;
  const partyName = (p: string) => (p === "Seller" ? d.SellerName : p === "Buyer" ? d.BuyerName : "Us");
  const regCopy = docs.find((x) => x.DocumentType === "RegisteredDeed");
  const papers = docs.filter((x) => x.DocumentType !== "RegisteredDeed");
  const papersEditable = canEdit && ["Draft", "UnderReview"].includes(d.Status);

  // ── Stepper (same pattern as the Sale Deed page) ──
  const stepper = [
    { label: "Legal Assigned", done: !!d.LegalExecutiveId, tab: "Overview" as Tab },
    { label: `Papers (${papers.filter((x) => x.IsMandatory && x.Status === "Verified").length}/${papers.filter((x) => x.IsMandatory).length})`, done: steps[0].ok, tab: "Documents" as Tab },
    ...steps.slice(1).map((s: any) => ({ label: s.key === "legal" ? "Legal Head" : s.key === "parties" ? (st.parties.length > 1 ? "Parties Approve" : "Seller Approves") : s.key === "date" ? "Signing Date" : s.key === "duty" ? "Stamp Duty" : s.key === "executed" ? "Executed" : "Registered", done: s.ok, tab: STEP_TAB[s.key] })),
  ];
  let blocked = false;
  const chips = stepper.map((s) => { const state = !blocked && s.done ? "done" : !blocked ? (blocked = true, "current") : "upcoming"; return { ...s, state }; });

  // ── Next-action banner ──
  const cur = steps.find((s: any) => s.state === "current");
  const next = cur?.checks.find((c: any) => !c.ok);
  const banner = d.Status === "Cancelled" ? { v: "error", t: "This deed is cancelled." }
    : d.Status === "Registered" ? { v: "success", t: "Deed complete — registered at the Sub-Registrar." }
    : cur ? { v: "action", t: `${cur.label}: ${next?.label || "ready"}`, tab: STEP_TAB[cur.key] } : null;

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])} />

      <div className="rounded-xl border border-border bg-card px-3 py-2">
        <div className="flex items-center overflow-x-auto thin-scroll pb-1">
          {chips.map((s, i) => (
            <React.Fragment key={s.label}>
              <button onClick={() => setTab(s.tab)} className={cn("flex items-center gap-1.5 shrink-0 rounded-lg px-2 py-1.5 hover:bg-muted/60 transition-colors", tab === s.tab ? "bg-muted/50" : "")}>
                <span className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[0.625rem] font-bold shrink-0 ring-2",
                  s.state === "done" ? "bg-emerald-500 text-white ring-emerald-200 dark:ring-emerald-900" : s.state === "current" ? "bg-primary text-primary-foreground ring-primary/25" : "bg-muted text-muted-foreground ring-transparent")}>
                  {s.state === "done" ? <Check size={11} /> : i + 1}
                </span>
                <span className={cn("text-[0.6875rem] font-semibold whitespace-nowrap", s.state === "done" ? "text-emerald-600 dark:text-emerald-400" : s.state === "current" ? "text-foreground" : "text-muted-foreground/60")}>{s.label}</span>
              </button>
              {i < chips.length - 1 && <div className={cn("w-4 h-px mx-0.5 shrink-0", chips[i + 1].state !== "upcoming" ? "bg-emerald-400" : "bg-border")} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {banner && (
        <div className={cn("rounded-xl border px-4 py-2.5 flex items-center justify-between gap-3",
          banner.v === "error" ? "border-red-200 bg-red-50/60 text-red-700 dark:bg-red-950/20 dark:border-red-900 dark:text-red-300"
          : banner.v === "success" ? "border-green-200 bg-green-50/60 text-green-700 dark:bg-green-950/20 dark:border-green-900 dark:text-green-300"
          : "border-primary/30 bg-primary/5")}>
          <span className="text-sm font-medium">{banner.t}</span>
          {banner.tab && banner.tab !== tab && <button className={primary} onClick={() => setTab(banner.tab as Tab)}>Go to {banner.tab}</button>}
        </div>
      )}

      {/* Header */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className={cn("px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-b",
          d.Status === "Registered" ? "bg-gradient-to-r from-green-500/10 to-green-500/5 border-green-200/60 dark:border-green-900/40"
          : d.Status === "Cancelled" ? "bg-gradient-to-r from-red-500/10 to-red-500/5 border-red-200/60 dark:border-red-900/40" : "bg-muted/20 border-border")}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl shrink-0 bg-primary/10"><ScrollText size={16} className="text-primary" /></div>
            <div className="min-w-0">
              <h2 className="font-bold text-[0.9375rem] leading-tight truncate">{d.SellerName}<span className="font-normal opacity-60"> → {d.DeedType === "Assignment" ? d.BuyerName : "us (buy-back)"}</span></h2>
              <p className="text-[0.6875rem] font-mono text-muted-foreground mt-0.5">{d.DeedNo}{d.VersionNo > 1 && <span className="ml-1.5 text-violet-600">· v{d.VersionNo}</span>}<span className="ml-1.5">· {d.BookingNo} · {d.Property}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2.5 py-1 rounded-lg border font-semibold bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900">{d.DeedType === "Assignment" ? "Deed of assignment" : "Cancellation deed"} · {d.StatusLabel}</span>
            <Link to={`/crm/resales/${d.ResaleId}`} className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted inline-flex items-center gap-1">Case #{d.ResaleId} <ExternalLink size={10} /></Link>
            {canEdit && !["Executed"].includes(d.Status) && (
              <button className={danger} onClick={() => {
                // Replaces window.prompt — uses Radix Dialog instead
                requestRejectRemarks("Why is this deed cancelled?", "cancel", "cancel", "Cancelled");
              }}>Cancel</button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs (same pattern as the Sale Deed page) */}
      <div className="flex items-center gap-x-1 border-b border-border px-1 overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5 ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[0.625rem] font-bold shrink-0 ${tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>{t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <div className="text-sm font-semibold">Parties</div>
            {["Seller", ...(d.DeedType === "Assignment" ? ["Buyer"] : [])].map((p) => <div key={p} className="text-sm"><span className={label}>{p}</span>{partyName(p)}</div>)}
            <div className="text-sm"><span className={label}>Developer</span>Us — {d.DeedType === "Assignment" ? "consenting party (our NOC)" : "taking the property back"}</div>
          </div>
          <div className={card}>
            <div className="text-sm font-semibold">Legal executive</div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <select className={input} disabled={!canEdit || !["Draft", "UnderReview", "LegalApproved", "WithParties", "PartiesApproved", "DateApproved"].includes(d.Status)} value={f.exec || d.LegalExecutiveId || ""} onChange={(e) => setF({ ...f, exec: e.target.value })}>
                  <option value="">— Unassigned —</option>{(execs.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              {canEdit && f.exec && String(f.exec) !== String(d.LegalExecutiveId || "") && <button className={primary} disabled={busy === "exec"} onClick={() => call("exec", "legal-executive", { LegalExecutiveId: Number(f.exec) }, "Legal executive assigned")}>Assign</button>}
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">Prepares the papers and attends the Sub-Registrar visit.{d.RecheckCount ? ` · ${d.RecheckCount} recheck(s) so far` : ""}</p>
          </div>
        </div>
      )}

      {tab === "Documents" && (
        <div className="space-y-3">
          <ul className="divide-y divide-border rounded-xl border border-border">
            {papers.map((x) => {
              const pk = `doc-${x.Id}`;
              return (
                <li key={x.Id} className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tick ok={x.Status === "Verified"} />
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-sm font-medium">{x.Label}{!x.IsMandatory && <span className="text-[0.625rem] text-muted-foreground"> · optional</span>}</div>
                      <div className="text-[0.6875rem] text-muted-foreground">{x.Party === "Company" ? "Ours" : `${x.Party} — ${partyName(x.Party)}`}{x.UploadedByType ? ` · uploaded ${x.UploadedByType === "Portal" ? "by them in the portal" : x.UploadedByType === "Proxy" ? "by staff for them" : "by staff"}` : ""}{x.Remarks ? ` · ${x.Remarks}` : ""}</div>
                    </div>
                    <span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full border ${docChip(x.Status)}`}>{docWord[x.Status] || x.Status}</span>
                    {x.FileName && <button className={ghost} onClick={() => view(`documents/${x.Id}/file`)}><Eye size={12} /> View</button>}
                    {papersEditable && x.Status === "Uploaded" && <>
                      <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={!!busy} onClick={() => call(pk, `documents/${x.Id}/review`, { decision: "Verified" }, "Verified")}>Verify</button>
                      <button className={ghost} disabled={!!busy} onClick={() => reject(pk, `documents/${x.Id}/review`, "Reject this document")}>Reject</button>
                    </>}
                    {papersEditable && x.Party === "Company" && !["Verified", "Uploaded"].includes(x.Status) && <button className={ghost} disabled={!!busy} onClick={() => pickFile(`documents/${x.Id}/upload`)}><Upload size={12} /> Upload</button>}
                  </div>
                  {papersEditable && x.Party !== "Company" && !["Verified", "Uploaded"].includes(x.Status) && (
                    <div className="ml-8 rounded-lg border border-dashed border-border p-2.5 space-y-2">
                      <p className="text-[0.6875rem] text-muted-foreground">{partyName(x.Party)} uploads it in their portal — or upload what they sent you:</p>
                      <ProxyFields methods={methods} who={x.Party.toLowerCase()} value={P(pk)} onChange={(v) => setProxy({ ...proxy, [pk]: v })} />
                      <button className={ghost} disabled={!P(pk).ProxyMethod || !P(pk).ProxyRemarks.trim() || !!busy} onClick={() => pickFile(`documents/${x.Id}/upload`, P(pk))}><Upload size={12} /> Upload for them</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {papersEditable && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px]"><span className={label}>Need another paper?</span><input className={input} value={f.newDoc} onChange={(e) => setF({ ...f, newDoc: e.target.value })} placeholder="e.g. Seller's possession letter" /></div>
              <div><span className={label}>Whose</span><select className={input} value={f.newDocParty} onChange={(e) => setF({ ...f, newDocParty: e.target.value })}>
                {["Company", ...st.parties].map((p: string) => <option key={p} value={p}>{p === "Company" ? "Ours" : p}</option>)}</select></div>
              <button className={ghost} disabled={!f.newDoc.trim() || !!busy} onClick={async () => { if (await call("req", "documents/request", { Label: f.newDoc, Party: f.newDocParty, DocumentType: "Other" }, "Requested", "POST")) setF({ ...f, newDoc: "" }); }}>Request it</button>
            </div>
          )}
        </div>
      )}

      {tab === "Legal & Approval" && (
        <div className="space-y-3">
          {/* Legal Head */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2"><div className="text-sm font-semibold">Legal Head approval</div><span className="text-[0.6875rem] text-muted-foreground">{steps[1].ok ? "Approved" : d.SeniorApprovalStatus === "Pending" ? "Waiting" : "Not sent yet"}</span></div>
            {d.SeniorRemarks && <p className="text-xs text-muted-foreground">{d.SeniorRemarks}</p>}
            {canEdit && d.Status === "Draft" && <button className={primary} disabled={busy === "submit"} onClick={() => call("submit", "submit", {}, "Sent to the Legal Head")}>Send to the Legal Head</button>}
            {canEdit && d.Status === "UnderReview" && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[200px]"><span className={label}>Remarks</span><input className={input} value={remarks.legal || ""} onChange={(e) => setRemarks({ ...remarks, legal: e.target.value })} /></div>
                <button className={primary} disabled={!!busy} onClick={() => call("legal", "legal/approve", { remarks: remarks.legal }, "Approved")}>Approve</button>
                <button className={danger} disabled={!!busy || !(remarks.legal || "").trim()} title="Add what needs changing" onClick={() => call("legal", "legal/reject", { remarks: remarks.legal }, "Sent back for changes")}>Send back</button>
              </div>
            )}
          </div>
          {/* Parties */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2"><div className="text-sm font-semibold">{st.parties.length > 1 ? "Seller & buyer review the draft" : "Seller reviews the draft"}</div>
              {canEdit && d.Status === "LegalApproved" && <button className={primary} disabled={busy === "send"} onClick={() => call("send", "send-to-parties", {}, "Sent — they can answer in the portal")}>Send to the portal</button>}</div>
            {st.parties.map((p: string) => {
              const s = d[`${p}Approval`];
              const pk = `party-${p}`;
              return (
                <div key={p} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <UserCheck size={14} className="text-muted-foreground" />
                    <span className="text-sm font-medium flex-1">{p} — {partyName(p)}</span>
                    <span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full border ${s === "Approved" ? docChip("Verified") : s === "Pending" ? docChip("Uploaded") : docChip("")}`}>{s === "Approved" ? "Approved" : s === "Pending" ? "Reviewing in the portal" : "Not sent yet"}</span>
                  </div>
                  {d[`${p}Remarks`] && <p className="text-[0.6875rem] text-muted-foreground">{d[`${p}Remarks`]}</p>}
                  {canEdit && d.Status === "WithParties" && s === "Pending" && (
                    <div className="rounded-lg border border-dashed border-border p-2.5 space-y-2">
                      <p className="text-[0.6875rem] text-muted-foreground">If {partyName(p)} answered you directly, record it for them:</p>
                      <ProxyFields methods={methods} who={p.toLowerCase()} value={P(pk)} onChange={(v) => setProxy({ ...proxy, [pk]: v })} />
                      <div className="flex flex-wrap gap-2">
                        <button className={primary} disabled={!P(pk).ProxyMethod || !P(pk).ProxyRemarks.trim() || !!busy} onClick={() => call(pk, `parties/${p}/respond`, { decision: "Approved", ...P(pk) }, `${p}'s approval recorded`)}>They approve</button>
                        <button className={danger} disabled={!P(pk).ProxyMethod || !P(pk).ProxyRemarks.trim() || !!busy} onClick={() => {
                          // Replaces window.prompt — uses Radix Dialog instead
                          requestRejectRemarks("What do they want checked?", pk, `parties/${p}/respond`, "Sent back for a recheck");
                        }}>They ask for a recheck</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Signing date */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2"><div className="text-sm font-semibold">Signing date</div>
              <span className="text-[0.6875rem] text-muted-foreground">{d.DeedDate ? `Approved: ${d.DeedDate}` : d.ProposedDate ? `Proposed ${d.ProposedDate} by ${d.ProposedBy === "Company" ? "us" : d.ProposedBy}` : "Not proposed"}</span></div>
            {canEdit && d.Status === "PartiesApproved" && d.DateApprovalStatus !== "Pending" && (
              <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                <div className="grid sm:grid-cols-[180px_200px] gap-2">
                  <div><span className={label}>Proposed by</span><select className={input} value={f.dateBy} onChange={(e) => setF({ ...f, dateBy: e.target.value })}>
                    {["Company", ...st.parties].map((p: string) => <option key={p} value={p}>{p === "Company" ? "Us" : `${p} (for them)`}</option>)}</select></div>
                  <div><span className={label}>Date</span><DateInput value={f.date} onChange={(e: any) => setF({ ...f, date: e.target.value })} /></div>
                </div>
                {f.dateBy !== "Company" && <ProxyFields methods={methods} who={f.dateBy.toLowerCase()} value={P("dateprop")} onChange={(v) => setProxy({ ...proxy, dateprop: v })} />}
                <button className={primary} disabled={!f.date || !!busy || (f.dateBy !== "Company" && (!P("dateprop").ProxyMethod || !P("dateprop").ProxyRemarks.trim()))}
                  onClick={() => call("date", "date/propose", { Date: f.date, ProposedBy: f.dateBy, ...(f.dateBy !== "Company" ? P("dateprop") : {}) }, "Proposed — the parties accept it in the portal")}>{d.ProposedDate ? "Propose another date" : "Propose the date"}</button>
              </div>
            )}
            {d.ProposedDate && d.Status === "PartiesApproved" && st.parties.map((p: string) => {
              const ok = d[`${p}DateAccepted`];
              const pk = `date-${p}`;
              return (
                <div key={p} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2"><Tick ok={!!ok} /><span className="text-sm flex-1">{p} — {partyName(p)} {ok ? "accepted the date" : "hasn't accepted it yet"}</span></div>
                  {canEdit && !ok && d.DateApprovalStatus !== "Pending" && <>
                    <ProxyFields methods={methods} who={p.toLowerCase()} value={P(pk)} onChange={(v) => setProxy({ ...proxy, [pk]: v })} />
                    <button className={ghost} disabled={!P(pk).ProxyMethod || !P(pk).ProxyRemarks.trim() || !!busy} onClick={() => call(pk, `date/accept/${p}`, P(pk), "Recorded")}>They accept this date</button>
                  </>}
                </div>
              );
            })}
            {canEdit && d.DateApprovalStatus === "Pending" && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[200px]"><span className={label}>Remarks</span><input className={input} value={remarks.date || ""} onChange={(e) => setRemarks({ ...remarks, date: e.target.value })} /></div>
                <button className={primary} disabled={!!busy} onClick={() => call("dateok", "date/approve", { remarks: remarks.date }, "Date approved")}>Approve the date</button>
                <button className={danger} disabled={!!busy || !(remarks.date || "").trim()} onClick={() => call("dateok", "date/reject", { remarks: remarks.date }, "Turned down")}>Turn it down</button>
              </div>
            )}
          </div>
          {/* Execution */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2"><div className="text-sm font-semibold">Execution (signing)</div><span className="text-[0.6875rem] text-muted-foreground">{d.ExecutedAt ? `Executed ${when(d.ExecutedAt)}` : "After the stamp duty is confirmed"}</span></div>
            {canEdit && d.Status === "DateApproved" && <button className={primary} disabled={busy === "x" || payment?.Status !== "Confirmed"} title={payment?.Status !== "Confirmed" ? "Confirm the stamp duty first" : undefined}
              onClick={() => {
                // Replaces window.confirm — uses Radix AlertDialog instead
                requestConfirm(`Every party signed ${d.DeedNo} on ${d.DeedDate}?`, () => call("x", "execute", {}, "Marked executed"));
              }}>Mark executed</button>}
          </div>
        </div>
      )}

      {tab === "Stamp Duty" && (
        <div className="space-y-3">
          <div className={card}>
            <div className="text-sm font-semibold">Stamp duty & registration fee</div>
            {!payment && d.Status !== "DateApproved" && <p className="text-xs text-muted-foreground">Assessed once the signing date is approved — the deed is stamped before it is signed.</p>}
            {payment && <div className="text-sm">Assessed {money(payment.StampDuty)} stamp duty + {money(payment.RegistrationFee)} registration fee · paid by <b>{payment.PayableBy}</b>{payment.InfoRemarks ? ` · ${payment.InfoRemarks}` : ""}</div>}
            {payment?.PaidRef && <div className="text-sm flex flex-wrap items-center gap-2">Paid {money(payment.AmountPaid)} · {payment.PaidRef} · {payment.ProofUploadedByType === "Portal" ? "uploaded by them" : payment.ProofUploadedByType === "Proxy" ? "uploaded by staff for them" : "uploaded by staff"}
              <button className={ghost} onClick={() => view("duty/proof")}><Eye size={12} /> Proof</button></div>}
            {payment?.ConfirmRemarks && <p className="text-[0.6875rem] text-muted-foreground">{payment.ConfirmRemarks}</p>}
            {payment?.Status === "Confirmed" && <p className="text-sm text-green-700 dark:text-green-300">Confirmed</p>}
          </div>
          {canEdit && d.Status === "DateApproved" && (!payment || (payment.Status === "InfoSent" && !payment.PaidRef)) && (
            <div className={card}>
              <div className="text-xs font-medium">{payment ? "Change the assessment" : "Assessment from the Sub-Registrar"}</div>
              <div className="grid sm:grid-cols-4 gap-2">
                <div><span className={label}>Stamp duty</span><input type="number" min={0} className={input} value={f.StampDuty} onChange={(e) => setF({ ...f, StampDuty: e.target.value })} /></div>
                <div><span className={label}>Registration fee</span><input type="number" min={0} className={input} value={f.RegistrationFee} onChange={(e) => setF({ ...f, RegistrationFee: e.target.value })} /></div>
                <div><span className={label}>Paid by</span><select className={input} value={f.PayableBy} onChange={(e) => setF({ ...f, PayableBy: e.target.value })}>
                  <option value="">Choose</option>{[...st.parties, "Developer", "Shared"].map((x: string) => <option key={x}>{x}</option>)}</select></div>
                <div><span className={label}>Note</span><input className={input} value={f.DutyRemarks} onChange={(e) => setF({ ...f, DutyRemarks: e.target.value })} /></div>
              </div>
              <button className={primary} disabled={!f.PayableBy || !!busy} onClick={() => call("duty", "duty/info", { StampDuty: f.StampDuty, RegistrationFee: f.RegistrationFee, PayableBy: f.PayableBy, Remarks: f.DutyRemarks }, "Sent to the payer")}>Send to the payer</button>
            </div>
          )}
          {canEdit && payment?.Status === "InfoSent" && (
            <div className={card}>
              <div className="text-xs font-medium">Paid? The payer uploads the challan in their portal — or upload what they sent you</div>
              <div className="grid sm:grid-cols-3 gap-2">
                <div><span className={label}>GRN / challan no.</span><input className={input} value={f.PaidRef} onChange={(e) => setF({ ...f, PaidRef: e.target.value })} /></div>
                <div><span className={label}>Amount paid</span><input type="number" min={0} className={input} value={f.AmountPaid} onChange={(e) => setF({ ...f, AmountPaid: e.target.value })} /></div>
                <div><span className={label}>Paid on</span><DateInput value={f.PaidOn} onChange={(e: any) => setF({ ...f, PaidOn: e.target.value })} /></div>
              </div>
              {payment.PayableBy !== "Developer" && <ProxyFields methods={methods} who="payer" value={P("duty")} onChange={(v) => setProxy({ ...proxy, duty: v })} />}
              <button className={ghost} disabled={!f.PaidRef || !(Number(f.AmountPaid) > 0) || !!busy || (payment.PayableBy !== "Developer" && (!P("duty").ProxyMethod || !P("duty").ProxyRemarks.trim()))}
                onClick={() => pickFile("duty/proof", { PaidRef: f.PaidRef, AmountPaid: f.AmountPaid, PaidOn: f.PaidOn, ...(payment.PayableBy !== "Developer" ? P("duty") : {}) })}><Upload size={12} /> Upload the challan</button>
            </div>
          )}
          {canEdit && payment?.Status === "ProofUploaded" && (
            <div className={cn(card, "flex flex-wrap items-end gap-2 space-y-0")}>
              <div className="flex-1 min-w-[200px]"><span className={label}>Remarks</span><input className={input} value={remarks.duty || ""} onChange={(e) => setRemarks({ ...remarks, duty: e.target.value })} placeholder="Needed if the amount differs from the assessment" /></div>
              <button className={primary} disabled={!!busy} onClick={() => call("dutyok", "duty/confirm", { remarks: remarks.duty }, "Confirmed")}>Confirm the payment</button>
              <button className={danger} disabled={!!busy || !(remarks.duty || "").trim()} onClick={() => call("dutyok", "duty/return", { remarks: remarks.duty }, "Sent back")}>Send back</button>
            </div>
          )}
        </div>
      )}

      {tab === "Registry" && (
        <div className="space-y-3">
          <div className={card}>
            <div className="text-sm font-semibold">Sub-Registrar visit</div>
            {registry ? <p className="text-sm"><b>{registry.Office}</b> · {when(registry.ScheduledAt)}{registry.Attendees ? ` · ${registry.Attendees}` : ""}{registry.RegNo ? ` · registered ${registry.RegNo}` : ""}</p>
              : <p className="text-xs text-muted-foreground">Scheduled once the deed is executed.</p>}
            {canEdit && d.Status === "Executed" && (
              <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                <div className="grid sm:grid-cols-3 gap-2">
                  <div><span className={label}>Office</span><input className={input} value={f.Office} onChange={(e) => setF({ ...f, Office: e.target.value })} placeholder="e.g. ADSR Bidhannagar" /></div>
                  <div><span className={label}>Date & time</span><input type="datetime-local" className={input} value={f.ScheduledAt} onChange={(e) => setF({ ...f, ScheduledAt: e.target.value })} /></div>
                  <div><span className={label}>Who attends</span><input className={input} value={f.Attendees} onChange={(e) => setF({ ...f, Attendees: e.target.value })} placeholder="Seller, buyer, legal executive" /></div>
                </div>
                <button className={primary} disabled={!f.Office.trim() || !f.ScheduledAt || !!busy} onClick={() => call("reg", "registry/schedule", { Office: f.Office, ScheduledAt: new Date(f.ScheduledAt).toISOString(), Attendees: f.Attendees }, registry ? "Rescheduled" : "Visit scheduled")}>{registry ? "Reschedule" : "Schedule the visit"}</button>
              </div>
            )}
          </div>
          {registry && (
            <div className={card}>
              <div className="flex flex-wrap items-center gap-2">
                <Tick ok={regCopy?.Status === "Verified"} />
                <span className="text-sm font-semibold flex-1">Registered deed (copy)</span>
                {regCopy && <span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full border ${docChip(regCopy.Status)}`}>{docWord[regCopy.Status]}</span>}
                {regCopy?.FileName && <button className={ghost} onClick={() => view(`documents/${regCopy.Id}/file`)}><Eye size={12} /> View</button>}
                {canEdit && d.Status === "Executed" && regCopy && !["Verified", "Uploaded"].includes(regCopy.Status) && <button className={ghost} disabled={!!busy} onClick={() => pickFile("registry/copy")}><Upload size={12} /> Upload</button>}
                {canEdit && regCopy?.Status === "Uploaded" && <>
                  <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={!!busy} onClick={() => call("copy", "registry/copy/verify", {}, "Verified")}>Verify</button>
                  <button className={ghost} disabled={!!busy} onClick={() => reject("copy", "registry/copy/reject", "Reject the copy")}>Reject</button>
                </>}
              </div>
              {canEdit && d.Status === "Executed" && (
                <div className="grid sm:grid-cols-[1fr_200px_auto] gap-2 items-end">
                  <div><span className={label}>Registration no.</span><input className={input} value={f.RegNo} onChange={(e) => setF({ ...f, RegNo: e.target.value })} /></div>
                  <div><span className={label}>Registered on</span><DateInput value={f.RegDate} onChange={(e: any) => setF({ ...f, RegDate: e.target.value })} /></div>
                  <button className={primary} disabled={!f.RegNo.trim() || !f.RegDate || regCopy?.Status !== "Verified" || !!busy} onClick={() => call("done", "registry/complete", { RegNo: f.RegNo, RegDate: f.RegDate }, "Registered")}>Mark registered</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "History" && (
        <ol className="rounded-xl border border-border p-4 space-y-2.5">
          {st.history.map((h: any, i: number) => (
            <li key={i} className="text-sm flex gap-3">
              <span className="text-[0.6875rem] text-muted-foreground w-36 shrink-0 tabular-nums">{when(h.At)}</span>
              <span className="flex-1"><span className="font-medium">{h.Action}</span>
                <span className="block text-[0.6875rem] text-muted-foreground">
                  {h.ActorType === "Portal" ? `${h.PortalName || h.Party} in the portal` : h.ActorType === "Proxy" ? `${h.ActorName || "Staff"} for the ${String(h.Party || "party").toLowerCase()} (${h.Method === "InPerson" ? "in person" : h.Method})` : h.ActorName || "Staff"}{h.Remarks ? ` · ${h.Remarks}` : ""}
                </span></span>
            </li>
          ))}
        </ol>
      )}

      {/* Shared AlertDialog — replaces window.confirm */}
      <AlertDialog open={confirmDialog !== null} onOpenChange={(o) => !o && setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Action</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog?.msg}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmDialog?.onOk(); setConfirmDialog(null); }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Shared prompt Dialog — replaces window.prompt */}
      <Dialog open={rejectPrompt !== null} onOpenChange={(o) => !o && setRejectPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Required Reason</DialogTitle>
            <DialogDescription>{rejectPrompt?.label}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={rejectInput}
            onChange={(e) => setRejectInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rejectInput.trim() && rejectPrompt) {
                const { pendingKey, pendingPath, pendingOk } = rejectPrompt;
                // For recheck calls the body includes decision + proxy fields; for others just remarks
                const isRecheck = pendingPath.includes("/respond");
                const body = isRecheck
                  ? { decision: "Recheck", ...P(pendingKey), Remarks: rejectInput.trim() }
                  : { remarks: rejectInput.trim(), decision: "Rejected" };
                call(pendingKey, pendingPath, body, pendingOk);
                setRejectPrompt(null);
              }
            }}
            placeholder="Enter reason…"
          />
          <DialogFooter>
            <button className={ghost} onClick={() => setRejectPrompt(null)}>Cancel</button>
            <button className={primary} disabled={!rejectInput.trim()} onClick={() => {
              if (!rejectPrompt) return;
              const { pendingKey, pendingPath, pendingOk } = rejectPrompt;
              const isRecheck = pendingPath.includes("/respond");
              const body = isRecheck
                ? { decision: "Recheck", ...P(pendingKey), Remarks: rejectInput.trim() }
                : { remarks: rejectInput.trim(), decision: "Rejected" };
              call(pendingKey, pendingPath, body, pendingOk);
              setRejectPrompt(null);
            }}>Submit</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TransferDeedDetail;

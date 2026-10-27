import { useSheetAsk } from "@/components/sheet/SheetAsk";
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DateInput } from "@/components/ui/date-input";
import { AlertCircle, ArrowRight, Check, CheckCircle2, ExternalLink, Eye, Loader2, ScrollText, Upload, UserCheck } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";
import { localDay } from "./salesDeed/config";

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
const label = `block mb-1 ${LBL}`;
const input = INP;
const primary = `${KEY_INK} h-8 px-3 whitespace-nowrap`;
const ghost = `${KEY_LINE} h-8 px-3 whitespace-nowrap`;
const danger = `${KEY_LINE} h-8 px-3 whitespace-nowrap !text-destructive !border-destructive`;
const card = "bg-card border border-foreground p-4 space-y-3";
const head = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const money = (n: any) => (n == null ? "—" : fmtRupees(Number(n)));
const when = (d: any) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const docTone = (s: string): "done" | "waiting" | "stopped" | "none" => (s === "Verified" || s === "Approved" ? "done" : s === "Rejected" ? "stopped" : s === "Uploaded" || s === "Pending" ? "waiting" : "none");
const Mark = ({ s, text }: { s: string; text: string }) => docTone(s) === "none"
  ? <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{text}</span>
  : <SheetMark text={text} tone={docTone(s) as "done" | "waiting" | "stopped"} />;
const docWord: Record<string, string> = { Requested: "Not uploaded", Uploaded: "To verify", Verified: "Verified", Rejected: "Rejected" };
const STEP_TAB: Record<string, Tab> = { papers: "Documents", legal: "Legal & Approval", parties: "Legal & Approval", date: "Legal & Approval", duty: "Stamp Duty", executed: "Legal & Approval", registry: "Registry" };

const Tick = ({ ok }: { ok: boolean }) => ok
  ? <span className="mt-0.5 w-5 h-5 shrink-0 bg-foreground text-card grid place-items-center"><Check size={12} /></span>
  : <span className="mt-0.5 w-5 h-5 shrink-0 border-2 border-foreground/50 bg-card" aria-label="still needed" />;

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
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  // ?tab= comes from links: only a real tab is taken (another value left the page with no tab open).
  const [tab, setTab] = useState<Tab>(initialTab && TABS.includes(initialTab) ? initialTab : "Overview");
  const [proxy, setProxy] = useState<Record<string, { ProxyMethod: string; ProxyRemarks: string }>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [f, setF] = useState<any>({ date: "", dateBy: "Company", StampDuty: "", RegistrationFee: "", PayableBy: "", DutyRemarks: "", PaidRef: "", AmountPaid: "", PaidOn: localDay(), Office: "", ScheduledAt: "", Attendees: "", RegNo: "", RegDate: "", newDoc: "", newDocParty: "Company", exec: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<{ url: string; fields: Record<string, string> } | null>(null);
  const P = (k: string) => proxy[k] || { ProxyMethod: "", ProxyRemarks: "" };

  const q = useQuery<any>({
    queryKey: ["crm-transfer-deed", id],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${id}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load the deed");
      return r.json();
    },
  });
  const execs = useQuery<any[]>({
    queryKey: ["crm-transfer-deed-execs"],
    queryFn: async () => { const r = await fetchWithAuth(`${API}/legal-executives`); const j = await r.json().catch(() => []); return r.ok && Array.isArray(j) ? j : []; },
    staleTime: 300_000,
  });
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
  const reject = async (key: string, path: string, what: string) => {
    const r = (await ask.prompt(`${what} — say why (they see this).`, { title: "Send back", okLabel: "Send back", danger: true })) || "";
    if (r.trim()) call(key, path, { remarks: r, decision: "Rejected" }, "Sent back");
  };

  if (q.isLoading) return <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>;
  if (q.isError || !st || !d) return <div className="p-6 text-sm text-destructive">{(q.error as any)?.message || "Not found"}</div>;

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
      {ask.node}
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])} />

      <div className="bg-card p-3 space-y-3" style={{ border: RULE }}>
        <div className="flex items-center overflow-x-auto thin-scroll pb-1">
          {chips.map((s, i) => (
            <React.Fragment key={s.label}>
              <button onClick={() => setTab(s.tab)} className={`flex items-center gap-1.5 shrink-0 px-2 py-1.5 hover:bg-primary/10 transition-colors ${tab === s.tab ? "bg-primary/10" : ""}`}>
                <span className={`w-6 h-6 flex items-center justify-center text-[0.625rem] font-bold shrink-0 border ${
                  s.state === "done" ? "bg-foreground text-card border-foreground" : s.state === "current" ? "bg-card text-foreground border-foreground border-2" : "bg-card text-muted-foreground border-foreground/25"}`}>
                  {s.state === "done" ? <Check size={11} /> : <span className="font-heading tabular-nums">{i + 1}</span>}
                </span>
                <span className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.08em] whitespace-nowrap ${s.state === "upcoming" ? "text-muted-foreground/60" : "text-foreground"}`}>{s.label}</span>
              </button>
              {i < chips.length - 1 && <div className={`w-4 h-px mx-0.5 shrink-0 ${chips[i + 1].state !== "upcoming" ? "bg-foreground" : "bg-foreground/20"}`} />}
            </React.Fragment>
          ))}
        </div>
        {banner && (
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 bg-card"
            style={{ border: RULE_SOFT, borderLeft: `3px solid ${banner.v === "error" ? "hsl(var(--destructive))" : banner.v === "success" ? "hsl(var(--foreground) / 0.3)" : "hsl(var(--foreground))"}` }}>
            <span className={`text-sm font-semibold flex items-center gap-2 ${banner.v === "error" ? "text-destructive" : ""}`}>
              {banner.v === "error" ? <AlertCircle size={15} /> : banner.v === "success" ? <CheckCircle2 size={15} /> : <ArrowRight size={15} />}{banner.t}
            </span>
            {banner.tab && banner.tab !== tab && <button className={`${KEY_INK} h-9 px-4`} onClick={() => setTab(banner.tab as Tab)}>Go to {banner.tab}</button>}
          </div>
        )}
      </div>


      {/* Header */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <span className={`block ${LBL}`}>{d.DeedType === "Assignment" ? "Deed of assignment" : "Cancellation deed"}</span>
            <h2 className="font-heading font-bold text-lg leading-tight truncate flex items-center gap-2"><ScrollText size={16} /> {d.SellerName}<span className="font-normal text-muted-foreground"> → {d.DeedType === "Assignment" ? d.BuyerName : "us (buy-back)"}</span></h2>
            <p className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">{d.DeedNo}{d.VersionNo > 1 && <span className="ml-1.5 font-semibold text-foreground">· version {d.VersionNo}</span>}<span className="ml-1.5">· {d.BookingNo} · {d.Property}</span></p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SheetMark text={d.StatusLabel || d.Status} tone={d.Status === "Registered" ? "done" : d.Status === "Cancelled" ? "stopped" : "waiting"} />
            <Link to={`/crm/resales/${d.ResaleId}`} className={`${KEY_LINE} h-8 px-2.5`}>Case #{d.ResaleId} <ExternalLink size={10} /></Link>
            {canEdit && !["Executed"].includes(d.Status) && (
              <button className={danger} onClick={async () => { const r = (await ask.prompt("Why is this deed cancelled?", { title: "Cancel deed", okLabel: "Cancel deed", cancelLabel: "Keep it", danger: true })) || ""; if (r.trim()) call("cancel", "cancel", { remarks: r }, "Cancelled"); }}>Cancel</button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs (same pattern as the Sale Deed page) */}
      <div className="flex items-stretch overflow-x-auto thin-scroll bg-card" style={{ border: RULE }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 h-10 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] whitespace-nowrap shrink-0 transition-colors ${
            tab === t ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`} style={{ borderRight: RULE_SOFT }}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <div className={head}>Parties</div>
            {["Seller", ...(d.DeedType === "Assignment" ? ["Buyer"] : [])].map((p) => <div key={p} className="text-sm"><span className={label}>{p}</span>{partyName(p)}</div>)}
            <div className="text-sm"><span className={label}>Developer</span>Us — {d.DeedType === "Assignment" ? "consenting party (our NOC)" : "taking the property back"}</div>
          </div>
          <div className={card}>
            <div className={head}>Legal executive</div>
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
          <ul className="bg-card divide-y divide-foreground/15 border border-foreground">
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
                    <Mark s={x.Status} text={docWord[x.Status] || x.Status} />
                    {x.FileName && <button className={ghost} onClick={() => view(`documents/${x.Id}/file`)}><Eye size={12} /> View</button>}
                    {papersEditable && x.Status === "Uploaded" && <>
                      <button className={primary} disabled={!!busy} onClick={() => call(pk, `documents/${x.Id}/review`, { decision: "Verified" }, "Verified")}>Verify</button>
                      <button className={ghost} disabled={!!busy} onClick={() => reject(pk, `documents/${x.Id}/review`, "Reject this document")}>Reject</button>
                    </>}
                    {papersEditable && x.Party === "Company" && !["Verified", "Uploaded"].includes(x.Status) && <button className={ghost} disabled={!!busy} onClick={() => pickFile(`documents/${x.Id}/upload`)}><Upload size={12} /> Upload</button>}
                  </div>
                  {papersEditable && x.Party !== "Company" && !["Verified", "Uploaded"].includes(x.Status) && (
                    <div className="ml-8 border border-foreground/15 p-2.5 space-y-2">
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
            <div className="flex items-center justify-between gap-2"><div className={head}>Legal Head approval</div><span className="text-[0.6875rem] text-muted-foreground">{steps[1].ok ? "Approved" : d.SeniorApprovalStatus === "Pending" ? "Waiting" : "Not sent yet"}</span></div>
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
            <div className="flex items-center justify-between gap-2"><div className={head}>{st.parties.length > 1 ? "Seller & buyer review the draft" : "Seller reviews the draft"}</div>
              {canEdit && d.Status === "LegalApproved" && <button className={primary} disabled={busy === "send"} onClick={() => call("send", "send-to-parties", {}, "Sent — they can answer in the portal")}>Send to the portal</button>}</div>
            {st.parties.map((p: string) => {
              const s = d[`${p}Approval`];
              const pk = `party-${p}`;
              return (
                <div key={p} className="border border-foreground/15 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <UserCheck size={14} className="text-muted-foreground" />
                    <span className="text-sm font-medium flex-1">{p} — {partyName(p)}</span>
                    <Mark s={s || ""} text={s === "Approved" ? "Approved" : s === "Pending" ? "Reviewing in the portal" : "Not sent yet"} />
                  </div>
                  {d[`${p}Remarks`] && <p className="text-[0.6875rem] text-muted-foreground">{d[`${p}Remarks`]}</p>}
                  {canEdit && d.Status === "WithParties" && s === "Pending" && (
                    <div className="border border-foreground/15 p-2.5 space-y-2">
                      <p className="text-[0.6875rem] text-muted-foreground">If {partyName(p)} answered you directly, record it for them:</p>
                      <ProxyFields methods={methods} who={p.toLowerCase()} value={P(pk)} onChange={(v) => setProxy({ ...proxy, [pk]: v })} />
                      <div className="flex flex-wrap gap-2">
                        <button className={primary} disabled={!P(pk).ProxyMethod || !P(pk).ProxyRemarks.trim() || !!busy} onClick={() => call(pk, `parties/${p}/respond`, { decision: "Approved", ...P(pk) }, `${p}'s approval recorded`)}>They approve</button>
                        <button className={danger} disabled={!P(pk).ProxyMethod || !P(pk).ProxyRemarks.trim() || !!busy} onClick={async () => { const r = (await ask.prompt("What do they want checked?", { title: "Recheck asked for", okLabel: "Send back" })) || ""; if (r.trim()) call(pk, `parties/${p}/respond`, { decision: "Recheck", ...P(pk), Remarks: r }, "Sent back for a recheck"); }}>They ask for a recheck</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Signing date */}
          <div className={card}>
            <div className="flex items-center justify-between gap-2"><div className={head}>Signing date</div>
              <span className="text-[0.6875rem] text-muted-foreground">{d.DeedDate ? `Approved: ${d.DeedDate}` : d.ProposedDate ? `Proposed ${d.ProposedDate} by ${d.ProposedBy === "Company" ? "us" : d.ProposedBy}` : "Not proposed"}</span></div>
            {canEdit && d.Status === "PartiesApproved" && d.DateApprovalStatus !== "Pending" && (
              <div className="border border-foreground/15 p-3 space-y-2">
                <div className="grid sm:grid-cols-[180px_200px] gap-2">
                  <div><span className={label}>Proposed by</span><select className={input} value={f.dateBy} onChange={(e) => setF({ ...f, dateBy: e.target.value })}>
                    {["Company", ...st.parties].map((p: string) => <option key={p} value={p}>{p === "Company" ? "Us" : `${p} (for them)`}</option>)}</select></div>
                  <div><span className={label}>Date</span><DateInput className={input} min={localDay()} value={f.date} onChange={(e: any) => setF({ ...f, date: e.target.value })} /></div>
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
                <div key={p} className="border border-foreground/15 p-3 space-y-2">
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
            <div className="flex items-center justify-between gap-2"><div className={head}>Execution (signing)</div><span className="text-[0.6875rem] text-muted-foreground">{d.ExecutedAt ? `Executed ${when(d.ExecutedAt)}` : "After the stamp duty is confirmed"}</span></div>
            {canEdit && d.Status === "DateApproved" && <button className={primary} disabled={busy === "x" || payment?.Status !== "Confirmed"} title={payment?.Status !== "Confirmed" ? "Confirm the stamp duty first" : undefined}
              onClick={async () => { if (await ask.confirm(`Every party signed ${d.DeedNo} on ${d.DeedDate}?`, { okLabel: "Mark executed" })) call("x", "execute", {}, "Marked executed"); }}>Mark executed</button>}
          </div>
        </div>
      )}

      {tab === "Stamp Duty" && (
        <div className="space-y-3">
          <div className={card}>
            <div className={head}>Stamp duty & registration fee</div>
            {!payment && d.Status !== "DateApproved" && <p className="text-xs text-muted-foreground">Assessed once the signing date is approved — the deed is stamped before it is signed.</p>}
            {payment && <div className="text-sm tabular-nums">Assessed {money(payment.StampDuty)} stamp duty + {money(payment.RegistrationFee)} registration fee · paid by <b>{payment.PayableBy}</b>{payment.InfoRemarks ? ` · ${payment.InfoRemarks}` : ""}</div>}
            {payment?.PaidRef && <div className="text-sm tabular-nums flex flex-wrap items-center gap-2">Paid {money(payment.AmountPaid)} · {payment.PaidRef} · {payment.ProofUploadedByType === "Portal" ? "uploaded by them" : payment.ProofUploadedByType === "Proxy" ? "uploaded by staff for them" : "uploaded by staff"}
              <button className={ghost} onClick={() => view("duty/proof")}><Eye size={12} /> Proof</button></div>}
            {payment?.ConfirmRemarks && <p className="text-[0.6875rem] text-muted-foreground">{payment.ConfirmRemarks}</p>}
            {payment?.Status === "Confirmed" && <SheetMark text="Confirmed" tone="done" />}
          </div>
          {canEdit && d.Status === "DateApproved" && (!payment || (payment.Status === "InfoSent" && !payment.PaidRef)) && (
            <div className={card}>
              <div className={head}>{payment ? "Change the assessment" : "Assessment from the Sub-Registrar"}</div>
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
              <div className={head}>Paid? The payer uploads the challan in their portal — or upload what they sent you</div>
              <div className="grid sm:grid-cols-3 gap-2">
                <div><span className={label}>GRN / challan no.</span><input className={input} value={f.PaidRef} onChange={(e) => setF({ ...f, PaidRef: e.target.value })} /></div>
                <div><span className={label}>Amount paid</span><input type="number" min={0} className={input} value={f.AmountPaid} onChange={(e) => setF({ ...f, AmountPaid: e.target.value })} /></div>
                <div><span className={label}>Paid on</span><DateInput className={input} max={localDay()} value={f.PaidOn} onChange={(e: any) => setF({ ...f, PaidOn: e.target.value })} /></div>
              </div>
              {payment.PayableBy !== "Developer" && <ProxyFields methods={methods} who="payer" value={P("duty")} onChange={(v) => setProxy({ ...proxy, duty: v })} />}
              <button className={ghost} disabled={!f.PaidRef || !(Number(f.AmountPaid) > 0) || !!busy || (payment.PayableBy !== "Developer" && (!P("duty").ProxyMethod || !P("duty").ProxyRemarks.trim()))}
                onClick={() => pickFile("duty/proof", { PaidRef: f.PaidRef, AmountPaid: f.AmountPaid, PaidOn: f.PaidOn, ...(payment.PayableBy !== "Developer" ? P("duty") : {}) })}><Upload size={12} /> Upload the challan</button>
            </div>
          )}
          {canEdit && payment?.Status === "ProofUploaded" && (
            <div className={`${card} flex flex-wrap items-end gap-2 space-y-0`}>
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
            <div className={head}>Sub-Registrar visit</div>
            {registry ? <p className="text-sm"><b>{registry.Office}</b> · {when(registry.ScheduledAt)}{registry.Attendees ? ` · ${registry.Attendees}` : ""}{registry.RegNo ? ` · registered ${registry.RegNo}` : ""}</p>
              : <p className="text-xs text-muted-foreground">Scheduled once the deed is executed.</p>}
            {canEdit && d.Status === "Executed" && (
              <div className="border border-foreground/15 p-3 space-y-2">
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
                <span className={`${head} flex-1`}>Registered deed (copy)</span>
                {regCopy && <Mark s={regCopy.Status} text={docWord[regCopy.Status] || regCopy.Status} />}
                {regCopy?.FileName && <button className={ghost} onClick={() => view(`documents/${regCopy.Id}/file`)}><Eye size={12} /> View</button>}
                {canEdit && d.Status === "Executed" && regCopy && !["Verified", "Uploaded"].includes(regCopy.Status) && <button className={ghost} disabled={!!busy} onClick={() => pickFile("registry/copy")}><Upload size={12} /> Upload</button>}
                {canEdit && regCopy?.Status === "Uploaded" && <>
                  <button className={primary} disabled={!!busy} onClick={() => call("copy", "registry/copy/verify", {}, "Verified")}>Verify</button>
                  <button className={ghost} disabled={!!busy} onClick={() => reject("copy", "registry/copy/reject", "Reject the copy")}>Reject</button>
                </>}
              </div>
              {canEdit && d.Status === "Executed" && (
                <div className="grid sm:grid-cols-[1fr_200px_auto] gap-2 items-end">
                  <div><span className={label}>Registration no.</span><input className={input} value={f.RegNo} onChange={(e) => setF({ ...f, RegNo: e.target.value })} /></div>
                  <div><span className={label}>Registered on</span><DateInput className={input} max={localDay()} value={f.RegDate} onChange={(e: any) => setF({ ...f, RegDate: e.target.value })} /></div>
                  <button className={primary} disabled={!f.RegNo.trim() || !f.RegDate || regCopy?.Status !== "Verified" || !!busy} onClick={() => call("done", "registry/complete", { RegNo: f.RegNo, RegDate: f.RegDate }, "Registered")}>Mark registered</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "History" && (
        <ol className="bg-card border border-foreground divide-y divide-foreground/15">
          {st.history.map((h: any, i: number) => (
            <li key={i} className="text-sm flex gap-3 px-4 py-2.5">
              <span className="text-[0.6875rem] text-muted-foreground w-36 shrink-0 tabular-nums">{when(h.At)}</span>
              <span className="flex-1"><span className="font-medium">{h.Action}</span>
                <span className="block text-[0.6875rem] text-muted-foreground">
                  {h.ActorType === "Portal" ? `${h.PortalName || h.Party} in the portal` : h.ActorType === "Proxy" ? `${h.ActorName || "Staff"} for the ${String(h.Party || "party").toLowerCase()} (${h.Method === "InPerson" ? "in person" : h.Method})` : h.ActorName || "Staff"}{h.Remarks ? ` · ${h.Remarks}` : ""}
                </span></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default TransferDeedDetail;

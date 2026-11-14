import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DocumentText } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
import { LegalFileLink, openLegalLink } from "@/components/legal/LegalDocumentPreview";
import { RegistrySearchPanel } from "@/components/legal/RegistrySearchPanel";
import { askLegal } from "@/components/legal/LegalAsk";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalLookup, uploadLegalFile } from "@/api/legalMastersApi";
import { deedRegistrationAction } from "@/api/legalLandApi";
import {
  getDeedRegList, getDeedRegLand, saveConsideration, addStampQuery, deleteStampQuery, saveFinalRegistration, addDeedTracking, inr,
  addPayment, deletePayment, addInstalment, deleteInstalment, getInstalmentTemplates, applyInstalmentTemplate,
  type DeedRegRow, type DeedRegLand, type StampQuery, type TrackRow, type PaymentRow, type ScheduleRow, type RevisionRow, type ValuationRow,
} from "@/api/legalDeedRegApi";

const field = "h-9 w-full border border-border bg-background px-2 text-sm";
const small = "border border-border px-2 py-1 text-xs hover:bg-muted";
const primary = "bg-foreground px-4 py-1.5 text-sm font-semibold text-card disabled:opacity-40";
const today = () => new Date().toISOString().slice(0, 10);

/** Options from a Setup list (Payment Mode, Registration Mode, IGR Status…). */
function useLookup(key: string) {
  return useQuery({ queryKey: ["legal-lookup", key], queryFn: () => getLegalLookup(key), staleTime: 5 * 60_000 }).data ?? [];
}
function Pick({ list, value, onChange, placeholder = "Select…", disabled }: { list: { value: number | string; label: string; active?: boolean }[]; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <select className={field} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {list.filter((o) => o.active !== false || String(o.value) === value).map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

// Steps of one land, in order; a step is done when its data is in.
const fullyPaid = (l: DeedRegRow | DeedRegLand) => l.ConsTotalAmount != null && Number(l.Paid) + 0.001 >= Number(l.ConsTotalAmount);
const stepsOf = (l: DeedRegRow | DeedRegLand, queries: number) => [
  { key: "cons", label: "Consideration", done: l.ConsTotalAmount != null },
  { key: "pay", label: "Payments", done: fullyPaid(l) },
  { key: "stamp", label: "Registration & Stamp Duty", done: queries > 0 },
  { key: "apply", label: "Apply to deed register", done: !!l.RegAppliedAt },
  { key: "final", label: "Final Registration", done: !!l.RegFinalDate && !!l.RegDeedFileId },
  { key: "track", label: "Physical Deed / IGR", done: !!l.DeedLocation && /deliver/i.test(l.IgrStatus ?? "") },
];

/**
 * Deed Registration — a work queue. Left: lands approved in Deed Process (or registered, still tracking the deed).
 * Right: the picked land's five steps — Consideration, Registration & Stamp Duty, Apply, Final Registration (then the
 * registered deed is uploaded and the land becomes Registered), Physical Deed / IGR tracking. Lists come from Setup.
 */
export default function LandDeedRegistrationPage() {
  const [tab, setTab] = useState<"active" | "registered">("active");
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<number | null>(null);
  const { data, isFetching, error } = useQuery({ queryKey: ["legal-deed-reg", tab], queryFn: () => getDeedRegList(tab) });
  const lands = data?.lands ?? [];
  const { data: other } = useQuery({ queryKey: ["legal-deed-reg", tab === "active" ? "registered" : "active"], queryFn: () => getDeedRegList(tab === "active" ? "registered" : "active") });
  const counts = { active: tab === "active" ? lands.length : other?.lands.length ?? 0, registered: tab === "registered" ? lands.length : other?.lands.length ?? 0 };
  const term = q.trim().toLowerCase();
  const list = lands.filter((l) => !term || [l.LandCode, l.LandName, l.MouzaName, l.RsDagNo, l.LrDagNo, l.RegDeedNo].some((v) => String(v ?? "").toLowerCase().includes(term)));
  useEffect(() => { if (pickedId && !lands.some((l) => l.LandId === pickedId)) setPickedId(null); }, [lands, pickedId]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Deed Registration"]} />
      <LegalShell title="Deed Registration" subtitle="Lands approved in Deed Process. Work each land through consideration, stamp duty, application, final registration and the physical deed." icon={DocumentText}>
        <div className="legal-cq"><div className="legal-split">
          <aside className="legal-queue border border-border bg-card">
            <div className="space-y-2 border-b border-border p-3">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Land ID, name, mouza, Dag, deed no…" className="h-9 w-full border border-border bg-background px-3 text-sm" />
              <div className="grid grid-cols-2 border border-border text-[0.6875rem] font-semibold uppercase tracking-wider">
                {([["active", `In registration ${counts.active}`], ["registered", `Registered ${counts.registered}`]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => { setTab(k); setPickedId(null); }} className={`px-2 py-1.5 ${tab === k ? "bg-foreground text-card" : "hover:bg-muted"}`}>{l}</button>
                ))}
              </div>
            </div>
            {error && <p className="p-3 text-sm text-destructive">{(error as Error).message}</p>}
            <ul className="divide-y divide-border">
              {list.map((l) => {
                const steps = stepsOf(l, l.Queries);
                const n = steps.filter((s) => s.done).length;
                return (
                  <li key={l.LandId}>
                    <button onClick={() => setPickedId(l.LandId)} className={`block w-full border-l-4 px-3 py-2.5 text-left hover:bg-muted/40 ${pickedId === l.LandId ? "bg-primary/10" : ""} ${n === steps.length ? "border-l-emerald-600" : l.RegAppliedAt ? "border-l-sky-600" : "border-l-amber-500"}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold">{l.LandCode}</span>
                        {l.RegAppliedAt && !l.RegCompletedAt && <span className="border border-sky-600/40 bg-sky-600/10 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-sky-700">{l.RegDaysOpen} day{l.RegDaysOpen === 1 ? "" : "s"} open</span>}
                        {l.RegCompletedAt && <span className="border border-emerald-600/40 bg-emerald-600/10 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-emerald-700">{l.IgrStatus ?? "Registered"}</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs">{l.LandName}</span>
                      <span className="block text-[0.6875rem] text-muted-foreground">{[l.MouzaName, l.DistrictName].filter(Boolean).join(", ")}{l.RegDeedNo ? ` · deed ${l.RegDeedNo}` : ""}</span>
                      {l.ConsTotalAmount != null && !fullyPaid(l) && (
                        <span className={`block text-[0.6875rem] font-semibold ${l.InstalmentsOverdue ? "text-destructive" : "text-amber-700"}`}>
                          Due {inr(Number(l.ConsTotalAmount) - Number(l.Paid))}{l.InstalmentsOverdue ? ` · ${l.InstalmentsOverdue} instalment${l.InstalmentsOverdue > 1 ? "s" : ""} overdue` : ""}
                        </span>
                      )}
                      <span className="mt-1.5 flex gap-0.5">{steps.map((s) => <span key={s.key} title={s.label} className={`h-1.5 flex-1 ${s.done ? "bg-emerald-600" : "bg-muted"}`} />)}</span>
                    </button>
                  </li>
                );
              })}
              {!list.length && <li className="p-4 text-center text-xs text-muted-foreground">{isFetching ? "Loading…" : tab === "active" ? "No land waiting for registration" : "No registered land yet"}</li>}
            </ul>
          </aside>
          <section className="legal-cq min-w-0">
            {pickedId ? <LandWork key={pickedId} id={pickedId} /> : <div className="flex h-48 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">Pick a land from the list</div>}
          </section>
        </div></div>
      </LegalShell>
    </>
  );
}

function Step({ n, title, done, open, onToggle, hint, children }: { n: number; title: string; done: boolean; open: boolean; onToggle: () => void; hint?: string; children: ReactNode }) {
  return (
    <div className={`border ${open ? "border-foreground/50" : "border-border"} bg-card`}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-600 text-white" : "border-2 border-border text-muted-foreground"}`}>{done ? "✓" : n}</span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
        <span className="text-xs text-muted-foreground">{open ? "▴" : "▾"}</span>
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </div>
  );
}

function LandWork({ id }: { id: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const rights = usePageRights("legal-land-master");
  const { data, error } = useQuery({ queryKey: ["legal-deed-reg-land", id], queryFn: () => getDeedRegLand(id) });
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["legal-deed-reg-land", id] });
    qc.invalidateQueries({ queryKey: ["legal-deed-reg"] });
    qc.invalidateQueries({ queryKey: ["legal-land-stats"] });
  };
  const l = data?.land;
  const steps = l ? stepsOf(l, data.queries.length) : [];
  // Open the first step not done yet.
  useEffect(() => { if (l && open === null) setOpen(steps.find((s) => !s.done)?.key ?? "track"); }, [l, open, steps]);
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!l || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const registered = l.WorkflowStatus === "Registered";
  const canEdit = rights.canEdit;
  const hint = (k: string) => {
    switch (k) {
      case "cons": return l.ConsTotalAmount != null ? `${inr(l.ConsTotalAmount)}${l.ConsDate ? ` · agreed ${l.ConsDate}` : ""}${data.revisions.length > 1 ? ` · revised ${data.revisions.length - 1}×` : ""}` : "Total, rate, date — revised with a reason when the valuation changes";
      case "pay": return l.ConsTotalAmount == null ? "Save the consideration first" : fullyPaid(l) ? `Fully paid · last payment ${l.LastPaid ?? "—"}` : `Paid ${inr(l.Paid)} of ${inr(l.ConsTotalAmount)} · ${inr(Number(l.ConsTotalAmount) - Number(l.Paid))} due`;
      case "stamp": return data.queries.length ? `${data.queries.length} quer${data.queries.length > 1 ? "ies" : "y"} · ${inr(data.queries.reduce((a, b) => a + Number(b.Amount), 0))}` : "Query date and amount";
      case "apply": return l.RegAppliedAt ? `Applied by ${l.RegAppliedByName ?? "—"} · ${String(l.RegAppliedAt).slice(0, 10)} · ${l.RegDaysOpen} days` : "An approver applies; the days open are counted from then";
      case "final": return l.RegFinalDate ? `${l.RegFinalDate} · ${l.RegOffice ?? ""} · ${l.RegMode ?? ""}${l.RegDeedNo ? ` · deed ${l.RegDeedNo}` : ""}` : "Date, office, mode — then upload the registered deed";
      default: return l.IgrStatus || l.DeedLocation ? `${l.IgrStatus ?? "—"} · ${l.DeedLocation ?? "—"}` : "IGR status link, where the physical deed is";
    }
  };
  const toggle = (k: string) => setOpen(open === k ? "" : k);

  return (
    <div className="space-y-3">
      {/* Land facts */}
      <div className="border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-base font-bold">{l.LandCode} <span className={`ml-2 border px-1.5 py-0.5 font-sans text-[0.6875rem] font-semibold ${registered ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700" : "border-amber-500/50 bg-amber-500/10 text-amber-700"}`}>{l.WorkflowStatus}</span></p>
            <p className="text-sm">{l.LandName}</p>
            <p className="text-xs text-muted-foreground">{[l.MouzaName, l.DistrictName].filter(Boolean).join(", ")}{l.JLNo ? ` · J.L. ${l.JLNo}` : ""}{l.Area ? ` · ${l.Area} ${l.UnitName ?? ""}` : ""}</p>
          </div>
          <button className={small} onClick={() => navigate(`/legal/deed-registration/${l.LandId}`)}>All land details</button>
        </div>
        <dl className="legal-g3 mt-2 text-xs">
          <div><dt className="text-muted-foreground">RS Dag / Khatian</dt><dd className="font-semibold">{l.RsDagNo ?? "—"} / {l.RsKhatianNo ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">LR Dag / Khatian</dt><dd className="font-semibold">{l.LrDagNo ?? "—"} / {l.LrKhatianNo ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Sellers (current owners)</dt><dd className="font-semibold">{l.Owners ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Govt. valuation</dt><dd className="font-semibold">{inr(l.GovtValue)}</dd></div>
          <div><dt className="text-muted-foreground">Approved</dt><dd className="font-semibold">L1 {l.L1By ?? "—"} · L2 {l.L2By ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Deed copy (Deed Process)</dt><dd>{l.DeedFileId ? <LegalFileLink id={l.DeedFileId} name={l.DeedFileName ?? "Deed copy"} /> : "—"}</dd></div>
        </dl>
      </div>

      <Step n={1} title="Consideration" done={steps[0].done} open={open === "cons"} onToggle={() => toggle("cons")} hint={hint("cons")}>
        <Consideration l={l} revisions={data.revisions} valuation={data.valuation} editable={canEdit && !registered} onSaved={refresh} />
      </Step>
      <Step n={2} title="Payments" done={steps[1].done} open={open === "pay"} onToggle={() => toggle("pay")} hint={hint("pay")}>
        <Payments l={l} payments={data.payments} schedule={data.schedule} editable={canEdit && !registered} onSaved={refresh} />
      </Step>
      <Step n={3} title="Registration & Stamp Duty" done={steps[2].done} open={open === "stamp"} onToggle={() => toggle("stamp")} hint={hint("stamp")}>
        <StampDuty id={l.LandId} rows={data.queries} editable={canEdit && !registered} onSaved={refresh} />
      </Step>
      <Step n={4} title="Apply to deed register" done={steps[3].done} open={open === "apply"} onToggle={() => toggle("apply")} hint={hint("apply")}>
        <Apply l={l} canApply={data.canApply} onSaved={refresh} />
      </Step>
      <Step n={5} title="Final Registration" done={steps[4].done} open={open === "final"} onToggle={() => toggle("final")} hint={hint("final")}>
        <FinalRegistration l={l} editable={canEdit} canSubmit={data.canApply} onSaved={refresh} />
      </Step>
      <Step n={6} title="Physical Deed / IGR status" done={steps[5].done} open={open === "track"} onToggle={() => toggle("track")} hint={hint("track")}>
        <Tracking l={l} rows={data.tracking} editable={canEdit} onSaved={refresh} />
      </Step>
    </div>
  );
}

function Consideration({ l, revisions, valuation, editable, onSaved }: { l: DeedRegLand; revisions: RevisionRow[]; valuation: ValuationRow | null; editable: boolean; onSaved: () => void }) {
  const modes = useLookup("payment-mode");
  const units = useLookup("area-unit");
  const s = (v: unknown) => (v == null ? "" : String(v));
  const [f, setF] = useState({ total: s(l.ConsTotalAmount), rate: s(l.ConsRate), rateUnitId: s(l.ConsRateUnitId), consDate: s(l.ConsDate) || today(), paymentModeId: s(l.ConsPaymentModeId), remarks: s(l.ConsRemarks), reason: "" });
  const [busy, setBusy] = useState(false);
  const saved = l.ConsTotalAmount != null;
  const changed = saved && (Number(f.total) !== Number(l.ConsTotalAmount) || Number(f.rate || 0) !== Number(l.ConsRate ?? 0));
  // A valuation dated after the consideration may change the price: show it next to the figure agreed.
  const newerValuation = valuation && l.ConsDate && valuation.ValuationDate > l.ConsDate;
  const monthsSince = l.ConsDate ? Math.floor((Date.now() - new Date(l.ConsDate).getTime()) / (30.44 * 86_400_000)) : 0;
  const save = async () => {
    setBusy(true);
    try {
      toast.success((await saveConsideration(l.LandId, { ...f, valuationId: changed && newerValuation ? valuation!.ValuationId : null })).message);
      setF({ ...f, reason: "" }); onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      {valuation && (
        <div className={`border px-3 py-2 text-xs ${newerValuation ? "border-amber-500/60 bg-amber-500/10" : "border-border bg-muted/30"}`}>
          <b>Latest valuation {valuation.ValuationDate}</b> · Govt {inr(valuation.GovernmentValuation)} · Market {inr(valuation.EstimatedMarketValue)}{valuation.ValuationSource ? ` (${valuation.ValuationSource})` : ""}
          {newerValuation && <span className="block font-semibold text-amber-800">Valued after the consideration was agreed ({l.ConsDate}) — check whether the price needs revising.</span>}
        </div>
      )}
      {saved && monthsSince >= 6 && !fullyPaid(l) && (
        <p className="border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800">Agreed {monthsSince} months ago and not fully paid — confirm the price still stands before the final payment.</p>
      )}
      <fieldset disabled={!editable} className="space-y-3">
        <div className="legal-g4">
          <label className="text-xs">Total consideration (₹) *<input className={field} inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></label>
          <label className="text-xs">Rate (₹)<div className="flex gap-1"><input className={field} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
            <select className={`${field} w-28`} value={f.rateUnitId} onChange={(e) => setF({ ...f, rateUnitId: e.target.value })}><option value="">per…</option>{units.map((u) => <option key={u.value} value={u.value}>per {u.label}</option>)}</select></div></label>
          <label className="text-xs">Consideration (agreement) date *<input type="date" className={field} max={today()} value={f.consDate} onChange={(e) => setF({ ...f, consDate: e.target.value })} /></label>
          <label className="text-xs">Usual mode of payment<Pick list={modes} value={f.paymentModeId} onChange={(v) => setF({ ...f, paymentModeId: v })} /></label>
        </div>
        {changed && (
          <label className="block text-xs font-semibold text-amber-800">Reason for the change * <span className="font-normal">(kept in the revision history)</span>
            <input className={field} value={f.reason} maxLength={1000} placeholder="e.g. Revised after the Nov 2026 government valuation" onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        )}
        <label className="block text-xs">Remarks<input className={field} value={f.remarks} maxLength={1000} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
        {editable && <button className={primary} disabled={busy || !f.total || !f.consDate || (changed && !f.reason.trim())} onClick={save}>{changed ? "Revise consideration" : saved ? "Save" : "Save consideration"}</button>}
      </fieldset>
      {revisions.length > 0 && (
        <div className="border border-border">
          <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Consideration history</p>
          <table className="w-full text-left text-xs"><tbody>
            {revisions.map((r) => (
              <tr key={r.RevisionId} className="border-t border-border first:border-t-0">
                <td className="px-3 py-1.5 tabular-nums">{r.RevisionDate}</td>
                <td className="px-3 py-1.5">{r.OldTotal != null ? <>{inr(r.OldTotal)} → <b>{inr(r.NewTotal)}</b></> : <b>{inr(r.NewTotal)}</b>}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.Reason ?? ""}{r.ValuationDate ? ` · valuation ${r.ValuationDate}` : ""}{r.ByName ? ` — ${r.ByName}` : ""}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

/**
 * Payments — one clear picture of the money before Final Registration.
 *   Top: what is agreed, paid and due, and the next instalment (one click records it).
 *   Two tabs: Schedule (the agreed instalments: from a template or one by one, as % or ₹) and Payments made
 *   (the land's payment record). Forms open only when asked for, one at a time.
 * The full consideration must be paid before Final Registration.
 */
function Payments({ l, payments, schedule, editable, onSaved }: { l: DeedRegLand; payments: PaymentRow[]; schedule: ScheduleRow[]; editable: boolean; onSaved: () => void }) {
  const purposes = useLookup("txn-type");
  const modes = useLookup("payment-mode");
  const { data: templates = [] } = useQuery({ queryKey: ["legal-instalment-templates"], queryFn: getInstalmentTemplates, staleTime: 5 * 60_000 });
  const [tab, setTab] = useState<"schedule" | "payments">(schedule.length ? "payments" : "schedule");
  // Only one form open at a time.
  const [form, setForm] = useState<null | "payment" | "instalment" | "template">(null);
  const blankPay = { paymentDate: today(), txnTypeId: "", amount: "", paymentModeId: String(l.ConsPaymentModeId ?? ""), payee: "", transactionRef: "", receiptNo: "", receiptFileId: null as number | null, receiptName: "", remarks: "" };
  const [p, setP] = useState(blankPay);
  const [more, setMore] = useState(false);
  const [i, setI] = useState({ dueDate: "", amount: "", percent: "", by: "pct" as "pct" | "amt", label: "", txnTypeId: "", remarks: "" });
  const [tpl, setTpl] = useState("");
  const [busy, setBusy] = useState(false);

  if (l.ConsTotalAmount == null) return <p className="text-sm text-muted-foreground">Save the consideration (step 1) first — payments are planned and recorded against it.</p>;

  const total = Number(l.ConsTotalAmount), paid = Number(l.Paid), due = Math.max(0, total - paid);
  const pctPaid = total ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const pctOf = (a: number) => (total ? Math.round((a / total) * 10000) / 100 : 0);
  // An instalment is paid when the payments so far reach the running total up to it.
  let running = 0;
  const rows = schedule.map((r) => {
    running += Number(r.Amount);
    const status = paid + 0.001 >= running ? "Paid" : r.DueDate < today() ? "Overdue" : "Upcoming";
    const short = Math.max(0, Math.min(Number(r.Amount), running - paid));
    return { ...r, status, short };
  });
  const planned = running;
  const next = rows.find((r) => r.status !== "Paid");
  const overdue = rows.filter((r) => r.status === "Overdue");

  const run = async (fn: () => Promise<{ message: string }>, after?: () => void) => {
    setBusy(true);
    try { toast.success((await fn()).message); after?.(); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  const remove = async (title: string, fn: () => Promise<{ message: string }>) => {
    if (await askLegal({ title, message: "This cannot be undone here.", confirmText: "Remove", tone: "danger" })) run(fn);
  };
  const openPayment = (amount?: number, purposeName?: string | null) => {
    const purpose = purposeName ? purposes.find((x) => x.label === purposeName)?.value : undefined;
    setP({ ...blankPay, amount: amount ? String(Math.round(amount * 100) / 100) : "", txnTypeId: purpose ? String(purpose) : "" });
    setMore(false); setTab("payments"); setForm("payment");
  };
  const attachReceipt = () => {
    const el = document.createElement("input");
    el.type = "file"; el.accept = "application/pdf,image/*";
    el.onchange = async () => {
      const file = el.files?.[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) { toast.error("File is larger than 15 MB"); return; }
      try { const up = await uploadLegalFile(file); setP((x) => ({ ...x, receiptFileId: up.id, receiptName: file.name })); } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    };
    el.click();
  };
  const applyTpl = async () => {
    setBusy(true);
    try {
      let r = await applyInstalmentTemplate(l.LandId, tpl);
      if (r.needsReplace) {
        if (!(await askLegal({ title: "Replace the current schedule?", message: `The ${schedule.length} planned instalment(s) are replaced by "${tpl}". Payments already made stay.`, confirmText: "Replace", tone: "danger" }))) return;
        r = await applyInstalmentTemplate(l.LandId, tpl, true);
      }
      toast.success(r.message); setTpl(""); setForm(null); onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not apply"); } finally { setBusy(false); }
  };
  const typedAmt = i.by === "pct" ? (Number(i.percent) || 0) * total / 100 : Number(i.amount) || 0;
  const typedPct = i.by === "pct" ? Number(i.percent) || 0 : pctOf(Number(i.amount) || 0);
  const chosenTpl = templates.find((t) => t.name === tpl);
  const badge = (s: string) => s === "Paid" ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700" : s === "Overdue" ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-sky-600/40 bg-sky-600/10 text-sky-700";

  return (
    <div className="space-y-4">
      {/* ── 1. Where the money stands ── */}
      <div className="legal-g3">
        <div className="border border-border px-3 py-2"><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Consideration</p><p className="text-lg font-bold tabular-nums">{inr(total)}</p></div>
        <div className="border border-emerald-600/40 bg-emerald-600/5 px-3 py-2"><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Paid</p><p className="text-lg font-bold tabular-nums text-emerald-700">{inr(paid)}</p></div>
        <div className={`border px-3 py-2 ${due ? "border-amber-500/50 bg-amber-500/5" : "border-emerald-600/40 bg-emerald-600/5"}`}><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Still to pay</p><p className={`text-lg font-bold tabular-nums ${due ? "text-amber-700" : "text-emerald-700"}`}>{due ? inr(due) : "Nothing — fully paid"}</p></div>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="h-2.5 flex-1 bg-muted"><span className={`block h-full ${due ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${pctPaid}%` }} /></span>
        <span className="tabular-nums text-muted-foreground">{pctPaid}% paid{l.LastPaid ? ` · last payment ${l.LastPaid}` : ""}</span>
      </div>

      {/* ── 2. What to do next ── */}
      {due > 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-l-4 px-3 py-2 ${next?.status === "Overdue" ? "border-destructive bg-destructive/10" : "border-sky-600 bg-sky-600/5"}`}>
          <div className="text-sm">
            {next ? (
              <><b>{next.status === "Overdue" ? "Overdue" : "Next"}: {next.Label ?? next.Purpose ?? "Instalment"}</b> — {inr(next.short)} due {next.DueDate}
                {overdue.length > 1 && <span className="text-destructive"> · {overdue.length} instalments overdue</span>}</>
            ) : <><b>{inr(due)} still to pay</b> — no instalment planned for it yet</>}
            <span className="block text-xs text-muted-foreground">Final Registration opens when the full consideration is paid.</span>
          </div>
          {editable && <button className={`${primary} max-sm:w-full`} onClick={() => openPayment(next ? next.short : due, next?.Purpose)}>Record this payment</button>}
        </div>
      )}

      {/* ── 3. Schedule | Payments made ── */}
      <div className="flex border-b border-border text-sm">
        {([["schedule", `Schedule · ${schedule.length}`], ["payments", `Payments made · ${payments.length}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setForm(null); }}
            className={`-mb-px border-b-2 px-4 py-2 font-semibold ${tab === k ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>

      {tab === "schedule" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs ${Math.abs(planned - total) < 0.01 ? "text-emerald-700" : "text-muted-foreground"}`}>
              {schedule.length ? <>{inr(planned)} planned ({pctOf(planned)}% of the consideration){Math.abs(planned - total) >= 0.01 ? ` · ${inr(total - planned)} not planned yet` : " · fully planned"}</> : "No instalment planned yet — use a template or add them one by one."}
            </p>
            {editable && (
              <span className="flex flex-wrap gap-2">
                {templates.length > 0 && <button className={`${small} ${form === "template" ? "bg-foreground text-card" : ""}`} onClick={() => setForm(form === "template" ? null : "template")}>Use a template</button>}
                <button className={`${small} ${form === "instalment" ? "bg-foreground text-card" : ""}`} onClick={() => setForm(form === "instalment" ? null : "instalment")}>+ Add instalment</button>
              </span>
            )}
          </div>

          {form === "template" && (
            <div className="space-y-2 border border-border bg-muted/20 p-3">
              <label className="block text-xs">Template (Setup → Instalment Schedule Templates)
                <select className={field} value={tpl} onChange={(e) => setTpl(e.target.value)}>
                  <option value="">Select…</option>
                  {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </label>
              {chosenTpl && (
                <table className="w-full text-left text-xs"><tbody>
                  {chosenTpl.lines.map((x) => {
                    const d = new Date(`${l.ConsDate ?? today()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(x.DueDays));
                    return (
                      <tr key={x.SeqNo} className="border-t border-border first:border-t-0">
                        <td className="py-1">{x.Label}</td><td className="py-1 text-right tabular-nums">{Number(x.SharePct)}%</td>
                        <td className="py-1 text-right font-semibold tabular-nums">{inr(Math.round(total * Number(x.SharePct)) / 100)}</td>
                        <td className="py-1 pl-3 tabular-nums text-muted-foreground">due {d.toISOString().slice(0, 10)}</td>
                      </tr>
                    );
                  })}
                </tbody></table>
              )}
              <div className="flex gap-2">
                <button className={primary} disabled={busy || !tpl} onClick={applyTpl}>{schedule.length ? "Replace schedule with this" : "Make schedule"}</button>
                <button className="text-xs underline" onClick={() => setForm(null)}>Cancel</button>
              </div>
            </div>
          )}

          {form === "instalment" && (
            <div className="space-y-2 border border-border bg-muted/20 p-3">
              <div className="legal-g2">
                <label className="text-xs">Instalment name<input className={field} value={i.label} maxLength={100} placeholder="e.g. Second instalment" onChange={(e) => setI({ ...i, label: e.target.value })} /></label>
                <label className="text-xs">Due date *<input type="date" className={field} value={i.dueDate} onChange={(e) => setI({ ...i, dueDate: e.target.value })} /></label>
                <div className="text-xs">
                  <span className="mb-1 flex items-center justify-between gap-2">
                    <span>Amount *</span>
                    {/* ₹ or % of the total — a small switch, the other figure is shown below */}
                    <span className="inline-flex border border-border">
                      {(["amt", "pct"] as const).map((k) => (
                        <button key={k} type="button" onClick={() => setI({ ...i, by: k })}
                          className={`px-2.5 py-0.5 text-[0.6875rem] font-semibold ${i.by === k ? "bg-foreground text-card" : "hover:bg-muted"}`}>{k === "pct" ? "% of total" : "₹ amount"}</button>
                      ))}
                    </span>
                  </span>
                  <div className="relative">
                    {i.by === "pct"
                      ? <input className={`${field} pr-8`} inputMode="decimal" placeholder="e.g. 25" value={i.percent} onChange={(e) => setI({ ...i, percent: e.target.value })} />
                      : <input className={`${field} pl-6`} inputMode="decimal" placeholder="e.g. 1200000" value={i.amount} onChange={(e) => setI({ ...i, amount: e.target.value })} />}
                    <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-sm text-muted-foreground" style={i.by === "pct" ? { right: 10 } : { left: 8 }}>{i.by === "pct" ? "%" : "₹"}</span>
                  </div>
                </div>
                <label className="text-xs">Purpose<Pick list={purposes} value={i.txnTypeId} onChange={(v) => setI({ ...i, txnTypeId: v })} /></label>
              </div>
              {typedAmt > 0 && (
                <p className={`text-xs ${planned + typedAmt > total + 0.01 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                  = <b>{inr(Math.round(typedAmt * 100) / 100)}</b> ({Math.round(typedPct * 100) / 100}% of {inr(total)}).
                  {planned + typedAmt > total + 0.01 ? " That is more than the consideration." : ` After this ${inr(total - planned - typedAmt)} is left to plan.`}
                </p>
              )}
              <p className="text-[0.6875rem] text-muted-foreground">A % instalment changes with the consideration if it is revised; a ₹ amount stays as entered.</p>
              <div className="flex gap-2">
                <button className={primary} disabled={busy || !i.dueDate || !typedAmt}
                  onClick={() => run(() => addInstalment(l.LandId, { ...i, percent: i.by === "pct" ? i.percent : "", amount: i.by === "amt" ? i.amount : "" }),
                    () => { setI({ ...i, dueDate: "", amount: "", percent: "", label: "", remarks: "" }); setForm(null); })}>Add instalment</button>
                <button className="text-xs underline" onClick={() => setForm(null)}>Cancel</button>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <ol className="divide-y divide-border border border-border">
              {rows.map((r, k) => (
                <li key={r.ScheduleId} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 ${r.status === "Overdue" ? "border-l-4 border-l-destructive" : r.status === "Paid" ? "border-l-4 border-l-emerald-600" : "border-l-4 border-l-sky-600"}`}>
                  <span className="w-5 shrink-0 text-xs text-muted-foreground">{k + 1}</span>
                  <span className="min-w-[10rem] flex-1">
                    <span className="block text-sm font-semibold">{r.Label ?? r.Purpose ?? "Instalment"}</span>
                    <span className="block text-xs text-muted-foreground">Due {r.DueDate}{r.Label && r.Purpose ? ` · ${r.Purpose}` : ""}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-bold tabular-nums">{inr(r.Amount)}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">{r.SharePct != null ? `${Number(r.SharePct)}% of total` : `${pctOf(Number(r.Amount))}% · fixed ₹`}</span>
                  </span>
                  <span className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                    <span>
                      <span className={`border px-1.5 py-0.5 text-[0.6875rem] font-semibold ${badge(r.status)}`}>{r.status}</span>
                      {r.status !== "Paid" && r.short < Number(r.Amount) && <span className="ml-1.5 text-xs text-muted-foreground">{inr(r.short)} left</span>}
                    </span>
                    {editable && (
                      <span className="flex gap-1">
                        {r.status !== "Paid" && <button className={`${small} border-foreground font-semibold`} onClick={() => openPayment(r.short, r.Purpose)}>Pay</button>}
                        <button className={`${small} text-rose-600`} onClick={() => remove("Remove this instalment?", () => deleteInstalment(r.ScheduleId))} title="Remove instalment">Delete</button>
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === "payments" && (
        <div className="space-y-3">
          {editable && due > 0 && form !== "payment" && (
            <div className="flex justify-end"><button className={small} onClick={() => openPayment()}>+ Record payment</button></div>
          )}
          {form === "payment" && (
            <div className="space-y-2 border border-border bg-muted/20 p-3">
              <div className="legal-g4">
                <label className="text-xs">Date paid *<input type="date" className={field} max={today()} value={p.paymentDate} onChange={(e) => setP({ ...p, paymentDate: e.target.value })} /></label>
                <label className="text-xs">Amount (₹) * <button type="button" className="ml-1 underline" onClick={() => setP({ ...p, amount: String(due) })}>whole balance</button>
                  <input className={field} inputMode="decimal" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></label>
                <label className="text-xs">Mode *<Pick list={modes} value={p.paymentModeId} onChange={(v) => setP({ ...p, paymentModeId: v })} /></label>
                <label className="text-xs">Purpose *<Pick list={purposes} value={p.txnTypeId} onChange={(v) => setP({ ...p, txnTypeId: v })} /></label>
              </div>
              {Number(p.amount) > 0 && <p className="text-xs text-muted-foreground">After this payment: {inr(Math.max(0, due - Number(p.amount)))} still to pay{Number(p.amount) > due + 0.01 ? <b className="text-destructive"> — more than the balance</b> : null}</p>}
              <button type="button" className="text-xs underline" onClick={() => setMore(!more)}>{more ? "Fewer details" : "More details (paid to, transaction no., receipt)"}</button>
              {more && (
                <div className="legal-g4">
                  <label className="text-xs">Paid to<input className={field} value={p.payee} maxLength={200} onChange={(e) => setP({ ...p, payee: e.target.value })} /></label>
                  <label className="text-xs">Transaction / cheque no.<input className={field} value={p.transactionRef} maxLength={100} onChange={(e) => setP({ ...p, transactionRef: e.target.value })} /></label>
                  <label className="text-xs">Receipt no.<input className={field} value={p.receiptNo} maxLength={60} onChange={(e) => setP({ ...p, receiptNo: e.target.value })} /></label>
                  <div className="text-xs">Receipt copy
                    <button type="button" className={`${field} text-left`} onClick={attachReceipt}>{p.receiptName || "Upload PDF / image"}</button></div>
                  <label className="text-xs legal-span">Remarks<input className={field} value={p.remarks} maxLength={1000} onChange={(e) => setP({ ...p, remarks: e.target.value })} /></label>
                </div>
              )}
              <div className="flex gap-2">
                <button className={primary} disabled={busy || !p.amount || !p.txnTypeId || !p.paymentModeId || !p.paymentDate}
                  onClick={() => run(() => addPayment(l.LandId, p), () => { setP(blankPay); setForm(null); })}>Save payment</button>
                <button className="text-xs underline" onClick={() => setForm(null)}>Cancel</button>
              </div>
            </div>
          )}
          {payments.length ? (
            <ol className="divide-y divide-border border border-border">
              {payments.map((r) => (
                <li key={r.PaymentId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5">
                  <span className="min-w-[10rem] flex-1">
                    <span className="block text-sm font-semibold">{r.Purpose ?? "Payment"} <span className="font-normal text-muted-foreground">· {r.PaymentDate}</span></span>
                    <span className="block text-xs text-muted-foreground">
                      {[r.Mode, r.TransactionRef, r.Payee ? `to ${r.Payee}` : null, r.ReceiptNo ? `receipt ${r.ReceiptNo}` : null].filter(Boolean).join(" · ") || "—"}
                      {r.ReceiptFileId ? <> · <LegalFileLink id={r.ReceiptFileId} name={r.ReceiptFileName ?? "Receipt"} /></> : null}
                    </span>
                  </span>
                  <span className={`text-sm font-bold tabular-nums ${r.Purpose === "Refund" ? "text-rose-600" : ""}`}>{r.Purpose === "Refund" ? "−" : ""}{inr(r.Amount)}</span>
                  {editable && <button className={`${small} text-rose-600`} onClick={() => remove("Remove this payment?", () => deletePayment(r.PaymentId))}>Delete</button>}
                </li>
              ))}
              <li className="flex justify-between px-3 py-2.5 text-sm font-bold"><span>Total paid</span><span className="tabular-nums">{inr(paid)}</span></li>
            </ol>
          ) : <p className="text-sm text-muted-foreground">No payment recorded yet.</p>}
          <p className="text-[0.6875rem] text-muted-foreground">This is the only place this purchase is paid. A payment cannot be dated in the future or be more than what is still to pay.</p>
        </div>
      )}
    </div>
  );
}

function StampDuty({ id, rows, editable, onSaved }: { id: number; rows: StampQuery[]; editable: boolean; onSaved: () => void }) {
  const fees = useLookup("fee-type");
  const [f, setF] = useState({ queryDate: today(), feeTypeId: "", amount: "", remarks: "" });
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((a, b) => a + Number(b.Amount), 0);
  const add = async () => {
    setBusy(true);
    try { toast.success((await addStampQuery(id, f)).message); setF({ queryDate: today(), feeTypeId: "", amount: "", remarks: "" }); onSaved(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  const remove = async (r: StampQuery) => {
    if (!(await askLegal({ title: "Remove this query?", message: `${r.QueryDate} · ${inr(r.Amount)}`, confirmText: "Remove", tone: "danger" }))) return;
    try { toast.success((await deleteStampQuery(r.QueryId)).message); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not remove"); }
  };
  return (
    <div className="space-y-3">
      <table className="w-full text-left text-sm">
        <thead className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground"><tr><th className="py-1">Query date</th><th className="py-1">Fee type</th><th className="py-1 text-right">Amount</th><th className="py-1">Remarks</th>{editable && <th />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.QueryId} className="border-t border-border">
              <td className="py-1.5 tabular-nums">{r.QueryDate}</td><td className="py-1.5">{r.FeeType ?? "—"}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{inr(r.Amount)}</td>
              <td className="py-1.5 text-xs text-muted-foreground">{r.Remarks ?? ""}{r.ByName ? ` · ${r.ByName}` : ""}</td>
              {editable && <td className="py-1.5 text-right"><button className={`${small} text-rose-600`} onClick={() => remove(r)}>Delete</button></td>}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="py-2 text-xs text-muted-foreground">No query yet</td></tr>}
          {rows.length > 0 && <tr className="border-t-2 border-border"><td colSpan={2} className="py-1.5 text-xs font-semibold uppercase">Total</td><td className="py-1.5 text-right font-bold tabular-nums">{inr(total)}</td><td colSpan={2} /></tr>}
        </tbody>
      </table>
      {editable && (
        <div className="legal-g4 border border-border bg-muted/30 p-3">
          <label className="text-xs">Query date<input type="date" className={field} value={f.queryDate} onChange={(e) => setF({ ...f, queryDate: e.target.value })} /></label>
          <label className="text-xs">Fee type<Pick list={fees} value={f.feeTypeId} onChange={(v) => setF({ ...f, feeTypeId: v })} placeholder="Stamp duty, registration…" /></label>
          <label className="text-xs">Amount (₹)<input className={field} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label className="text-xs">Remarks<input className={field} value={f.remarks} maxLength={1000} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
          <button className={`${primary} h-9`} disabled={busy || !f.amount || !f.queryDate} onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}

function Apply({ l, canApply, onSaved }: { l: DeedRegLand; canApply: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    if (!(await askLegal({ title: `Apply ${l.LandCode} for deed registration?`, message: "Your name and today's date are recorded; the days open are counted from now.", confirmText: "Apply" }))) return;
    setBusy(true);
    try { toast.success((await deedRegistrationAction(l.LandId, "apply")).message); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not apply"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      {l.RegAppliedAt ? (
        <p className="text-sm">Applied by <b>{l.RegAppliedByName ?? "—"}</b> on <b>{String(l.RegAppliedAt).slice(0, 10)}</b> · <span className="font-semibold text-sky-700">{l.RegDaysOpen} day{l.RegDaysOpen === 1 ? "" : "s"} open</span></p>
      ) : canApply ? (
        <button className={primary} disabled={busy} onClick={apply}>Apply to deed register</button>
      ) : <p className="text-xs text-amber-700">Only an L1 or L2 Approver (Setup → Approval Control) can apply.</p>}
      <details className="border border-border">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">Registry search records for this land (add, edit, delete)</summary>
        <div className="border-t border-border"><RegistrySearchPanel landCode={l.LandCode} /></div>
      </details>
      <GovtSiteLinks hint="Registration offices and the IGR site (opens in a new tab)." />
    </div>
  );
}

function FinalRegistration({ l, editable, canSubmit, onSaved }: { l: DeedRegLand; editable: boolean; canSubmit: boolean; onSaved: () => void }) {
  const offices = useLookup("registration-office");
  const modes = useLookup("registration-mode");
  const s = (v: unknown) => (v == null ? "" : String(v));
  const [f, setF] = useState({ date: s(l.RegFinalDate), officeId: s(l.RegOfficeId), modeId: s(l.RegModeId), deedNo: s(l.RegDeedNo) });
  const [busy, setBusy] = useState(false);
  const registered = l.WorkflowStatus === "Registered";
  const save = async () => {
    setBusy(true);
    try { toast.success((await saveFinalRegistration(l.LandId, f)).message); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  const submit = () => {
    const el = document.createElement("input");
    el.type = "file"; el.accept = "application/pdf,image/*";
    el.onchange = async () => {
      const file = el.files?.[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) { toast.error("File is larger than 15 MB"); return; }
      if (!(await askLegal({ title: `Submit ${l.LandCode} as registered?`, message: `Registered deed copy: ${file.name}. The land then moves to Post-Registration and Land & Projects.`, confirmText: "Submit" }))) return;
      setBusy(true);
      try { const up = await uploadLegalFile(file); toast.success((await deedRegistrationAction(l.LandId, "submit", up.id)).message); onSaved(); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Could not submit"); } finally { setBusy(false); }
    };
    el.click();
  };
  const finalSaved = !!l.RegFinalDate && !!l.RegOfficeId && !!l.RegModeId;
  // Full payment first; the registration date cannot be before the last payment.
  const paidUp = fullyPaid(l);
  return (
    <div className="space-y-3">
      {!registered && !paidUp && (
        <p className="border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800">
          {l.ConsTotalAmount == null ? "Save the consideration and record the payments first." : `${inr(Number(l.ConsTotalAmount) - Number(l.Paid))} of the consideration is still due — Final Registration opens when it is fully paid.`}
        </p>
      )}
      <fieldset disabled={!editable || registered || !paidUp} className="legal-g4">
        <label className="text-xs">Date of registration *<input type="date" className={field} min={l.LastPaid ?? undefined} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="text-xs">Office of registration *<Pick list={offices} value={f.officeId} onChange={(v) => setF({ ...f, officeId: v })} /></label>
        <label className="text-xs">Mode of registration *<Pick list={modes} value={f.modeId} onChange={(v) => setF({ ...f, modeId: v })} /></label>
        <label className="text-xs">Registered deed number<input className={field} value={f.deedNo} maxLength={100} onChange={(e) => setF({ ...f, deedNo: e.target.value })} /></label>
      </fieldset>
      {editable && !registered && <button className={primary} disabled={busy || !paidUp || !f.date || !f.officeId || !f.modeId} onClick={save}>Save final registration</button>}
      <div className="border-t border-border pt-3">
        {registered ? (
          <p className="text-sm">Registered{l.RegCompletedByName ? ` by ${l.RegCompletedByName}` : ""}{l.RegCompletedAt ? ` on ${String(l.RegCompletedAt).slice(0, 10)}` : ""} · {l.RegDeedFileId ? <LegalFileLink id={l.RegDeedFileId} name={l.RegDeedFileName ?? "Registered deed"} /> : "—"}</p>
        ) : !l.RegAppliedAt ? <p className="text-xs text-muted-foreground">Apply to the deed register (step 3) first.</p>
          : !finalSaved ? <p className="text-xs text-muted-foreground">Save the date, office and mode, then upload the registered deed.</p>
          : canSubmit ? <button className={primary} disabled={busy} onClick={submit}>Upload registered deed & submit</button>
          : <p className="text-xs text-amber-700">Only an L1 or L2 Approver can submit the registered deed.</p>}
      </div>
    </div>
  );
}

function Tracking({ l, rows, editable, onSaved }: { l: DeedRegLand; rows: TrackRow[]; editable: boolean; onSaved: () => void }) {
  const statuses = useLookup("igr-status");
  const locations = useLookup("deed-location");
  const [f, setF] = useState({ statusDate: today(), igrStatusId: String(l.IgrStatusId ?? ""), deedLocationId: String(l.DeedLocationId ?? ""), trackingUrl: l.IgrTrackingUrl ?? "", remarks: "" });
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { toast.success((await addDeedTracking(l.LandId, f)).message); setF({ ...f, remarks: "" }); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="legal-g3 text-sm">
        <div className="border border-border px-3 py-2"><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">IGR status</p><p className="font-semibold">{l.IgrStatus ?? "—"}</p></div>
        <div className="border border-border px-3 py-2"><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Physical deed is</p><p className="font-semibold">{l.DeedLocation ?? "—"}</p></div>
        <div className="border border-border px-3 py-2"><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">IGR tracking link</p>
          {l.IgrTrackingUrl ? <button className="truncate text-left font-semibold underline" onClick={() => openLegalLink(l.IgrTrackingUrl!, "IGR status")}>Open status page</button> : <p className="font-semibold">—</p>}</div>
      </div>
      {editable && (
        <div className="legal-g4 border border-border bg-muted/30 p-3">
          <label className="text-xs">Date<input type="date" className={field} value={f.statusDate} onChange={(e) => setF({ ...f, statusDate: e.target.value })} /></label>
          <label className="text-xs">IGR status<Pick list={statuses} value={f.igrStatusId} onChange={(v) => setF({ ...f, igrStatusId: v })} /></label>
          <label className="text-xs">Deed location<Pick list={locations} value={f.deedLocationId} onChange={(v) => setF({ ...f, deedLocationId: v })} /></label>
          <label className="text-xs">IGR tracking link<input className={field} value={f.trackingUrl} placeholder="https://…" maxLength={500} onChange={(e) => setF({ ...f, trackingUrl: e.target.value })} /></label>
          <label className="text-xs legal-span">Remarks<input className={field} value={f.remarks} maxLength={1000} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
          <button className={`${primary} h-9`} disabled={busy} onClick={add}>Update status</button>
        </div>
      )}
      <ol className="space-y-0 border-l-2 border-border pl-4">
        {rows.map((r) => (
          <li key={r.TrackId} className="relative pb-3 text-xs">
            <span className="absolute -left-[1.4rem] top-0.5 h-2.5 w-2.5 rounded-full bg-foreground" />
            <p><b className="tabular-nums">{r.StatusDate}</b> · {r.IgrStatus ?? "—"} · {r.DeedLocation ?? "—"}</p>
            {(r.Remarks || r.ByName) && <p className="text-muted-foreground">{r.Remarks ?? ""}{r.ByName ? ` — ${r.ByName}` : ""}</p>}
          </li>
        ))}
        {!rows.length && <li className="text-xs text-muted-foreground">No status update yet</li>}
      </ol>
    </div>
  );
}

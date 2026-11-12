import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DocumentText } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
import { LegalFileLink, openLegalLink } from "@/components/legal/LegalDocumentPreview";
import { LandRegistrySearches } from "@/components/legal/RegistrySearchPanel";
import { askLegal } from "@/components/legal/LegalAsk";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalLookup, uploadLegalFile } from "@/api/legalMastersApi";
import { deedRegistrationAction } from "@/api/legalLandApi";
import {
  getDeedRegList, getDeedRegLand, saveConsideration, addStampQuery, deleteStampQuery, saveFinalRegistration, addDeedTracking, inr,
  type DeedRegRow, type DeedRegLand, type StampQuery, type TrackRow,
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
const stepsOf = (l: DeedRegRow | DeedRegLand, queries: number) => [
  { key: "cons", label: "Consideration", done: l.ConsTotalAmount != null },
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
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <aside className="border border-border bg-card lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-8rem)] lg:flex-col lg:overflow-hidden">
            <div className="space-y-2 border-b border-border p-3">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Land ID, name, mouza, Dag, deed no…" className="h-9 w-full border border-border bg-background px-3 text-sm" />
              <div className="grid grid-cols-2 border border-border text-[0.6875rem] font-semibold uppercase tracking-wider">
                {([["active", `In registration ${counts.active}`], ["registered", `Registered ${counts.registered}`]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => { setTab(k); setPickedId(null); }} className={`px-2 py-1.5 ${tab === k ? "bg-foreground text-card" : "hover:bg-muted"}`}>{l}</button>
                ))}
              </div>
            </div>
            {error && <p className="p-3 text-sm text-destructive">{(error as Error).message}</p>}
            <ul className="divide-y divide-border lg:overflow-y-auto">
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
                      <span className="mt-1.5 flex gap-0.5">{steps.map((s) => <span key={s.key} title={s.label} className={`h-1.5 flex-1 ${s.done ? "bg-emerald-600" : "bg-muted"}`} />)}</span>
                    </button>
                  </li>
                );
              })}
              {!list.length && <li className="p-4 text-center text-xs text-muted-foreground">{isFetching ? "Loading…" : tab === "active" ? "No land waiting for registration" : "No registered land yet"}</li>}
            </ul>
          </aside>
          <section className="min-w-0">
            {pickedId ? <LandWork key={pickedId} id={pickedId} /> : <div className="flex h-48 items-center justify-center border border-dashed border-border text-sm text-muted-foreground">Pick a land from the list</div>}
          </section>
        </div>
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
      case "cons": return l.ConsTotalAmount != null ? `${inr(l.ConsTotalAmount)} · advance ${inr(l.ConsAdvanceAmount)} · balance ${inr((l.ConsTotalAmount ?? 0) - (l.ConsAdvanceAmount ?? 0))}` : "Total, rate, advance, mode of payment";
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
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
          <div><dt className="text-muted-foreground">RS Dag / Khatian</dt><dd className="font-semibold">{l.RsDagNo ?? "—"} / {l.RsKhatianNo ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">LR Dag / Khatian</dt><dd className="font-semibold">{l.LrDagNo ?? "—"} / {l.LrKhatianNo ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Sellers (current owners)</dt><dd className="font-semibold">{l.Owners ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Govt. valuation</dt><dd className="font-semibold">{inr(l.GovtValue)}</dd></div>
          <div><dt className="text-muted-foreground">Approved</dt><dd className="font-semibold">L1 {l.L1By ?? "—"} · L2 {l.L2By ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Deed copy (Deed Process)</dt><dd>{l.DeedFileId ? <LegalFileLink id={l.DeedFileId} name={l.DeedFileName ?? "Deed copy"} /> : "—"}</dd></div>
        </dl>
      </div>

      <Step n={1} title="Consideration" done={steps[0].done} open={open === "cons"} onToggle={() => toggle("cons")} hint={hint("cons")}>
        <Consideration l={l} editable={canEdit && !registered} onSaved={refresh} />
      </Step>
      <Step n={2} title="Registration & Stamp Duty" done={steps[1].done} open={open === "stamp"} onToggle={() => toggle("stamp")} hint={hint("stamp")}>
        <StampDuty id={l.LandId} rows={data.queries} editable={canEdit && !registered} onSaved={refresh} />
      </Step>
      <Step n={3} title="Apply to deed register" done={steps[2].done} open={open === "apply"} onToggle={() => toggle("apply")} hint={hint("apply")}>
        <Apply l={l} canApply={data.canApply} onSaved={refresh} />
      </Step>
      <Step n={4} title="Final Registration" done={steps[3].done} open={open === "final"} onToggle={() => toggle("final")} hint={hint("final")}>
        <FinalRegistration l={l} editable={canEdit} canSubmit={data.canApply} onSaved={refresh} />
      </Step>
      <Step n={5} title="Physical Deed / IGR status" done={steps[4].done} open={open === "track"} onToggle={() => toggle("track")} hint={hint("track")}>
        <Tracking l={l} rows={data.tracking} editable={canEdit} onSaved={refresh} />
      </Step>
    </div>
  );
}

function Consideration({ l, editable, onSaved }: { l: DeedRegLand; editable: boolean; onSaved: () => void }) {
  const modes = useLookup("payment-mode");
  const units = useLookup("area-unit");
  const s = (v: unknown) => (v == null ? "" : String(v));
  const [f, setF] = useState({ total: s(l.ConsTotalAmount), rate: s(l.ConsRate), rateUnitId: s(l.ConsRateUnitId), advance: s(l.ConsAdvanceAmount), paymentModeId: s(l.ConsPaymentModeId), remarks: s(l.ConsRemarks) });
  const [busy, setBusy] = useState(false);
  const balance = (Number(f.total) || 0) - (Number(f.advance) || 0);
  const save = async () => {
    setBusy(true);
    try { toast.success((await saveConsideration(l.LandId, f)).message); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  return (
    <fieldset disabled={!editable} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs">Total amount (₹) *<input className={field} inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></label>
        <label className="text-xs">Rate (₹)<div className="flex gap-1"><input className={field} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          <select className={`${field} w-28`} value={f.rateUnitId} onChange={(e) => setF({ ...f, rateUnitId: e.target.value })}><option value="">per…</option>{units.map((u) => <option key={u.value} value={u.value}>per {u.label}</option>)}</select></div></label>
        <label className="text-xs">Advance amount (₹)<input className={field} inputMode="decimal" value={f.advance} onChange={(e) => setF({ ...f, advance: e.target.value })} /></label>
        <label className="text-xs">Mode of payment<Pick list={modes} value={f.paymentModeId} onChange={(v) => setF({ ...f, paymentModeId: v })} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-4 border border-border bg-muted/30 px-3 py-2 text-sm">
        <span>Total <b>{inr(Number(f.total) || 0)}</b></span><span>Advance <b>{inr(Number(f.advance) || 0)}</b></span>
        <span className={balance < 0 ? "text-destructive" : ""}>Balance <b>{inr(balance)}</b></span>
      </div>
      <label className="block text-xs">Remarks<input className={field} value={f.remarks} maxLength={1000} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
      {editable && <button className={primary} disabled={busy || !f.total} onClick={save}>Save consideration</button>}
    </fieldset>
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
        <div className="grid items-end gap-2 border border-border bg-muted/30 p-2 sm:grid-cols-[9rem_1fr_9rem_1.4fr_auto]">
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
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">Registry search records for this land</summary>
        <div className="border-t border-border p-2"><LandRegistrySearches landId={l.LandId} /></div>
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
  return (
    <div className="space-y-3">
      <fieldset disabled={!editable || registered} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs">Date of registration *<input type="date" className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="text-xs">Office of registration *<Pick list={offices} value={f.officeId} onChange={(v) => setF({ ...f, officeId: v })} /></label>
        <label className="text-xs">Mode of registration *<Pick list={modes} value={f.modeId} onChange={(v) => setF({ ...f, modeId: v })} /></label>
        <label className="text-xs">Registered deed number<input className={field} value={f.deedNo} maxLength={100} onChange={(e) => setF({ ...f, deedNo: e.target.value })} /></label>
      </fieldset>
      {editable && !registered && <button className={primary} disabled={busy || !f.date || !f.officeId || !f.modeId} onClick={save}>Save final registration</button>}
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
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="border border-border px-3 py-2"><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">IGR status</p><p className="font-semibold">{l.IgrStatus ?? "—"}</p></div>
        <div className="border border-border px-3 py-2"><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Physical deed is</p><p className="font-semibold">{l.DeedLocation ?? "—"}</p></div>
        <div className="border border-border px-3 py-2"><p className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">IGR tracking link</p>
          {l.IgrTrackingUrl ? <button className="truncate text-left font-semibold underline" onClick={() => openLegalLink(l.IgrTrackingUrl!, "IGR status")}>Open status page</button> : <p className="font-semibold">—</p>}</div>
      </div>
      {editable && (
        <div className="grid items-end gap-2 border border-border bg-muted/30 p-2 sm:grid-cols-2 xl:grid-cols-[9rem_1fr_1fr_1.4fr]">
          <label className="text-xs">Date<input type="date" className={field} value={f.statusDate} onChange={(e) => setF({ ...f, statusDate: e.target.value })} /></label>
          <label className="text-xs">IGR status<Pick list={statuses} value={f.igrStatusId} onChange={(v) => setF({ ...f, igrStatusId: v })} /></label>
          <label className="text-xs">Deed location<Pick list={locations} value={f.deedLocationId} onChange={(v) => setF({ ...f, deedLocationId: v })} /></label>
          <label className="text-xs">IGR tracking link<input className={field} value={f.trackingUrl} placeholder="https://…" maxLength={500} onChange={(e) => setF({ ...f, trackingUrl: e.target.value })} /></label>
          <label className="text-xs sm:col-span-2 xl:col-span-3">Remarks<input className={field} value={f.remarks} maxLength={1000} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
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

import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { getInheritanceSuggestions, decideHeirShares, getPortalFetches, getDiligence, saveOwnershipDetails, setDiligenceArea, addRiskAssessment, addLegalReview, clearCourtCase, type Diligence } from "@/api/legalDiligenceApi";
import { LegalMasterTable } from "@/pages/legal/LegalMasterPage";
import { askLegal } from "./LegalAsk";
import { getLegalLookup, uploadLegalFile } from "@/api/legalMastersApi";
import { usePageRights } from "@/hooks/usePageRights";
import { LegalFileLink } from "./LegalDocumentPreview";

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const input = "w-full border border-border bg-background px-2 py-1.5 text-sm";
const lbl = "block text-[0.6875rem] uppercase tracking-wider text-muted-foreground";
const card = "border border-border bg-card p-4";
const btn = "bg-foreground px-3 py-1.5 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card disabled:cursor-not-allowed disabled:opacity-40";
const STATUS_TONE: Record<string, string> = {
  Verified: "text-emerald-600", "Not Applicable": "text-muted-foreground", Pending: "text-amber-600", Incomplete: "text-amber-600",
  "Requires Legal Review": "text-amber-600", Disputed: "text-destructive",
};
const RISK_TONE: Record<string, string> = { Low: "bg-emerald-500/15 text-emerald-700", Medium: "bg-amber-500/15 text-amber-700", High: "bg-destructive/15 text-destructive", Critical: "bg-destructive text-card" };
const OWNERSHIP_LABELS: Record<string, string> = {
  OwnershipType: "Ownership type", OwnershipSource: "Ownership acquired by", SellerIdStatus: "Seller identity", SellerAuthority: "Seller's authority to sell", OwnersConsent: "Owners' consent",
};

const pickFile = (onDone: (f: { id: number; fileName: string }) => void) => {
  const el = document.createElement("input");
  el.type = "file"; el.accept = "application/pdf,image/*";
  el.onchange = async () => {
    const f = el.files?.[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { toast.error("File is larger than 15 MB"); return; }
    try { onDone(await uploadLegalFile(f)); } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
  };
  el.click();
};

/** One area's verifier check: status + remarks (Verifier only, never the land's entry user). */
const AreaCheck: React.FC<{ landId: number; d: Diligence; area: Diligence["areas"][number]; onSaved: () => void; children?: React.ReactNode }> = ({ landId, d, area, onSaved, children }) => {
  const [status, setStatus] = useState(area.Status);
  const [remarks, setRemarks] = useState(area.Remarks ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStatus(area.Status); setRemarks(area.Remarks ?? ""); }, [area.Status, area.Remarks]);
  const opts = d.options.areaStatus.filter((s) => s !== "Not Applicable" || area.key === "inheritance");
  const save = async () => {
    setBusy(true);
    try { toast.success((await setDiligenceArea(landId, area.key, status, remarks)).message); onSaved(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-heading font-bold uppercase tracking-[0.1em] text-foreground">{area.label}</h3>
        <span className={`text-xs font-semibold ${STATUS_TONE[area.Status] ?? ""}`}>
          {area.Status}{area.CheckedByName ? ` · ${area.CheckedByName}, ${fmt(area.CheckedAt)}` : ""}
        </span>
      </div>
      {children && <div className="mt-3">{children}</div>}
      {area.Remarks && <p className="mt-2 text-xs text-muted-foreground">Remarks: {area.Remarks}</p>}
      {d.can.verify && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
          <label className="w-48"><span className={lbl}>Verifier status</span>
            <select className={`${input} mt-1`} value={status} onChange={(e) => setStatus(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
          </label>
          <label className="min-w-[200px] flex-1"><span className={lbl}>Remarks {status !== "Verified" && status !== "Pending" ? "*" : ""}</span>
            <input className={`${input} mt-1`} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
          <button className={btn} disabled={busy || (status === area.Status && remarks === (area.Remarks ?? ""))} onClick={save}>Save check</button>
        </div>
      )}
    </section>
  );
};

/** Suggested heir shares per inheritance, from Setup → Succession Rules — for comparison only, never a decision. */
const ShareSuggestions: React.FC<{ landId: number; onSaved: () => void }> = ({ landId, onSaved }) => {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["legal-heir-shares", landId], queryFn: () => getInheritanceSuggestions(landId), enabled: landId > 0 });
  if (!data?.items.length) return null;
  const decide = async (id: number, decision: string) => {
    const r = await askLegal({ title: `${decision}?`, message: decision === "Accept suggestion" ? "The suggested shares are written to the heirs." : "The recorded shares stay as they are.",
      input: { label: "Legal basis / remarks", required: true, multiline: true }, confirmText: decision });
    if (!r) return;
    try { toast.success((await decideHeirShares(id, decision, r)).message); qc.invalidateQueries({ queryKey: ["legal-heir-shares", landId] }); onSaved(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };
  return (
    <div className="mt-3 space-y-3">
      {data.items.map(({ inheritance: i, result }) => (
        <div key={i.InheritanceId} className="border border-border/70 p-3">
          <p className="text-xs"><b>{i.DeceasedName}</b> · {i.SuccessionLaw ?? "Succession law not chosen"}</p>
          {!i.SuccessionLaw ? <p className="mt-1 text-xs text-muted-foreground">Choose the applicable succession law on the inheritance (Ownership History) to see suggested shares.</p>
            : !result ? <p className="mt-1 text-xs text-muted-foreground">No suggestion for {i.SuccessionLaw} — shares follow the will / documents and legal review.</p> : (
            <>
              <p className="mt-1 rounded bg-amber-500/10 px-2 py-1 text-[0.6875rem] text-amber-800 dark:text-amber-300">
                Suggestion for legal review — not a legal determination.{!result.allValidated && " Some rules used are NOT yet validated by a lawyer."}
              </p>
              <table className="mt-2 w-full text-left text-xs">
                <thead className="text-muted-foreground"><tr><th className="py-1 pr-2">Heir</th><th className="py-1 pr-2">Role</th><th className="py-1 pr-2 text-right">Recorded %</th><th className="py-1 pr-2 text-right">Suggested %</th><th className="py-1">Rule</th></tr></thead>
                <tbody>{result.lines.map((l) => {
                  const off = l.suggestedPct != null && Math.abs(Number(l.recordedPct ?? 0) - l.suggestedPct) > 0.01;
                  return (
                    <tr key={l.id} className="border-t border-border/60">
                      <td className="py-1 pr-2">{l.name}</td><td className="py-1 pr-2">{l.role ?? "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{l.recordedPct ?? "—"}</td>
                      <td className={`py-1 pr-2 text-right font-semibold tabular-nums ${off ? "text-amber-600" : ""}`}>{l.suggestedPct ?? "—"}</td>
                      <td className="py-1 text-muted-foreground">{l.rule ?? l.note}{l.rule && !l.validated ? " · not validated" : ""}{l.rule && l.note ? ` · ${l.note}` : ""}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              {result.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-[0.6875rem] text-muted-foreground">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </>
          )}
          {i.ShareDecision ? (
            <p className="mt-2 text-xs text-emerald-600">{i.ShareDecision} · {i.ShareDecisionByName}, {fmt(i.ShareDecisionAt)} — {i.ShareDecisionRemarks}</p>
          ) : data.canDecide && i.SuccessionLaw ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {result && <button className={btn} onClick={() => decide(i.InheritanceId, "Accept suggestion")}>Accept suggestion</button>}
              <button className="border border-foreground px-3 py-1.5 text-xs font-semibold" onClick={() => decide(i.InheritanceId, "Keep recorded shares")}>Keep recorded shares</button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};

/**
 * Due Diligence tab (before Final Verification): ownership & seller, inheritance, title and documents checked by a
 * Verifier; automatic risk flags + manual risk assessment; legal review with final clearance by a Legal Reviewer.
 * Automatic flags come from the land's records — they are prompts for review, not legal findings.
 */
export const DueDiligencePanel: React.FC<{ landId: number; onGoTab: (tab: string) => void }> = ({ landId, onGoTab }) => {
  const qc = useQueryClient();
  const canEdit = usePageRights("legal-land-master").canEdit;
  const { data: d, error, isLoading } = useQuery({ queryKey: ["legal-diligence", landId], queryFn: () => getDiligence(landId), enabled: landId > 0 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-diligence", landId] }); qc.invalidateQueries({ queryKey: ["legal-land-final", landId] }); };

  const [own, setOwn] = useState<Record<string, string>>({});
  useEffect(() => {
    if (d) setOwn({ OwnershipType: d.land.OwnershipType ?? "", OwnershipSource: d.land.OwnershipSource ?? "", SellerIdStatus: d.land.SellerIdStatus ?? "",
      SellerAuthority: d.land.SellerAuthority ?? "", OwnersConsent: d.land.OwnersConsent ?? "", SellerContact: d.land.SellerContact ?? "" });
  }, [d]);
  const [risk, setRisk] = useState({ level: "", remarks: "", fileId: null as number | null, fileName: "" });
  const [rev, setRev] = useState({ status: "", advocateId: "", assignedOn: "", completedOn: "", opinion: "", observations: "", additionalDocs: "", recommendation: "", fileId: null as number | null, fileName: "" });
  const { data: advocates = [] } = useQuery({ queryKey: ["legal-lookup", "advocate"], queryFn: () => getLegalLookup("advocate"), staleTime: 5 * 60_000 });
  const { data: fetches = [] } = useQuery({ queryKey: ["legal-portal-fetches", landId], queryFn: () => getPortalFetches(landId), enabled: landId > 0 });
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ message: string }>, after?: () => void) => {
    setBusy(true);
    try { toast.success((await fn()).message); after?.(); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !d) return <p className="text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>;
  const area = (k: string) => d.areas.find((a) => a.key === k)!;
  const latestRisk = d.risks[0];
  const latestReview = d.reviews[0];
  const go = (t: string) => <button className="text-xs underline" onClick={() => onGoTab(t)}>Open {t === "ownership" ? "Ownership History" : t === "transfers" ? "Acquisition & Purchase" : t === "records" ? "Land Records" : "Documents"} tab</button>;

  return (
    <div className="space-y-4">
      {/* Gate: what still stands before Final Verification */}
      <div className={`border-2 p-4 ${d.blockers.length ? "border-amber-500 bg-amber-500/5" : "border-emerald-600 bg-emerald-500/5"}`}>
        <p className="flex items-center gap-2 text-sm font-semibold">
          {d.blockers.length ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />}
          {d.blockers.length ? "Due diligence not complete — Final Verification waits for:" : "Due diligence complete — the land can go to Final Verification."}
        </p>
        {d.blockers.length > 0 && <ul className="mt-1 list-disc pl-6 text-xs text-muted-foreground">{d.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
      </div>

      {/* 1. Ownership & seller */}
      <AreaCheck landId={landId} d={d} area={area("ownership")} onSaved={refresh}>
        <p className="text-xs text-muted-foreground">Current owners: <b className="text-foreground">{d.land.CurrentOwners ?? "none recorded"}</b> · {go("ownership")}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {Object.entries(d.options.ownership).map(([k, opts]) => (
            <label key={k}><span className={lbl}>{OWNERSHIP_LABELS[k]}</span>
              <select className={`${input} mt-1`} disabled={!canEdit} value={own[k] ?? ""} onChange={(e) => setOwn({ ...own, [k]: e.target.value })}>
                <option value="">Select…</option>{opts.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
          ))}
          <label><span className={lbl}>Seller contact</span><input className={`${input} mt-1`} disabled={!canEdit} value={own.SellerContact ?? ""} onChange={(e) => setOwn({ ...own, SellerContact: e.target.value })} /></label>
        </div>
        {canEdit && <button className={`${btn} mt-3`} disabled={busy} onClick={() => run(() => saveOwnershipDetails(landId, own))}>Save details</button>}
      </AreaCheck>

      {/* 2. Inheritance */}
      <AreaCheck landId={landId} d={d} area={area("inheritance")} onSaved={refresh}>
        <p className="text-xs text-muted-foreground">
          {d.land.Inheritances ? `${d.land.Inheritances} inheritance record(s)` : "No inheritance recorded"} — deceased owner, legal heirs and shares, death / heir certificates,
          will / probate, family tree and any pending dispute are entered in Ownership History. {go("ownership")}
        </p>
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">The system only suggests shares from the rules in Setup → Succession Rules (when a succession law is chosen on the inheritance). It never decides them — a Verifier / Legal Reviewer accepts or keeps the recorded shares, with remarks.</p>
        <ShareSuggestions landId={landId} onSaved={refresh} />
      </AreaCheck>

      {/* 3. Title */}
      <AreaCheck landId={landId} d={d} area={area("title")} onSaved={refresh}>
        <p className="text-xs text-muted-foreground">{d.land.Transfers} ownership transfer(s) (sale / gift / partition / parent deeds) · {d.land.LandRecords} RS / LR record(s). Check that the chain is continuous and the RS / LR records match. {go("transfers")} {go("records")}</p>
      </AreaCheck>

      {/* 4. Documents */}
      <AreaCheck landId={landId} d={d} area={area("documents")} onSaved={refresh}>
        <p className="text-xs text-muted-foreground">{d.land.Documents} document(s) — sale / parent deed, RS / LR, Khatian, heir / death certificates, will, mortgage release, court orders, permissions, ID, legal opinion. {go("documents")}</p>
      </AreaCheck>

      {/* 5. Special / restricted property — processing waits until the permission is recorded */}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-heading font-bold uppercase tracking-[0.1em]">Special / restricted property</h3>
          <span className="text-xs text-muted-foreground">Waqf · Debottar · religious trust · ST land · vested land · ceiling · acquisition notification</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Record any restriction found. A restriction that needs permission blocks Final Verification and the deed approvals until its status is <b>Permission obtained</b> (with the document); <b>Transfer prohibited</b> blocks the land.</p>
        <div className="mt-2">
          <LegalMasterTable entry={{ pageKey: "legal-land-master", key: "property-restriction", label: "Special / Restricted Property" }} parentId={landId} onSaved={refresh} />
        </div>
      </section>

      {/* 6. Litigation & encumbrance — open cases / stay orders need a legal officer's clearance */}
      <section className={card}>
        <h3 className="text-sm font-heading font-bold uppercase tracking-[0.1em]">Litigation & encumbrance</h3>
        <p className="mt-1 text-xs text-muted-foreground">Court cases (with stay order / injunction) are entered in Legal Dispute Information; loans, mortgages, encumbrance certificate and attachment orders in Loan & Mortgage.
          {" "}<button className="text-xs underline" onClick={() => onGoTab("legal")}>Open Legal Dispute Information</button> · <button className="text-xs underline" onClick={() => onGoTab("loans")}>Open Loan & Mortgage</button></p>
        {!(d.cases ?? []).length ? <p className="mt-2 text-xs text-muted-foreground">No open court case or stay order.</p> : (
          <ul className="mt-2 space-y-1.5 text-xs">
            {(d.cases ?? []).map((c) => (
              <li key={c.CaseId} className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-1.5">
                <b>{c.CaseNumber}</b><span className="text-muted-foreground">{c.CourtName ?? ""} · {c.CaseStatus}</span>
                {c.StayType !== "None" && <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-semibold text-destructive">{c.StayType}</span>}
                {c.ClearedAt ? <span className="text-emerald-600">Cleared by {c.ClearedByName}, {fmt(c.ClearedAt)} — {c.ClearRemarks}</span> : (
                  d.can.clear ? (
                    <button className="ml-auto border border-foreground px-2 py-0.5 font-semibold" onClick={async () => {
                      const r = await askLegal({ title: `Clear case ${c.CaseNumber}?`, message: "Only after reviewing the supporting evidence (order, settlement, withdrawal…).", input: { label: "Reason / evidence reviewed", required: true, multiline: true }, confirmText: "Clear case" });
                      if (r) run(() => clearCourtCase(landId, c.CaseId, r));
                    }}>Clear case</button>
                  ) : <span className="ml-auto text-amber-600">Waiting for a Legal Reviewer to clear</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Government-site evidence (saved from Fetch on Basic Information) */}
      <section className={card}>
        <h3 className="text-sm font-heading font-bold uppercase tracking-[0.1em]">Government site evidence</h3>
        <p className="mt-1 text-xs text-muted-foreground">Data fetched from government sites and saved here (Basic Information → Fetch → Save as evidence). A check, not conclusive proof of title.</p>
        {!fetches.length ? <p className="mt-2 text-xs text-muted-foreground">None saved.</p> : (
          <ul className="mt-2 space-y-1 text-xs">{fetches.map((f) => (
            <li key={f.FetchId} className="border-t border-border/60 pt-1">
              <b>{f.SiteName ?? "Site"}</b> · {fmt(f.FetchedAt)} {new Date(f.FetchedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · {f.FetchedByName ?? ""}
              {" · "}<b className={f.MatchResult === "Does not match" ? "text-destructive" : f.MatchResult === "Partly matches" ? "text-amber-600" : "text-emerald-600"}>{f.MatchResult}</b>
              {f.Remarks ? ` — ${f.Remarks}` : ""}{f.SourceUrl ? <span className="block truncate text-muted-foreground">{f.SourceUrl}</span> : null}
              {f.Response ? <details><summary className="cursor-pointer text-muted-foreground">Fetched data</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-muted/40 p-2 text-[0.6875rem]">{f.Response}</pre></details> : null}
            </li>
          ))}</ul>
        )}
      </section>

      {/* 7. Risk */}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-heading font-bold uppercase tracking-[0.1em]">Legal risk assessment</h3>
          {latestRisk ? <span className={`rounded px-2 py-0.5 text-xs font-semibold ${RISK_TONE[latestRisk.RiskLevel]}`}>{latestRisk.RiskLevel} · {latestRisk.AssessedByName}, {fmt(latestRisk.AssessedAt)}</span> : <span className="text-xs text-amber-600">Not assessed</span>}
        </div>
        <div className="mt-2">
          <p className={lbl}>Automatic flags ({d.autoFlags.length}) — from the records, for review; not a legal finding</p>
          {!d.autoFlags.length ? <p className="mt-1 text-xs text-muted-foreground">None.</p> : (
            <ul className="mt-1 space-y-0.5 text-xs">{d.autoFlags.map((f) => <li key={f.text}><span className={`mr-1.5 rounded px-1.5 py-0.5 text-[0.625rem] font-semibold ${RISK_TONE[f.level]}`}>{f.level}</span>{f.text}</li>)}</ul>
          )}
        </div>
        {d.can.assessRisk && (
          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
            <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
              <label><span className={lbl}>Risk level *</span>
                <select className={`${input} mt-1`} value={risk.level} onChange={(e) => setRisk({ ...risk, level: e.target.value })}><option value="">Select…</option>{d.options.riskLevels.map((o) => <option key={o}>{o}</option>)}</select>
              </label>
              <label><span className={lbl}>Explanation *</span><input className={`${input} mt-1`} value={risk.remarks} onChange={(e) => setRisk({ ...risk, remarks: e.target.value })} /></label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {risk.fileId && <LegalFileLink id={risk.fileId} name={risk.fileName} />}
              <button type="button" className="inline-flex items-center gap-1 border border-foreground px-2.5 py-1 text-xs font-semibold" onClick={() => pickFile((f) => setRisk({ ...risk, fileId: f.id, fileName: f.fileName }))}><Upload size={12} /> Attach</button>
              <button className={`${btn} ml-auto`} disabled={busy || !risk.level || !risk.remarks.trim()} onClick={() => run(() => addRiskAssessment(landId, risk), () => setRisk({ level: "", remarks: "", fileId: null, fileName: "" }))}>Save assessment</button>
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">High or Critical risk needs legal clearance before Final Verification; Critical cannot proceed.</p>
          </div>
        )}
        {d.risks.length > 0 && (
          <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">History ({d.risks.length})</summary>
            <ul className="mt-1 space-y-1 text-xs">{d.risks.map((r) => (
              <li key={r.RiskId} className="border-t border-border/60 pt-1"><b>{r.RiskLevel}</b> · {fmt(r.AssessedAt)} · {r.AssessedByName} — {r.Remarks} {r.FileId ? <LegalFileLink id={r.FileId} name={r.FileName ?? "File"} /> : null}</li>
            ))}</ul>
          </details>
        )}
      </section>

      {/* 8. Legal review */}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-heading font-bold uppercase tracking-[0.1em]">Legal review & opinion</h3>
          <span className={`text-xs font-semibold ${latestReview?.Status === "Legally Cleared" ? "text-emerald-600" : latestReview?.Status === "Not Recommended" ? "text-destructive" : "text-amber-600"}`}>
            {latestReview ? `${latestReview.Status}${latestReview.AdvocateName ? ` · ${latestReview.AdvocateName}` : ""}` : "Not started"}
          </span>
        </div>
        {latestReview?.Opinion && <p className="mt-2 text-xs"><span className="text-muted-foreground">Opinion:</span> {latestReview.Opinion}</p>}
        {latestReview?.AdditionalDocs && <p className="mt-1 text-xs"><span className="text-muted-foreground">Documents needed:</span> {latestReview.AdditionalDocs}</p>}
        {(canEdit || d.can.clear) && (
          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <label><span className={lbl}>Status *</span>
                <select className={`${input} mt-1`} value={rev.status} onChange={(e) => setRev({ ...rev, status: e.target.value })}>
                  <option value="">Select…</option>
                  {d.options.reviewStatus.filter((s) => d.can.clear || !["Legally Cleared", "Not Recommended", "Not Required"].includes(s)).map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
              <label><span className={lbl}>Advocate / legal officer</span>
                <select className={`${input} mt-1`} value={rev.advocateId} onChange={(e) => setRev({ ...rev, advocateId: e.target.value })}><option value="">Select…</option>{advocates.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
              </label>
              <label><span className={lbl}>Assigned on</span><input type="date" className={`${input} mt-1`} value={rev.assignedOn} onChange={(e) => setRev({ ...rev, assignedOn: e.target.value })} /></label>
              <label><span className={lbl}>Completed on</span><input type="date" className={`${input} mt-1`} value={rev.completedOn} onChange={(e) => setRev({ ...rev, completedOn: e.target.value })} /></label>
            </div>
            <label className="block"><span className={lbl}>Legal opinion {["Legally Cleared", "Not Recommended"].includes(rev.status) ? "*" : ""}</span><textarea rows={2} className={`${input} mt-1`} value={rev.opinion} onChange={(e) => setRev({ ...rev, opinion: e.target.value })} /></label>
            <div className="grid gap-2 sm:grid-cols-3">
              <label><span className={lbl}>Observations</span><input className={`${input} mt-1`} value={rev.observations} onChange={(e) => setRev({ ...rev, observations: e.target.value })} /></label>
              <label><span className={lbl}>Additional documents needed {rev.status === "Additional Information Required" ? "*" : ""}</span><input className={`${input} mt-1`} value={rev.additionalDocs} onChange={(e) => setRev({ ...rev, additionalDocs: e.target.value })} /></label>
              <label><span className={lbl}>Final recommendation</span><input className={`${input} mt-1`} value={rev.recommendation} onChange={(e) => setRev({ ...rev, recommendation: e.target.value })} /></label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {rev.fileId && <LegalFileLink id={rev.fileId} name={rev.fileName} />}
              <button type="button" className="inline-flex items-center gap-1 border border-foreground px-2.5 py-1 text-xs font-semibold" onClick={() => pickFile((f) => setRev({ ...rev, fileId: f.id, fileName: f.fileName }))}><Upload size={12} /> Attach opinion</button>
              <button className={`${btn} ml-auto`} disabled={busy || !rev.status} onClick={() => run(() => addLegalReview(landId, { ...rev, advocateId: rev.advocateId ? Number(rev.advocateId) : null }),
                () => setRev({ status: "", advocateId: "", assignedOn: "", completedOn: "", opinion: "", observations: "", additionalDocs: "", recommendation: "", fileId: null, fileName: "" }))}>Save review</button>
            </div>
            {!d.can.clear && <p className="text-[0.6875rem] text-muted-foreground">Legally Cleared / Not Recommended / Not Required are given only by a Legal Reviewer (Setup → Approval Control).</p>}
          </div>
        )}
        {d.reviews.length > 0 && (
          <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">History ({d.reviews.length})</summary>
            <ul className="mt-1 space-y-1 text-xs">{d.reviews.map((r) => (
              <li key={r.ReviewId} className="border-t border-border/60 pt-1"><b>{r.Status}</b> · {fmt(r.CreatedAt)} · {r.CreatedByName}{r.AdvocateName ? ` · ${r.AdvocateName}` : ""}{r.Opinion ? ` — ${r.Opinion}` : ""} {r.FileId ? <LegalFileLink id={r.FileId} name={r.FileName ?? "File"} /> : null}</li>
            ))}</ul>
          </details>
        )}
      </section>
    </div>
  );
};

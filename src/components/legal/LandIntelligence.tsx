import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { askLegal } from "@/components/legal/LegalAsk";
import { LegalMasterTable } from "@/pages/legal/LegalMasterPage";
import {
  calculateShares, confirmFramework, decideEvent, getFamily, getInheritanceCase, getLandEvents, getReconciliation, inheritanceAction, reviewCalc,
  type FamilyMember, type OwnershipEventRow, type ParcelArea,
} from "@/api/legalIntelApi";
import { getLegalRows } from "@/api/legalMastersApi";

/**
 * Land intelligence (Legal V3): parcels and area reconciliation · ownership events (many parties, verify / dispute) with
 * the event tree · family relationships with the family tree, and inheritance cases (framework, provisional shares,
 * legal-officer review, workflow) · ownership disputes · possession and alternative history.
 * Family relationships, recorded ownership, possession and legally verified ownership are kept apart.
 */
const LAND_PAGE = "legal-land-master";
const t = (key: string, label: string) => ({ pageKey: LAND_PAGE, key, label });
const small = "border border-border px-2 py-1 text-xs hover:bg-muted";
const note = "border-l-2 border-sky-600 bg-sky-500/5 px-3 py-2 text-xs";
const STATUS_TONE: Record<string, string> = {
  Verified: "bg-emerald-600/15 text-emerald-800", Approved: "bg-emerald-600/15 text-emerald-800", "Pending Verification": "bg-amber-500/15 text-amber-800",
  Draft: "bg-muted text-muted-foreground", Disputed: "bg-destructive/15 text-destructive", Rejected: "bg-destructive/15 text-destructive",
  Provisional: "bg-amber-500/15 text-amber-800", Superseded: "bg-muted text-muted-foreground",
};
const Chip = ({ s }: { s: string }) => <span className={`px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase ${STATUS_TONE[s] ?? "bg-sky-500/15 text-sky-800"}`}>{s}</span>;
type Tab = "parcels" | "events" | "family" | "disputes" | "possession";
const TABS: [Tab, string][] = [["parcels", "Parcels & area"], ["events", "Ownership events"], ["family", "Family & inheritance"], ["disputes", "Disputes"], ["possession", "Possession & other history"]];

export function LandIntelligence({ landId, editable }: { landId: number; editable: boolean }) {
  const [tab, setTab] = useState<Tab>("parcels");
  return (
    <section className="border border-border bg-card">
      <header className="border-b border-border px-4 py-2.5">
        <h3 className="font-semibold">Land intelligence</h3>
        <p className="text-xs text-muted-foreground">Parcels, ownership events, family &amp; inheritance, disputes and possession — every entry needs evidence and verification; nothing here certifies title by itself.</p>
      </header>
      <div className="flex overflow-x-auto border-b border-border bg-muted/30" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm ${tab === k ? "border-foreground bg-card font-semibold" : "border-transparent hover:bg-card/60"}`}>{l}</button>
        ))}
      </div>
      <div className="space-y-3 p-4">
        {tab === "parcels" && <ParcelsView q={{ landId }} entry={t("land-parcel", "Land Parcel")} parentId={landId} editable={editable} />}
        {tab === "events" && <EventsView landId={landId} editable={editable} />}
        {tab === "family" && <FamilyView landId={landId} editable={editable} />}
        {tab === "disputes" && (<>
          <p className={note}>Competing claims to ownership or shares. An open dispute keeps its inheritance case from approval and shows as a high risk at Land Approval.</p>
          <LegalMasterTable entry={t("ownership-dispute", "Ownership Dispute")} parentId={landId} noAdd={!editable} />
        </>)}
        {tab === "possession" && (<>
          <p className={note}>Possession and ownership are different: the person occupying the land is not treated as its owner.</p>
          <LegalMasterTable entry={t("land-possession", "Possession Entry")} parentId={landId} noAdd={!editable} />
          <p className={note}>Alternative history — khas / vested land, patta, grant, settlement, lease, tenancy, encroachment, court order and other claims. Recorded as claims, evidence or events, never as automatic ownership.</p>
          <LegalMasterTable entry={t("land-alt-history", "Alternative History Entry")} parentId={landId} noAdd={!editable} />
        </>)}
      </div>
    </section>
  );
}

/** Parcels list + the area reconciliation table (used for an enquiry too). */
export function ParcelsView({ q, entry, parentId, editable }: { q: { landId?: number; enquiryId?: number }; entry: { pageKey: string; key: string; label: string }; parentId: number; editable: boolean }) {
  const qc = useQueryClient();
  const rec = useQuery({ queryKey: ["legal-reconciliation", q], queryFn: () => getReconciliation(q) });
  const cols = rec.data?.parcels[0] ? Object.keys(rec.data.parcels[0].areas) : [];
  return (
    <div className="space-y-3">
      <p className={note}>One row per parcel or portion. Records, ownership events and inheritance cases name their parcel; the same parcel stays with the land after conversion. A Dag already on another parcel shows the match and needs confirmation.</p>
      <LegalMasterTable entry={entry} parentId={parentId} noAdd={!editable} onSaved={() => qc.invalidateQueries({ queryKey: ["legal-reconciliation"] })} />
      <div className="border border-border">
        <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider">Area reconciliation (in each parcel's unit)</p>
        {rec.isLoading ? <p className="p-3 text-xs text-muted-foreground">Loading…</p> : !rec.data?.parcels.length ? <p className="p-3 text-xs text-muted-foreground">No parcels.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr><th className="px-2 py-1">Parcel</th>{cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 text-right">{c}</th>)}<th className="px-2 py-1">Check</th></tr></thead>
              <tbody>
                {rec.data.parcels.map((p: ParcelArea) => (
                  <tr key={p.ParcelId} className={`border-t border-border align-top ${p.flags.length ? "bg-amber-500/5" : ""}`}>
                    <td className="px-2 py-1"><b>{p.ParcelCode}</b><span className="block text-muted-foreground">{[p.MouzaName, p.RsDagNo && `RS ${p.RsDagNo}`, p.LrDagNo && `LR ${p.LrDagNo}`].filter(Boolean).join(" · ")} · {p.UnitName ?? "unit?"}</span></td>
                    {cols.map((c) => <td key={c} className="px-2 py-1 text-right tabular-nums">{p.areas[c] ?? "—"}</td>)}
                    <td className="px-2 py-1">{p.flags.length ? p.flags.map((f) => <span key={f} className="block text-amber-800">⚠ {f}</span>) : <span className="text-emerald-700">Consistent</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EventsView({ landId, editable }: { landId: number; editable: boolean }) {
  const qc = useQueryClient();
  const [view, setView] = useState<"tree" | "list">("tree");
  const [partiesOf, setPartiesOf] = useState<number | null>(null);
  const q = useQuery({ queryKey: ["legal-land-events", landId], queryFn: () => getLandEvents(landId) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-land-events", landId] }); qc.invalidateQueries({ queryKey: ["legal-master"] }); };
  const decide = async (e: OwnershipEventRow, decision: string) => {
    const remarks = decision === "Verified" ? await askLegal({ title: "Verify this ownership event?", message: "Confirm the parties, shares and supporting document are checked. A verified event is changed only through an amendment.", input: { label: "Remarks (optional)" }, confirmText: "Verify" })
      : await askLegal({ title: `${decision === "Disputed" ? "Mark disputed" : "Reject"} this event?`, input: { label: "Reason", required: true }, confirmText: decision === "Disputed" ? "Mark disputed" : "Reject", tone: "danger" });
    if (remarks === null) return;
    try { toast.success((await decideEvent(e.EventId, decision, remarks || undefined)).message); refresh(); } catch (err) { toast.error((err as Error).message); }
  };
  const events = q.data?.events ?? [];
  return (
    <div className="space-y-3">
      <p className={note}>Ownership changes as events — sale, gift, inheritance, partition, release, exchange, patta, court decree, family arrangement… — each with every transferor and transferee and their shares. Another user verifies; unverified and disputed events stay marked.</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex border border-foreground">
          {(["tree", "list"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`h-7 px-3 text-[0.6875rem] font-semibold uppercase ${view === v ? "bg-foreground text-background" : ""}`}>{v === "tree" ? "Event tree" : "Manage events"}</button>)}
        </span>
        {!!q.data?.openDisputes.length && <span className="text-xs font-semibold text-destructive">{q.data.openDisputes.length} open dispute(s): {q.data.openDisputes.map((d) => `${d.Claimant} (${d.DisputeType})`).join(", ")}</span>}
      </div>
      {view === "list" ? (
        <LegalMasterTable entry={t("ownership-event", "Ownership Event")} parentId={landId} noAdd={!editable} onSaved={refresh}
          rowActions={(raw) => <button className={small} onClick={(ev) => { ev.stopPropagation(); setPartiesOf(Number(raw.EventId)); }}>Parties</button>} />
      ) : q.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : !events.length ? <p className="text-xs text-muted-foreground">No ownership events yet — add them under Manage events.</p> : (
        <ol className="relative space-y-3 border-l-2 border-foreground/20 pl-5">
          {events.map((e) => {
            const from = e.parties.filter((p) => p.PartyRole === "Transferor"), to = e.parties.filter((p) => p.PartyRole === "Transferee");
            const shaky = e.ApprovalStatus !== "Verified";
            return (
              <li key={e.EventId} className="relative">
                <span className={`absolute -left-[1.85rem] top-2 h-3.5 w-3.5 rounded-full border-2 border-card ${e.ApprovalStatus === "Verified" ? "bg-emerald-600" : e.ApprovalStatus === "Disputed" || e.ApprovalStatus === "Rejected" ? "bg-destructive" : "bg-amber-500"}`} />
                <div className={`border p-2 text-xs ${shaky ? "border-dashed border-foreground/40" : "border-foreground/40"} ${e.ApprovalStatus === "Disputed" ? "bg-destructive/5" : "bg-card"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="tabular-nums">{e.EffectiveDate ?? e.EventDate}</b><b>{e.EventType ?? "Event"}</b><Chip s={e.ApprovalStatus} />
                    {e.ParcelCode && <span className="text-muted-foreground">· {e.ParcelCode}</span>}{(e.DeedNo || e.DocumentNo) && <span className="text-muted-foreground">· {e.DeedNo ?? e.DocumentNo}</span>}
                    {editable && e.ApprovalStatus !== "Verified" && (
                      <span className="ml-auto flex gap-1">
                        <button className={small} onClick={() => decide(e, "Verified")}>Verify</button>
                        <button className={`${small} text-destructive`} onClick={() => decide(e, "Disputed")}>Dispute</button>
                        <button className={`${small} text-destructive`} onClick={() => decide(e, "Rejected")}>Reject</button>
                      </span>
                    )}
                    {editable && e.ApprovalStatus === "Verified" && <button className={`${small} ml-auto text-destructive`} onClick={() => decide(e, "Disputed")}>Raise dispute</button>}
                  </div>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <div>{from.length ? from.map((p) => <span key={p.PartyId} className="block">{p.PersonName}{p.ShareFraction ? ` · ${p.ShareFraction}` : p.SharePct != null ? ` · ${Number(p.SharePct)}%` : ""}</span>) : <span className="text-muted-foreground">{e.PreviousOwnerName ?? "Original / not recorded"}</span>}</div>
                    <span className="text-center text-muted-foreground">→</span>
                    <div>{to.length ? to.map((p) => <span key={p.PartyId} className="block font-semibold">{p.PersonName}<span className="font-normal text-muted-foreground">{p.Relationship ? ` (${p.Relationship})` : ""}{p.ShareFraction ? ` · ${p.ShareFraction}` : p.SharePct != null ? ` · ${Number(p.SharePct)}%` : ""}{p.OwnerKind !== "Individual" ? ` · ${p.OwnerKind}` : ""}</span></span>) : <span className="text-muted-foreground">{e.NewOwnerName ?? "—"}</span>}</div>
                  </div>
                  <p className="mt-1 text-[0.6875rem] text-muted-foreground">Entered by {e.CreatedByName ?? "—"}{e.ApprovedByName ? ` · ${e.ApprovalStatus.toLowerCase()} by ${e.ApprovedByName}` : ""}{e.ApprovalRemarks ? ` — ${e.ApprovalRemarks}` : ""}{e.InheritanceId ? " · from an approved inheritance case" : ""}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {partiesOf != null && (
        <div className="border-2 border-foreground/40 p-3">
          <div className="mb-2 flex items-center justify-between"><b className="text-sm">Parties of the event</b><button className="text-xs underline" onClick={() => setPartiesOf(null)}>Close</button></div>
          <LegalMasterTable key={`p-${partiesOf}`} entry={t("ownership-event-party", "Party")} parentId={landId} noAdd={!editable} onSaved={refresh}
            fixed={{ EventId: String(partiesOf) }} rowFilter={(r) => Number(r.EventId) === partiesOf} />
        </div>
      )}
    </div>
  );
}

/** Family tree (who is related to whom) — drawn from "child / spouse of" links; separate from ownership. */
function FamilyTree({ members }: { members: FamilyMember[] }) {
  const roots = members.filter((m) => !m.RelatedToMemberId || !members.some((x) => x.MemberId === m.RelatedToMemberId));
  const kids = (id: number) => members.filter((m) => m.RelatedToMemberId === id);
  const Node = ({ m, depth }: { m: FamilyMember; depth: number }): React.ReactElement => (
    <li className={depth ? "relative pl-5 before:absolute before:left-0 before:top-3 before:w-4 before:border-t before:border-foreground/30" : ""}>
      <span className={`inline-flex flex-wrap items-center gap-1.5 border px-2 py-1 text-xs ${m.IsDeceasedOwner ? "border-2 border-foreground" : m.RelationshipStatus === "Disputed" ? "border-destructive bg-destructive/5" : m.RelationshipStatus !== "Verified" ? "border-dashed border-foreground/40" : "border-foreground/40"}`}>
        <b>{m.FullName}</b>
        {m.RelationToRelated && depth > 0 && <span className="text-muted-foreground">{m.RelationToRelated.toLowerCase()}</span>}
        {m.RelationToDeceased && <span className="text-muted-foreground">· {m.RelationToDeceased}</span>}
        {!m.IsAlive && <span className="text-muted-foreground">· died {m.DateOfDeath ?? ""}</span>}
        {m.IsMinor && <span className="bg-sky-500/15 px-1 text-[0.625rem] uppercase text-sky-800">minor</span>}
        {m.IsMissing && <span className="bg-amber-500/15 px-1 text-[0.625rem] uppercase text-amber-800">missing</span>}
        {m.RelationshipStatus !== "Verified" && <span className="bg-muted px-1 text-[0.625rem] uppercase">{m.RelationshipStatus}</span>}
      </span>
      {kids(m.MemberId).length > 0 && <ul className="ml-3 mt-1 space-y-1 border-l border-foreground/30">{kids(m.MemberId).map((k) => <Node key={k.MemberId} m={k} depth={depth + 1} />)}</ul>}
    </li>
  );
  return <ul className="space-y-1">{roots.map((m) => <Node key={m.MemberId} m={m} depth={0} />)}</ul>;
}

function FamilyView({ landId, editable }: { landId: number; editable: boolean }) {
  const qc = useQueryClient();
  const fam = useQuery({ queryKey: ["legal-family", landId], queryFn: () => getFamily(landId) });
  const cases = useQuery({ queryKey: ["legal-master", "inheritance", landId], queryFn: () => getLegalRows("inheritance", landId) });
  const [caseId, setCaseId] = useState<number | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-family", landId] }); qc.invalidateQueries({ queryKey: ["legal-inheritance-case"] }); };
  return (
    <div className="space-y-3">
      <p className={note}>Two different things: the <b>family tree</b> shows who is related to whom; legal ownership changes only through verified events. A relative is not automatically an heir of this property, and an heir's share is decided in the inheritance case.</p>
      <div className="grid gap-3 lg:grid-cols-[1fr_1.3fr]">
        <div className="border border-border p-2">
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider">Family tree</p>
          {fam.data?.members.length ? <FamilyTree members={fam.data.members} /> : <p className="text-xs text-muted-foreground">No family members recorded.</p>}
        </div>
        <div className="border border-border p-2">
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider">Family members</p>
          <LegalMasterTable entry={t("family-member", "Family Member")} parentId={landId} noAdd={!editable} onSaved={refresh} />
        </div>
      </div>
      <div className="border border-border p-2">
        <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider">Inheritance cases</p>
        <div className="flex flex-wrap gap-1.5">
          {(cases.data ?? []).map((r) => (
            <button key={String(r.InheritanceId)} onClick={() => setCaseId(Number(r.InheritanceId))}
              className={`border px-2.5 py-1 text-xs ${caseId === Number(r.InheritanceId) ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/50"}`}>
              Estate of {String(r.DeceasedName)} · {String(r.ReviewStatus ?? "Draft")}
            </button>
          ))}
          {!cases.data?.length && <span className="text-xs text-muted-foreground">No inheritance case — add one in the land's Ownership History section (+ New inheritance).</span>}
        </div>
        {caseId != null && <InheritanceCasePanel id={caseId} landId={landId} editable={editable} />}
      </div>
    </div>
  );
}

function InheritanceCasePanel({ id, landId, editable }: { id: number; landId: number; editable: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legal-inheritance-case", id], queryFn: () => getInheritanceCase(id) });
  const refresh = () => { ["legal-inheritance-case", "legal-land-events", "legal-master"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const run = async (fn: () => Promise<{ message: string }>) => { try { toast.success((await fn()).message); refresh(); } catch (e) { toast.error((e as Error).message); } };
  const act = async (action: string, label: string, needReason: boolean) => {
    const r = await askLegal({ title: `${label}?`, input: { label: needReason ? "Reason" : "Remarks (optional)", required: needReason }, confirmText: label, tone: ["reject", "dispute"].includes(action) ? "danger" : "default" });
    if (r === null) return;
    run(() => inheritanceAction(id, action, r || undefined));
  };
  if (q.isLoading) return <p className="mt-2 text-xs text-muted-foreground">Loading…</p>;
  if (q.error || !q.data) return <p className="mt-2 text-xs text-destructive">{(q.error as Error)?.message ?? "Could not load"}</p>;
  const { case: c, calcs, flags, members } = q.data;
  const st = c.ReviewStatus;
  const ACTIONS: Record<string, [string, string, boolean][]> = {
    Draft: [["submit", "Submit for verification", false], ["dispute", "Mark disputed", true]],
    Returned: [["submit", "Submit again", false]], "Further Investigation": [["submit", "Submit again", false]],
    "Verifier Review": [["verify", "Verify — send to Legal Officer", false], ["return", "Return", true], ["investigate", "Further investigation", true], ["dispute", "Mark disputed", true]],
    "Legal Officer Review": [["approve", "Approve", false], ["return", "Return", true], ["investigate", "Further investigation", true], ["reject", "Reject", true], ["dispute", "Mark disputed", true]],
    Approved: [["reopen", "Reopen", true]], Rejected: [["reopen", "Reopen", true]], Disputed: [["reopen", "Reopen", true]],
  };
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">Estate of {c.DeceasedName}</b><Chip s={st} />
        <span className="text-muted-foreground">died {c.DateOfDeath ?? "?"} · {c.DeceasedGender ?? "gender?"} · {c.ParcelCode ?? "no parcel"} · available share {c.AvailableShareFraction ?? (c.AvailableSharePct != null ? `${Number(c.AvailableSharePct)}%` : "?")}</span>
        {editable && <span className="ml-auto flex flex-wrap gap-1">{(ACTIONS[st] ?? []).map(([a, l, r]) => <button key={a} className={`${small} ${["reject", "dispute"].includes(a) ? "text-destructive" : ""}`} onClick={() => act(a, l, r)}>{l}</button>)}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <p><span className="text-muted-foreground">Framework:</span> <b>{c.ApplicableFramework ?? "not set"}</b>{c.SchoolOfLaw ? ` · ${c.SchoolOfLaw}` : ""}</p>
        <p><span className="text-muted-foreground">Property / nature:</span> {c.PropertyType ?? "?"} · {c.NatureOfOwnership ?? "?"}</p>
        <p><span className="text-muted-foreground">Succession:</span> {c.SuccessionType ?? "?"}</p>
        <p className="sm:col-span-3">{c.FrameworkConfirmedByName ? <span className="text-emerald-700">Framework confirmed by {c.FrameworkConfirmedByName} {c.FrameworkConfirmedAt ? new Date(c.FrameworkConfirmedAt).toLocaleDateString("en-IN") : ""}</span>
          : <span className="text-amber-800">Framework not confirmed by a Legal Officer — no calculation until it is.</span>}
          {editable && <button className={`${small} ml-2`} onClick={async () => { const r = await askLegal({ title: "Confirm the succession framework?", message: `"${c.ApplicableFramework ?? "—"}" — confirm only after checking personal law, property type, nature of ownership, date of death, will and court orders (never religion alone).`, input: { label: "Basis / remarks" }, confirmText: "Confirm" }); if (r === null) return; run(() => confirmFramework(id, r || undefined)); }}>Confirm framework</button>}</p>
      </div>
      {flags.length > 0 && <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-2">{flags.map((f) => <p key={f} className="text-destructive">⚠ {f}</p>)}</div>}
      <p className="text-muted-foreground">Family members in this case: {members.filter((m) => !m.IsDeceasedOwner).map((m) => `${m.FullName} (${m.RelationToDeceased ?? "?"}${m.IsAlive ? "" : ", died"}${m.RelationshipStatus !== "Verified" ? `, ${m.RelationshipStatus.toLowerCase()}` : ""})`).join(", ") || "none — add them under Family members (link them to this case)"}</p>

      <div className="border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider">Provisional share calculation</p>
          {editable && st !== "Approved" && <button className={small} onClick={() => run(() => calculateShares(id))}>Calculate (new version)</button>}
        </div>
        <p className="border-b border-border px-3 py-1.5 text-[0.6875rem] text-amber-800">Provisional only — a Legal Officer must approve it. Rules: {q.data.ruleVersion}. Unsupported cases show "Requires Legal Review"; shares are never forced to 100 %.</p>
        {!calcs.length ? <p className="px-3 py-2 text-muted-foreground">No calculation yet.</p> : calcs.map((k) => (
          <div key={k.CalcId} className={`border-b border-border/60 px-3 py-2 last:border-b-0 ${k.CalcStatus === "Superseded" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <b>Version {k.VersionNo}</b><Chip s={k.CalcStatus} /><span className={k.Outcome === "Calculated" ? "" : "font-semibold text-amber-800"}>{k.Outcome}</span>
              <span className="text-muted-foreground">· {k.CreatedByName ?? "—"} {new Date(k.CreatedAt).toLocaleDateString("en-IN")}{k.ReviewedByName ? ` · reviewed by ${k.ReviewedByName}` : ""}{k.ReviewRemarks ? ` — ${k.ReviewRemarks}` : ""}</span>
              {editable && k.CalcStatus === "Provisional" && (
                <span className="ml-auto flex gap-1">
                  {k.Outcome === "Calculated" && <button className={small} onClick={async () => { const r = await askLegal({ title: `Approve version ${k.VersionNo}?`, message: "Legal Officer approval — another officer than the one who calculated.", input: { label: "Remarks (optional)" }, confirmText: "Approve" }); if (r === null) return; run(() => reviewCalc(k.CalcId, "Approved", r || undefined)); }}>Approve</button>}
                  <button className={`${small} text-destructive`} onClick={async () => { const r = await askLegal({ title: `Reject version ${k.VersionNo}?`, input: { label: "Reason", required: true }, confirmText: "Reject", tone: "danger" }); if (!r) return; run(() => reviewCalc(k.CalcId, "Rejected", r)); }}>Reject</button>
                </span>
              )}
            </div>
            {k.result?.lines.length ? (
              <table className="mt-1 w-full text-left">
                <thead className="text-muted-foreground"><tr><th className="py-0.5">Heir</th><th>Relation</th><th>Basis</th><th className="text-right">Of estate</th><th className="text-right">Of parcel</th><th className="text-right">Area</th></tr></thead>
                <tbody>{k.result.lines.map((l) => (
                  <tr key={`${l.memberId}-${l.name}`} className="border-t border-border/50"><td className="py-0.5 font-semibold">{l.name}{l.minor ? " (minor)" : ""}</td><td>{l.relation}</td><td className="text-muted-foreground">{l.head}</td>
                    <td className="text-right tabular-nums">{l.fractionOfEstate} · {l.pctOfEstate}%</td><td className="text-right tabular-nums">{l.fractionOfParcel} · {l.pctOfParcel}%</td><td className="text-right tabular-nums">{l.area != null ? `${l.area} ${l.areaUnit ?? ""}` : "—"}</td></tr>
                ))}</tbody>
              </table>
            ) : null}
            {k.Explanation && <pre className="mt-1 whitespace-pre-wrap font-sans text-[0.6875rem] text-muted-foreground">{k.Explanation}</pre>}
          </div>
        ))}
      </div>
      <div className="border border-border p-2">
        <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider">Will(s)</p>
        <LegalMasterTable key={`w-${id}`} entry={t("inheritance-will", "Will")} parentId={landId} noAdd={!editable} fixed={{ InheritanceId: String(id) }} rowFilter={(r) => Number(r.InheritanceId) === id} />
      </div>
    </div>
  );
}

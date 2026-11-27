import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ShieldTick } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { useProjectScope } from "@/components/legal/ProjectPicker";
import { askLegal } from "@/components/legal/LegalAsk";
import { usePageRights } from "@/hooks/usePageRights";
import { LegalMasterTable } from "@/pages/legal/LegalMasterPage";
import { decideAssessment, getPreReg, submitPreRegConversion, verifyPreRegConversion, type PreRegLand, type PreRegParcel } from "@/api/legalIntelApi";

/**
 * Pre-registration compliance — land classification & conversion (Pipeline step before Deed Registration).
 * Every parcel: current / proposed classification, whether conversion is required and when (before / after
 * registration), the Legal Officer's approval, and — when needed before registration — the conversion application up
 * to a verified order. Deed Registration stays blocked, parcel by parcel, until this is clear. Conversions allowed
 * after registration go to the existing Post-registration module; mutation is separate.
 */
const LAND_PAGE = "legal-land-master";
const small = "border border-border px-2 py-1 text-xs hover:bg-muted";
const TONE: Record<string, string> = { Approved: "text-emerald-700", Verified: "text-emerald-700", Clear: "text-emerald-700", Pending: "text-amber-700", Returned: "text-destructive", Rejected: "text-destructive", Blocked: "text-destructive" };

export default function LandPreRegistrationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const rights = usePageRights(LAND_PAGE);
  const { scope } = useProjectScope();
  const project = typeof scope === "number" ? String(scope) : "all";
  const q = useQuery({ queryKey: ["legal-prereg", project], queryFn: () => getPreReg(project) });
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "blocked" | "clear">("blocked");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-prereg"] }); qc.invalidateQueries({ queryKey: ["legal-master"] }); };
  const run = async (fn: () => Promise<{ message: string }>) => { try { toast.success((await fn()).message); refresh(); } catch (e) { toast.error((e as Error).message); } };
  const c = q.data?.counts;
  const tiles: [string, number | undefined, string?][] = [
    ["Pre-registration conversion pending", c?.prePending], ["Overdue", c?.preOverdue, c?.preOverdue ? "text-destructive" : ""], ["Application under process", c?.underProcess],
    ["Order received — verification pending", c?.orderVerificationPending, c?.orderVerificationPending ? "text-violet-700" : ""],
    ["Registration blocked (deed stage)", c?.registrationBlocked, c?.registrationBlocked ? "text-destructive" : ""], ["Assessment approval pending", c?.assessmentPending, c?.assessmentPending ? "text-amber-700" : ""],
    ["Not applicable — approval pending", c?.notApplicablePending], ["Post-registration conversion pending", c?.postPending],
  ];
  const lands = (q.data?.lands ?? []).filter((l) => filter === "all" || (filter === "blocked" ? !l.ok : l.ok));

  const assess = async (p: PreRegParcel, decision: "Approved" | "Returned" | "Rejected") => {
    const summary = `${p.CurrentClass ?? "?"} → ${p.ProposedClass ?? "no change"} · conversion ${p.ConversionRequired ?? "?"}${p.ConversionStage ? ` (${p.ConversionStage})` : ""}`;
    const r = await askLegal({ title: `${decision === "Approved" ? "Approve" : decision === "Returned" ? "Return" : "Reject"} the assessment of ${p.ParcelCode}?`, message: `${summary}. ${decision === "Approved" ? "Approve only on the applicable law, proposed use, jurisdiction and records — this decides registration eligibility." : ""}`,
      input: { label: decision === "Approved" ? "Reason / legal basis" : "Reason", required: decision !== "Approved" || p.ConversionRequired === "No" || p.ConversionStage === "Post-registration" }, confirmText: decision === "Approved" ? "Approve" : decision, tone: decision === "Approved" ? "default" : "danger" });
    if (r === null) return;
    run(() => decideAssessment(p.ParcelId, decision, r || undefined));
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Pre-registration compliance" }]} />
      <LegalShell stage="prereg" title="Pre-registration compliance" subtitle="Land classification and conversion, parcel by parcel. Bastu: usually no conversion; Shali, Doba and others: the Legal Officer decides; where conversion is needed before registration, Deed Registration waits for the verified conversion order." icon={ShieldTick}>
        <div className="mb-3 grid grid-cols-2 border-l border-t border-border sm:grid-cols-4">
          {tiles.map(([l, n, tone]) => (
            <div key={l} className="border-b border-r border-border bg-card px-3 py-2"><span className="block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">{l}</span><b className={`text-xl tabular-nums ${tone ?? ""}`}>{n ?? "—"}</b></div>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(["blocked", "clear", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`h-8 border px-3 text-xs font-semibold uppercase ${filter === f ? "border-foreground bg-foreground text-background" : "border-border"}`}>
              {f === "blocked" ? "Blocked" : f === "clear" ? "Clear to register" : "All"} · {(q.data?.lands ?? []).filter((l) => f === "all" || (f === "blocked" ? !l.ok : l.ok)).length}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">Final conversion applicability and timing must be confirmed by a West Bengal land-law professional / the competent authority — the system enforces the approved decision.</span>
        </div>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p> : !lands.length ? <p className="text-sm text-muted-foreground">Nothing here.</p> : (
          <div className="space-y-2">
            {lands.map((l: PreRegLand) => (
              <section key={l.LandId} className={`border bg-card ${l.ok ? "border-border" : "border-destructive/50"}`}>
                <button onClick={() => setOpen(open === l.LandId ? null : l.LandId)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left">
                  <b className="font-mono">{l.LandCode}</b><span className="text-sm">{l.LandName ?? ""}</span>
                  <span className="text-xs text-muted-foreground">{[l.EnquiryNo, l.ProjectName, l.MouzaName, l.JLNo && `J.L. ${l.JLNo}`, l.WorkflowStatus].filter(Boolean).join(" · ")}</span>
                  <span className={`ml-auto text-xs font-semibold uppercase ${l.ok ? TONE.Clear : TONE.Blocked}`}>{l.ok ? "Clear to register" : `Blocked · ${l.blockers.length}`}</span>
                </button>
                {!l.ok && open !== l.LandId && <p className="border-t border-border px-3 py-1.5 text-xs text-destructive">{l.blockers[0]}{l.blockers.length > 1 ? ` (+${l.blockers.length - 1} more)` : ""}</p>}
                {open === l.LandId && (
                  <div className="space-y-3 border-t border-border p-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="text-muted-foreground"><tr><th className="py-1">Parcel / Dag</th><th>Current → proposed</th><th>Proposed use</th><th>Conversion</th><th>Assessment</th><th>Pre-reg conversion</th><th>Gate</th><th /></tr></thead>
                        <tbody>
                          {l.parcels.map((p) => (
                            <tr key={p.ParcelId} className="border-t border-border align-top">
                              <td className="py-1.5"><b>{p.ParcelCode}</b><span className="block text-muted-foreground">{[p.RsDagNo && `RS ${p.RsDagNo}`, p.LrDagNo && `LR ${p.LrDagNo}`].filter(Boolean).join(" · ")}</span></td>
                              <td>{p.CurrentClass ?? <span className="text-destructive">not recorded</span>}{p.ProposedClass ? ` → ${p.ProposedClass}` : ""}</td>
                              <td>{p.ProposedLandUse ?? "—"}</td>
                              <td>{p.ConversionRequired ?? "—"}{p.ConversionStage ? <span className="block text-muted-foreground">{p.ConversionStage}</span> : null}</td>
                              <td className={TONE[p.AssessmentStatus] ?? ""}>{p.AssessmentStatus}{p.AssessedByName ? <span className="block text-muted-foreground">{p.AssessedByName}</span> : null}{p.AssessmentRemarks ? <span className="block text-muted-foreground" title={p.AssessmentRemarks}>{p.AssessmentRemarks.slice(0, 60)}</span> : null}</td>
                              <td>{p.ConversionStatus ? <span className={TONE[p.ConversionStatus] ?? ""}>{p.ConversionStatus}</span> : "—"}{p.ApplicationNo ? <span className="block text-muted-foreground">{p.ApplicationNo}{p.TargetDate ? ` · target ${p.TargetDate}` : ""}{p.AssignedName ? ` · ${p.AssignedName}` : ""}</span> : null}</td>
                              <td className={TONE[p.gate]}>{p.gate}{p.blockers.map((b) => <span key={b} className="block text-[0.6875rem]">{b.replace(/^Dag [^:]+: /, "")}</span>)}</td>
                              <td className="whitespace-nowrap">
                                {rights.canEdit && p.AssessmentStatus !== "Approved" && <span className="flex flex-col gap-1">
                                  <button className={small} onClick={() => assess(p, "Approved")}>Approve assessment</button>
                                  <button className={`${small} text-destructive`} onClick={() => assess(p, "Returned")}>Return</button>
                                </span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <details className="border border-border">
                      <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold">Edit parcels — classification, proposed use, conversion required / stage, reason</summary>
                      <div className="p-2"><LegalMasterTable entry={{ pageKey: LAND_PAGE, key: "land-parcel", label: "Land Parcel" }} parentId={l.LandId} noAdd={!rights.canCreate} onSaved={refresh} /></div>
                    </details>
                    {l.parcels.some((p) => p.ConversionRequired === "Yes" && p.ConversionStage === "Pre-registration") && (
                      <div className="border border-border p-2">
                        <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider">Pre-registration conversion applications</p>
                        <p className="mb-2 text-xs text-muted-foreground">Submitting the application is not completion: record the order (number, date, copy), send it for verification; another user verifies it.</p>
                        <LegalMasterTable entry={{ pageKey: LAND_PAGE, key: "prereg-conversion", label: "Pre-registration Conversion" }} parentId={l.LandId} noAdd={!rights.canCreate} onSaved={refresh}
                          rowActions={(raw) => {
                            const st = String(raw.ConversionStatus), id = Number(raw.ConversionId);
                            return (
                              <span className="flex gap-1">
                                {["Order Received", "Returned for Correction"].includes(st) && rights.canEdit && <button className={small} onClick={(e) => { e.stopPropagation(); run(() => submitPreRegConversion(id)); }}>Send for verification</button>}
                                {st === "Submitted for Verification" && <>
                                  <button className={small} onClick={async (e) => { e.stopPropagation(); const r = await askLegal({ title: "Verify the conversion order?", message: "Confirm the order matches the parcel, classification and use.", input: { label: "Remarks (optional)" }, confirmText: "Verify" }); if (r === null) return; run(() => verifyPreRegConversion(id, "Verified", r || undefined)); }}>Verify</button>
                                  <button className={`${small} text-destructive`} onClick={async (e) => { e.stopPropagation(); const r = await askLegal({ title: "Return for correction?", input: { label: "Reason", required: true }, confirmText: "Return", tone: "danger" }); if (!r) return; run(() => verifyPreRegConversion(id, "Returned", r)); }}>Return</button>
                                </>}
                              </span>
                            );
                          }} />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Conversion allowed after registration → tracked in <button className="underline" onClick={() => navigate("/legal/land/post-registration")}>Post-registration</button> (opened when the assessment is approved). Mutation is a separate process there.</p>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </LegalShell>
    </>
  );
}

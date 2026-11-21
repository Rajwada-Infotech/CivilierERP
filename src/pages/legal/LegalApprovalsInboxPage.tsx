import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardTick } from "iconsax-react";
import { CheckCircle2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { AmendmentDecision } from "@/components/legal/LandAmendmentPanel";
import { LandReviewFlow, ReviewDecision } from "@/components/legal/LandReviewFlow";
import { getReviewQueue } from "@/api/legalFlowApi";
import { LandSummary } from "@/components/legal/LandSummary";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { approveDeedProcess, getDeedProcessLands, getLandPendingPage, reverifyDeedChanges, type DeedProcessLand } from "@/api/legalLandApi";
import { usePaged } from "@/components/legal/usePaged";
import { getPendingAmendments } from "@/api/legalAmendmentApi";

/**
 * Approvals — one inbox for everything waiting for a decision in the Legal module:
 *   Final verification · Re-verification of changes · Deed approval · Amendments (after registration)
 * Each item shows the land and acts in place (or opens the land's full verification screen when that needs every detail).
 */
type Tab = "verify" | "landverify" | "versions" | "reverify" | "approve" | "amend";
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "landverify", label: "Land verification", hint: "Lands sent by data entry — open, check every section, tick it, then submit for approval (or send back to correct)" },
  { key: "versions", label: "Versions", hint: "Verified lands — approve to save the next version. A new land's first approved version moves it to Deed Process" },
  { key: "approve", label: "Deed approval", hint: "Deed Process done and sent for final approval — approve to move the land to Deed Registration" },
  { key: "amend", label: "Amendments", hint: "Registered lands that need a change — approve to open the land for editing; the edits then come back through Land verification" },
];

const btn = "h-8 border px-3 text-xs font-semibold uppercase tracking-[0.06em] disabled:opacity-40";
const when = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function Empty({ text }: { text: string }) {
  return (
    <div className="border border-border bg-card p-10 text-center">
      <CheckCircle2 className="mx-auto mb-2 h-9 w-9 text-emerald-600/60" />
      <p className="text-sm font-semibold">Nothing waiting</p>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

/** One land card in the inbox: who / what / since, the full summary on demand, and the actions. */
function Card({ landId, code, name, place, since, note, children, onOpen }: {
  landId: number; code: string; name: string; place?: string | null; since?: string | null; note?: React.ReactNode; children?: React.ReactNode; onOpen: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={`border bg-card p-3 ${show ? "border-foreground" : "border-border"}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <button onClick={onOpen} className="text-left hover:underline"><b className="font-mono">{code}</b> · {name}</button>
        <span className="text-xs text-muted-foreground">{place}</span>
        <span className="ml-auto flex items-center gap-3">
          {since && <span className="text-xs text-muted-foreground">since {when(since)}</span>}
          <button onClick={() => setShow((x) => !x)} aria-expanded={show}
            className={`${btn} ${show ? "border-foreground bg-foreground text-background" : "border-foreground/40 hover:border-foreground"}`}>{show ? "Close summary ▴" : "Open summary ▾"}</button>
        </span>
      </div>
      {show && <div className="mt-3"><LandSummary landId={landId} /></div>}
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** Approve / Hold / Reject a deed, with a remark. */
function DeedDecision({ land }: { land: DeedProcessLand }) {
  const qc = useQueryClient();
  const [remark, setRemark] = useState("");
  const act = useMutation({
    mutationFn: (a: "Approve" | "Hold" | "Reject") => approveDeedProcess(land.LandId, a, remark.trim() || undefined),
    onSuccess: (r) => { toast.success(r.message); setRemark(""); qc.invalidateQueries({ queryKey: ["legal-deed-process"] }); qc.invalidateQueries({ queryKey: ["legal-flow"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remark (needed to hold or reject)" className="h-8 flex-1 border border-foreground/30 bg-background px-2 text-sm" />
      <div className="flex gap-2">
        <button disabled={act.isPending || !remark.trim()} onClick={() => act.mutate("Reject")} className={`${btn} border-destructive text-destructive hover:bg-destructive hover:text-white`}>Reject</button>
        <button disabled={act.isPending || !remark.trim()} onClick={() => act.mutate("Hold")} className={`${btn} border-amber-600 text-amber-700 hover:bg-amber-600 hover:text-white`}>Hold</button>
        <button disabled={act.isPending} onClick={() => act.mutate("Approve")} className={`${btn} border-emerald-700 bg-emerald-700 text-white hover:opacity-90`}>Approve</button>
      </div>
    </div>
  );
}

export default function LegalApprovalsInboxPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [verifying, setVerifying] = useState<number | null>(null);
  // Tab counts: one-row pages of each kind (their totals). The open tab: one page (20) from the server.
  const cVerify = usePaged(["legal-land-pending-queue", "count"], (qs) => getLandPendingPage(qs), { kind: "verify", pageSize: 1 });
  const cRe = usePaged(["legal-deed-process", "count", "reverify"], (qs) => getDeedProcessLands(qs), { kind: "reverify", pageSize: 1 });
  const cAp = usePaged(["legal-deed-process", "count", "approve"], (qs) => getDeedProcessLands(qs), { kind: "approve", pageSize: 1 });
  const cLv = usePaged(["legal-review-queue", "count", "verify"], (qs) => getReviewQueue(qs), { kind: "verify", pageSize: 1 });
  const cVer = usePaged(["legal-review-queue", "count", "approve"], (qs) => getReviewQueue(qs), { kind: "approve", pageSize: 1 });
  const cAm = usePaged(["legal-amend", "pending", "count"], (qs) => getPendingAmendments(qs), { pageSize: 1 });
  const reverify = useMutation({
    mutationFn: (id: number) => reverifyDeedChanges(id),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ["legal-deed-process"] }); qc.invalidateQueries({ queryKey: ["legal-flow"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts: Record<Tab, number> = { verify: cVerify.total, landverify: cLv.total, versions: cVer.total, reverify: cRe.total, approve: cAp.total, amend: cAm.total };
  const first = (TABS.find((t) => counts[t.key] > 0)?.key ?? "landverify") as Tab;
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? first) as Tab;
  const loading = cVerify.isLoading || cRe.isLoading || cAp.isLoading || cVer.isLoading || cLv.isLoading || cAm.isLoading;
  const verifyL = usePaged(["legal-land-pending-queue"], (qs) => getLandPendingPage(qs), { kind: "verify", enabled: tab === "verify" });
  const isDeedTab = tab === "reverify" || tab === "approve";
  const deedL = usePaged(["legal-deed-process", "inbox", tab], (qs) => getDeedProcessLands(qs), { kind: isDeedTab ? tab : undefined, enabled: isDeedTab });
  const lvL = usePaged(["legal-review-queue", "verify"], (qs) => getReviewQueue(qs), { kind: "verify", enabled: tab === "landverify" });
  const verL = usePaged(["legal-review-queue", "approve"], (qs) => getReviewQueue(qs), { kind: "approve", enabled: tab === "versions" });
  const amendL = usePaged(["legal-amend", "pending"], (qs) => getPendingAmendments(qs), { enabled: tab === "amend" });
  const verify = verifyL.data?.items ?? [];
  const deedRows = deedL.data?.lands ?? [];
  const changed = deedRows;
  const amends = amendL.data?.items ?? [];
  const deedQ = { data: deedL.data ?? cAp.data };
  const amendQ = { data: amendL.data ?? cAm.data };
  const active = tab === "verify" ? verifyL : tab === "versions" ? verL : tab === "landverify" ? lvL : isDeedTab ? deedL : amendL;
  const open = (id: number) => navigate(`/legal/land/properties/${id}`);
  const place = (l: { MouzaName?: string | null; DistrictName?: string | null }) => [l.MouzaName, l.DistrictName].filter(Boolean).join(", ");

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Approvals" }]} />
      <LegalShell stage={tab === "verify" ? "verify" : undefined} title="Approvals" subtitle="Land verification → Versions → Deed approval, and Amendments for registered lands." icon={ClipboardTick}>
        <div className="space-y-4">
          {/* One tab per kind of approval, with how many are waiting. */}
          <div className="grid grid-cols-2 border border-border bg-card sm:grid-cols-4" role="tablist">
            {TABS.map((t, i) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setParams({ tab: t.key })}
                className={`relative px-3 py-3 text-left ${tab === t.key ? "bg-primary/5" : "hover:bg-primary/5"} ${i ? "border-l border-border" : ""}`}>
                <span className="block text-2xl font-heading font-bold tabular-nums">{loading ? "…" : counts[t.key]}</span>
                <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">{t.label}</span>
                <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: tab === t.key ? "hsl(var(--foreground))" : "transparent" }} />
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{TABS.find((t) => t.key === tab)?.hint}</p>
          {active.search("Search land ID, name, mouza…")}

          {tab === "verify" && (verify.length ? verify.map((l) => (
            <Card key={l.LandId} landId={l.LandId} code={l.LandCode} name={l.LandName} place={place(l)} since={l.CreatedAt} onOpen={() => open(l.LandId)}
              note={`${l.Area ?? "—"} ${l.UnitName ?? ""} · waiting ${l.WaitingDays} day${l.WaitingDays === 1 ? "" : "s"}`}>
              <button onClick={() => navigate(`/legal/land/properties/${l.LandId}/final-verify`)} className={`${btn} border-foreground bg-foreground text-background hover:opacity-90`}>Open & verify →</button>
            </Card>
          )) : <Empty text="No land is waiting for final verification." />)}

          {tab === "landverify" && (() => {
            const rows = lvL.data?.items ?? [];
            const want = Number(params.get("land")) || null;
            // A land opened by link (land profile / Approvals → Versions) is shown even when it is not in the list.
            const ids = want && !rows.some((r) => r.LandId === want) ? [want, ...rows.map((r) => r.LandId)] : rows.map((r) => r.LandId);
            return ids.length ? ids.map((id) => {
              const r = rows.find((x) => x.LandId === id);
              const on = verifying === id || (verifying === null && want === id);
              return (
                <div key={id} className={`border bg-card ${on ? "border-foreground" : "border-border"}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <button onClick={() => open(id)} className="text-left hover:underline"><b className="font-mono">{r?.LandCode ?? `Land ${id}`}</b>{r ? ` · ${r.LandName}` : ""}</button>
                    <span className="text-xs text-muted-foreground">{[r?.MouzaName, r?.WorkflowStatus, r ? `Version ${r.VersionNo}` : ""].filter(Boolean).join(" · ")}</span>
                    <button onClick={() => setVerifying(on ? 0 : id)} className={`${btn} ml-auto ${on ? "border-foreground bg-foreground text-background" : "border-foreground/40 hover:border-foreground"}`}>{on ? "Close ▴" : "Open & verify ▾"}</button>
                  </div>
                  {on && <div className="border-t border-border p-3"><LandReviewFlow landId={id} /></div>}
                </div>
              );
            }) : <Empty text="No land is waiting for verification." />;
          })()}

          {tab === "versions" && ((verL.data?.items ?? []).length ? (verL.data?.items ?? []).map((r) => (
            <Card key={r.LandId} landId={r.LandId} code={r.LandCode} name={r.LandName} place={r.MouzaName} since={r.Since} onOpen={() => open(r.LandId)}
              note={<>Version {r.VersionNo} · verified by {r.ByName ?? "—"} · <button className="underline" onClick={() => navigate(`/legal/approvals?tab=landverify&land=${r.LandId}`)}>see the checked sections</button></>}>
              {verL.data?.canApprove ? <ReviewDecision landId={r.LandId} versionNo={r.VersionNo} /> : <p className="text-xs text-muted-foreground">Only an Approver (Setup → Approval Control) can approve.</p>}
            </Card>
          )) : <Empty text="No land version is waiting for approval." />)}

          {tab === "reverify" && (changed.length ? changed.map((l) => (
            <Card key={l.LandId} landId={l.LandId} code={l.LandCode} name={l.LandName} place={place(l)} since={l.DeedChangedAt} onOpen={() => open(l.LandId)}
              note={`Changed after verification${l.DeedChangedByName ? ` by ${l.DeedChangedByName}` : ""}. Check the land's Versions tab, then confirm.`}>
              <div className="flex gap-2">
                <button onClick={() => navigate(`/legal/land/properties/${l.LandId}?tab=versions`)} className={`${btn} border-foreground/40 hover:border-foreground`}>See changes</button>
                <button disabled={reverify.isPending} onClick={() => reverify.mutate(l.LandId)} className={`${btn} border-emerald-700 bg-emerald-700 text-white hover:opacity-90`}>Re-verify</button>
              </div>
            </Card>
          )) : <Empty text="No verified land has been changed." />)}

          {tab === "approve" && (deedRows.length ? deedRows.map((l) => (
            <Card key={l.LandId} landId={l.LandId} code={l.LandCode} name={l.LandName} place={place(l)} since={l.FinalVerifiedAt} onOpen={() => open(l.LandId)}
              note={<>Deed target {when(l.DeedTargetDate)}{l.DeedFileId ? <> · deed copy: <LegalFileLink id={l.DeedFileId} name={l.DeedFileName ?? "Deed copy"} /></> : " · deed copy not uploaded yet"}
                {l.DeedApprovalNote ? ` · note: ${l.DeedApprovalNote}` : ""}{l.L1Status && l.L1Status !== "Pending" ? ` · now ${l.L1Status}` : ""}</>}>
              {deedQ.data?.canApprove ? <DeedDecision land={l} /> : <p className="text-xs text-muted-foreground">Only an Approver (Setup → Approval Control) can decide.</p>}
            </Card>
          )) : <Empty text="No deed is waiting for approval." />)}

          {tab === "amend" && (amends.length ? amends.map((a) => (
            <div key={a.AmendmentId} className="space-y-1">
              <Card landId={a.LandId} code={a.LandCode} name={a.LandName} since={a.RequestedAt} onOpen={() => open(a.LandId)} note="Registered land — summary shows it as it is now, before this amendment." />
              <AmendmentDecision a={a} canApprove={!!amendQ.data?.canApprove} userId={amendQ.data?.userId} />
            </div>
          )) : <Empty text="No amendment is waiting for approval." />)}
          {active.pager}
        </div>
      </LegalShell>
    </>
  );
}

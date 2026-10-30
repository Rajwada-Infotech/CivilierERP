import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Global } from "iconsax-react";
import { AlertTriangle, ChevronLeft, ChevronRight, Lock, Pause, Play } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell, LEGAL_GRADIENT } from "@/components/legal/LegalShell";
import { LandPipelineSidebar, StatusBadge } from "@/components/legal/land/LandPipelineSidebar";
import { usePageRights } from "@/hooks/usePageRights";
import { getLandAudit, getLandPipeline, holdLand, moveLandStep, resumeLand, type PipelineStep, type StepStatus } from "@/api/legalLandApi";
import { LegalMasterTable } from "../LegalMasterPage";

// One land property: header, the pipeline on the left, the selected step on the right.
// Every move is checked again by the server (order, gates, hold, rights).

const card = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";
const eyebrow = "mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50";

const PHASES: Record<number, string> = { 2: "Ownership & Documents", 3: "Legal Verification", 4: "Purchase & Sale", 5: "Deed & Registration", 6: "Mutation & Closure" };

export default function LandPropertyDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rights = usePageRights("legal-land-master");
  const { data, error, isLoading } = useQuery({ queryKey: ["legal-land", id], queryFn: () => getLandPipeline(id), enabled: id > 0 });
  const [selected, setSelected] = useState<string>("");
  const [tab, setTab] = useState<"step" | "audit">("step");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [hold, setHold] = useState({ category: "", reason: "", expectedReviewDate: "" });

  // Open on the first unfinished step.
  useEffect(() => {
    if (data && !selected) setSelected((data.steps.find((s) => s.live && !["Completed", "Skipped"].includes(s.status)) ?? data.steps[0]).code);
  }, [data, selected]);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["legal-land", id] }),
    queryClient.invalidateQueries({ queryKey: ["legal-land-audit", id] }),
    queryClient.invalidateQueries({ queryKey: ["legal-land-stats"] }),
  ]);

  const act = async (fn: () => Promise<{ message: string; reverify?: string[] }>) => {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(r.message);
      if (r.reverify?.length) toast.warning(`Sent back for re-verification: ${r.reverify.join(", ")}`);
      setRemarks("");
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="p-6 text-destructive">{(error as Error).message}</div>;
  if (isLoading || !data) return <div className="p-6 text-muted-foreground">Loading land property…</div>;

  const { land } = data;
  const step = data.steps.find((s) => s.code === selected) ?? data.steps[0];
  const idx = data.steps.indexOf(step);
  const move = (status: StepStatus, extra: { skipReason?: string } = {}) =>
    act(() => moveLandStep(id, step.code, { status, remarks: remarks.trim() || undefined, ...extra }));

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Land Properties", path: "/legal/land/properties" }, { label: land.LandCode }]} />
      <LegalShell
        title={`${land.LandCode} · ${land.LandName}`}
        subtitle={[land.MouzaName && `${land.MouzaName} (J.L. ${land.JLNo ?? "-"})`, land.DistrictName, land.Area != null && `${Number(land.Area)} ${land.UnitName ?? ""}`].filter(Boolean).join(" · ")}
        icon={Global}
        action={rights.canApprove ? (
          land.IsOnHold
            ? <button className={btn} disabled={busy} onClick={() => { const r = window.prompt("Why is this land resumed?"); if (r?.trim()) act(() => resumeLand(id, r.trim())); }}><Play size={13} /> Resume</button>
            : <button className={btn} disabled={busy} onClick={() => setHoldOpen((v) => !v)}><Pause size={13} /> Put on hold</button>
        ) : undefined}
      >
        <div className="space-y-4">
          {/* ── Header strip ── */}
          <div className={`${card} p-4`}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span><span className="text-muted-foreground">Workflow:</span> <b>{land.WorkflowStatus ?? "—"}</b></span>
              <span><span className="text-muted-foreground">Land status:</span> {land.LandStatus}</span>
              {land.EnquiryNo && <span><span className="text-muted-foreground">Enquiry:</span> {land.EnquiryNo}</span>}
              <span><span className="text-muted-foreground">Parties:</span> {data.counts.parties}</span>
              <span><span className="text-muted-foreground">RS / LR records:</span> {data.counts.rs} / {data.counts.lr} ({data.counts.recordsVerified} verified)</span>
              {!land.IsActive && <span className="text-rose-600">Inactive</span>}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${data.progress}%`, background: LEGAL_GRADIENT }} /></div>
              <span className="text-xs tabular-nums text-muted-foreground">{data.progress}%</span>
            </div>
            {data.hold && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <b>On hold — {data.hold.HoldCategory}:</b> {data.hold.HoldReason}
                {data.hold.HeldByName && <> · by {data.hold.HeldByName}</>}
                {data.hold.ExpectedReviewDate && <> · review by {String(data.hold.ExpectedReviewDate).slice(0, 10)}</>}
              </div>
            )}
            {data.warnings.map((w) => (
              <div key={w} className="mt-2 flex items-start gap-2 text-sm text-amber-600"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}</div>
            ))}
            {holdOpen && !land.IsOnHold && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <select className="rounded-lg border border-border bg-muted px-2 py-1.5 text-sm" value={hold.category} onChange={(e) => setHold({ ...hold, category: e.target.value })}>
                  <option value="">Hold category…</option>
                  {data.holdCategories.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input className="rounded-lg border border-border bg-muted px-2 py-1.5 text-sm sm:col-span-2" placeholder="Hold reason" value={hold.reason} onChange={(e) => setHold({ ...hold, reason: e.target.value })} />
                <label className="text-xs text-muted-foreground">Expected review date
                  <input type="date" className="mt-1 block w-full rounded-lg border border-border bg-muted px-2 py-1.5 text-sm" value={hold.expectedReviewDate} onChange={(e) => setHold({ ...hold, expectedReviewDate: e.target.value })} />
                </label>
                <div className="flex items-end gap-2 sm:col-span-2">
                  <button className={btn} disabled={busy} onClick={async () => { if (await act(() => holdLand(id, { ...hold, expectedReviewDate: hold.expectedReviewDate || undefined }))) setHoldOpen(false); }}>Confirm hold</button>
                  <button className={btn} onClick={() => setHoldOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className={`${card} p-2 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`}>
              <LandPipelineSidebar steps={data.steps} selected={step.code} onSelect={(c) => { setSelected(c); setTab("step"); }} />
            </div>

            <div className="min-w-0 space-y-4">
              <div className={`${card} p-4 sm:p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={eyebrow}>Step {step.stepNo} of {data.steps.length}</p>
                    <h3 className="-mt-1 text-lg font-heading font-semibold text-foreground">{step.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={step.status} />
                    <button className={btn} onClick={() => setTab(tab === "audit" ? "step" : "audit")}>{tab === "audit" ? "Back to step" : "Audit trail"}</button>
                  </div>
                </div>
                {step.skipReason && <p className="mt-2 text-sm text-muted-foreground">Skipped: {step.skipReason}</p>}
                {step.remarks && !step.skipReason && <p className="mt-2 text-sm text-muted-foreground">Remarks: {step.remarks}</p>}
                {step.live && step.missing.length > 0 && (
                  <ul className="mt-3 space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                    {step.missing.map((m) => <li key={m} className="flex gap-2"><span className="text-amber-600">•</span>{m}</li>)}
                  </ul>
                )}

                {step.live && rights.canEdit && !land.IsOnHold && tab === "step" && (
                  <StepActions step={step} busy={busy} canApprove={rights.canApprove} remarks={remarks} setRemarks={setRemarks} move={move} />
                )}
              </div>

              {tab === "audit" ? <AuditTrail id={id} /> : <StepContent step={step} landId={id} mouzaId={land.MouzaId} onSaved={refresh} navigate={navigate} enquiryNo={land.EnquiryNo} />}

              <div className="flex justify-between">
                <button className={btn} disabled={idx <= 0} onClick={() => setSelected(data.steps[idx - 1].code)}><ChevronLeft size={13} /> Back</button>
                <button className={btn} disabled={idx >= data.steps.length - 1} onClick={() => setSelected(data.steps[idx + 1].code)}>Next <ChevronRight size={13} /></button>
              </div>
            </div>
          </div>
        </div>
      </LegalShell>
    </>
  );
}

const StepActions: React.FC<{
  step: PipelineStep; busy: boolean; canApprove: boolean; remarks: string; setRemarks: (v: string) => void;
  move: (s: StepStatus, extra?: { skipReason?: string }) => void;
}> = ({ step, busy, canApprove, remarks, setRemarks, move }) => {
  if (step.locked && !["Completed", "Skipped"].includes(step.status)) {
    return <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Lock size={14} /> Finish the earlier steps first.</p>;
  }
  const done = ["Completed", "Skipped"].includes(step.status);
  return (
    <div className="mt-4 space-y-2">
      <textarea
        className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm"
        rows={2}
        placeholder={done ? "Why is this step reopened? (finished steps after it go back for re-verification)" : "Remarks (needed for Correction Required)"}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {done ? (
          <button className={btn} disabled={busy} onClick={() => move("In Progress")}>Reopen</button>
        ) : (
          <>
            {step.status !== "In Progress" && <button className={btn} disabled={busy} onClick={() => move("In Progress")}>Start</button>}
            {step.status !== "Pending Verification" && <button className={btn} disabled={busy} onClick={() => move("Pending Verification")}>Submit for verification</button>}
            <button className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: LEGAL_GRADIENT }} disabled={busy || step.missing.length > 0} onClick={() => move("Completed")}>
              Mark completed
            </button>
            {canApprove && step.status === "Pending Verification" && <button className={btn} disabled={busy || !remarks.trim()} onClick={() => move("Correction Required")}>Correction required</button>}
            {canApprove && step.skippable && (
              <button className={btn} disabled={busy} onClick={() => { const r = window.prompt("Reason for skipping this step"); if (r?.trim()) move("Skipped", { skipReason: r.trim() }); }}>Skip…</button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const StepContent: React.FC<{
  step: PipelineStep; landId: number; mouzaId: number | null; onSaved: () => void; navigate: (p: string) => void; enquiryNo: string | null;
}> = ({ step, landId, mouzaId, onSaved, navigate, enquiryNo }) => {
  const defaults = mouzaId ? { MouzaId: String(mouzaId) } : {};
  const land = { pageKey: "legal-land-master" };
  if (!step.live) {
    return (
      <div className={`${card} p-6 text-sm text-muted-foreground`}>
        This step arrives with <b>Phase {step.phase} — {PHASES[step.phase]}</b> of the Legal module. Its status, history and gates are already tracked here.
      </div>
    );
  }
  switch (step.code) {
    case "ENQUIRY":
      return (
        <div className={`${card} p-5 text-sm`}>
          {enquiryNo ? <>This land was converted from enquiry <b>{enquiryNo}</b>.</> : "No enquiry is linked. If the land was entered directly, an approver can skip this step with a reason."}
          <button className={`${btn} ml-3`} onClick={() => navigate("/legal/land/enquiries")}>Land enquiries</button>
        </div>
      );
    case "PROPERTY":
      return (
        <div className={`${card} p-5 text-sm`}>
          Land details, location, boundaries, GPS and map are kept on the Land Property Master.
          <button className={`${btn} ml-3`} onClick={() => navigate(`/legal/land/properties?edit=${landId}`)}>Edit land property</button>
        </div>
      );
    case "PARTIES":
      return <div className={card}><LegalMasterTable entry={{ ...land, key: "land-party", label: "Owners & Sellers" }} parentId={landId} onSaved={onSaved} /></div>;
    case "RECORD_MAPPING":
      return (
        <div className="space-y-4">
          <div className={card}><LegalMasterTable entry={{ ...land, key: "land-rs-record", label: "RS Records" }} parentId={landId} defaults={defaults} onSaved={onSaved} /></div>
          <div className={card}><LegalMasterTable entry={{ ...land, key: "land-lr-record", label: "LR Records of Rights" }} parentId={landId} defaults={defaults} onSaved={onSaved} /></div>
        </div>
      );
    default:
      return null;
  }
};

const AuditTrail: React.FC<{ id: number }> = ({ id }) => {
  const { data, isLoading } = useQuery({ queryKey: ["legal-land-audit", id], queryFn: () => getLandAudit(id) });
  const short = (v: string | null) => {
    if (!v) return "";
    try { return Object.entries(JSON.parse(v)).map(([k, x]) => `${k}: ${x ?? "—"}`).join(", "); } catch { return v; }
  };
  return (
    <div className={`${card} p-4 sm:p-5`}>
      <p className={eyebrow}>Audit trail</p>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !data?.length ? <p className="text-sm text-muted-foreground">No events yet.</p> : (
        <div className="divide-y divide-border/60 text-sm">
          {data.map((e) => (
            <div key={e.EventId} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span><b>{e.Action}</b> <span className="text-muted-foreground">· {e.EntityType}{e.EntityId ? ` #${e.EntityId}` : ""}</span></span>
                <span className="text-xs text-muted-foreground">{e.UserName ?? "System"} · {new Date(e.CreatedAt).toLocaleString("en-IN")}</span>
              </div>
              {(e.OldValue || e.NewValue) && (
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {e.OldValue && <>From {short(e.OldValue)} </>}{e.NewValue && <>→ {short(e.NewValue)}</>}
                </p>
              )}
              {e.Remarks && <p className="mt-0.5 text-xs">{e.Remarks}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

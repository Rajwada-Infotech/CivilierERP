import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, ListChecks, Plus, Trash2 } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalRows } from "@/api/legalMastersApi";
import { getLandRegister, initFinalChecks, recordOwnershipTransfer, updateLandRegister, type LandPipeline } from "@/api/legalLandApi";
import { LEGAL_GRADIENT } from "@/components/legal/LegalShell";
import { StepTabs, stepCard } from "./StepTabs";
import { FinancialSummary } from "./PurchaseDeedSteps";

// Phase 6 pipeline steps (23–31): ownership transfer, mutation, new Khatian, final verification, financial
// settlement, land register, audit & reports, and closure. Registration, mutation and closure are separate
// milestones — a registered deed is not a completed mutation, and neither closes the transaction.

type StepProps = { landId: number; onSaved: () => void };
const eyebrow = "mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground";
const input = "w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50";
const fmt = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

/** Step 23: who sells what share, who buys what share, from the approved registered deed. */
const TransferForm: React.FC<StepProps> = ({ landId, onSaved }) => {
  const rights = usePageRights("legal-land-master");
  const queryClient = useQueryClient();
  const owners = useQuery({ queryKey: ["legal-master", "ownership-record", landId], queryFn: () => getLegalRows("ownership-record", landId) });
  const deeds = useQuery({ queryKey: ["legal-master", "registered-deed", landId], queryFn: () => getLegalRows("registered-deed", landId) });
  const current = (owners.data ?? []).filter((r) => r.IsActive && !r.ValidTo);
  const approved = (deeds.data ?? []).filter((d) => d.IsActive && d.ApprovalStatus === "Approved");
  const [deedId, setDeedId] = useState("");
  const [date, setDate] = useState("");
  const purchases = useQuery({ queryKey: ["legal-master", "land-purchase", landId], queryFn: () => getLegalRows("land-purchase", landId) });
  const [sell, setSell] = useState<Record<string, string>>({});
  const [buyers, setBuyers] = useState([{ name: "", guardian: "", share: "" }]);
  // Pre-fill from the purchase: every current owner gives their whole share to the purchase's buyer.
  const [prefilled, setPrefilled] = useState(false);
  React.useEffect(() => {
    if (prefilled || !current.length || !purchases.data) return;
    const p = purchases.data.find((x) => x.IsActive && x.TxnStatus !== "Cancelled");
    setSell(Object.fromEntries(current.map((o) => [String(o.RecordId), String(Number(o.SharePct))])));
    if (p) setBuyers([{ name: String(p.BuyerName ?? ""), guardian: "", share: String(current.reduce((a, o) => a + Number(o.SharePct), 0)) }]);
    setPrefilled(true);
  }, [prefilled, current, purchases.data]);
  const [busy, setBusy] = useState(false);
  if (!rights.canEdit) return null;
  if (!approved.length) return <div className={`${stepCard} p-5 text-sm text-muted-foreground`}>The transfer is recorded from an <b>approved registered deed</b> (step 22). None yet.</div>;

  const sellers = Object.entries(sell).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ recordId: Number(id), sharePct: Number(v) }));
  const out = sellers.reduce((a, x) => a + x.sharePct, 0);
  const into = buyers.reduce((a, x) => a + (Number(x.share) || 0), 0);
  const save = async () => {
    setBusy(true);
    try {
      toast.success((await recordOwnershipTransfer(landId, {
        registeredDeedId: Number(deedId), transferDate: date, sellers,
        buyers: buyers.filter((b) => b.name.trim()).map((b) => ({ name: b.name.trim(), guardian: b.guardian.trim() || undefined, sharePct: Number(b.share) })),
      })).message);
      setSell({}); setBuyers([{ name: "", guardian: "", share: "" }]);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the transfer");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`${stepCard} p-4 sm:p-5`}>
      <p className={eyebrow}>Record the ownership transfer</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">Registered deed *
          <select className={`${input} mt-1`} value={deedId} onChange={(e) => {
            setDeedId(e.target.value);
            const d = approved.find((x) => String(x.RegisteredId) === e.target.value);
            if (d && !date) setDate(String(d.RegistrationDate).slice(0, 10));
          }}>
            <option value="">Select…</option>
            {approved.map((d) => <option key={String(d.RegisteredId)} value={String(d.RegisteredId)}>{String(d.RegisteredDeedNo)} · {fmt(d.RegistrationDate)}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">Transfer date *<input type="date" className={`${input} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <p className="mt-4 text-xs font-medium text-foreground">Selling owners — share each one transfers (partial is fine; the rest stays with them)</p>
      <div className="mt-2 space-y-2">
        {current.map((o) => (
          <div key={String(o.RecordId)} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-[200px] flex-1">{String(o.OwnerName)} <span className="text-xs text-muted-foreground">holds {Number(o.SharePct)}%</span></span>
            <input className={`${input} w-28`} type="number" min={0} max={Number(o.SharePct)} placeholder="Share %" value={sell[String(o.RecordId)] ?? ""}
              onChange={(e) => setSell({ ...sell, [String(o.RecordId)]: e.target.value })} />
          </div>
        ))}
        {!current.length && <p className="text-xs text-amber-600">No current owners recorded (step 5).</p>}
      </div>
      <p className="mt-4 text-xs font-medium text-foreground">New owners</p>
      <div className="mt-2 space-y-2">
        {buyers.map((b, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_110px_auto]">
            <input className={input} placeholder="New owner name" value={b.name} onChange={(e) => setBuyers(buyers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className={input} placeholder="Father / husband (optional)" value={b.guardian} onChange={(e) => setBuyers(buyers.map((x, j) => (j === i ? { ...x, guardian: e.target.value } : x)))} />
            <input className={input} type="number" min={0} max={100} placeholder="Share %" value={b.share} onChange={(e) => setBuyers(buyers.map((x, j) => (j === i ? { ...x, share: e.target.value } : x)))} />
            <button className="text-muted-foreground hover:text-destructive disabled:opacity-30" disabled={buyers.length === 1} onClick={() => setBuyers(buyers.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={14} /></button>
          </div>
        ))}
        <button className={btn} onClick={() => setBuyers([...buyers, { name: "", guardian: "", share: "" }])}><Plus size={12} /> Add new owner</button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-50" style={{ background: LEGAL_GRADIENT }}
          disabled={busy || !deedId || !date || !sellers.length || Math.abs(out - into) > 0.0001} onClick={save}>Record transfer</button>
        <span className={`text-xs ${Math.abs(out - into) > 0.0001 ? "text-amber-600" : "text-muted-foreground"}`}>Sold {out}% · bought {into}%{Math.abs(out - into) > 0.0001 ? " — must be equal" : ""}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Earlier owners are never overwritten: their records end the day before, and new records start Pending verification.</p>
    </div>
  );
};

export const OwnershipTransferStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "new", label: "Record transfer", content: <TransferForm {...p} /> },
    { key: "records", label: "Verify new records", tables: [{ key: "ownership-record", label: "Ownership Records" }, { key: "ownership-event", label: "Transfer History" }] },
  ]} />
);
export const MutationStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "app", label: "Mutation application", tables: [{ key: "mutation", label: "Mutation" }],
      note: "Tracked apart from registration — a registered deed is not a completed mutation. Approved / Rejected is set by a reviewer, with the order number." },
    { key: "hear", label: "Hearings & objections", tables: [{ key: "mutation-hearing", label: "Mutation Hearings" }] },
  ]} />
);
export const NewKhatianStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "ror", label: "New Khatian / RoR", tables: [{ key: "mutation-record", label: "New Khatian / RoR" }],
      note: "The old RS / LR records stay as history (step 4)." },
  ]} />
);

const Milestones: React.FC<{ m?: LandPipeline["milestones"] }> = ({ m }) => !m ? null : (
  <div className={`${stepCard} grid gap-3 p-4 sm:grid-cols-4`}>
    {([["Registered deed", m.deedRegistered], ["Mutation completed", m.mutationCompleted], ["Settlement approved", m.settlementApproved], ["Transaction closed", m.transactionClosed]] as const).map(([label, ok]) => (
      <div key={label} className="flex items-center gap-2 text-sm">
        {ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Circle size={16} className="text-muted-foreground" />}
        <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
      </div>
    ))}
  </div>
);

const FinalChecksSetup: React.FC<StepProps> = ({ landId, onSaved }) => {
  const rights = usePageRights("legal-land-master");
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["legal-master", "final-check", landId], queryFn: () => getLegalRows("final-check", landId) });
  const [busy, setBusy] = useState(false);
  if (!rights.canEdit || (data && data.length >= 9)) return null;
  return (
    <div className={`${stepCard} flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}>
      <span className="text-muted-foreground">{data?.length ? `${data.length} of 9 checks on the list.` : "No final checks yet."}</span>
      <button className={btn} disabled={busy} onClick={async () => {
        setBusy(true);
        try { toast.success((await initFinalChecks(landId)).message); await queryClient.invalidateQueries({ queryKey: ["legal-master", "final-check"] }); onSaved(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Could not create the checklist"); } finally { setBusy(false); }
      }}><ListChecks size={13} /> Add all 9 checks</button>
    </div>
  );
};

export const FinalVerifyStep: React.FC<StepProps & { milestones?: LandPipeline["milestones"] }> = ({ milestones, ...p }) => (
  <StepTabs {...p} tabs={[
    { key: "final", label: "Final verification", content: <><Milestones m={milestones} /><FinalChecksSetup {...p} /></>,
      tables: [{ key: "final-check", label: "Final Verification" }],
      note: "Every item must be Confirmed (or Not Applicable with a reason) by a reviewer." },
  ]} />
);
export const SettlementStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "set", label: "Settlement", content: <FinancialSummary landId={p.landId} />, tables: [{ key: "settlement", label: "Financial Settlement" }],
      note: "Use the summary above to fill the settlement. Only a reviewer can approve it." },
  ]} />
);

const RegisterView: React.FC<StepProps> = ({ landId, onSaved }) => {
  const rights = usePageRights("legal-land-master");
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["legal-land-register", landId], queryFn: () => getLandRegister(landId) });
  const [busy, setBusy] = useState(false);
  if (!data) return <div className={`${stepCard} p-5 text-sm text-muted-foreground`}>Loading the land register…</div>;
  const c = data.current;
  const row = (k: string, v: React.ReactNode) => <div><dt className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="mt-0.5 text-sm text-foreground">{v || "—"}</dd></div>;
  return (
    <div className="space-y-4">
      <div className={`${stepCard} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={eyebrow}>Current land register</p>
          {rights.canEdit && (
            <button className="mb-3 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-50" style={{ background: LEGAL_GRADIENT }} disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { toast.success((await updateLandRegister(landId)).message); await queryClient.invalidateQueries({ queryKey: ["legal-land-register", landId] }); onSaved(); }
                catch (e) { toast.error(e instanceof Error ? e.message : "Could not update"); } finally { setBusy(false); }
              }}>Update land register</button>
          )}
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          {row("Land", `${c.landCode} · ${c.landName}`)}
          {row("Mouza", c.mouza)}
          {row("Area / unsold", `${c.area ?? "—"} · ${c.remainingArea ?? "—"} unsold`)}
          {row("Current owners", c.owners.map((o) => `${o.name} ${o.sharePct}%`).join(", "))}
          {row("RS references", c.rsReferences.join(", "))}
          {row("LR references", c.lrReferences.join(", "))}
          {row("Latest deed", c.latestDeed ? `${c.latestDeed.number} · ${fmt(c.latestDeed.date)} · ${c.latestDeed.approval}` : null)}
          {row("Mutation", c.mutationStatus)}
          {row("Legal / settlement", `${c.legalStatus} · ${c.settlementStatus}`)}
        </dl>
      </div>
      <div className={`${stepCard} p-4 sm:p-5`}>
        <p className={eyebrow}>Register history</p>
        {!data.snapshots.length ? <p className="text-sm text-muted-foreground">Not updated yet.</p> : (
          <ul className="space-y-1.5 text-sm">
            {data.snapshots.map((s) => (
              <li key={s.SnapshotId} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="text-foreground">{new Date(s.CreatedAt).toLocaleString("en-IN")}</span>
                <span>· {s.CreatedByName ?? "System"}</span>
                <span>· owners: {(s.snapshot.owners ?? []).map((o) => `${o.name} ${o.sharePct}%`).join(", ") || "—"}</span>
                {s.snapshot.mutationStatus && <span>· mutation: {s.snapshot.mutationStatus}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export const RegisterUpdateStep: React.FC<StepProps> = (p) => <RegisterView {...p} />;

export const AuditReportsStep: React.FC<StepProps> = () => {
  const navigate = useNavigate();
  return (
    <div className={`${stepCard} p-5 text-sm`}>
      Every action on this land is in its <b>Audit trail</b> (button above). The 24 land reports — register, ownership, documents, legal,
      purchase & sale, registration, mutation, settlement and user activity — are on the reports page.
      <button className={`${btn} ml-3`} onClick={() => navigate("/legal/land/reports")}>Open land reports</button>
    </div>
  );
};

export const ClosedStep: React.FC<StepProps & { milestones?: LandPipeline["milestones"] }> = ({ milestones }) => (
  <div className="space-y-3">
    <Milestones m={milestones} />
    <div className={`${stepCard} p-5 text-sm text-muted-foreground`}>
      A land is closed only after registration, ownership transfer, mutation, final verification, settlement and the register update are each done.
      Mark this step Completed when every earlier step is finished.
    </div>
  </div>
);

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalLookup, getLegalRows } from "@/api/legalMastersApi";
import { addOwnersToApprovals, getLandFinance, startPurchaseFromOwners } from "@/api/legalLandApi";
import { LEGAL_GRADIENT } from "@/components/legal/LegalShell";
import { StepTabs, stepCard } from "./StepTabs";

// Phase 4 (steps 8, 11–14: purchase / sale, valuation, agreement, approvals, payments) and Phase 5 (steps 15–22:
// deed preparation to deed approval). The server decides when each step can complete.

type StepProps = { landId: number; onSaved: () => void };
const inr = (v: unknown) => `₹${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Value, verified and unverified payments and balance per purchase / sale; expenses apart from the land value. */
export const FinancialSummary: React.FC<{ landId: number }> = ({ landId }) => {
  const { data } = useQuery({ queryKey: ["legal-land-finance", landId], queryFn: () => getLandFinance(landId) });
  if (!data) return null;
  const expenses = data.expenses.reduce((a, e) => a + Number(e.Amount), 0);
  return (
    <div className={`${stepCard} p-4 sm:p-5`}>
      <p className="mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Financial summary</p>
      {!data.transactions.length ? <p className="text-sm text-muted-foreground">No purchase or sale recorded yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Transaction</th><th className="pb-2 pr-3 font-medium">Value</th><th className="pb-2 pr-3 font-medium">Advance</th>
              <th className="pb-2 pr-3 font-medium">Verified paid</th><th className="pb-2 pr-3 font-medium">Awaiting verification</th><th className="pb-2 font-medium">Balance</th>
            </tr></thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.TransactionId} className="border-t border-border/60">
                  <td className="py-2 pr-3">{t.TransactionNo} · {t.TxnType}<div className="text-xs text-muted-foreground">{t.BuyerName} ← {t.SellerNames} · {t.TxnStatus}</div></td>
                  <td className="py-2 pr-3 tabular-nums">{inr(t.TotalValue)}</td>
                  <td className="py-2 pr-3 tabular-nums">{t.AdvanceAmount != null ? inr(t.AdvanceAmount) : "—"}</td>
                  <td className="py-2 pr-3 tabular-nums text-emerald-600">{inr(t.Verified)}</td>
                  <td className="py-2 pr-3 tabular-nums text-amber-600">{inr(t.Unverified)}</td>
                  <td className="py-2 tabular-nums font-semibold">{inr(t.Balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>Expenses (not part of the land value): <b className="text-foreground">{inr(expenses)}</b>{data.expenses.length ? ` — ${data.expenses.map((e) => `${e.ExpenseType} ${inr(e.Amount)}`).join(", ")}` : ""}</span>
        <span>Registration fees paid (verified): <b className="text-foreground">{inr(data.registrationFees)}</b></span>
      </div>
    </div>
  );
};

const inputCls = "w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm";
const btnCls = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50";

/** Step 8: the purchase starts from what the land already holds — its current owners and its area. */
const StartPurchase: React.FC<StepProps> = ({ landId, onSaved }) => {
  const rights = usePageRights("legal-land-master");
  const queryClient = useQueryClient();
  const purchases = useQuery({ queryKey: ["legal-master", "land-purchase", landId], queryFn: () => getLegalRows("land-purchase", landId) });
  const owners = useQuery({ queryKey: ["legal-master", "ownership-record", landId], queryFn: () => getLegalRows("ownership-record", landId) });
  const buyers = useQuery({ queryKey: ["legal-lookup", "buyer"], queryFn: () => getLegalLookup("buyer") });
  const [f, setF] = useState({ buyer: "", value: "", advance: "" });
  const [busy, setBusy] = useState(false);
  const current = (owners.data ?? []).filter((r) => r.IsActive && !r.ValidTo);
  if (!rights.canCreate || (purchases.data ?? []).some((p) => p.IsActive && p.TxnStatus !== "Cancelled")) return null;
  const buyerOpt = (buyers.data ?? []).find((b) => b.label.split(" (")[0] === f.buyer);
  return (
    <div className={`${stepCard} p-4 sm:p-5`}>
      <p className="mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Start the purchase from the current owners</p>
      {!current.length ? <p className="text-sm text-amber-600">Record the land's current owners first (step 5).</p> : (
        <>
          <p className="text-sm text-muted-foreground">Sellers: {current.map((o) => `${String(o.OwnerName)} (${Number(o.SharePct)}%)`).join(", ")} — the whole land is bought from all of them.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-muted-foreground">Buyer (company) *
              <input className={`${inputCls} mt-1`} list="legal-buyers" value={f.buyer} onChange={(e) => setF({ ...f, buyer: e.target.value })} placeholder="Type or pick from the Buyer master" />
              <datalist id="legal-buyers">{(buyers.data ?? []).map((b) => <option key={b.value} value={b.label.split(" (")[0]} />)}</datalist>
            </label>
            <label className="text-xs text-muted-foreground">Total land value (₹) *<input type="number" className={`${inputCls} mt-1`} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Advance (₹)<input type="number" className={`${inputCls} mt-1`} value={f.advance} onChange={(e) => setF({ ...f, advance: e.target.value })} /></label>
          </div>
          <button className="mt-3 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: LEGAL_GRADIENT }}
            disabled={busy || !f.buyer.trim() || !(Number(f.value) > 0)}
            onClick={async () => {
              setBusy(true);
              try {
                toast.success((await startPurchaseFromOwners(landId, { buyerName: f.buyer.trim(), buyerId: buyerOpt?.value, totalValue: Number(f.value), advanceAmount: Number(f.advance) || undefined })).message);
                await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
                onSaved();
              } catch (e) { toast.error(e instanceof Error ? e.message : "Could not start the purchase"); } finally { setBusy(false); }
            }}>Start purchase</button>
        </>
      )}
    </div>
  );
};

/** Step 13: put every current owner and the buyer on the agreement in one click. */
const OwnersToApprovals: React.FC<StepProps> = ({ landId, onSaved }) => {
  const rights = usePageRights("legal-land-master");
  const queryClient = useQueryClient();
  const agreements = useQuery({ queryKey: ["legal-master", "agreement", landId], queryFn: () => getLegalRows("agreement", landId) });
  const [agr, setAgr] = useState("");
  const [busy, setBusy] = useState(false);
  const list = (agreements.data ?? []).filter((a) => a.IsActive);
  if (!rights.canCreate || !list.length) return null;
  return (
    <div className={`${stepCard} flex flex-wrap items-end gap-3 p-4 text-sm`}>
      <label className="min-w-[14rem] flex-1 text-xs text-muted-foreground">Agreement
        <select className={`${inputCls} mt-1`} value={agr} onChange={(e) => setAgr(e.target.value)}>
          <option value="">Select…</option>
          {list.map((a) => <option key={String(a.AgreementId)} value={String(a.AgreementId)}>{String(a.AgreementNo)} · {String(a.AgreementStatus)}</option>)}
        </select>
      </label>
      <button className={btnCls} disabled={busy || !agr} onClick={async () => {
        setBusy(true);
        try { toast.success((await addOwnersToApprovals(landId, Number(agr))).message); await queryClient.invalidateQueries({ queryKey: ["legal-master", "party-approval"] }); onSaved(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Could not add the parties"); } finally { setBusy(false); }
      }}><Users size={13} /> Add all current owners and the buyer</button>
    </div>
  );
};

export const PurchaseSaleStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "txn", label: "Purchase", content: <StartPurchase {...p} />, tables: [{ key: "land-purchase", label: "Purchase" }],
      note: "This pipeline is the company acquiring the land. Selling it later is in the land's Sales section." },
  ]} />
);
export const ValuationStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "val", label: "Valuation & survey", tables: [{ key: "valuation", label: "Valuation & Survey" }],
      note: "Government value must come from a stated, verified source — the system never assumes a fixed rate." },
  ]} />
);
export const AgreementStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "agr", label: "Agreement", tables: [{ key: "agreement", label: "Agreements" }],
      note: "Picking the purchase / sale fills value, advance, area and rate. Signed needs both signatures and a reviewer." },
  ]} />
);
export const PartyApprovalStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "ap", label: "Buyer & seller approval", content: <OwnersToApprovals {...p} />, tables: [{ key: "party-approval", label: "Party Approvals" }],
      note: "List every buyer, seller and co-owner separately. All must be Approved (or Not Applicable) on the signed agreement." },
  ]} />
);
export const PaymentStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "pay", label: "Payments", content: <FinancialSummary landId={p.landId} />, tables: [{ key: "payment", label: "Payments & Receipts" }],
      note: "Each payment is verified on its own. Editing a verified payment without the approve right sends it back for verification." },
    { key: "exp", label: "Expenses", content: <FinancialSummary landId={p.landId} />, tables: [{ key: "expense", label: "Expenses" }] },
  ]} />
);

export const DeedPrepStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "deed", label: "Deed", tables: [{ key: "land-deed", label: "Deed" }],
      note: "Writer and advocate are assigned on the deed. It is marked registered only from a successful registration attempt." },
    { key: "drafts", label: "Drafts", tables: [{ key: "deed-draft", label: "Deed Drafts" }],
      note: "A correction is a new version — earlier drafts stay. Each new draft gets its twelve checks automatically." },
  ]} />
);
export const DraftVerifyStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "checks", label: "Draft checks", tables: [{ key: "deed-draft-check", label: "Draft Verification Checks" }],
      note: "The latest draft must have all twelve checks Correct (or Not Applicable) before it can be Approved." },
    { key: "drafts", label: "Drafts & approval", tables: [{ key: "deed-draft", label: "Deed Drafts" }] },
  ]} />
);
export const StampDutyStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "calc", label: "Calculation", tables: [{ key: "stamp-duty", label: "Stamp Duty & Fees" }],
      note: "Enter the amounts from an approved source (e.g. the e-assessment) — rates are never hard-coded." },
    { key: "paid", label: "Fee payments", tables: [{ key: "reg-payment", label: "Registration Payments" }] },
  ]} />
);
export const AppointmentStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[{ key: "appt", label: "Appointment", tables: [{ key: "reg-appointment", label: "Registration Appointments" }] }]} />
);
export const RegistrationStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "att", label: "Registration attempts", tables: [{ key: "reg-attempt", label: "Registration Attempts" }],
      note: "An appointment or a payment never makes a registration successful. Record each attempt; a failed one stays in the history." },
  ]} />
);
export const RegisteredDeedStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "reg", label: "Registered deed", tables: [{ key: "registered-deed", label: "Registered Deed" }],
      note: "Upload the final registered deed; approval is set by a reviewer." },
  ]} />
);

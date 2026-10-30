import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getLandFinance } from "@/api/legalLandApi";
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

export const PurchaseSaleStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "txn", label: "Purchase / sale", tables: [{ key: "land-transaction", label: "Purchases & Sales" }],
      note: "A sale may not exceed the land's unsold area — the same area cannot be sold twice. Cancelled sales do not count." },
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
    { key: "ap", label: "Buyer & seller approval", tables: [{ key: "party-approval", label: "Party Approvals" }],
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

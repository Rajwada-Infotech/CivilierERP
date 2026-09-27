import React from "react";
import { toast } from "sonner";
import { ArrowRight, Landmark, Loader2, Save } from "lucide-react";
import { Link } from "react-router-dom";
import { setReceivedPaymentDepositBank } from "@/api/receivedPaymentApi";

export interface DepositBankOption { BId: number; BName: string | null; BBranch?: string | null; BAccountLast4?: string | null }

// Accounts' step for a CRM payment: CRM records the cheque/cash WITHOUT a
// deposit bank; here, on the Pending Received Payment, Accounts assigns the
// bank (PATCH /:id/deposit-bank — changes nothing else), after which the
// final Approve becomes available (the approve route refuses a CRM payment
// with no bank). Shown only for Pending, CRM-linked payments.
export function DepositBankAssignPanel({
  paymentId, currentBankId, currentBankName, banks, canEdit, onUpdated, onDecided,
}: {
  paymentId: number;
  currentBankId?: number;
  currentBankName?: string;
  banks: DepositBankOption[];
  canEdit: boolean;
  onUpdated: (bank: { id: number; name: string }) => void;
  onDecided: () => void;
}) {
  const [bankId, setBankId] = React.useState<string>(currentBankId ? String(currentBankId) : "");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { setBankId(currentBankId ? String(currentBankId) : ""); }, [currentBankId]);

  const hasBank = !!currentBankId;
  const changed = bankId !== "" && bankId !== String(currentBankId ?? "");

  const save = async () => {
    if (!bankId) { toast.error("Select the bank this payment is deposited into"); return; }
    setSaving(true);
    try {
      const r = await setReceivedPaymentDepositBank(paymentId, Number(bankId));
      toast.success(`Deposit bank set: ${r.RPDepositBankName}`);
      onUpdated({ id: r.RPDepositBankId, name: r.RPDepositBankName });
    } catch (e: any) {
      toast.error(e.message || "Failed to set the deposit bank");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-5 mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] font-heading font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <Landmark size={12} /> CRM payment — {hasBank ? "deposit bank assigned" : "assign the deposit bank before approval"}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={bankId} onChange={(e) => setBankId(e.target.value)} disabled={saving}
            className="flex-1 min-w-[12rem] h-8 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">Select deposit bank…</option>
            {banks.map((b) => (
              <option key={b.BId} value={String(b.BId)}>
                {b.BName}{b.BBranch ? ` — ${b.BBranch}` : ""}{b.BAccountLast4 ? ` (••${b.BAccountLast4})` : ""}
              </option>
            ))}
          </select>
          <button type="button" onClick={save} disabled={saving || !changed}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-heading font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {hasBank ? "Change bank" : "Save bank"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {hasBank ? `Deposit bank: ${currentBankName}` : "Waiting for Accounts to assign the deposit bank."}
        </p>
      )}
      {hasBank && !changed && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-500/20">
          <span className="text-[11px] text-muted-foreground">Bank: <span className="font-medium text-foreground">{currentBankName}</span> — sent for final approval.</span>
          <Link to="/admin/approval/inbox"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-heading font-semibold text-primary border border-primary/40 hover:bg-primary/10">
            Final approval in Approval Inbox <ArrowRight size={11} />
          </Link>
        </div>
      )}
    </div>
  );
}

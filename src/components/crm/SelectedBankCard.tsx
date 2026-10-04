import React from "react";
import { Landmark } from "lucide-react";

export interface BankOption {
  BId: number | string;
  BName: string;
  BBranch?: string | null;
  BIfscCode?: string | null;
  BAccountLast4?: string | null;
}

// Confirmation card shown right under a company-bank picker once a bank is
// selected — every CRM payment/refund/on-account surface used to only show
// the picked bank's name inside the <select> itself, with nothing to
// double-check the exact branch/account before submitting a real payout.
// Never shows the full account number (that stays a Bank Master-only
// detail, per the existing documented decision on the /for-project
// endpoint) — only branch, IFSC (not sensitive — a public routing code),
// and a masked last-4, same fields the dropdown label itself now carries.
export function SelectedBankCard({ bank }: { bank: BankOption | null | undefined }) {
  if (!bank) return null;
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
      <Landmark size={13} className="text-primary shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="font-medium text-foreground truncate">{bank.BName}</div>
        <div className="text-muted-foreground flex flex-wrap gap-x-2">
          {bank.BBranch && <span>{bank.BBranch}</span>}
          {bank.BIfscCode && <span>IFSC {bank.BIfscCode}</span>}
          {bank.BAccountLast4 && <span>A/c ••{bank.BAccountLast4}</span>}
        </div>
      </div>
    </div>
  );
}

export function findBank(banks: BankOption[] | undefined, id: string | number | null | undefined): BankOption | null {
  if (id == null || id === "") return null;
  return (banks || []).find((b) => String(b.BId) === String(id)) || null;
}

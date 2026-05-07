import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DiscountType = "percentage" | "flat" | "none";
export type BillType =
  | "Tax Invoice"
  | "Proforma Invoice"
  | "Credit Note"
  | "Debit Note"
  | "Bill of Supply"
  | "Receipt Voucher"
  | "Delivery Challan"
  | "Self Invoice";

export interface BillingTerm {
  _id: string;
  name: string;
  billType: BillType;
  discountType: DiscountType;
  discountValue: number;
  paymentDueDays: number;
  description: string;
  status: boolean;
  calculationType?: string;
}

interface BillingTermsContextType {
  billingTerms: BillingTerm[];
  setBillingTerms: (records: BillingTerm[]) => void;
  activeBillingTerms: BillingTerm[];
  loading: boolean;
}

// ─── DB → BillingTerm mapper ───────────────────────────────────────────────────

function mapDbRow(row: any): BillingTerm {
  return {
    _id: String(row.BillingTermID),
    name: row.Name ?? "",
    description: row.Description ?? "",
    billType: (row.CalculationType as BillType) ?? "Tax Invoice",
    discountType: "none",
    discountValue: 0,
    paymentDueDays: 0,
    status: row.IsActive === 1 || row.IsActive === true,
    calculationType: row.CalculationType ?? undefined,
  };
}

// ─── Context ───────────────────────────────────────────────────────────────────

const BillingTermsContext = createContext<BillingTermsContextType | null>(null);

export const useBillingTerms = (): BillingTermsContextType => {
  const ctx = useContext(BillingTermsContext);
  if (!ctx)
    throw new Error("useBillingTerms must be used inside BillingTermsProvider");
  return ctx;
};

export const BillingTermsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [billingTerms, setBillingTermsState] = useState<BillingTerm[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/billing-terms")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: any[]) => {
        if (Array.isArray(data)) {
          setBillingTermsState(data.map(mapDbRow));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setBillingTerms = useCallback((records: BillingTerm[]) => {
    setBillingTermsState(records);
  }, []);

  const activeBillingTerms = billingTerms.filter((bt) => bt.status);

  return (
    <BillingTermsContext.Provider
      value={{ billingTerms, setBillingTerms, activeBillingTerms, loading }}
    >
      {children}
    </BillingTermsContext.Provider>
  );
};

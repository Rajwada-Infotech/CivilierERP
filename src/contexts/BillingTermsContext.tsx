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
  /** "Addition" adds to the base amount; "Deduction" subtracts from it */
  deductionType: "Addition" | "Deduction";
  /** Whether the term is applied before or after GST */
  appliedOn: "pre-gst" | "post-gst";
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
    discountType: "percentage",
    discountValue: 0,
    paymentDueDays: 0,
    status: Boolean(row.IsActive),
    calculationType: row.CalculationType ?? undefined,
    deductionType: row.DeductionType === "Deduction" ? "Deduction" : "Addition",
    appliedOn: row.CalculationType === "After GST" ? "post-gst" : "pre-gst",
  };
}

// ─── Context ───────────────────────────────────────────────────────────────────

const BillingTermsContext = createContext<BillingTermsContextType | null>(null);

const _fallback: BillingTermsContextType = {
  billingTerms: [],
  setBillingTerms: () => {},
  activeBillingTerms: [],
  loading: false,
};

export const useBillingTerms = (): BillingTermsContextType => {
  const ctx = useContext(BillingTermsContext);
  return ctx ?? _fallback;
};

export const BillingTermsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [billingTerms, setBillingTermsState] = useState<BillingTerm[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchWithAuth("/api/billing-terms")
      .then((r) => {
        if (!r.ok) {
          console.warn("[BillingTerms] fetch failed, status:", r.status);
          return [];
        }
        return r.json();
      })
      .then((data: any[]) => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setBillingTermsState(data.map(mapDbRow));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[BillingTerms] fetch error:", err?.message ?? err);
        }
      })
      .finally(() => {
        // Always clear the loading spinner, even if the fetch is abandoned.
        // Without this, the 401 never-resolving-promise case left loading=true
        // forever, freezing any UI that gated on it.
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
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

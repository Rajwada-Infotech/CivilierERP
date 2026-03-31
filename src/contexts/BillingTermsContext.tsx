import React, { createContext, useContext, useState, useCallback } from "react";

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
  name: string;           // e.g. "Standard Net-30"
  billType: BillType;     // type of bill document
  discountType: DiscountType;
  discountValue: number;  // percentage (0-100) or flat ₹ amount
  paymentDueDays: number; // 0 = immediate, 30 = net-30, etc.
  description: string;
  status: boolean;
}

interface BillingTermsContextType {
  billingTerms: BillingTerm[];
  setBillingTerms: (records: BillingTerm[]) => void;
  activeBillingTerms: BillingTerm[];
}

// ─── Seed data ─────────────────────────────────────────────────────────────────

const INITIAL_BILLING_TERMS: BillingTerm[] = [
  {
    _id: "bt-seed-1",
    name: "Standard Net-30",
    billType: "Tax Invoice",
    discountType: "none",
    discountValue: 0,
    paymentDueDays: 30,
    description: "Standard 30-day payment terms with tax invoice",
    status: true,
  },
  {
    _id: "bt-seed-2",
    name: "Early Payment 5%",
    billType: "Tax Invoice",
    discountType: "percentage",
    discountValue: 5,
    paymentDueDays: 15,
    description: "5% discount for payments within 15 days",
    status: true,
  },
  {
    _id: "bt-seed-3",
    name: "Advance ₹5000 Off",
    billType: "Tax Invoice",
    discountType: "flat",
    discountValue: 5000,
    paymentDueDays: 0,
    description: "Flat ₹5000 discount on advance payment",
    status: true,
  },
  {
    _id: "bt-seed-4",
    name: "Proforma No Discount",
    billType: "Proforma Invoice",
    discountType: "none",
    discountValue: 0,
    paymentDueDays: 7,
    description: "Proforma invoice — full payment within 7 days",
    status: true,
  },
  {
    _id: "bt-seed-5",
    name: "Credit Note 10%",
    billType: "Credit Note",
    discountType: "percentage",
    discountValue: 10,
    paymentDueDays: 0,
    description: "Credit note with 10% value adjustment",
    status: false,
  },
  {
    _id: "bt-seed-6",
    name: "Bill of Supply – Exempt",
    billType: "Bill of Supply",
    discountType: "none",
    discountValue: 0,
    paymentDueDays: 45,
    description: "Used for GST-exempt supplies, net-45 terms",
    status: true,
  },
];

// ─── Context ───────────────────────────────────────────────────────────────────

const BillingTermsContext = createContext<BillingTermsContextType | null>(null);

export const useBillingTerms = (): BillingTermsContextType => {
  const ctx = useContext(BillingTermsContext);
  if (!ctx) throw new Error("useBillingTerms must be used inside BillingTermsProvider");
  return ctx;
};

export const BillingTermsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [billingTerms, setBillingTermsState] =
    useState<BillingTerm[]>(INITIAL_BILLING_TERMS);

  const setBillingTerms = useCallback((records: BillingTerm[]) => {
    setBillingTermsState(records);
  }, []);

  const activeBillingTerms = billingTerms.filter((bt) => bt.status);

  return (
    <BillingTermsContext.Provider
      value={{ billingTerms, setBillingTerms, activeBillingTerms }}
    >
      {children}
    </BillingTermsContext.Provider>
  );
};

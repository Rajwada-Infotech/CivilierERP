import React, { createContext, useContext, useState, useCallback } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BillDiscountGroup {
  billNumber: string;
  billAmount: number | null;
  discMode: "percent" | "amount";
  discPercent: string;
  discAmount: string;
  finalAmount: number | null;
}

export interface DebitNoteRecord {
  _id: string;
  company: string;
  project: string;
  supplier: string;
  billDiscountGroup: BillDiscountGroup;
  billNumber: string;
  billAmount: number | null;
  discMode: "percent" | "amount";
  discPercent: string;
  discAmount: string;
  finalAmount: number | null;
  status: boolean;
}

interface DebitNoteContextType {
  debitNoteRecords: DebitNoteRecord[];
  setDebitNoteRecords: (records: DebitNoteRecord[]) => void;
  /** Only records with status === true */
  activeDebitNoteRecords: DebitNoteRecord[];
}

// ─── Seed data (mirrors DebitNoteMaster's initial empty state) ─────────────────

const INITIAL_RECORDS: DebitNoteRecord[] = [];

// ─── Context ───────────────────────────────────────────────────────────────────

const DebitNoteContext = createContext<DebitNoteContextType | null>(null);

export const useDebitNote = (): DebitNoteContextType => {
  const ctx = useContext(DebitNoteContext);
  if (!ctx) throw new Error("useDebitNote must be used inside DebitNoteProvider");
  return ctx;
};

export const DebitNoteProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [debitNoteRecords, setDebitNoteRecordsState] =
    useState<DebitNoteRecord[]>(INITIAL_RECORDS);

  const setDebitNoteRecords = useCallback((records: DebitNoteRecord[]) => {
    setDebitNoteRecordsState(records);
  }, []);

  const activeDebitNoteRecords = debitNoteRecords.filter((r) => r.status);

  return (
    <DebitNoteContext.Provider
      value={{ debitNoteRecords, setDebitNoteRecords, activeDebitNoteRecords }}
    >
      {children}
    </DebitNoteContext.Provider>
  );
};

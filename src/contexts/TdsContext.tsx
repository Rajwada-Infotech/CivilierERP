import React, { createContext, useContext, useState, useCallback } from "react";

export interface TdsRecord {
  nature: string;
  name: string;
  percentage: number;
  status: boolean;
}

// Seed data
const INITIAL_TDS = [
  { nature: "CONTRACTOR", name: "Contract Work", percentage: 1, status: true },
  { nature: "PROFESSIONAL", name: "Professional Fees", percentage: 10, status: true },
  { nature: "INTEREST", name: "Interest on Loans", percentage: 10, status: true },
  { nature: "RENT", name: "Rent Payments", percentage: 10, status: true },
  { nature: "COMMISSION", name: "Commission", percentage: 5, status: true },
  { nature: "LABOUR", name: "Labour Charges", percentage: 2, status: true },
  { nature: "TRANSPORT", name: "Transport", percentage: 2, status: true },
];

interface TdsContextType {
  tdsRecords: TdsRecord[];
  setTdsRecords: (records: TdsRecord[]) => void;
}

const TdsContext = createContext<TdsContextType | null>(null);

export const useTds = (): TdsContextType => {
  const ctx = useContext(TdsContext);
  if (!ctx) throw new Error("useTds must be used inside TdsProvider");
  return ctx;
};

export const TdsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tdsRecords, setTdsRecordsState] = useState<TdsRecord[]>(INITIAL_TDS);

  const setTdsRecords = useCallback((records: TdsRecord[]) => {
    setTdsRecordsState(records);
  }, []);

  return (
    <TdsContext.Provider value={{ tdsRecords, setTdsRecords }}>
      {children}
    </TdsContext.Provider>
  );
};


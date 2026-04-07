import React, { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TdsRecord {
  id: string;
  nature: string;
  name: string;
  percentage: number;
  status: boolean;
}

interface TdsContextType {
  tdsRecords: TdsRecord[];
  isLoading: boolean;
}

// ─── Context ──────────────────────────────────────────────────────────────────
const TdsContext = createContext<TdsContextType | null>(null);

export const useTds = (): TdsContextType => {
  const ctx = useContext(TdsContext);
  if (!ctx) throw new Error("useTds must be used inside TdsProvider");
  return ctx;
};

// ─── Provider ─────────────────────────────────────────────────────────────────
export const TdsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { data: dbData, isLoading } = useQuery({
    queryKey: ["tds"],
    queryFn: () => fetch("/api/tds-master").then((r) => r.json()),
  });

  const tdsRecords: TdsRecord[] = Array.isArray(dbData)
    ? dbData.map((item: any) => ({
        id: String(item.TDSId),
        nature: item.Nature || "",
        name: item.Name || "",
        percentage: item.Percentage ?? 0,
        status: !!item.Status,
      }))
    : [];

  return (
    <TdsContext.Provider value={{ tdsRecords, isLoading }}>
      {children}
    </TdsContext.Provider>
  );
};

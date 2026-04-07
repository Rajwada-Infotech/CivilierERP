import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getFinYears,
  addFinYear,
  updateFinYear,
  deleteFinYear,
} from "@/api/finYearApi";

export interface FinYear {
  id: string;
  year: string;
  startDate: string;
  endDate: string;
  status: "Active" | "Closed";
  locked: boolean;
}

interface FinYearContextType {
  finYears: FinYear[];
  isLoading: boolean;
  addFinYear: (finYear: Omit<FinYear, "id">) => Promise<void>;
  updateFinYear: (id: string, updates: Partial<FinYear>) => Promise<void>;
  toggleLock: (id: string, currentLocked: boolean) => Promise<void>;
  deleteFinYear: (id: string) => Promise<void>;
}

const FinYearContext = createContext<FinYearContextType | null>(null);

export const useFinYear = () => {
  const ctx = useContext(FinYearContext);
  if (!ctx) throw new Error("useFinYear must be inside FinYearProvider");
  return ctx;
};

export const FinYearProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();

  const { data: dbData, isLoading } = useQuery({
    queryKey: ["fin-years"],
    queryFn: getFinYears,
  });

  const finYears: FinYear[] = Array.isArray(dbData)
    ? dbData.map((item: any) => ({
        id: String(item.FId),
        year: item.FName || "",
        startDate: item.FStartDate ? item.FStartDate.split("T")[0] : "",
        endDate: item.FEndDate ? item.FEndDate.split("T")[0] : "",
        status: item.FStatus ? "Active" : "Closed",
        locked: !!item.FisLocked,
      }))
    : [];

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["fin-years"] }),
    [queryClient],
  );

  const add = useCallback(
    async (finYear: Omit<FinYear, "id">) => {
      await addFinYear({
        FName: finYear.year || null,
        FStartDate: finYear.startDate || null,
        FEndDate: finYear.endDate || null,
        FStatus: finYear.status !== "Closed",
        FisLocked: finYear.locked,
      });
      await invalidate();
    },
    [invalidate],
  );

  const update = useCallback(
    async (id: string, updates: Partial<FinYear>) => {
      const current = finYears.find((f) => f.id === id);
      if (!current) return;
      const merged = { ...current, ...updates };
      await updateFinYear(id, {
        FName: merged.year || null,
        FStartDate: merged.startDate || null,
        FEndDate: merged.endDate || null,
        FStatus: merged.status !== "Closed",
        FisLocked: merged.locked,
      });
      await invalidate();
    },
    [finYears, invalidate],
  );

  const toggleLock = useCallback(
    async (id: string, currentLocked: boolean) => {
      const current = finYears.find((f) => f.id === id);
      if (!current) return;
      await updateFinYear(id, {
        FName: current.year || null,
        FStartDate: current.startDate || null,
        FEndDate: current.endDate || null,
        FStatus: current.status !== "Closed",
        FisLocked: !currentLocked,
      });
      await invalidate();
    },
    [finYears, invalidate],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteFinYear(id);
      await invalidate();
    },
    [invalidate],
  );

  const value = useMemo(
    () => ({
      finYears,
      isLoading,
      addFinYear: add,
      updateFinYear: update,
      toggleLock,
      deleteFinYear: remove,
    }),
    [finYears, isLoading, add, update, toggleLock, remove],
  );

  return (
    <FinYearContext.Provider value={value}>{children}</FinYearContext.Provider>
  );
};

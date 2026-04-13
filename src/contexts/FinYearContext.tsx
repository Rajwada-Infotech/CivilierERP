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
  addFinYear as apiAddFinYear,
  updateFinYear as apiUpdateFinYear,
  deleteFinYear as apiDeleteFinYear,
} from "@/api/finYearApi";
import { useAuth } from "./AuthContext";

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
  toggleLock: (id: string, newLockedState: boolean) => Promise<void>;
  deleteFinYear: (id: string) => Promise<void>;
}

const FinYearContext = createContext<FinYearContextType | null>(null);

export const useFinYear = () => {
  const ctx = useContext(FinYearContext);
  if (!ctx) throw new Error("useFinYear must be inside FinYearProvider");
  return ctx;
};

const QUERY_KEY = ["fin-years"];

export const FinYearProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  const { data: dbData, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getFinYears,
    enabled: !!currentUser,
    // FIX: reduced staleTime so invalidate() always triggers an immediate refetch.
    // 5 min staleTime meant React Query considered data "fresh" and skipped the
    // refetch even after invalidate() was called — so the badge never updated.
    staleTime: 0,
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
    () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    [queryClient],
  );

  // Helper: optimistically patch the cached query data so the UI updates
  // instantly without waiting for the refetch round-trip.
  const optimisticPatch = useCallback(
    (id: string, patch: Partial<FinYear>) => {
      queryClient.setQueryData(QUERY_KEY, (old: any[]) => {
        if (!Array.isArray(old)) return old;
        return old.map((item: any) => {
          if (String(item.FId) !== id) return item;
          const updated = { ...item };
          if (patch.locked !== undefined) updated.FisLocked = patch.locked ? 1 : 0;
          if (patch.status !== undefined) updated.FStatus = patch.status !== "Closed" ? 1 : 0;
          if (patch.year !== undefined) updated.FName = patch.year;
          if (patch.startDate !== undefined) updated.FStartDate = patch.startDate;
          if (patch.endDate !== undefined) updated.FEndDate = patch.endDate;
          return updated;
        });
      });
    },
    [queryClient],
  );

  // FIX: toggleLock now:
  // 1. Optimistically flips the locked badge in the UI immediately
  // 2. Calls apiUpdateFinYear directly (not the local updateFinYear callback)
  //    so { FisLocked } reaches the backend as a raw DB field — not filtered
  //    through the Partial<FinYear> mapper which would silently drop it
  // 3. On error, rolls back the optimistic update and re-throws
  const toggleLock = useCallback(
    async (id: string, newLockedState: boolean) => {
      // Step 1 — optimistic update: flip the badge before the request finishes
      optimisticPatch(id, { locked: newLockedState });

      try {
        // Step 2 — persist to DB via the raw API (bypasses the FinYear-key mapper)
        await apiUpdateFinYear(id, { FisLocked: newLockedState });
        // Step 3 — invalidate so the next read is fresh (clears Redis cache too)
        await invalidate();
      } catch (error) {
        // Step 4 — rollback: flip back if the request failed
        optimisticPatch(id, { locked: !newLockedState });
        console.error("Failed to toggle lock:", error);
        throw error;
      }
    },
    [optimisticPatch, invalidate],
  );

  const addFinYear = useCallback(
    async (finYear: Omit<FinYear, "id">) => {
      await apiAddFinYear({
        FName: finYear.year,
        FStartDate: finYear.startDate,
        FEndDate: finYear.endDate,
        FStatus: finYear.status !== "Closed",
        FisLocked: finYear.locked,
      });
      await invalidate();
    },
    [invalidate],
  );

  const updateFinYear = useCallback(
    async (id: string, updates: Partial<FinYear>) => {
      // Optimistic update for edit dialog saves too
      optimisticPatch(id, updates);

      const payload: any = {};
      if (updates.year !== undefined) payload.FName = updates.year;
      if (updates.startDate !== undefined) payload.FStartDate = updates.startDate;
      if (updates.endDate !== undefined) payload.FEndDate = updates.endDate;
      if (updates.status !== undefined) payload.FStatus = updates.status !== "Closed";
      if (updates.locked !== undefined) payload.FisLocked = updates.locked;

      try {
        await apiUpdateFinYear(id, payload);
        await invalidate();
      } catch (error) {
        // Rollback on failure
        await invalidate();
        throw error;
      }
    },
    [optimisticPatch, invalidate],
  );

  const deleteFinYear = useCallback(
    async (id: string) => {
      await apiDeleteFinYear(id);
      await invalidate();
    },
    [invalidate],
  );

  const value = useMemo(
    () => ({
      finYears,
      isLoading,
      addFinYear,
      updateFinYear,
      toggleLock,
      deleteFinYear,
    }),
    [finYears, isLoading, addFinYear, updateFinYear, toggleLock, deleteFinYear],
  );

  return (
    <FinYearContext.Provider value={value}>{children}</FinYearContext.Provider>
  );
};

import {
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

/** Convert a Date object or ISO string to a local YYYY-MM-DD string without UTC shift. */
function toLocalDateStr(val: string | Date): string {
  const d = val instanceof Date ? val : new Date(val);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const QUERY_KEY = ["fin-years"];

export const FinYearProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();

  const { data: dbData, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getFinYears,
    enabled: !!localStorage.getItem("token"),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const finYears: FinYear[] = Array.isArray(dbData)
    ? dbData
        .map((item: any) => ({
          id: String(item.FId),
          year: item.FName || "",
          startDate: item.FStartDate ? toLocalDateStr(item.FStartDate) : "",
          endDate: item.FEndDate ? toLocalDateStr(item.FEndDate) : "",
          status: item.FStatus ? "Active" : "Closed",
          locked: !!item.FisLocked,
        }))
        .sort((a, b) => b.year.localeCompare(a.year))
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
          if (patch.locked !== undefined)
            updated.FisLocked = patch.locked ? 1 : 0;
          if (patch.status !== undefined)
            updated.FStatus = patch.status !== "Closed" ? 1 : 0;
          if (patch.year !== undefined) updated.FName = patch.year;
          if (patch.startDate !== undefined)
            updated.FStartDate = patch.startDate;
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
        await apiUpdateFinYear(id, { is_locked: newLockedState });
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
        fy_label: finYear.year,
        start_date: finYear.startDate,
        end_date: finYear.endDate,
        is_locked: finYear.locked,
      });
      await invalidate();
    },
    [invalidate],
  );

  const updateFinYear = useCallback(
    async (id: string, updates: Partial<FinYear>) => {
      // Optimistic update for edit dialog saves too
      optimisticPatch(id, updates);

      const payload: Partial<{
        fy_label: string;
        start_date: string;
        end_date: string;
        is_locked: boolean;
      }> = {};
      if (updates.year !== undefined) payload.fy_label = updates.year;
      if (updates.startDate !== undefined)
        payload.start_date = updates.startDate;
      if (updates.endDate !== undefined) payload.end_date = updates.endDate;
      if (updates.locked !== undefined) payload.is_locked = updates.locked;
      // status is not part of FinYearPayload — status is derived from is_locked on the backend

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

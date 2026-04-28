import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // No retry on 429 rate limit
      retry: (failureCount, error: any) => {
        if ((error as Response)?.status === 429) return false;
        return failureCount < 2;
      },
      // Always fetch fresh data on mount — if cache is empty the data will load.
      // refetchOnMount: false was the bug: it silently skipped the initial fetch
      // whenever no cached entry existed, leaving dashboards permanently blank.
      refetchOnMount: true,
      staleTime: 60 * 1000, // data is "fresh" for 1 min (was 5 min)
      gcTime: 10 * 60 * 1000, // keep unused cache for 10 min
      refetchOnWindowFocus: false, // don't hammer the DB on tab-switch
    },
    mutations: {
      retry: 1,
    },
  },
});

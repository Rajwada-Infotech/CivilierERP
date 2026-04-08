import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // No retry on 429 rate limit
retry: (failureCount, error: any) => {
        if ((error as Response)?.status === 429) return false;
        return failureCount < 2;
      },
      // Stagger concurrent queries: max 3 parallel, 100ms between batches
      // staggerAmount: 3, // v6 beta feature, remove for stable
      // Cache aggressively to reduce refetches
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
    mutations: {
      retry: 1,
    },
  },
});


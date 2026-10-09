import { QueryClient } from "@tanstack/react-query";

// Many API helpers throw a plain Error carrying only the server's message ("Too many requests, please try again
// later."), with no status - so the status check alone never saw their 429s, and every one was retried twice more,
// which made the rate limit worse. Recognise the message as well.
const RATE_LIMITED_MESSAGE = /too many requests|(^|[^0-9])429([^0-9]|$)/i;

export function shouldRetry(failureCount: number, error: unknown, maxRetries: number) {
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403 || status === 429) return false;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string" && RATE_LIMITED_MESSAGE.test(message)) return false;
  return failureCount < maxRetries;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry on 401 (expired session), 403 (forbidden), or 429 (rate limit).
      // Retrying 401s is what causes the request storm visible in the logs —
      // each polling query fires up to 2 extra requests after the token dies.
      retry: (failureCount, error) => shouldRetry(failureCount, error, 2),
      // Always fetch fresh data on mount — if cache is empty the data will load.
      // refetchOnMount: false was the bug: it silently skipped the initial fetch
      // whenever no cached entry existed, leaving dashboards permanently blank.
      refetchOnMount: true,
      staleTime: 60 * 1000, // data is "fresh" for 1 min (was 5 min)
      gcTime: 10 * 60 * 1000, // keep unused cache for 10 min
      refetchOnWindowFocus: false, // don't hammer the DB on tab-switch
    },
    mutations: {
      retry: (failureCount, error) => shouldRetry(failureCount, error, 1),
    },
  },
});

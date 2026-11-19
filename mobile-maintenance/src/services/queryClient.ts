import { QueryClient } from "@tanstack/react-query";

// Same defaults intent as the web app: don't hammer the API on every screen
// focus, but keep data reasonably fresh. Tune per-query with staleTime like
// the web app already does throughout src/pages/**.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One retry for a blip — but never for "too many requests" (HTTP 429): a retry is one more request.
      retry: (failures, error) => failures < 1 && (error as { status?: number } | null)?.status !== 429,
      staleTime: 30_000,
    },
  },
});

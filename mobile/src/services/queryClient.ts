import { QueryClient } from "@tanstack/react-query";

// Same defaults intent as the web app: don't hammer the API on every screen
// focus, but keep data reasonably fresh. Tune per-query with staleTime like
// the web app already does throughout src/pages/**.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

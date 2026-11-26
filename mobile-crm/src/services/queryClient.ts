import { AppState, Platform } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";

// Coming back to the app counts as "focus", so every query on screen that is older than its staleTime refetches —
// what a browser tab does on its own. Without it, a change made in the CRM (an agreement signed, a payment counted)
// showed only after a pull-to-refresh. (TanStack Query's React Native recipe.)
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => focusManager.setFocused(state === "active"));
}

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

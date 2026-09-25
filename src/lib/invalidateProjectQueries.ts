import type { QueryClient } from "@tanstack/react-query";

// Project / company / godown data feeds Company -> Project dropdowns all over
// the app under many different query keys (each page names its own), and most
// keep them fresh for minutes. After a project is saved or its company tags
// change, refresh every one of them at once so the change shows up instantly
// instead of whenever each page's cache happens to expire.
export function invalidateProjectCompanyQueries(qc: QueryClient) {
  qc.invalidateQueries({
    predicate: (q) => /project|enterprise|compan|godown/i.test(JSON.stringify(q.queryKey)),
  });
}

import type { QueryClient } from "@tanstack/react-query";

const TICKET_QUERY_ROOTS = new Set([
  "ticket-dashboard",
  "my-tickets",
  "admin-tickets",
  "admin-ticket-stats",
  "admin-ticket-detail",
]);

export function invalidateTicketQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => TICKET_QUERY_ROOTS.has(String(query.queryKey[0])),
  });
}

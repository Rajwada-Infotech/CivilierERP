import type { QueryClient } from "@tanstack/react-query";

/**
 * All query key roots used across the ticket module.
 * Keep this in sync with every useQuery({ queryKey }) in:
 *   - TicketDashboard.tsx      → "ticket-dashboard"
 *   - MyTickets.tsx            → "tickets"
 *   - PendingTickets.tsx       → "tickets"
 *   - ResolvedTickets.tsx      → "tickets"
 *   - TicketResolution.tsx     → "admin-resolution-tickets"
 */
const TICKET_QUERY_ROOTS = new Set([
  "ticket-dashboard",
  "tickets",
  "admin-resolution-tickets",
  "admin-tickets",
  "admin-ticket-stats",
  "admin-ticket-detail",
  "ticket-detail",
  "home-dashboard",
]);

export function invalidateTicketQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => TICKET_QUERY_ROOTS.has(String(query.queryKey[0])),
  });
}

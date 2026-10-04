-- Migration 436: de-duplicate the "Ticket Dashboard" entries in Menu Rights.
--
-- Two distinct, both genuinely used, PageDefinitions rows shared the exact
-- same Label "Ticket Dashboard" in the same "Dashboards" group, making them
-- look like an accidental duplicate:
--   - PageKey 'ticket-dashboard' — the route guard/nav-link gate for the
--     actual /ticket Dashboard page (App.tsx's <ProtectedRoute>,
--     TicketSidebar.ts's Dashboard nav item). This is the real dashboard.
--   - PageKey 'tickets' — the umbrella action-rights key checked by every
--     OTHER ticket page (MyTickets, PendingTickets, ResolvedTickets,
--     CreateTicket, AdminTicketPanel) and also, incidentally, by buttons
--     inside the dashboard page itself. Not a dashboard at all — its
--     Label only said "Dashboard" because migration 434's dashboard
--     detection matched on Label LIKE '%Dashboard%'.
--
-- Both keys are real and load-bearing (confirmed via full-repo usage
-- search) — this only relabels/regroups 'tickets' to reflect what it
-- actually is, out of the Dashboards tier and back into the Ticket
-- module's own base group.

UPDATE dbo.PageDefinitions
  SET Label = 'Tickets', GroupName = 'Ticket'
  WHERE PageKey = 'tickets' AND Module = 'Ticket';

PRINT 'Relabeled tickets PageKey out of Dashboards, distinct from ticket-dashboard';
GO

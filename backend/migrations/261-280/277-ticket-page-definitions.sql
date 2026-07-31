-- Migration 277: Ticket module PageDefinitions cleanup — same pattern as
-- 275/276. Sales and Civil Work DPR were checked too and are already clean
-- (their dead rows were deactivated previously), so this file only touches
-- Ticket.
--
-- TicketSidebar.ts's own nav items all share a single pageKey ("tickets")
-- for Create/My Tickets/Pending/Resolved — only the dashboard uses its own
-- ("ticket-dashboard"). Six other PageKeys (ticket-create, ticket-my-tickets,
-- ticket-pending, ticket-resolved, ticket-admin-panel, ticket-resolution)
-- have zero references anywhere in the frontend — not the sidebar, not any
-- <ProtectedRoute>, not a usePageRights() call — while ticket-dashboard
-- itself gates a real route (App.tsx) but had no PageDefinitions row at all.

UPDATE dbo.PageDefinitions
SET IsActive = 0
WHERE PageKey IN (
  'ticket-create', 'ticket-my-tickets', 'ticket-pending', 'ticket-resolved',
  'ticket-admin-panel', 'ticket-resolution'
);
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'ticket-dashboard', 'Ticket Dashboard', 'Ticket', 'Ticket', 'view', 10, 1, 'migration-277', SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'ticket-dashboard');
GO

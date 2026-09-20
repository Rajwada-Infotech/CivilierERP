-- Migration 437: fix the remaining Dashboards-tier label collision.
--
-- Two rows shared the bare Label "Dashboard" in the flattened Dashboards
-- group — same look-like-a-duplicate problem as tickets/ticket-dashboard
-- in migration 436:
--   - PageKey 'dashboard' (Module=General) — the actual Home page
--     (/home route). Relabeled "Home Dashboard" to be unambiguous now
--     that it sits alongside every other module's dashboard.
--   - PageKey 'civilworkdpr-dashboard' — was the only module dashboard
--     NOT prefixed with its own module name (every sibling row already
--     follows "<Module> Dashboard": Finance Dashboard, Material
--     Dashboard, Engineering Dashboard, ...). Brought in line.

UPDATE dbo.PageDefinitions SET Label = 'Home Dashboard' WHERE PageKey = 'dashboard' AND Module = 'General';
UPDATE dbo.PageDefinitions SET Label = 'Civil Work DPR Dashboard' WHERE PageKey = 'civilworkdpr-dashboard';

PRINT 'Fixed remaining Dashboards-tier label collision';
GO

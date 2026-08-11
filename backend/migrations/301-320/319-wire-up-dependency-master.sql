-- Migration 319: wire up the long-dormant Dependency Master page.
--
-- The table (dbo.DependencyType, migration 123) and its full CRUD API
-- (backend/routes/dependency.js) already existed, but no frontend page or
-- nav entry was ever built — the PageDefinitions row from 123 pointed at
-- Module='Inside Work' (renamed to 'Civil Work DPR' by migration 130/131
-- along the way), and nothing in src/ ever rendered it.
--
-- Moves it into Engineering > Engineering Setup, next to Activity Master,
-- matching where the nav entry now lives (src/components/layout/TopNavbar.tsx
-- engineeringSetupItems / MobileNav.tsx). A proper redesign (real
-- predecessor/successor dependency modeling, not just a flat code/name
-- list) is a separate, larger follow-up — this only makes the page reachable.

UPDATE dbo.PageDefinitions
SET Module = N'Engineering', GroupName = N'Engineering Setup', UpdatedAt = SYSDATETIME()
WHERE PageKey = N'dependency-master';
GO

PRINT '319-wire-up-dependency-master applied successfully.';
GO

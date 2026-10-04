-- Migration 434: restructure Menu Rights / Page Permission into three
-- tiers — Dashboards, Setup, then module-wise pages — instead of every
-- module's dashboard and setup pages being scattered inside that
-- module's own group. Explicit request: granting rights shouldn't mean
-- hunting through every module separately to find its dashboard/setup
-- pages — collect each into one place across all modules.
--
-- "Setup" (not "Setups") matches the exact label this app's own UI
-- already uses for this concept — see TopNavbar.tsx's Setup dropdown
-- button.
--
-- Module column is left untouched on every row (still the real owning
-- module, used for the badge next to each page in these shared
-- sections) — only GroupName changes, and GroupName is read nowhere
-- outside pageDefinitions.js / MenuRights.tsx's own admin UI (confirmed
-- via full-repo search), so this is a pure display reclassification,
-- not a permission-semantics change.

UPDATE dbo.PageDefinitions
  SET GroupName = 'Dashboards'
  WHERE IsActive = 1 AND (PageKey LIKE '%dashboard%' OR Label LIKE '%Dashboard%');

UPDATE dbo.PageDefinitions
  SET GroupName = 'Setup'
  WHERE IsActive = 1 AND (GroupName LIKE '%Setup%' OR GroupName LIKE '%Master%');

PRINT 'Restructured Page Definitions into Dashboards / Setup / module-wise tiers';
GO

-- Migration 444: fix production's stale records/contractor-category/
-- followup-pending-tasks rows to match dev — same direction as 440-442,
-- opposite of 443 (which fixed dev's stale loan-* rows instead).
--
-- Verified against actual code, not just picking a side:
--
--   - records: src/pages/records/Records.tsx has its own dedicated
--     RecordsSidebar.ts, RecordsContext/RecordsProvider, and route
--     "/records" — a real standalone module, not part of Finance. Dev's
--     Module="Records"/GroupName="Records" is correct; production's
--     "Finance"/"Finance" is a stale leftover (there's even a dead,
--     unrouted src/pages/finance/Records.tsx confirming where this page
--     used to live before it was split into its own module).
--
--   - contractor-category: ContractorCategoryAdmin.tsx's own on-screen
--     title is "Contractor Categories" (plural) — dev's Label matches
--     exactly; production's singular "Contractor Category" is wrong.
--     SortOrder also aligned for consistency (cosmetic either way).
--
--   - followup-pending-tasks: routed at /crm/setup/pending-tasks - dev's
--     Module="CRM" is correct; production's "Follow-Up" is stale.
--     PendingTasks.tsx also has no print/export UI (only canCreate is
--     checked), so dev's narrower Actions (no print/export) matches the
--     page's real capabilities better than production's six-action set.
--
-- Idempotent: no-op on dev (already in this state).

UPDATE dbo.PageDefinitions
  SET Module = 'Records', GroupName = 'Records'
  WHERE PageKey = 'records';

UPDATE dbo.PageDefinitions
  SET Label = 'Contractor Categories', SortOrder = 80
  WHERE PageKey = 'contractor-category';

UPDATE dbo.PageDefinitions
  SET Module = 'CRM', Actions = 'view,create,edit,delete', SortOrder = 210
  WHERE PageKey = 'followup-pending-tasks';

PRINT 'Fixed records/contractor-category/followup-pending-tasks to match dev';
GO

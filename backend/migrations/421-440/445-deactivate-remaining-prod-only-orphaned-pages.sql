-- Migration 445: deactivate 10 more orphaned PageDefinitions rows, found
-- via scripts/findOrphanedPageDefinitions.js run against production
-- (these are production-only rows with no dev counterpart to diff
-- against, so the earlier dev/prod comparison in migrations 440-444
-- couldn't have caught them - this is the same class of cleanup as
-- migrations 438/439, just surfaced by the reusable checker instead).
--
-- Verified against current frontend source, not just "no code reference":
--   - account-group: the live /masters/account-group route uses
--     pageKey="account-head" (already active) - "account-group" is a
--     stale duplicate from before that rename.
--   - insidework-activity, insidework-dashboard: "Inside Work" does not
--     exist anywhere in the frontend - no module, sidebar, or route.
--   - work-order-master: WorkOrderMaster.tsx's routes use
--     pageKey="engineering-work-order" (already active), never this key.
--   - followup-payment-plan-master: already deactivated in dev by
--     migration 438; production just never received that fix.
--   - followup-applications, followup-customer-master, followup-demands,
--     followup-payments, followup-unit-selections: same superseded-by-
--     CRM-module class as the 35 rows cleaned up in migrations 438/439
--     (e.g. crm-applications, crm-customers, crm-money-receipts,
--     crm-unit-matrix) - just under prod-only row names that didn't
--     exist in dev for that earlier diff to catch.
--
-- Deactivating rather than deleting, per this session's established
-- convention (keeps history, harmless for any already-inert RoleRights
-- grant since nothing in code checks these keys).

UPDATE dbo.PageDefinitions SET IsActive = 0 WHERE PageKey IN (
  'account-group',
  'insidework-activity',
  'insidework-dashboard',
  'work-order-master',
  'followup-payment-plan-master',
  'followup-applications',
  'followup-customer-master',
  'followup-demands',
  'followup-payments',
  'followup-unit-selections'
);

PRINT 'Deactivated 10 more orphaned PageDefinitions rows';
GO

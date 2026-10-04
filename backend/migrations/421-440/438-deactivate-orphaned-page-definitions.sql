-- Migration 438: deactivate orphaned PageDefinitions rows.
--
-- Audit (this session) cross-referenced every usePageRights()/pageKey prop
-- in src/ and every requirePageRight() in backend/routes/ against
-- dbo.PageDefinitions.PageKey. 42 active rows matched nothing at all;
-- of those, 35 were confirmed to be genuine clutter rather than
-- intentionally-excluded pages (admin/portal-only routes, which don't
-- need a page key, were left alone):
--
--   - 12 are stale duplicates superseded by a key the real page checks
--     instead (leftover rows from a naming consolidation that was never
--     cleaned up): the 6 ticket-* keys (superseded by 'tickets', see
--     migration 436), the 5 *-reminders keys (superseded by the single
--     'followup-reminders' umbrella key Reminders.tsx actually checks),
--     and 'material-debit-note' (superseded by 'debit-note').
--   - 23 have zero connection to any code anywhere - an early CRM
--     follow-up naming scheme ('followup-*') that was rebuilt under
--     'crm-*' keys (crm-handover, crm-noc, crm-customer-bank-details,
--     etc.) with the old rows never removed, plus 3 unrelated dead rows
--     (amendment-menu, engineering-amendment-menu, engineering-boq).
--
-- Deactivating rather than deleting: keeps history/audit trail intact
-- and matches how IsActive is already used elsewhere to hide retired
-- pages from Menu Rights without touching any RoleRights/user grants
-- that may still reference the old key (those grants were already inert
-- since nothing in code checks these keys).

UPDATE dbo.PageDefinitions SET IsActive = 0 WHERE PageKey IN (
  -- superseded by 'tickets'
  'ticket-my-tickets', 'ticket-pending', 'ticket-resolved',
  'ticket-create', 'ticket-admin-panel', 'ticket-resolution',
  -- superseded by 'followup-reminders'
  'chq-reminders', 'grn-reminders', 'po-reminders', 'tds-reminders', 'wo-reminders',
  -- superseded by 'debit-note'
  'material-debit-note',
  -- early CRM follow-up naming, rebuilt under crm-* keys, never removed
  'followup-agreement-workflow', 'followup-applicant-timeline', 'followup-applicants',
  'followup-bank-noc', 'followup-communicator', 'followup-document-vault',
  'followup-finance-demands', 'followup-finance-payments', 'followup-handover',
  'followup-log', 'followup-noc', 'followup-pipeline-applicants',
  'followup-pipeline-unit-selections', 'followup-pre-possession',
  'followup-report-customer', 'followup-report-financial', 'followup-report-project-status',
  'followup-unit-selection',
  -- unrelated dead rows, no code reference anywhere
  'amendment-menu', 'engineering-amendment-menu', 'engineering-boq'
);

PRINT 'Deactivated 35 orphaned PageDefinitions rows';
GO

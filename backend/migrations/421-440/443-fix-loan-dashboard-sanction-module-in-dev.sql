-- Migration 443: fix dev's stale loan-dashboard/loan-sanction rows to
-- match production — the opposite direction from migrations 440-442.
--
-- LoanDashboard.tsx and LoanSanction.tsx live under their own /loan/*
-- routes with a dedicated LoanSidebar.ts — "Loan" is a real, separate
-- module, not part of Finance. Production already has Module="Loan"
-- correctly; dev had Module="Finance", left over from before the Loan
-- module was split out on its own.
--
-- Actions were also wrong in dev: every other *-dashboard row in this
-- table (ticket-dashboard, civilworkdpr-dashboard, admin-dashboard,
-- hr-payroll-dashboard, sales-dashboard, ...) is Actions='view' only —
-- dashboards are view-only by convention. Dev's loan-dashboard had the
-- generic "view,create,edit,delete,print,export" default instead.
-- loan-sanction doesn't branch on any specific action internally, so
-- production's narrower, deliberately-curated "view,add,edit" is kept
-- over dev's blanket six-action default.
--
-- Idempotent both ways: no-op on production (already in this state).

UPDATE dbo.PageDefinitions
  SET Module = 'Loan', GroupName = 'Dashboards', Actions = 'view'
  WHERE PageKey = 'loan-dashboard';

UPDATE dbo.PageDefinitions
  SET Module = 'Loan', GroupName = 'Loan', Actions = 'view,add,edit'
  WHERE PageKey = 'loan-sanction';

PRINT 'Fixed loan-dashboard/loan-sanction Module+Actions to match production';
GO

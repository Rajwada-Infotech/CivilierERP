-- Migration 276: Follow-Up + Engineering PageDefinitions cleanup, same
-- treatment as 275 gave Finance/Material — one file, cross-checked against
-- the actual sidebars (FollowupSidebar.ts / followupSetupItems,
-- EngineeringSidebar.ts / engineeringSetupItems, crmSetupItems in
-- TopNavbar.tsx), not file location or PageKey naming.
--
-- Follow-Up carried ~30 rows left over from the pre-cleanup Follow-Up
-- module (Applications/Bookings/Agreements/NOC/Handover/Sales Deed/etc.) —
-- all superseded by CRM's own crm-* equivalents when that module absorbed
-- them; none of these old followup-* keys back any route in App.tsx
-- anymore. Deactivated rather than deleted, to keep an audit trail.

-- ── Follow-Up's own page (FollowupSidebar.ts) ──
UPDATE dbo.PageDefinitions
SET Module = 'Follow-Up', GroupName = 'Follow-Up'
WHERE PageKey = 'followup-dashboard';
GO

-- ── Follow-Up Setup — task-master and followup-department-master were
-- seeded under Module='CRM' back when Follow-Up leaned on CRM Setup, but
-- both are now in Follow-Up's own setup menu (followupSetupItems). ──
UPDATE dbo.PageDefinitions
SET Module = 'Follow-Up', GroupName = 'Follow-Up Setup'
WHERE PageKey IN ('task-master', 'followup-department-master');
GO

-- ── followup-reminders / followup-pending-tasks are real pages, but only
-- ever reached via CRM's own setup menu (crmSetupItems' Reminders/Pending
-- Tasks items still use these old pageKeys) — reassign, and backfill
-- followup-pending-tasks which has a real route (/crm/setup/pending-tasks)
-- but no PageDefinitions row at all. ──
UPDATE dbo.PageDefinitions
SET Module = 'CRM', GroupName = 'CRM Setup'
WHERE PageKey = 'followup-reminders';
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'followup-pending-tasks', 'Pending Tasks', 'CRM', 'CRM Setup', 'view,create,edit,delete', 210, 1, 'migration-276', SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'followup-pending-tasks');
GO

-- ── Dead pre-cleanup Follow-Up pages — zero references anywhere in the
-- frontend. ──
UPDATE dbo.PageDefinitions
SET IsActive = 0
WHERE PageKey IN (
  'followup-tasks', 'followup-log', 'po-reminders', 'wo-reminders',
  'chq-reminders', 'grn-reminders', 'tds-reminders',
  'followup-construction-updates', 'followup-agreements',
  'followup-agreement-workflow', 'followup-document-vault',
  'followup-communicator', 'followup-noc', 'followup-bank-noc',
  'followup-sales-deed', 'followup-handover', 'followup-pre-possession',
  'followup-possession-notice', 'followup-finance-demands',
  'followup-finance-payments', 'followup-legal-milestones',
  'followup-report-customer', 'followup-report-financial',
  'followup-report-project-status', 'followup-applicants',
  'followup-applicant-timeline', 'followup-bookings',
  'followup-unit-selection', 'followup-welcome-calls',
  'followup-pipeline-applicants', 'followup-pipeline-unit-selections',
  'followup-payment-plan-master'
);
GO

-- ── Engineering's own transactional pages (EngineeringSidebar.ts) ──
UPDATE dbo.PageDefinitions
SET Module = 'Engineering', GroupName = 'Engineering'
WHERE PageKey IN (
  'engineering-dashboard', 'work-done', 'engineering-work-order', 'dpr',
  'engineering-amendment-menu', 'boq'
);
GO

-- ── Engineering Setup — the one master in engineeringSetupItems ──
UPDATE dbo.PageDefinitions
SET Module = 'Engineering', GroupName = 'Engineering Setup'
WHERE PageKey = 'activity-master';
GO

-- ── Dead duplicate — engineering-boq duplicates boq (the real pageKey
-- EngineeringSidebar.ts actually uses); zero references. ──
UPDATE dbo.PageDefinitions
SET IsActive = 0
WHERE PageKey = 'engineering-boq';
GO

-- /material/work-order (renders the same WorkOrderMaster.tsx as
-- Engineering's own /engineering/work-order) had no sidebar link but is a
-- real deep-link target (useReminders.ts, ApprovalInbox.tsx both navigate
-- there directly for WO reminders/approvals) — not orphaned after all, just
-- unreachable from a static menu. Fixed in App.tsx: it now shares the
-- "engineering-work-order" pageKey instead of the ungranted, DB-row-less
-- "work-order-master", so it's correctly gated as an Engineering page with
-- no separate PageDefinitions entry needed.

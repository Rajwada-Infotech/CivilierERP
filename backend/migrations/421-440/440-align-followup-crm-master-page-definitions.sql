-- Migration 440: bring production's PageDefinitions into line with dev on
-- the specific rows confirmed this session to be genuinely drifted (not
-- just cosmetic Module/GroupName labeling, which has no effect on access
-- control — only PageKey existence and IsActive do).
--
-- Found via a cross-environment dump/diff (scripts/dumpPageDefinitions.js)
-- that production's PageDefinitions had never received several dev-only
-- changes that predate this session's own migrations (433-439) and aren't
-- covered by any existing migration file:
--
--   1. Seven Follow-Up pages are IsActive=1 in production but IsActive=0
--      in dev — dev's state was confirmed as the intended one.
--   2. Four CRM "*-master" pages (crm-block-master, crm-customer-master,
--      crm-pending-tasks, crm-unit-master) exist in dev (as IsActive=0
--      rows — inactive, but present) and are entirely missing from
--      production's PageDefinitions table.
--
-- Idempotent both ways: running this on dev is a no-op (already in this
-- state); running it on production converges it to match.

UPDATE dbo.PageDefinitions SET IsActive = 0 WHERE PageKey IN (
  'followup-agreements',
  'followup-bookings',
  'followup-construction-updates',
  'followup-legal-milestones',
  'followup-possession-notice',
  'followup-sales-deed',
  'followup-welcome-calls'
);

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-block-master')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('crm-block-master', 'Block Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 130, 0, 'migration', GETDATE());
END

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-customer-master')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('crm-customer-master', 'Customer Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 110, 0, 'migration', GETDATE());
END

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-pending-tasks')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('crm-pending-tasks', 'Pending Tasks', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 100, 0, 'migration', GETDATE());
END

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-unit-master')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('crm-unit-master', 'Unit Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 120, 0, 'migration', GETDATE());
END

PRINT 'Aligned 7 Follow-Up IsActive flags and seeded 4 missing CRM master pages';
GO

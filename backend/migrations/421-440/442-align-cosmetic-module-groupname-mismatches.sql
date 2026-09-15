-- Migration 442: align 11 PageDefinitions rows where only Module/GroupName
-- (the Menu Rights UI grouping — has no effect on actual access control,
-- which is driven entirely by the separate RoleRights.Module/SubModule
-- columns) differed between dev and production, with every other field
-- (Label, Actions, SortOrder, IsActive) already identical on both sides.
--
-- Found via the same dev/prod PageDefinitions diff as migrations 440-441.
-- Confirmed dev as the intended grouping for these; production had never
-- picked up whatever earlier reorganization moved these pages under their
-- current Module in dev.
--
-- 5 further rows with similar-looking Module/GroupName differences were
-- deliberately excluded from this migration because they also differ in
-- Label, SortOrder, or Actions (a functionally meaningful difference, not
-- just cosmetic grouping) — contractor-category, followup-pending-tasks,
-- loan-dashboard, loan-sanction, records. Those need individual review,
-- not a blind "copy dev's value" pass (records in particular has dev's
-- Module/GroupName set to the nonsensical "Records"/"Records", which
-- looks like a bug in dev, not the correct value).
--
-- Idempotent both directions.

UPDATE dbo.PageDefinitions SET Module = 'Engineering' WHERE PageKey = 'activity-master';
UPDATE dbo.PageDefinitions SET Module = 'Material' WHERE PageKey = 'billing-terms';
UPDATE dbo.PageDefinitions SET Module = 'Engineering', GroupName = 'Engineering' WHERE PageKey = 'boq';
UPDATE dbo.PageDefinitions SET Module = 'Finance' WHERE PageKey = 'contractor-master';
UPDATE dbo.PageDefinitions SET Module = 'Material', GroupName = 'Material' WHERE PageKey = 'debit-note';
UPDATE dbo.PageDefinitions SET Module = 'Finance', GroupName = 'Finance' WHERE PageKey = 'expense-booking';
UPDATE dbo.PageDefinitions SET Module = 'CRM' WHERE PageKey = 'followup-block-master';
UPDATE dbo.PageDefinitions SET Module = 'CRM', GroupName = 'Setup' WHERE PageKey = 'followup-reminders';
UPDATE dbo.PageDefinitions SET Module = 'CRM' WHERE PageKey = 'followup-unit-master';
UPDATE dbo.PageDefinitions SET GroupName = 'Material' WHERE PageKey = 'quotation';
UPDATE dbo.PageDefinitions SET Module = 'Finance' WHERE PageKey = 'supplier-master';

PRINT 'Aligned 11 cosmetic Module/GroupName mismatches to dev';
GO

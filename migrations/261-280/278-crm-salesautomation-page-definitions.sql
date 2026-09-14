-- Migration 278: CRM + Sales Automation PageDefinitions cleanup, same
-- pattern as 275/276/277.
--
-- CRM turned out to have a systemic naming split: at some point it was
-- reseeded with a cleaner "crm-X-master" naming convention for the masters
-- shared with the old Follow-Up module (Unit/Block/Room/Parking/Parking
-- Slot/Extra Charge/Customer/Broker/Pending Tasks/Reminders), but the actual
-- application code (crmSetupItems in TopNavbar.tsx, and every
-- <ProtectedRoute> in App.tsx) was never updated to match — it still uses
-- the original "followup-X-master"/"broker-master" keys. Net effect: 10
-- dead "crm-*" rows sat in Menu Rights granting nothing real, while 7 pages
-- that people actually use every day (Unit/Block/Room/Parking/Parking Slot/
-- Extra Charge/Broker Master) had NO grantable row at all — meaning nobody
-- but a super-admin-tier role could ever be granted access to them.
--
-- (crm-broker-master's dead key was also embedded in CrmBrokerMaster.tsx's
-- own internal usePageRights() call — fixed in the same commit as this
-- migration to use "broker-master", matching the route's real gate.)

-- ── Dead crm-*-master duplicates — zero references anywhere in the
-- frontend (not the sidebar, not any route, not a usePageRights call). ──
UPDATE dbo.PageDefinitions
SET IsActive = 0
WHERE PageKey IN (
  'crm-pending-tasks', 'crm-customer-master', 'crm-unit-master',
  'crm-room-master', 'crm-block-master', 'crm-parking-master',
  'crm-parking-slot-master', 'crm-extra-charge-master', 'crm-reminders',
  'crm-broker-master'
);
GO

-- ── The real, live keys these duplicated — had no PageDefinitions row at
-- all, so Menu Rights could never grant them. ──
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
VALUES
  ('followup-unit-master', 'Unit Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 120, 1, 'migration-278', SYSUTCDATETIME()),
  ('followup-room-master', 'Room Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 125, 1, 'migration-278', SYSUTCDATETIME()),
  ('followup-block-master', 'Block Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 130, 1, 'migration-278', SYSUTCDATETIME()),
  ('followup-parking-master', 'Parking Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 150, 1, 'migration-278', SYSUTCDATETIME()),
  ('followup-parking-slot-master', 'Parking Slot Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 155, 1, 'migration-278', SYSUTCDATETIME()),
  ('followup-extra-charge-master', 'Extra Charge Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 160, 1, 'migration-278', SYSUTCDATETIME()),
  ('broker-master', 'Broker Master', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 165, 1, 'migration-278', SYSUTCDATETIME());
GO

-- ── Sales Automation — sa-campaigns/sa-ads are transactional (Campaigns
-- submenu) but were grouped with the real Setup page sa-social-media;
-- sa-channel-partners is a Leads submenu item but was grouped under Admin. ──
UPDATE dbo.PageDefinitions
SET GroupName = 'Sales Automation Campaigns'
WHERE PageKey IN ('sa-campaigns', 'sa-ads');
GO

UPDATE dbo.PageDefinitions
SET GroupName = 'Sales Automation Leads'
WHERE PageKey = 'sa-channel-partners';
GO

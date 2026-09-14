-- The Follow-Up module's Setup dropdown (Customer/Unit/Block/Room/Parking
-- Rate/Parking Slot/Extra Charge masters + Pending Tasks) was moved into the
-- CRM module's Setup dropdown, and the routes were moved from
-- /followup/setup/* to /crm/setup/* so the app no longer switches back into
-- the Follow-Up module (ModuleContext derives activeModule purely from the
-- URL prefix). The pageKeys guarding these routes/menu items were still
-- "followup-*", which meant:
--   1. marketing_head (whose access is granted by "sa-"/"crm-" prefix match
--      in requirePageRight.js/auth.utils.ts) could never reach pages that now
--      visually live entirely inside the CRM module.
--   2. The Admin > Menu Rights catalog (dbo.PageDefinitions) still listed
--      them under Module='Follow-Up', out of sync with where they actually
--      live now.
-- Verified live before writing this migration: dbo.RoleRights has zero rows
-- for these SubModules and dbo.UserPageRightsJson has zero rows referencing
-- any of these old pageKeys, so renaming in place revokes nothing that
-- currently exists.
--
-- A brand new "crm-reminders" key is added (not a rename of
-- "followup-reminders") because that key is still shared by five other,
-- genuinely Follow-Up-only sidebar entries (PO/WO/CHQ/TDS/GRN Reminders in
-- FollowupSidebar.ts) — renaming it in place would have altered unrelated
-- pages.

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-unit-master', Module = 'CRM', GroupName = 'CRM Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-unit-master';

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-room-master', Module = 'CRM', GroupName = 'CRM Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-room-master';

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-block-master', Module = 'CRM', GroupName = 'CRM Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-block-master';

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-customer-master', Module = 'CRM', GroupName = 'CRM Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-customer-master';

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-parking-master', Module = 'CRM', GroupName = 'CRM Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-parking-master';

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-parking-slot-master', Module = 'CRM', GroupName = 'CRM Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-parking-slot-master';

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-extra-charge-master', Module = 'CRM', GroupName = 'CRM Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-extra-charge-master';

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-pending-tasks', Module = 'CRM', GroupName = 'CRM Setup', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'followup-pending-tasks';

-- New page (the CRM Setup shortcut), distinct from the pre-existing
-- "followup-reminders" key used by the Follow-Up module's own Reminders link
-- and its PO/WO/CHQ/TDS/GRN siblings.
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'crm-reminders', 'Reminders', 'CRM', 'CRM Setup', 'view,create,edit,delete,print,export', 170, 1, 'migration-239', SYSDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'crm-reminders' AND pd.IsActive = 1
);

-- Safety net: rename these keys anywhere they might already appear inside a
-- per-user RightsJson override, so any future/other-environment data with
-- existing grants carries forward instead of being silently dropped.
UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-unit-master"', '"crm-unit-master"')
 WHERE RightsJson LIKE '%"followup-unit-master"%';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-room-master"', '"crm-room-master"')
 WHERE RightsJson LIKE '%"followup-room-master"%';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-block-master"', '"crm-block-master"')
 WHERE RightsJson LIKE '%"followup-block-master"%';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-customer-master"', '"crm-customer-master"')
 WHERE RightsJson LIKE '%"followup-customer-master"%';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-parking-master"', '"crm-parking-master"')
 WHERE RightsJson LIKE '%"followup-parking-master"%';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-parking-slot-master"', '"crm-parking-slot-master"')
 WHERE RightsJson LIKE '%"followup-parking-slot-master"%';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-extra-charge-master"', '"crm-extra-charge-master"')
 WHERE RightsJson LIKE '%"followup-extra-charge-master"%';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"followup-pending-tasks"', '"crm-pending-tasks"')
 WHERE RightsJson LIKE '%"followup-pending-tasks"%';

-- Same rename inside dbo.RoleRights, keyed off SubModule (the literal value
-- getCandidatePageKeys() treats as a ready-made page key, same convention
-- migration 226 used for "sa-reports").
UPDATE dbo.RoleRights SET SubModule = 'crm-unit-master' WHERE Module = 'Follow-Up' AND SubModule = 'followup-unit-master';
UPDATE dbo.RoleRights SET SubModule = 'crm-room-master' WHERE Module = 'Follow-Up' AND SubModule = 'followup-room-master';
UPDATE dbo.RoleRights SET SubModule = 'crm-block-master' WHERE Module = 'Follow-Up' AND SubModule = 'followup-block-master';
UPDATE dbo.RoleRights SET SubModule = 'crm-customer-master' WHERE Module = 'Follow-Up' AND SubModule = 'followup-customer-master';
UPDATE dbo.RoleRights SET SubModule = 'crm-parking-master' WHERE Module = 'Follow-Up' AND SubModule = 'followup-parking-master';
UPDATE dbo.RoleRights SET SubModule = 'crm-parking-slot-master' WHERE Module = 'Follow-Up' AND SubModule = 'followup-parking-slot-master';
UPDATE dbo.RoleRights SET SubModule = 'crm-extra-charge-master' WHERE Module = 'Follow-Up' AND SubModule = 'followup-extra-charge-master';
UPDATE dbo.RoleRights SET SubModule = 'crm-pending-tasks' WHERE Module = 'Follow-Up' AND SubModule = 'followup-pending-tasks';

-- marketing_head already gets these via the "crm-" prefix match in
-- requirePageRight.js/isMarketingHeadPage() with no RoleRights row required,
-- but an explicit baseline row is added anyway to match the existing
-- convention (migration 226) and keep Menu Rights' UI consistent.
DECLARE @MhdId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
IF @MhdId IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-unit-master')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-unit-master', 1, 1, 1, 1);
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-room-master')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-room-master', 1, 1, 1, 1);
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-block-master')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-block-master', 1, 1, 1, 1);
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-customer-master')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-customer-master', 1, 1, 1, 1);
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-parking-master')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-parking-master', 1, 1, 1, 1);
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-parking-slot-master')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-parking-slot-master', 1, 1, 1, 1);
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-extra-charge-master')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-extra-charge-master', 1, 1, 1, 1);
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-pending-tasks')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-pending-tasks', 1, 1, 1, 1);
  IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-reminders')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES (@MhdId, 'CRM', 'crm-reminders', 1, 1, 1, 1);
END;

PRINT 'CRM Setup pageKeys migrated from followup-* to crm-* (PageDefinitions, UserPageRightsJson, RoleRights); crm-reminders seeded.';

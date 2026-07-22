-- Broker Master (/masters/brokers) sits in the CRM module's Setup dropdown
-- alongside Payment Plan Master / Milestone Master / Home Loan Tracking, but
-- unlike those it was still keyed "broker-master" (no "crm-" prefix), so
-- marketing_head — whose access is granted by "sa-"/"crm-" prefix match in
-- requirePageRight.js/auth.utils.ts, same as every other CRM Setup page —
-- could never reach it. Same fix class as migration 239.
--
-- Verified live before writing this: dbo.RoleRights has zero rows with
-- SubModule='broker-master' and dbo.UserPageRightsJson has zero rows
-- referencing it, so renaming in place revokes nothing that currently
-- exists. The actual CRUD backend (accountHeadMaster.js) is gated on the
-- unrelated shared "account-head" key (same as every other ledger-head
-- master: Customer/Supplier/Contractor), so no backend route change needed.

UPDATE dbo.PageDefinitions
   SET PageKey = 'crm-broker-master', UpdatedAt = SYSDATETIME()
 WHERE PageKey = 'broker-master';

UPDATE dbo.UserPageRightsJson
   SET RightsJson = REPLACE(RightsJson, '"broker-master"', '"crm-broker-master"')
 WHERE RightsJson LIKE '%"broker-master"%';

UPDATE dbo.RoleRights SET SubModule = 'crm-broker-master' WHERE SubModule = 'broker-master';

DECLARE @MhdId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
IF @MhdId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-broker-master'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@MhdId, 'CRM', 'crm-broker-master', 1, 1, 1, 1);
END;

PRINT 'broker-master renamed to crm-broker-master (PageDefinitions, UserPageRightsJson, RoleRights); marketing_head baseline seeded.';

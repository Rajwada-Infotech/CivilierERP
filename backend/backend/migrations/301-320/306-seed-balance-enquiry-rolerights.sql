-- Migration 306: Balance Enquiry (migration 302) seeded its PageDefinitions
-- row but never granted it to any role in RoleRights — with zero rows there,
-- requirePageRight("balance-enquiry","view") returns 403 for every role
-- except the hardcoded superuser bypass (super_admin/admin/dba), so
-- non-superuser users saw the page but nothing ever populated (banks,
-- summary, passbook all silently 403'd). Mirrors 292's grant for Fund
-- Transfer / Journal Voucher — RoleId=5 "Account's Head" (Finance module
-- owner) gets view; export matches the page's own Actions='view,export'.

DECLARE @AccountsHeadRoleId INT = 5;

IF NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights
  WHERE RoleId = @AccountsHeadRoleId AND Module = 'Finance' AND SubModule = 'Balance Enquiry'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanExport)
  VALUES (@AccountsHeadRoleId, 'Finance', 'Balance Enquiry', 1, 0, 0, 0, 1);
  PRINT 'Inserted: Account''s Head -> Finance / Balance Enquiry (view, export)';
END
ELSE
  PRINT 'Already exists: Account''s Head -> Finance / Balance Enquiry';
GO

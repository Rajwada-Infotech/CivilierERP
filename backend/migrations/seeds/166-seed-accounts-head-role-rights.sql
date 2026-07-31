-- Migration 166: Baseline role-level rights for "Account's Head" (RId=5)
--
-- dbo.RoleRights was completely empty for this role — Sourav's access
-- (migration 165) came entirely from his personal UserPageRightsJson
-- override, which does NOT propagate to any future user assigned this
-- role. This seeds the role itself with Journal Voucher + Inter-Company
-- Stock Transfer (view, create) so every "Account's Head" login going
-- forward gets these by default, per the concept: only Accounts Head may
-- initiate a JV or an Inter-Company Transfer; approval stays restricted to
-- super_admin in code (MODULE_APPROVER_ROLE_OVERRIDES).
--
-- Module/SubModule text is kebab-cased by getCandidatePageKeys() in
-- backend/middleware/permissions.js to resolve the page key:
--   kebab('Journal Voucher')  -> 'journal-voucher'
--   kebab('Stock Transfers')  -> 'stock-transfers'
-- both match the requirePageRight() page keys used by the routes exactly,
-- with no entry needed in the PERMISSION_PAGE_KEYS override map.

DECLARE @AccountsHeadRoleId INT = 5;

IF NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights
  WHERE RoleId = @AccountsHeadRoleId AND Module = 'Finance' AND SubModule = 'Journal Voucher'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@AccountsHeadRoleId, 'Finance', 'Journal Voucher', 1, 1, 0, 0);
  PRINT 'Inserted: Account''s Head -> Finance / Journal Voucher (view, create)';
END
ELSE
  PRINT 'Already exists: Account''s Head -> Finance / Journal Voucher';

IF NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights
  WHERE RoleId = @AccountsHeadRoleId AND Module = 'Material' AND SubModule = 'Stock Transfers'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@AccountsHeadRoleId, 'Material', 'Stock Transfers', 1, 1, 0, 0);
  PRINT 'Inserted: Account''s Head -> Material / Stock Transfers (view, create)';
END
ELSE
  PRINT 'Already exists: Account''s Head -> Material / Stock Transfers';
GO

SELECT RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete
FROM dbo.RoleRights
WHERE RoleId = 5
ORDER BY Module, SubModule;
GO

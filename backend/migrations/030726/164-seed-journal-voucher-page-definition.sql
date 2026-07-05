-- Migration 164: Seed journal-voucher page definition
--
-- src/pages/finance/JournalVoucher.tsx uses usePageRights("journal-voucher")
-- and backend/routes/journalVoucher.js gates on requirePageRight("journal-
-- voucher", ...), but this page key was never added to dbo.PageDefinitions.
-- Without this, an admin has no way to find/grant the Journal Voucher page
-- to non-super-admin roles via the Rights admin screen — only super_admin/
-- admin/dba (who bypass all page-right checks) can currently reach it.

IF NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'journal-voucher' AND IsActive = 1
)
BEGIN
  INSERT INTO dbo.PageDefinitions
    (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES
    ('journal-voucher', 'Journal Voucher', 'Finance', 'Finance',
     'view,create,edit,delete,print,export', 60, 1, 'migration-164', GETDATE());
  PRINT 'Inserted: journal-voucher';
END
ELSE
BEGIN
  PRINT 'Already exists: journal-voucher';
END
GO

-- Verify
SELECT PageKey, Label, Module, GroupName, IsActive
FROM dbo.PageDefinitions
WHERE PageKey = 'journal-voucher';
GO

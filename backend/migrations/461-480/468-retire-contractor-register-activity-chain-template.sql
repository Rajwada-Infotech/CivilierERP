-- Contractor Register (civilworkdpr-contractor-register) and Activity Chain
-- Template (dpr-activity-chain-template) were removed from the app — the
-- real work allocation/reporting flow runs through Dependency Master /
-- Dependency Chains (WorkDone.tsx's ActivityChainPreview) instead, and
-- Contractor Register duplicated/contradicted that. Retiring both page
-- rights rather than deleting the rows, same convention migration 131 used
-- retiring dependency-master/civilworkdpr-activity.
--
-- Daily Labour (backend/routes/dailyLabour.js) reused
-- civilworkdpr-contractor-register for its own create/edit/delete gate —
-- repointed to its own civilworkdpr-daily-labour key (seeded below) so it
-- isn't left checking a right nobody can grant anymore.

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  UPDATE dbo.PageDefinitions SET IsActive = 0 WHERE PageKey = 'civilworkdpr-contractor-register';
  UPDATE dbo.PageDefinitions SET IsActive = 0 WHERE PageKey = 'dpr-activity-chain-template';

  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'civilworkdpr-daily-labour' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('civilworkdpr-daily-labour', 'Daily Labour', 'Civil Work DPR', 'Civil Work DPR', 'view,create,edit,delete', 13, 1, 'migration', GETDATE());

  PRINT 'Retired civilworkdpr-contractor-register / dpr-activity-chain-template, seeded civilworkdpr-daily-labour';
END
GO

-- Verify
SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
WHERE Module = 'Civil Work DPR'
ORDER BY SortOrder;

-- Migration 557: Civil Work DPR > Query — the User-Wise Daily Work Report as its own menu; clicking a row opens
-- that activity in Reporting. Page right so the menu can be granted in Menu Rights.
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'civilworkdpr-query' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('civilworkdpr-query', 'Query', 'Civil Work DPR', 'Civil Work DPR', 'view,export', 17, 1, 'migration-557', SYSUTCDATETIME());
  PRINT 'Seeded PageDefinitions civilworkdpr-query';
END
GO

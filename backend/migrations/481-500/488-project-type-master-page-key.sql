-- Migration 488: page key for the Project Type master screen.
--
-- Migration 482 seeded five project types, which made them effectively
-- hardcoded from the application's point of view — adding "Row Housing" or
-- retiring a type meant a migration and a deploy. routes/projectTypeMaster.js
-- and the Project Type master screen turn them into ordinary master data; this
-- registers the page so rights resolve for it like any other master.
--
-- Granted to admin-tier roles only. A project type decides whether a project's
-- units stack on floors, whether it sells land (outside GST) or construction
-- (taxable), and whether several units may share one booking — so it changes
-- how money is taxed and recognised, not merely how a screen looks.

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'project-type-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('project-type-master', 'Project Type', 'Masters', 'Project Setup', 'view,create,edit,delete', 180, 1, 'migration-488', SYSDATETIME());
  PRINT 'Migration 488: seeded PageDefinitions row for project-type-master.';
END
ELSE
  PRINT 'Migration 488: project-type-master page key already exists — skipped.';
GO

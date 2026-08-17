-- 334: Activity Reporting — adds a Status column to
-- dbo.DependencyActivityAssignment so each assigned chain rung can be
-- tracked through a review workflow (Pending, In Progress, Hold, Cancelled,
-- Approved, Rework, Completed) on the new Reporting page. Order between
-- these is intentionally NOT enforced here — any status can move to any
-- other; that's a policy decision for later, not a schema one.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'Status'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment
    ADD Status NVARCHAR(20) NOT NULL
      CONSTRAINT DF_DependencyActivityAssignment_Status DEFAULT 'PENDING';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DependencyActivityAssignment_Status'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment
    ADD CONSTRAINT CK_DependencyActivityAssignment_Status
      CHECK (Status IN ('PENDING', 'IN_PROGRESS', 'HOLD', 'CANCELLED', 'APPROVED', 'REWORK', 'COMPLETED'));
END
GO

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'civilworkdpr-activity-reporting' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('civilworkdpr-activity-reporting', 'Reporting', 'Civil Work DPR', 'Civil Work DPR', 'view,edit', 14, 1, 'migration', GETDATE());
END
GO

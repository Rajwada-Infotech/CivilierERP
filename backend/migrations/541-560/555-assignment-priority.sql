-- Migration 555: Activity Priority on the Work Allocation (dbo.DependencyActivityAssignment).
-- Set from the allocation form; one of Low / High / Urgent / Very Urgent, or NULL when none was
-- chosen (every existing row). A rework attempt inherits it from the attempt it replaces.

IF COL_LENGTH('dbo.DependencyActivityAssignment', 'Priority') IS NULL
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD Priority NVARCHAR(20) NULL;
  PRINT 'Migration 555: added DependencyActivityAssignment.Priority.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DependencyActivityAssignment_Priority')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment
    ADD CONSTRAINT CK_DependencyActivityAssignment_Priority
    CHECK (Priority IS NULL OR Priority IN (N'Low', N'High', N'Urgent', N'Very Urgent'));
END
GO

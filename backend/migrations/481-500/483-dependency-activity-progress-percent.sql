-- Migration 483: Civil Work DPR — % work done per assignment, editable via
-- a draggable progress bar in the Activity Detail modal (Reporting).
-- Independent of Status — a HOLD or IN_PROGRESS activity can carry any
-- percent; nothing here auto-derives Status from it or vice versa.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'ProgressPercent'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment
    ADD ProgressPercent INT NOT NULL CONSTRAINT DF_DependencyActivityAssignment_ProgressPercent DEFAULT (0);
END
GO

-- Separate batch — referencing ProgressPercent in the same batch it's
-- added in fails with "Invalid column name" (SQL Server resolves column
-- names at parse time, before the preceding ALTER TABLE has executed).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DependencyActivityAssignment_ProgressPercent')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment
    ADD CONSTRAINT CK_DependencyActivityAssignment_ProgressPercent CHECK (ProgressPercent BETWEEN 0 AND 100);
END
GO

PRINT '483-dependency-activity-progress-percent applied successfully.';
GO

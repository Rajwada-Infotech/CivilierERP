-- 335: Expands the rung-level assignment popup (Work Reporting) to support
-- multiple engineers, a duration-driven end date, labour/material source
-- (contractor vs developer), a description, and remarks.
--
-- Multiple engineers per assignment need their own table (an assignment can
-- now have any number) — the old single EngineerId column on
-- DependencyActivityAssignment is left in place but unused going forward,
-- rather than risk a data migration on what's currently only smoke-seeded
-- dev data; every read now sources engineers from DependencyActivityEngineer.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityEngineer' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyActivityEngineer (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentId INT NOT NULL,
    EngineerId   INT NOT NULL,
    CONSTRAINT FK_DependencyActivityEngineer_Assignment
      FOREIGN KEY (AssignmentId) REFERENCES dbo.DependencyActivityAssignment(Id) ON DELETE CASCADE,
    CONSTRAINT FK_DependencyActivityEngineer_Engineer
      FOREIGN KEY (EngineerId) REFERENCES dbo.users(id),
    CONSTRAINT UX_DependencyActivityEngineer_Assignment_Engineer UNIQUE (AssignmentId, EngineerId)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'Days')
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD
    Days           INT NULL,
    EndDate        DATE NULL,
    -- Who's actually supplying the labour/material for this rung — the
    -- project's own crew/stock ("DEVELOPER") or a contractor's. No FK to a
    -- specific contractor here; this is a source classification only, shown
    -- as a badge (see ASSIGNMENT_SOURCE_META in the frontend).
    LabourSource   NVARCHAR(20) NULL
      CONSTRAINT CK_DependencyActivityAssignment_LabourSource CHECK (LabourSource IN ('CONTRACTOR', 'DEVELOPER')),
    MaterialSource NVARCHAR(20) NULL
      CONSTRAINT CK_DependencyActivityAssignment_MaterialSource CHECK (MaterialSource IN ('CONTRACTOR', 'DEVELOPER')),
    Description    NVARCHAR(500) NULL,
    Remarks        NVARCHAR(1000) NULL;
END
GO

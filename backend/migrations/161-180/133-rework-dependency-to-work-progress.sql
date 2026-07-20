-- Migration 133: Rework "Dependency" into real Work Progress tracking
--
-- The real workflow: a Project has several Activities in progress at once,
-- each one allocated to a Contractor (dbo.ContractorAllocation already
-- captures Project + Activity + Contractor). The allocated contractor logs
-- progress against their allocation; every progress update goes to Pending
-- Review until an Engineer/Manager approves or rejects it.
--
-- dbo.ActivityDependency previously modeled "Activity A depends on Activity
-- B" with a free-text AssignedTo — wrong model. Reworking it in place
-- (renamed to dbo.WorkProgress) since it had zero rows: drop the
-- Parent/Dependent/Activity/AssignedTo/ProjectId columns (all redundant or
-- wrong), key everything off AllocationId instead, add review fields.

IF EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ActivityDependency' AND xtype = 'U')
  AND NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'WorkProgress' AND xtype = 'U')
BEGIN
  EXEC sp_rename 'dbo.ActivityDependency', 'WorkProgress';
  PRINT 'Renamed dbo.ActivityDependency to dbo.WorkProgress';
END
GO

-- Drop FKs/columns that don't belong in the new model
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActDep_Activity')
  ALTER TABLE dbo.WorkProgress DROP CONSTRAINT FK_ActDep_Activity;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActDep_Parent')
  ALTER TABLE dbo.WorkProgress DROP CONSTRAINT FK_ActDep_Parent;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActDep_Dependent')
  ALTER TABLE dbo.WorkProgress DROP CONSTRAINT FK_ActDep_Dependent;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'ActivityId')
  ALTER TABLE dbo.WorkProgress DROP COLUMN ActivityId;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'ParentActivityId')
  ALTER TABLE dbo.WorkProgress DROP COLUMN ParentActivityId;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'DependentActivityId')
  ALTER TABLE dbo.WorkProgress DROP COLUMN DependentActivityId;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'AssignedTo')
  ALTER TABLE dbo.WorkProgress DROP COLUMN AssignedTo;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'ProjectId')
  ALTER TABLE dbo.WorkProgress DROP COLUMN ProjectId;
GO

-- Add the real key + review fields
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'AllocationId')
BEGIN
  ALTER TABLE dbo.WorkProgress ADD AllocationId INT NULL;
END
GO
-- (Backfill step would go here if there were existing rows — there are none.)
ALTER TABLE dbo.WorkProgress ALTER COLUMN AllocationId INT NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WorkProgress_Allocation')
  ALTER TABLE dbo.WorkProgress
    ADD CONSTRAINT FK_WorkProgress_Allocation FOREIGN KEY (AllocationId) REFERENCES dbo.ContractorAllocation(AllocationId);
GO
CREATE INDEX IX_WorkProgress_AllocationId ON dbo.WorkProgress(AllocationId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'ReviewStatus')
  ALTER TABLE dbo.WorkProgress ADD ReviewStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_WorkProgress_ReviewStatus DEFAULT 'Pending';
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'ReviewedBy')
  ALTER TABLE dbo.WorkProgress ADD ReviewedBy NVARCHAR(150) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'ReviewedAt')
  ALTER TABLE dbo.WorkProgress ADD ReviewedAt DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'ReviewRemarks')
  ALTER TABLE dbo.WorkProgress ADD ReviewRemarks NVARCHAR(500) NULL;
GO

-- Rename DependencyId -> WorkProgressId for clarity (was the PK of the old table)
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkProgress') AND name = 'DependencyId')
  EXEC sp_rename 'dbo.WorkProgress.DependencyId', 'WorkProgressId', 'COLUMN';
GO

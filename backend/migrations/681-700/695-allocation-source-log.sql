-- Migration 695: Work Allocation > Labour / Material Given By — who supplied it, from when, and who came before.
--
-- One row per period a source (the developer, or a contractor) supplied an activity's labour or material. The first
-- source of an activity starts on the allocation's start date; when Work Allocation saves a different source, the open
-- period ends that day and the new source's period starts that day. Kept per activity (rung), so it runs on across
-- rework attempts, which carry the same source forward.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyAssignmentSourceLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyAssignmentSourceLog (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    RungId        INT           NOT NULL,          -- dbo.DependencyMasterActivity.Id
    Kind          NVARCHAR(10)  NOT NULL,          -- LABOUR / MATERIAL
    Source        NVARCHAR(20)  NOT NULL,          -- DEVELOPER / CONTRACTOR
    ContractorId  INT           NULL,              -- dbo.AccountHeadMaster.LHeadId when CONTRACTOR
    StartedOn     DATE          NOT NULL,
    EndedOn       DATE          NULL,              -- NULL = the current source
    CreatedBy     NVARCHAR(200) NULL,
    CreatedAt     DATETIME2(3)  NOT NULL CONSTRAINT DF_DependencyAssignmentSourceLog_CreatedAt DEFAULT (SYSDATETIME()),
    EndedBy       NVARCHAR(200) NULL,
    CONSTRAINT CK_DependencyAssignmentSourceLog_Kind CHECK (Kind IN ('LABOUR', 'MATERIAL'))
  );
  CREATE INDEX IX_DependencyAssignmentSourceLog_Rung ON dbo.DependencyAssignmentSourceLog (RungId, Kind, EndedOn);
  PRINT 'Created dbo.DependencyAssignmentSourceLog';
END
GO

-- Activities already allocated: their current source, from the allocation's start date (or the day it was created).
INSERT INTO dbo.DependencyAssignmentSourceLog (RungId, Kind, Source, ContractorId, StartedOn, CreatedBy)
SELECT a.DependencyMasterActivityId, 'LABOUR', a.LabourSource, a.LabourContractorId,
       COALESCE(a.StartDate, CAST(a.CreatedAt AS DATE)), 'migration 695'
FROM dbo.DependencyActivityAssignment a
WHERE a.IsCurrent = 1 AND a.LabourSource IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.DependencyAssignmentSourceLog l WHERE l.RungId = a.DependencyMasterActivityId AND l.Kind = 'LABOUR');

INSERT INTO dbo.DependencyAssignmentSourceLog (RungId, Kind, Source, ContractorId, StartedOn, CreatedBy)
SELECT a.DependencyMasterActivityId, 'MATERIAL', a.MaterialSource, a.MaterialContractorId,
       COALESCE(a.StartDate, CAST(a.CreatedAt AS DATE)), 'migration 695'
FROM dbo.DependencyActivityAssignment a
WHERE a.IsCurrent = 1 AND a.MaterialSource IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.DependencyAssignmentSourceLog l WHERE l.RungId = a.DependencyMasterActivityId AND l.Kind = 'MATERIAL');
GO

PRINT '695-allocation-source-log applied successfully.';
GO

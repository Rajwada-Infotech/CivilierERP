-- 333: Dependency Activity Assignment — clicking an activity rung inside a
-- linked Dependency chain on Work Reporting opens a form to assign an
-- engineer, a start date, and the material + quantity needed for that
-- specific rung (material list is seeded from dbo.ActivityItems, the same
-- Activity->Item links Activity Master's own "linked items" tab already
-- maintains — see backend/routes/activityItems.js).
--
-- Known tradeoff: dbo.DependencyMasterActivity rows are always delete+
-- reinserted on a Dependency Master edit (see PUT /:id in
-- dependencyMaster.js), and this table's FK cascades on delete — so
-- editing a dependency chain's activities also wipes any assignments made
-- against its old rungs. Acceptable for now; revisit if that turns out to
-- happen often in practice.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityAssignment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyActivityAssignment (
    Id                          INT IDENTITY(1,1) PRIMARY KEY,
    DependencyMasterActivityId INT NOT NULL,
    EngineerId                 INT NULL,
    StartDate                  DATE NULL,
    CreatedBy                  NVARCHAR(200) NULL,
    CreatedAt                  DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy                  NVARCHAR(200) NULL,
    UpdatedAt                  DATETIME2(3) NULL,
    CONSTRAINT FK_DependencyActivityAssignment_Rung
      FOREIGN KEY (DependencyMasterActivityId) REFERENCES dbo.DependencyMasterActivity(Id) ON DELETE CASCADE,
    CONSTRAINT FK_DependencyActivityAssignment_Engineer
      FOREIGN KEY (EngineerId) REFERENCES dbo.users(id),
    -- One assignment per rung — the form always upserts against this
    -- rather than piling up duplicates.
    CONSTRAINT UX_DependencyActivityAssignment_Rung UNIQUE (DependencyMasterActivityId)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityMaterial' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyActivityMaterial (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentId  INT NOT NULL,
    ItemId        UNIQUEIDENTIFIER NOT NULL,
    Quantity      DECIMAL(18,2) NOT NULL DEFAULT 0,
    CONSTRAINT FK_DependencyActivityMaterial_Assignment
      FOREIGN KEY (AssignmentId) REFERENCES dbo.DependencyActivityAssignment(Id) ON DELETE CASCADE,
    CONSTRAINT UX_DependencyActivityMaterial_Assignment_Item UNIQUE (AssignmentId, ItemId)
  );
END
GO

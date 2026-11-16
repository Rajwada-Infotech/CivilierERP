-- Migration 663: Floor Master (Civil Work DPR setup).
-- The floors of a project are read from Auto Project Setup (dbo.CrmProjectAutoSetupFloor, per block). Floors that
-- setup doesn't have — a terrace, a basement, a podium — are added here for the project, either for one block or
-- (BlockId NULL) for every block of it. FloorNo is the floor's number (0 = Ground, negative = basement), which is
-- what a BOQ stores; FloorLabel is the name shown in dropdowns.
IF OBJECT_ID('dbo.DprFloorMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DprFloorMaster (
    Id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DprFloorMaster PRIMARY KEY,
    ProjectId  INT NOT NULL,
    BlockId    INT NULL,
    FloorNo    INT NOT NULL,
    FloorLabel NVARCHAR(50) NOT NULL,
    IsActive   BIT NOT NULL CONSTRAINT DF_DprFloorMaster_IsActive DEFAULT 1,
    CreatedBy  NVARCHAR(200) NULL,
    CreatedAt  DATETIME2 NOT NULL CONSTRAINT DF_DprFloorMaster_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy  NVARCHAR(200) NULL,
    UpdatedAt  DATETIME2 NULL
  );
  CREATE INDEX IX_DprFloorMaster_Project ON dbo.DprFloorMaster (ProjectId, BlockId, FloorNo) WHERE IsActive = 1;
  PRINT 'Migration 663: created DprFloorMaster.';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'dpr-floor-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('dpr-floor-master', 'Floor Master', 'Civil Work DPR', 'Setup', 'view,create,edit,delete', 24, 1, 'migration-663', SYSDATETIME());
  PRINT 'Seeded PageDefinitions dpr-floor-master';
END
GO

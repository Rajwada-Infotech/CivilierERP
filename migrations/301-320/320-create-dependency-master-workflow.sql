-- Migration 320: redesign of Dependency Master — replaces the flat
-- code/name list (dbo.DependencyType, migration 123) with a proper
-- task-scope + linear activity-chain record.
--
-- Scope hierarchy uses the masters that already exist in this codebase:
--   Project  -> dbo.enterprise (business_type='P'), same as room-master.js
--   Tower    -> dbo.BlockMaster (user's "Tower" = this codebase's "Block")
--   Floor    -> dbo.RoomMaster.Floor is free text, not its own master table
--                (see migration 136) — so Floor here is NVARCHAR(50) too,
--                not a FK. The cascade still works: Tower narrows the
--                distinct Floor values (via the Rooms under it), Floor+Tower
--                narrows Flat, Flat+Floor narrows Room.
--   Flat     -> dbo.UnitMaster (user's "Flat" = this codebase's "Unit")
--   Room     -> dbo.RoomMaster
--
-- DependencyType (the old table) is left untouched — orphaned by this
-- redesign but not deleted, since nothing else is known to reference it.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyMaster (
    Id          INT             IDENTITY(1,1) PRIMARY KEY,
    ProjectId   INT             NOT NULL,
    TowerId     INT             NOT NULL,
    Floor       NVARCHAR(50)    NOT NULL,
    FlatId      INT             NOT NULL,
    RoomId      INT             NOT NULL,
    Alias       NVARCHAR(200)   NOT NULL,
    WorkType    NVARCHAR(20)    NOT NULL CONSTRAINT DF_DependencyMaster_WorkType DEFAULT ('INTERNAL'),
    IsActive    BIT             NOT NULL CONSTRAINT DF_DependencyMaster_IsActive DEFAULT (1),
    CreatedBy   NVARCHAR(300)   NULL,
    CreatedAt   DATETIME2(3)    NOT NULL CONSTRAINT DF_DependencyMaster_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy   NVARCHAR(300)   NULL,
    UpdatedAt   DATETIME2(3)    NULL,
    CONSTRAINT FK_DependencyMaster_Tower FOREIGN KEY (TowerId) REFERENCES dbo.BlockMaster(Id),
    CONSTRAINT FK_DependencyMaster_Flat  FOREIGN KEY (FlatId)  REFERENCES dbo.UnitMaster(Id),
    CONSTRAINT FK_DependencyMaster_Room  FOREIGN KEY (RoomId)  REFERENCES dbo.RoomMaster(Id),
    CONSTRAINT CK_DependencyMaster_WorkType CHECK (WorkType IN ('INTERNAL', 'EXTERNAL'))
  );

  CREATE INDEX IX_DependencyMaster_Scope
    ON dbo.DependencyMaster(ProjectId, TowerId, FlatId, RoomId);

  PRINT 'Created dbo.DependencyMaster';
END
ELSE
  PRINT 'dbo.DependencyMaster already exists — skipping create';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyMasterActivity' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyMasterActivity (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    DependencyMasterId  INT NOT NULL,
    ActivityId          INT NOT NULL,
    SequenceNo          INT NOT NULL,
    CONSTRAINT FK_DependencyMasterActivity_Master
      FOREIGN KEY (DependencyMasterId) REFERENCES dbo.DependencyMaster(Id) ON DELETE CASCADE,
    CONSTRAINT FK_DependencyMasterActivity_Activity
      FOREIGN KEY (ActivityId) REFERENCES dbo.ActivityMaster(id)
  );

  -- One sequence number per rung, per chain — reorder always renumbers on
  -- save (delete+reinsert), never a per-drag write, so this stays exact.
  CREATE UNIQUE INDEX UX_DependencyMasterActivity_Sequence
    ON dbo.DependencyMasterActivity(DependencyMasterId, SequenceNo);

  PRINT 'Created dbo.DependencyMasterActivity';
END
ELSE
  PRINT 'dbo.DependencyMasterActivity already exists — skipping create';
GO

PRINT '320-create-dependency-master-workflow applied successfully.';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'RoomMaster' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.RoomMaster (
    Id          INT            IDENTITY(1,1) PRIMARY KEY,
    ProjectId   INT            NOT NULL,
    BlockId     INT            NOT NULL,
    UnitId      INT            NOT NULL,
    RoomName    NVARCHAR(100)  NOT NULL,
    IsActive    BIT            NOT NULL CONSTRAINT DF_RoomMaster_IsActive    DEFAULT (1),
    CreatedBy   INT            NULL,
    CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_RoomMaster_CreatedAt  DEFAULT (SYSDATETIME()),
    UpdatedBy   INT            NULL,
    UpdatedAt   DATETIME2(3)   NULL,
    CONSTRAINT FK_RoomMaster_Unit
      FOREIGN KEY (UnitId) REFERENCES dbo.UnitMaster(Id),
    CONSTRAINT FK_RoomMaster_Block
      FOREIGN KEY (BlockId) REFERENCES dbo.BlockMaster(Id)
  );

  CREATE INDEX IX_RoomMaster_ProjectBlockUnit
    ON dbo.RoomMaster(ProjectId, BlockId, UnitId)
    INCLUDE (RoomName, IsActive);
END
GO

-- Register the page so it shows up in Follow-Up > Setup > Menu Rights
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM dbo.PageDefinitions
    WHERE PageKey = 'followup-room-master' AND IsActive = 1
  )
  BEGIN
    INSERT INTO dbo.PageDefinitions
      (PageKey, Label, Module, GroupName, Actions, SortOrder)
    VALUES
      ('followup-room-master', 'Room Master', 'Follow-Up', 'Follow-Up Setup',
       'view,create,edit,delete,print,export', 125);
    PRINT 'Seeded page definition: followup-room-master';
  END
END
GO

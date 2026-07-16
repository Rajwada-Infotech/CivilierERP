IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'UnitMaster' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.UnitMaster (
    Id          INT            IDENTITY(1,1) PRIMARY KEY,
    ProjectId   INT            NOT NULL,
    BlockId     INT            NOT NULL,
    UnitName    NVARCHAR(100)  NOT NULL,
    IsActive    BIT            NOT NULL CONSTRAINT DF_UnitMaster_IsActive    DEFAULT (1),
    CreatedBy   INT            NULL,
    CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_UnitMaster_CreatedAt  DEFAULT (SYSDATETIME()),
    UpdatedBy   INT            NULL,
    UpdatedAt   DATETIME2(3)   NULL,
    CONSTRAINT FK_UnitMaster_Block
      FOREIGN KEY (BlockId) REFERENCES dbo.BlockMaster(Id)
  );

  CREATE INDEX IX_UnitMaster_ProjectBlock
    ON dbo.UnitMaster(ProjectId, BlockId)
    INCLUDE (UnitName, IsActive);
END

IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE name = 'BlockMaster' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.BlockMaster (
    Id          INT            IDENTITY(1,1) PRIMARY KEY,
    ProjectId   INT            NOT NULL,
    BlockName   NVARCHAR(100)  NOT NULL,
    IsActive    BIT            NOT NULL CONSTRAINT DF_BlockMaster_IsActive DEFAULT (1),
    CreatedBy   INT            NULL,
    CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_BlockMaster_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy   INT            NULL,
    UpdatedAt   DATETIME2(3)   NULL
  );

  CREATE INDEX IX_BlockMaster_ProjectId
    ON dbo.BlockMaster(ProjectId)
    INCLUDE (BlockName, IsActive);
END

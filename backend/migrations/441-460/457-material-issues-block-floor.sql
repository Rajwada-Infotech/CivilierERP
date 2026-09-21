-- Migration 457: Material Issues records which Block and Floor the
-- material was issued for. Both nullable and optional — issues not tied
-- to a specific block/floor (e.g. general site consumption) leave them
-- blank. BlockId references dbo.BlockMaster; FloorNo is a plain number,
-- matching how floors already work on dbo.UnitMaster (no standalone
-- Floor Master table exists in this schema).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'BlockId')
  ALTER TABLE dbo.MaterialIssues ADD BlockId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'FloorNo')
  ALTER TABLE dbo.MaterialIssues ADD FloorNo INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_MaterialIssues_BlockMaster')
  ALTER TABLE dbo.MaterialIssues ADD CONSTRAINT FK_MaterialIssues_BlockMaster
    FOREIGN KEY (BlockId) REFERENCES dbo.BlockMaster(Id);
GO

PRINT '457-material-issues-block-floor applied successfully.';
GO

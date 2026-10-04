-- Migration 465: tag ContractorAllocation to the real Block/Unit hierarchy.
--
-- ContractorAllocation previously only carried a loose ProjectId plus a
-- free-text SiteLocation string — no structural link to BlockMaster/
-- UnitMaster the way the rest of Civil Work DPR (DependencyMaster.TowerId/
-- FlatId/RoomId) already has. Adding nullable BlockId/UnitId with real FK
-- constraints closes that gap; nullable because an allocation can still be
-- project-wide (e.g. a boundary wall contractor not tied to one block).
--
-- Idempotent — safe to re-run.

IF COL_LENGTH('dbo.ContractorAllocation', 'BlockId') IS NULL
BEGIN
  ALTER TABLE dbo.ContractorAllocation ADD BlockId INT NULL;
END
GO

IF COL_LENGTH('dbo.ContractorAllocation', 'UnitId') IS NULL
BEGIN
  ALTER TABLE dbo.ContractorAllocation ADD UnitId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ContractorAlloc_Block')
BEGIN
  ALTER TABLE dbo.ContractorAllocation
    ADD CONSTRAINT FK_ContractorAlloc_Block FOREIGN KEY (BlockId) REFERENCES dbo.BlockMaster(Id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ContractorAlloc_Unit')
BEGIN
  ALTER TABLE dbo.ContractorAllocation
    ADD CONSTRAINT FK_ContractorAlloc_Unit FOREIGN KEY (UnitId) REFERENCES dbo.UnitMaster(Id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ContractorAllocation_Block' AND object_id = OBJECT_ID('dbo.ContractorAllocation'))
BEGIN
  CREATE INDEX IX_ContractorAllocation_Block ON dbo.ContractorAllocation(BlockId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ContractorAllocation_Unit' AND object_id = OBJECT_ID('dbo.ContractorAllocation'))
BEGIN
  CREATE INDEX IX_ContractorAllocation_Unit ON dbo.ContractorAllocation(UnitId);
END
GO

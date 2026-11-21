-- Add structured area breakdown and base rate to UnitMaster.
-- AreaSqFt (legacy single-field) stays and is kept in sync with
-- SuperBuiltUpAreaSqFt by the application layer for backward compat.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'CarpetAreaSqFt')
  ALTER TABLE dbo.UnitMaster ADD CarpetAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'BuiltUpAreaSqFt')
  ALTER TABLE dbo.UnitMaster ADD BuiltUpAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'SuperBuiltUpAreaSqFt')
  ALTER TABLE dbo.UnitMaster ADD SuperBuiltUpAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'OpenTerraceAreaSqFt')
  ALTER TABLE dbo.UnitMaster ADD OpenTerraceAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'RatePerSqFt')
  ALTER TABLE dbo.UnitMaster ADD RatePerSqFt DECIMAL(18,2) NULL;

-- Backfill via EXEC so SQL Server compiles the UPDATE in a fresh sub-batch
-- after the ALTER TABLE columns above are already committed — referencing a
-- newly added column in the same batch as the ALTER TABLE causes a compile-time
-- "Invalid column name" error because SQL Server validates the whole batch upfront.
EXEC ('UPDATE dbo.UnitMaster SET SuperBuiltUpAreaSqFt = AreaSqFt WHERE SuperBuiltUpAreaSqFt IS NULL AND AreaSqFt IS NOT NULL');

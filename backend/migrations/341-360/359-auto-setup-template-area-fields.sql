-- Add area breakdown and rate fields to the auto-setup unit template table
-- so a block's "typical floor" mix can carry the full structural breakdown,
-- not just a single undifferentiated area. generate-units uses these when
-- creating UnitMaster rows for each floor.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmProjectAutoSetupUnitTemplate') AND name = 'CarpetAreaSqFt')
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD CarpetAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmProjectAutoSetupUnitTemplate') AND name = 'BuiltUpAreaSqFt')
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD BuiltUpAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmProjectAutoSetupUnitTemplate') AND name = 'SuperBuiltUpAreaSqFt')
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD SuperBuiltUpAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmProjectAutoSetupUnitTemplate') AND name = 'OpenTerraceAreaSqFt')
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD OpenTerraceAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmProjectAutoSetupUnitTemplate') AND name = 'RatePerSqFt')
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD RatePerSqFt DECIMAL(18,2) NULL;

-- Backfill via EXEC — same reason as migration 342: SQL Server validates the
-- whole batch at compile time, so a column added by ALTER TABLE in the same
-- batch can't be referenced by a subsequent UPDATE without a fresh sub-batch.
EXEC ('UPDATE dbo.CrmProjectAutoSetupUnitTemplate SET SuperBuiltUpAreaSqFt = AreaSqFt WHERE SuperBuiltUpAreaSqFt IS NULL AND AreaSqFt IS NOT NULL');

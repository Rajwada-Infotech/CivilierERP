-- Migration 393: "Type of Repairs SAC Code" on the Fixed Asset Record
-- (Fixed Asset Depreciation Tag page).
--
-- Holds a Service Accounting Code (SAC) chosen from the Material-module
-- HSN master (dbo.HSN) — specifically the rows flagged HIsSAC = 1. Stored
-- as the SAC code string (dbo.HSN.HCode); nullable, existing rows keep NULL.
-- No CHECK constraint: the list of valid SAC codes is data-driven from
-- dbo.HSN, not a fixed enum.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'RepairType')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord ADD RepairType NVARCHAR(50) NULL;
  PRINT 'Added dbo.FixedAssetRecord.RepairType';
END
ELSE
  PRINT 'dbo.FixedAssetRecord.RepairType already exists';
GO

-- Drop the old fixed-enum CHECK if a prior version of this migration added it.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FixedAssetRecord_RepairType')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord DROP CONSTRAINT CK_FixedAssetRecord_RepairType;
  PRINT 'Dropped CK_FixedAssetRecord_RepairType (SAC codes are data-driven)';
END
GO

PRINT '393-fixed-asset-repair-type applied successfully.';
GO

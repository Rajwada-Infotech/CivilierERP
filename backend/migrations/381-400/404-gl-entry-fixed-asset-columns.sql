-- ============================================================
-- Migration 404: direct Fixed-Asset linkage columns on the GL row
--
-- GL rows for depreciation (SourceType = 'FADepreciation') and FA
-- maintenance (SourceType = 'FAMaintenance') currently link to their asset
-- only indirectly: SourceId -> the source entry row -> AssetId. This adds
-- AssetId / FinYear / FAItemCode straight onto dbo.GeneralLedgerEntry so
-- asset-wise / FY-wise Fixed-Asset reporting can read the ledger without
-- hopping through the source tables, and so every depreciation voucher
-- carries its own audit-friendly Fixed-Asset reference.
--
-- All three columns are NULLable — every non-Fixed-Asset module leaves
-- them NULL. Populated going forward by services/generalLedger.js
-- postVoucher() (new optional assetId / finYear / faItemCode options),
-- passed by the depreciation and maintenance posting services.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GeneralLedgerEntry' AND COLUMN_NAME = 'AssetId'
)
  ALTER TABLE dbo.GeneralLedgerEntry ADD AssetId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GeneralLedgerEntry' AND COLUMN_NAME = 'FinYear'
)
  ALTER TABLE dbo.GeneralLedgerEntry ADD FinYear NVARCHAR(20) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GeneralLedgerEntry' AND COLUMN_NAME = 'FAItemCode'
)
  ALTER TABLE dbo.GeneralLedgerEntry ADD FAItemCode NVARCHAR(200) NULL;
GO

-- Asset-wise GL reporting index (filtered — only Fixed-Asset rows carry AssetId)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_GeneralLedgerEntry_AssetId' AND object_id = OBJECT_ID('dbo.GeneralLedgerEntry')
)
  CREATE NONCLUSTERED INDEX IX_GeneralLedgerEntry_AssetId
    ON dbo.GeneralLedgerEntry (AssetId)
    INCLUDE (FinYear, LHeadId, DebitAmount, CreditAmount, IsReversed)
    WHERE AssetId IS NOT NULL;
GO

-- ── Backfill: depreciation vouchers ───────────────────────────────────────
UPDATE g
  SET g.AssetId    = e.AssetId,
      g.FinYear    = e.FinYear,
      g.FAItemCode = fa.FAItemCode
FROM dbo.GeneralLedgerEntry g
JOIN dbo.FixedAssetDepreciationEntry e ON e.EntryId = g.SourceId
LEFT JOIN dbo.FixedAssetRecord fa ON fa.AssetId = e.AssetId
WHERE g.SourceType = 'FADepreciation' AND g.AssetId IS NULL;
GO

-- ── Backfill: FA maintenance vouchers ─────────────────────────────────────
UPDATE g
  SET g.AssetId    = m.AssetId,
      g.FinYear    = m.FinYear,
      g.FAItemCode = m.FAItemCode
FROM dbo.GeneralLedgerEntry g
JOIN dbo.FixedAssetMaintenance m ON m.MaintenanceId = g.SourceId
WHERE g.SourceType = 'FAMaintenance' AND g.AssetId IS NULL;
GO

PRINT '404-gl-entry-fixed-asset-columns applied successfully.';
GO

-- Migration 185: Add ActivationDate to dbo.FixedAssetRecord
-- The date an asset was actually put into service, which can differ from
-- PurchaseDate (e.g. an asset sitting in storage before deployment).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'ActivationDate'
)
BEGIN
  ALTER TABLE dbo.FixedAssetRecord
    ADD ActivationDate DATE NULL;
  PRINT 'Added ActivationDate to FixedAssetRecord';
END

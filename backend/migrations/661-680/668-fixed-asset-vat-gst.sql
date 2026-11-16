-- Migration 668: VAT / GST on fixed assets.
-- GST started in India on 1 July 2017; an asset bought before that paid VAT instead (services/faTax.js).
--   TaxType   'VAT' (purchase date before 2017-07-01) or 'GST' (on or after)
--   TaxPct    the tax rate on the purchase
--   TaxAmount the tax in rupees. VAT couldn't be claimed back, so it is part of PurchaseCost (and depreciated);
--             GST is claimed as input credit, so it is recorded here but not in PurchaseCost.
-- Existing assets stay NULL (no tax recorded); their PurchaseCost is unchanged.
IF COL_LENGTH('dbo.FixedAssetRecord', 'TaxType') IS NULL
  ALTER TABLE dbo.FixedAssetRecord ADD TaxType NVARCHAR(10) NULL;
GO
IF COL_LENGTH('dbo.FixedAssetRecord', 'TaxPct') IS NULL
  ALTER TABLE dbo.FixedAssetRecord ADD TaxPct DECIMAL(9,4) NULL;
GO
IF COL_LENGTH('dbo.FixedAssetRecord', 'TaxAmount') IS NULL
  ALTER TABLE dbo.FixedAssetRecord ADD TaxAmount DECIMAL(18,2) NULL;
GO

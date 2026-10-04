-- Migration 394: GST on FA Maintenance & Repair.
--
-- The repair spend now carries GST. The applicable rate is configuration-
-- driven, resolved at posting time:
--
--   FA Item Code (dbo.FixedAssetRecord)
--     -> RepairType  = SAC Code   (set on the Fixed Asset Depreciation Tag)
--       -> dbo.HSN row (HCode = SAC, HIsSAC = 1, HStatus = 1)
--         -> HCGST + HSGST  (or HIGST)  = GST rate %
--
-- Posting (see services/fixedAssetMaintenancePosting.js):
--   Dr  Repairs & Maintenance - Direct / Indirect A/c   (taxable)
--   Dr  GST Credit Available  (the ERP's input-GST-credit ledger, code GSTCA)  (GST)
--   Cr  <Vendor ledger>                                 (taxable + GST)
--
-- These columns store the snapshot of what was computed, for audit / display.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetMaintenance') AND name = 'SacCode')
  ALTER TABLE dbo.FixedAssetMaintenance ADD SacCode NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetMaintenance') AND name = 'GstRatePct')
  ALTER TABLE dbo.FixedAssetMaintenance ADD GstRatePct DECIMAL(9,4) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetMaintenance') AND name = 'TaxableAmount')
  ALTER TABLE dbo.FixedAssetMaintenance ADD TaxableAmount DECIMAL(18,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetMaintenance') AND name = 'GstAmount')
  ALTER TABLE dbo.FixedAssetMaintenance ADD GstAmount DECIMAL(18,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetMaintenance') AND name = 'TotalAmount')
  ALTER TABLE dbo.FixedAssetMaintenance ADD TotalAmount DECIMAL(18,2) NULL;
GO

-- Backfill existing rows: no GST was applied before this migration.
UPDATE dbo.FixedAssetMaintenance
  SET TaxableAmount = ISNULL(TaxableAmount, Amount),
      GstAmount     = ISNULL(GstAmount, 0),
      TotalAmount   = ISNULL(TotalAmount, Amount)
  WHERE TaxableAmount IS NULL OR GstAmount IS NULL OR TotalAmount IS NULL;
GO

PRINT '394-fa-maintenance-gst applied successfully.';
GO

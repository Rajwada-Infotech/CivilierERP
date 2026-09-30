-- 497-ict-source-mr-link.sql
-- Lets an Inter-Company Stock Transfer be raised from a Material Request,
-- same linkage shape migration 056 already added for PurchaseOrders
-- (SourceMRId/SourceMRDocNo on the header, MRItemId on the line items) —
-- reused here rather than inventing a second, parallel tracking mechanism.
-- Partial fulfillment itself needs no new column: MaterialRequestItems has
-- no stored "remaining qty" — it's always computed live in
-- services/materialRequestFulfillment.js by summing what's already been
-- consumed against each MRItemId. This migration only adds the FK surface
-- for ICT to participate in that same computation.
-- Safe to run multiple times.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.InterCompanyTransfer') AND name = 'SourceMRId'
)
BEGIN
  ALTER TABLE dbo.InterCompanyTransfer
    ADD SourceMRId INT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.InterCompanyTransfer') AND name = 'SourceMRDocNo'
)
BEGIN
  ALTER TABLE dbo.InterCompanyTransfer
    ADD SourceMRDocNo NVARCHAR(100) NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.InterCompanyTransfer') AND name = 'IX_ICT_SourceMRId'
)
BEGIN
  CREATE INDEX IX_ICT_SourceMRId
    ON dbo.InterCompanyTransfer (SourceMRId)
    WHERE SourceMRId IS NOT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.InterCompanyTransferItems') AND name = 'MRItemId'
)
BEGIN
  ALTER TABLE dbo.InterCompanyTransferItems
    ADD MRItemId INT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.InterCompanyTransferItems') AND name = 'IX_ICTI_MRItemId'
)
BEGIN
  CREATE INDEX IX_ICTI_MRItemId
    ON dbo.InterCompanyTransferItems (MRItemId)
    WHERE MRItemId IS NOT NULL;
END;
GO

PRINT '497-ict-source-mr-link completed.';

-- Migration 545: a Material Request can be raised from an approved Work Order.
--
-- dbo.MaterialRequests gets SourceWOId / SourceWODocNo (same pattern as dbo.PurchaseOrders.SourceWOId and
-- dbo.Quotations.SourceMRId) so the document chain can run Work Order -> Material Request -> Quotation -> PO -> GRN
-- -> Invoice. Both are nullable: every existing MR (and every MR raised by hand) stays as it is.
-- No foreign key on purpose, to match SourceMRId on Quotations / PurchaseOrders.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialRequests' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  IF COL_LENGTH('dbo.MaterialRequests', 'SourceWOId') IS NULL
    ALTER TABLE dbo.MaterialRequests ADD SourceWOId INT NULL;
  IF COL_LENGTH('dbo.MaterialRequests', 'SourceWODocNo') IS NULL
    ALTER TABLE dbo.MaterialRequests ADD SourceWODocNo NVARCHAR(100) NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialRequests' AND schema_id = SCHEMA_ID('dbo'))
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MaterialRequests_SourceWOId' AND object_id = OBJECT_ID('dbo.MaterialRequests'))
  EXEC('CREATE INDEX IX_MaterialRequests_SourceWOId ON dbo.MaterialRequests(SourceWOId) WHERE SourceWOId IS NOT NULL');
GO

PRINT '545-material-request-source-work-order applied successfully.';
GO

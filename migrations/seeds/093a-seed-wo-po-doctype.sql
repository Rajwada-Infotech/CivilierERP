-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 093: Seed WO_PO document type in TypeOfDoc
-- Safe to run multiple times (guarded by IF NOT EXISTS on Prefix).
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE Prefix = 'WO-PO')
BEGIN
  DECLARE @EId UNIQUEIDENTIFIER = (
    SELECT TOP 1 E_Id FROM dbo.Entry_Type WHERE EntryType = 'Purchase Order'
  );
  IF @EId IS NULL
    SELECT TOP 1 @EId = E_Id FROM dbo.Entry_Type;

  INSERT INTO dbo.TypeOfDoc
    (Prefix, Description, EntryTypeId, IsActive, StartingDocNo, DocNoPadding, CreatedBy, CreatedAt)
  VALUES
    ('WO-PO', 'Work Order Purchase Order', @EId, 1, 1, 5, 'migration', GETDATE());

  PRINT 'Seeded WO-PO document type';
END
ELSE
BEGIN
  PRINT 'WO-PO document type already exists';
END
GO

-- Guard columns on PurchaseOrders (already present in earlier migrations, safety only)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SourceWOId')
  ALTER TABLE dbo.PurchaseOrders ADD SourceWOId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SourceWODocNo')
  ALTER TABLE dbo.PurchaseOrders ADD SourceWODocNo NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'POType')
  ALTER TABLE dbo.PurchaseOrders ADD POType NVARCHAR(20) NULL;
GO

PRINT 'Migration 093 complete';
GO

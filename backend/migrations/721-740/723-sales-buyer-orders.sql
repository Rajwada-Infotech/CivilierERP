-- Migration 723: Sale Orders sell our materials to a buyer.
--
-- A sale order used to move stock between two of our own godowns (From → To company/project/godown). It now sells
-- from one godown to a buyer — any ledger (AccountHeadMaster), the same list the Journal Voucher offers — with
-- item, UOM, qty, rate and GST % per line. On final approval the stock goes OUT of the godown and the sale is posted:
-- Dr buyer (grand total) / Cr the selling company's own sales ledger "Sales - <Company>" (basic; created on first use,
-- code SALES-C-<companyId>) / Cr GST Output A/c (tax).
--
--   1. SaleOrders: the To* columns become optional (old transfer orders keep theirs), plus BuyerLHeadId,
--      BasicAmount, TaxAmount and GLPosted (so a Sale Invoice made from it doesn't post the sale a second time).
--   2. The GST Output A/c GL head (under the Duties & Taxes group), found by its code SALES-GST-OUTPUT.
--   3. The 'sales-stock-update' page (Sales → Setup → Stock Update) for the rights system.

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaleOrders') AND name = 'ToCompanyID' AND is_nullable = 0)
  ALTER TABLE dbo.SaleOrders ALTER COLUMN ToCompanyID INT NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaleOrders') AND name = 'ToProjectID' AND is_nullable = 0)
  ALTER TABLE dbo.SaleOrders ALTER COLUMN ToProjectID INT NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaleOrders') AND name = 'ToGodownID' AND is_nullable = 0)
  ALTER TABLE dbo.SaleOrders ALTER COLUMN ToGodownID INT NULL;
GO

IF COL_LENGTH('dbo.SaleOrders', 'BuyerLHeadId') IS NULL
  ALTER TABLE dbo.SaleOrders ADD BuyerLHeadId INT NULL;
GO
IF COL_LENGTH('dbo.SaleOrders', 'BasicAmount') IS NULL
  ALTER TABLE dbo.SaleOrders ADD BasicAmount DECIMAL(18, 2) NULL;
GO
IF COL_LENGTH('dbo.SaleOrders', 'TaxAmount') IS NULL
  ALTER TABLE dbo.SaleOrders ADD TaxAmount DECIMAL(18, 2) NULL;
GO
IF COL_LENGTH('dbo.SaleOrders', 'GLPosted') IS NULL
  ALTER TABLE dbo.SaleOrders ADD GLPosted BIT NOT NULL CONSTRAINT DF_SaleOrders_GLPosted DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SaleOrders_Buyer' AND object_id = OBJECT_ID('dbo.SaleOrders'))
  CREATE INDEX IX_SaleOrders_Buyer ON dbo.SaleOrders (BuyerLHeadId) WHERE BuyerLHeadId IS NOT NULL;
GO

-- 2. GL head -----------------------------------------------------------------------------------------------------
DECLARE @dutiesGroupId INT;
SELECT TOP 1 @dutiesGroupId = AGId FROM dbo.AccountGroup WHERE Name LIKE '%DUT%TAX%' OR Name LIKE '%TAX%PAYABLE%' OR Code IN ('DT', 'DTX', 'DAT');
IF @dutiesGroupId IS NULL SET @dutiesGroupId = 8;

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'SALES-GST-OUTPUT')
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LCountry, IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('GST Output A/c', 'SALES-GST-OUTPUT', 'GL', 1, 'Approved', @dutiesGroupId,
     'N/A', 'N/A', 'N/A', 'India', 1, 'migration-723', SYSDATETIME());
GO

-- 3. Sales → Setup → Stock Update -----------------------------------------------------------------------------------
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'sales-stock-update', 'Stock Update', 'Sales', 'Sales', 'view,create,edit,print,export', 160, 1, 'migration-723', SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'sales-stock-update' AND IsActive = 1);
GO

PRINT '723-sales-buyer-orders applied successfully.';
GO

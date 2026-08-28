-- Migration 365: Fixed Asset Record "Delete & Reverse" + Inventory Import.
--
-- Two additions, kept deliberately separate from the existing (safe)
-- soft-delete on Fixed Asset Record:
--
--   1. A 'reverse' PageDefinitions action on fixed-asset-record — gates a
--      NEW, distinct "Delete & Reverse GRN" action (backend: GET
--      /api/fixed-assets/:id/can-reverse + POST /api/fixed-assets/:id/reverse)
--      that hard-removes the GRN/Import-derived batch, its FA Item Code
--      tags, any completed unit records, and the specific StockLedger
--      entries it created — leaving everything else (other items on the
--      same GRN, other assets) untouched. The plain "Delete" button and its
--      existing soft-delete behaviour are unchanged.
--
--   2. dbo.FixedAssetInventoryImport — lets an asset that was never
--      received through a GRN (or whose original GRN is gone) be manually
--      brought into Fixed Asset Inventory. It creates a batch
--      dbo.FixedAssetRecord row + a StockLedger entry exactly the way GRN
--      approval does (SourceType = 'IMPORT' instead of 'GRN'), so it flows
--      through the identical tagging/record workflow afterwards.

-- ── 1. 'reverse' action on fixed-asset-record ────────────────────────────────
UPDATE dbo.PageDefinitions
SET Actions = 'view,create,edit,delete,reverse,print,export'
WHERE PageKey = 'fixed-asset-record' AND Actions NOT LIKE '%reverse%';
GO

-- ── 2. dbo.FixedAssetInventoryImport ──────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'FixedAssetInventoryImport'
)
BEGIN
  CREATE TABLE dbo.FixedAssetInventoryImport (
    ImportId     INT IDENTITY(1,1) PRIMARY KEY,
    DocNo        NVARCHAR(100)  NULL,
    DocDate      DATE           NULL,
    CompanyId    INT            NULL,
    ProjectId    INT            NULL,
    GodownId     INT            NOT NULL,
    ItemId       NVARCHAR(100)  NOT NULL,
    ItemName     NVARCHAR(200)  NULL,
    Quantity     DECIMAL(18,3)  NOT NULL,
    Rate         DECIMAL(18,2)  NULL,
    Remarks      NVARCHAR(MAX)  NULL,
    Status       NVARCHAR(20)   NOT NULL CONSTRAINT DF_FAII_Status DEFAULT 'Active'
                   CONSTRAINT CK_FAII_Status CHECK (Status IN ('Active','Reversed')),
    AssetId      INT            NULL,  -- the batch FixedAssetRecord row this import created
    CreatedBy    NVARCHAR(200)  NULL,
    CreatedAt    DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    ReversedBy   NVARCHAR(200)  NULL,
    ReversedAt   DATETIME2      NULL,
    CONSTRAINT FK_FAII_Godown FOREIGN KEY (GodownId) REFERENCES dbo.Godowns(GodownID)
  );
  PRINT 'Created dbo.FixedAssetInventoryImport';
END
ELSE
  PRINT 'dbo.FixedAssetInventoryImport already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAII_ItemId' AND object_id = OBJECT_ID('dbo.FixedAssetInventoryImport'))
  CREATE INDEX IX_FAII_ItemId ON dbo.FixedAssetInventoryImport(ItemId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAII_AssetId' AND object_id = OBJECT_ID('dbo.FixedAssetInventoryImport'))
  CREATE INDEX IX_FAII_AssetId ON dbo.FixedAssetInventoryImport(AssetId);
GO

-- ── 3. TypeOfDoc — FAI prefix for Inventory Import doc numbers ───────────────
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FAI')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('FAI', 'FAI', 'Fixed Asset Inventory Import', 1, 5, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc FAI';
END
ELSE
  PRINT 'TypeOfDoc FAI already exists';
GO

-- ── 4. PageDefinitions — fixed-asset-inventory-import ────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fixed-asset-inventory-import' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('fixed-asset-inventory-import', 'Inventory Import', 'Fixed Asset', 'Fixed Asset', 'view,create,delete', 235, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions fixed-asset-inventory-import';
END
ELSE
  PRINT 'PageDefinitions fixed-asset-inventory-import already exists';
GO

PRINT '365-fixed-asset-reverse-and-import applied successfully.';
GO

-- Migration 183: Fixed Asset Record module
-- Creates DepreciationSetup master + FixedAssetRecord table,
-- seeds TypeOfDoc (FA) and PageDefinitions for both pages.

-- ── 1. DepreciationSetup ─────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'DepreciationSetup'
)
BEGIN
  CREATE TABLE dbo.DepreciationSetup (
    SetupId          INT IDENTITY(1,1) PRIMARY KEY,
    AssetCategory    NVARCHAR(100) NOT NULL,
    DepreciationType NVARCHAR(50)  NOT NULL DEFAULT 'SLM',
    DepreciationRate DECIMAL(5,2)  NOT NULL,
    EffectiveFrom    DATE          NOT NULL,
    Status           NVARCHAR(20)  NOT NULL DEFAULT 'Active',
    CreatedBy        NVARCHAR(200) NULL,
    CreatedAt        DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy        NVARCHAR(200) NULL,
    UpdatedAt        DATETIME2     NULL,
    CONSTRAINT CK_DeprecSetup_Status CHECK (Status IN ('Active','Inactive'))
  );
  PRINT 'Created dbo.DepreciationSetup';
END
ELSE
  PRINT 'dbo.DepreciationSetup already exists';

-- ── 2. FixedAssetRecord ──────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'FixedAssetRecord'
)
BEGIN
  CREATE TABLE dbo.FixedAssetRecord (
    AssetId              INT IDENTITY(1,1) PRIMARY KEY,
    DocNo                NVARCHAR(100) NULL,
    DocDate              DATE          NULL,
    CompanyId            INT           NULL,
    ProjectId            INT           NULL,
    FinYear              NVARCHAR(20)  NULL,
    -- asset identity
    AssetName            NVARCHAR(200) NOT NULL,
    AssetCategory        NVARCHAR(100) NOT NULL,
    AssetCode            NVARCHAR(50)  NULL,
    Brand                NVARCHAR(100) NULL,
    Model                NVARCHAR(100) NULL,
    SerialNumber         NVARCHAR(100) NULL,
    -- purchase
    PurchaseDate         DATE          NULL,
    PurchaseInvoiceRef   NVARCHAR(100) NULL,
    SupplierId           INT           NULL,
    PurchaseCost         DECIMAL(18,2) NOT NULL DEFAULT 0,
    Quantity             DECIMAL(18,3) NOT NULL DEFAULT 1,
    -- location / assignment
    Location             NVARCHAR(200) NULL,
    Department           NVARCHAR(100) NULL,
    Custodian            NVARCHAR(200) NULL,
    -- depreciation (denormalised from setup at time of entry)
    DepreciationSetupId  INT           NULL,
    DepreciationType     NVARCHAR(50)  NULL,
    DepreciationRate     DECIMAL(5,2)  NULL,
    UsefulLife           INT           NULL,
    -- status
    AssetStatus          NVARCHAR(30)  NOT NULL DEFAULT 'Active',
    -- sale
    SellingPrice         DECIMAL(18,2) NULL,
    SaleDate             DATE          NULL,
    BuyerName            NVARCHAR(200) NULL,
    SaleRemarks          NVARCHAR(MAX) NULL,
    -- misc
    Remarks              NVARCHAR(MAX) NULL,
    Status               NVARCHAR(30)  NOT NULL DEFAULT 'Draft',
    CreatedBy            NVARCHAR(200) NULL,
    CreatedAt            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy            NVARCHAR(200) NULL,
    UpdatedAt            DATETIME2     NULL,
    CONSTRAINT CK_FAR_AssetStatus CHECK (AssetStatus IN ('Active','Sold','Scrapped','Under Maintenance')),
    CONSTRAINT CK_FAR_Status      CHECK (Status IN ('Draft','Approved','Deleted'))
  );
  PRINT 'Created dbo.FixedAssetRecord';
END
ELSE
  PRINT 'dbo.FixedAssetRecord already exists';

-- ── 3. TypeOfDoc — FA prefix ─────────────────────────────────────────────────
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FA')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('FA', 'FA', 'Fixed Asset Record', 1, 5, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc FA';
END
ELSE
  PRINT 'TypeOfDoc FA already exists';

-- ── 4. PageDefinitions ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fixed-asset-record' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('fixed-asset-record', 'Fixed Asset Record', 'Material', 'Material', 'view,create,edit,delete,print,export', 230, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions fixed-asset-record';
END

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'depreciation-setup' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('depreciation-setup', 'Depreciation Setup', 'Material', 'Material Setup', 'view,create,edit,delete', 231, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions depreciation-setup';
END

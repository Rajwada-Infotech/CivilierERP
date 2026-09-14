-- Migration 392: FA Maintenance & Repair — records maintenance/repair spend
-- against a specific Fixed Asset (FA Item Code) and posts the resulting
-- double-entry voucher to dbo.GeneralLedgerEntry (via
-- backend/services/fixedAssetMaintenancePosting.js).
--
-- Standard posting:
--   Dr  Repairs & Maintenance - Direct/Indirect A/c   (amount)
--   Cr  Vendor A/c                                     (amount)
--
-- The expense head is chosen from RepairExpenseType ('Direct' | 'Indirect').
-- Doc Number is user-entered (not auto-sequenced) and must be unique within
-- the same Company + Project among non-cancelled records.

------------------------------------------------------------------------------
-- 1. dbo.FixedAssetMaintenance
------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FixedAssetMaintenance' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.FixedAssetMaintenance (
    MaintenanceId     INT IDENTITY(1,1) PRIMARY KEY,
    DocNo             NVARCHAR(100) NOT NULL,   -- user-entered
    DocDate           DATE          NOT NULL,
    FinYear           NVARCHAR(20)  NULL,
    CompanyId         INT           NOT NULL,
    ProjectId         INT           NOT NULL,
    -- Fixed Asset link (every record is tied to one valid FA Item Code)
    AssetId           INT           NOT NULL,
    FAItemCode        NVARCHAR(200) NULL,       -- snapshot at save time
    ItemName          NVARCHAR(200) NULL,       -- snapshot at save time
    -- vendor (an AccountHeadMaster row — LHeadId; no FK, mirrors
    -- dbo.FixedAssetRecord.SupplierId)
    VendorId          INT           NOT NULL,
    VendorName        NVARCHAR(200) NULL,       -- snapshot at save time
    RepairExpenseType NVARCHAR(20)  NOT NULL,   -- 'Direct' | 'Indirect'
    Amount            DECIMAL(18,2) NOT NULL,
    Remarks           NVARCHAR(MAX) NULL,
    -- posting
    Status            NVARCHAR(20)  NOT NULL CONSTRAINT DF_FAM_Status DEFAULT 'Draft',
    VoucherNo         NVARCHAR(50)  NULL,
    PostedBy          NVARCHAR(200) NULL,
    PostedAt          DATETIME2     NULL,
    -- audit
    CreatedBy         NVARCHAR(200) NULL,
    CreatedAt         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy         NVARCHAR(200) NULL,
    UpdatedAt         DATETIME2     NULL,
    CONSTRAINT FK_FAM_Asset   FOREIGN KEY (AssetId)   REFERENCES dbo.FixedAssetRecord(AssetId),
    CONSTRAINT CK_FAM_RepairType CHECK (RepairExpenseType IN ('Direct','Indirect')),
    CONSTRAINT CK_FAM_Status     CHECK (Status IN ('Draft','Posted','Cancelled')),
    CONSTRAINT CK_FAM_Amount     CHECK (Amount > 0)
  );
  PRINT 'Created dbo.FixedAssetMaintenance';
END
ELSE
  PRINT 'dbo.FixedAssetMaintenance already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAM_AssetId' AND object_id = OBJECT_ID('dbo.FixedAssetMaintenance'))
  CREATE INDEX IX_FAM_AssetId ON dbo.FixedAssetMaintenance(AssetId);
GO
-- Doc Number is system-generated (TypeOfDoc 'FAMR', see below) and globally
-- unique among non-cancelled records.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FAM_DocNo_Scope' AND object_id = OBJECT_ID('dbo.FixedAssetMaintenance'))
  CREATE UNIQUE INDEX UX_FAM_DocNo_Scope
    ON dbo.FixedAssetMaintenance(DocNo)
    WHERE Status <> 'Cancelled';
GO

-- ── TypeOfDoc — FAMR prefix (auto Doc Number, e.g. FAMR-2026-000001) ────────
-- Reuses the shared doc-number engine (utils/docNumberLock.js) exactly like
-- FA Assignment ('FAA') and FA Quality Check ('FAQ').
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type);
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FAMR')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('FAMR', 'FAMR', 'FA Maintenance & Repair', 1, 6, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc FAMR';
END
ELSE
  PRINT 'TypeOfDoc FAMR already exists';
GO

------------------------------------------------------------------------------
-- 2. Expense GL heads — Direct / Indirect Repairs & Maintenance
------------------------------------------------------------------------------
DECLARE @IE INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'IE');
DECLARE @DirectGrp INT = (
  SELECT TOP 1 AGId FROM dbo.AccountGroup
  WHERE (Name LIKE '%DIRECT EXPENSE%' AND Name NOT LIKE '%INDIRECT%') OR Code = 'DE'
  ORDER BY AGId
);
IF @DirectGrp IS NULL SET @DirectGrp = (SELECT ParentGroupId FROM dbo.AccountGroup WHERE Code = 'IE');
IF @DirectGrp IS NULL SET @DirectGrp = @IE;
IF @IE IS NULL SET @IE = @DirectGrp;

IF @IE IS NULL OR @DirectGrp IS NULL
BEGIN
  RAISERROR('392: no usable expense AccountGroup found (Code IE missing) -- aborting', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'RM-DIRECT')
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LBranchName, LCountry,
     IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('Repairs & Maintenance - Direct A/c', 'RM-DIRECT', 'GL', 1, 'Approved', @DirectGrp,
     'N/A', 'N/A', 'N/A', 'Main', 'India',
     1, 'migration', SYSDATETIME());
  PRINT 'Seeded GL head: Repairs & Maintenance - Direct A/c';
END
ELSE
  PRINT 'GL head Repairs & Maintenance - Direct A/c already exists';

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'RM-INDIRECT')
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LBranchName, LCountry,
     IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('Repairs & Maintenance - Indirect A/c', 'RM-INDIRECT', 'GL', 1, 'Approved', @IE,
     'N/A', 'N/A', 'N/A', 'Main', 'India',
     1, 'migration', SYSDATETIME());
  PRINT 'Seeded GL head: Repairs & Maintenance - Indirect A/c';
END
ELSE
  PRINT 'GL head Repairs & Maintenance - Indirect A/c already exists';
GO

------------------------------------------------------------------------------
-- 3. PageDefinitions — fixed-asset-maintenance
------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fixed-asset-maintenance' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('fixed-asset-maintenance', 'FA Maintenance & Repair', 'Fixed Asset', 'Fixed Asset', 'view,create,edit,delete', 238, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions fixed-asset-maintenance';
END
ELSE
  PRINT 'PageDefinitions fixed-asset-maintenance already exists';
GO

PRINT '392-fa-maintenance-repair applied successfully.';
GO

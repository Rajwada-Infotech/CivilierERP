-- ============================================================
-- Migration: 115-create-vehicle-in-out.sql
--
-- Creates the VehicleInOut table and seeds:
--   1. dbo.TypeOfDoc  → prefix "VEH", Tier-2 dash format (VEH-2026-00001)
--   2. dbo.VehicleInOut — header-only transaction table (no line items)
--
-- Safe to run multiple times (all operations guarded).
-- ============================================================

SET NOCOUNT ON;
GO

-- ── 1. Seed TypeOfDoc row for VEH ───────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'VEH'
)
BEGIN
    DECLARE @EntryTypeId UNIQUEIDENTIFIER = (
        SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt
    );

    INSERT INTO dbo.TypeOfDoc
        (Prefix, DocNoPrefix, Description, ModuleCode, links_to,
         FinYearReset, IsActive, EntryTypeId, CreatedBy, CreatedAt)
    VALUES
        ('VEH', 'VEH', 'Vehicle In/Out', 'VEH', 'Vehicle In/Out',
         1, 1, @EntryTypeId, 'migration', GETDATE());

    PRINT 'TypeOfDoc seeded: VEH';
END
ELSE
    PRINT 'TypeOfDoc VEH already exists — skipped.';
GO

-- ── 2. Create VehicleInOut table ────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VehicleInOut'
)
BEGIN
    CREATE TABLE dbo.VehicleInOut (
        VehicleInOutID   INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,

        -- Document identity
        DocNo            NVARCHAR(50)   NULL,                          -- VEH-2026-00001
        DocTypeId        INT            NULL,                          -- FK → TypeOfDoc
        DocDate          DATE           NOT NULL DEFAULT CAST(GETDATE() AS DATE),

        -- Org context (from dbo.enterprise)
        CompanyID        INT            NULL,                          -- business_type='C'
        ProjectID        INT            NULL,                          -- business_type='P'
        FinYear          NVARCHAR(20)   NULL,                          -- e.g. "2026-2027"

        -- Supplier / PO link
        SupplierID       INT            NULL,                          -- FK → AccountHeadMaster
        SupplierName     NVARCHAR(255)  NULL,                          -- denormalized
        POID             INT            NULL,                          -- FK → PurchaseOrders
        PONumber         NVARCHAR(100)  NULL,                          -- denormalized

        -- Vehicle details
        VehicleNo        NVARCHAR(50)   NOT NULL,
        EntryTime        DATETIME       NOT NULL DEFAULT GETDATE(),
        ExitTime         DATETIME       NULL,

        -- Challan / reference
        ChallanNo        NVARCHAR(100)  NULL,                          -- Supplier Ref / Challan No

        -- Attachment (car plate photo or any doc)
        AttachmentPath   NVARCHAR(500)  NULL,

        -- Misc
        Remarks          NVARCHAR(1000) NULL,
        Status           NVARCHAR(30)   NOT NULL DEFAULT 'Draft',

        -- Audit
        CreatedAt        DATETIME       NOT NULL DEFAULT GETDATE(),
        UpdatedAt        DATETIME       NOT NULL DEFAULT GETDATE(),
        CreatedBy        NVARCHAR(150)  NULL,
        UpdatedBy        NVARCHAR(150)  NULL
    );

    PRINT 'dbo.VehicleInOut created.';
END
ELSE
    PRINT 'dbo.VehicleInOut already exists — skipped.';
GO

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_VehicleInOut_DocNo'
      AND object_id = OBJECT_ID('dbo.VehicleInOut')
)
    CREATE INDEX IX_VehicleInOut_DocNo ON dbo.VehicleInOut (DocNo);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_VehicleInOut_SupplierID_DocDate'
      AND object_id = OBJECT_ID('dbo.VehicleInOut')
)
    CREATE INDEX IX_VehicleInOut_SupplierID_DocDate
        ON dbo.VehicleInOut (SupplierID, DocDate DESC);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_VehicleInOut_ProjectID'
      AND object_id = OBJECT_ID('dbo.VehicleInOut')
)
    CREATE INDEX IX_VehicleInOut_ProjectID ON dbo.VehicleInOut (ProjectID);
GO

PRINT '================================================================';
PRINT '115-create-vehicle-in-out applied successfully.';
PRINT '================================================================';
GO
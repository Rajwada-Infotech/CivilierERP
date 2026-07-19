-- ============================================================
-- Migration: 228-quality-rejection-debit-note.sql
--
-- Quality Rejection Debit Note — raised by the buyer against a specific
-- received line, from either a Vehicle In/Out entry or a GRN, when
-- inspection finds some or all of the delivered quantity is below the
-- ordered grade/quality (e.g. ordered Grade A steel, 20 of 100 tonnes
-- received turn out inferior). Records the rejected quantity, the
-- resulting bad-quality percentage, and the debit amount (rejectedQty *
-- rate) charged back to the supplier. The same row is read by the
-- Supplier Portal and shown to the supplier as a Credit Note (their side
-- of the same transaction — less money owed to them).
--
-- Deliberately its own table rather than reusing dbo.DebitNote /
-- dbo.DebitNoteItems: those are bill-anchored (require a NOT NULL bill_id)
-- with free-text line items and no link back to a received-goods line —
-- the wrong shape for "which specific delivery, which specific line, what
-- percent was bad".
--
-- Two source shapes, exactly one populated per row:
--   - Vehicle In/Out: dbo.VehicleInOutItems is a real child table with a
--     stable PK — VehicleInOutID/VehicleInOutItemID reference it directly.
--   - GRN: dbo.GoodsReceiptNotes.GRNItems is a JSON array with no stable
--     per-line id (an itemId can repeat within one GRN), so GRNID +
--     GRNItemIndex (the line's position in that array) identifies it.
--
-- Seeds:
--   1. dbo.TypeOfDoc  → prefix "QDN", Tier-2 dash format (QDN-2026-00001)
--   2. dbo.QualityRejectionDebitNote
--
-- Safe to run multiple times (all operations guarded).
-- ============================================================

SET NOCOUNT ON;
GO

-- ── 1. Seed TypeOfDoc row for QDN ───────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'QDN'
)
BEGIN
    DECLARE @EntryTypeId UNIQUEIDENTIFIER = (
        SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt
    );

    INSERT INTO dbo.TypeOfDoc
        (Prefix, DocNoPrefix, Description, ModuleCode, links_to,
         FinYearReset, IsActive, EntryTypeId, CreatedBy, CreatedAt)
    VALUES
        ('QDN', 'QDN', 'Quality Rejection Debit Note', 'QDN', 'Vehicle In/Out',
         1, 1, @EntryTypeId, 'migration', GETDATE());

    PRINT 'TypeOfDoc seeded: QDN';
END
ELSE
    PRINT 'TypeOfDoc QDN already exists — skipped.';
GO

-- ── 2. Create QualityRejectionDebitNote table ───────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'QualityRejectionDebitNote'
)
BEGIN
    CREATE TABLE dbo.QualityRejectionDebitNote (
        DebitNoteId        INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,

        -- Document identity
        DocNo              NVARCHAR(50)   NULL,                 -- QDN-2026-00001
        DocTypeId          INT            NULL,                 -- FK -> TypeOfDoc
        DebitDate          DATE           NOT NULL DEFAULT CAST(GETDATE() AS DATE),

        -- Source receiving line — exactly one of the two pairs below is set
        VehicleInOutID     INT            NULL,                 -- FK -> VehicleInOut
        VehicleInOutItemID INT            NULL,                 -- FK -> VehicleInOutItems
        GRNID              INT            NULL,                 -- FK -> GoodsReceiptNotes
        GRNItemIndex       INT            NULL,                 -- position within GRNItems JSON
        POItemId           INT            NULL,                 -- FK -> PurchaseOrderItems
        POID               INT            NULL,                 -- FK -> PurchaseOrders
        ItemId             NVARCHAR(100)  NULL,                 -- denormalized
        ItemName           NVARCHAR(255)  NULL,                 -- denormalized
        UomName            NVARCHAR(50)   NULL,                 -- denormalized

        -- Org context (from dbo.enterprise)
        CompanyID          INT            NULL,
        ProjectID          INT            NULL,

        -- Supplier
        SupplierID         INT            NOT NULL,             -- FK -> AccountHeadMaster
        SupplierName       NVARCHAR(255)  NULL,                 -- denormalized

        -- Quality rejection figures
        ReceivedQty        DECIMAL(18,3)  NOT NULL,             -- qty on this receiving line
        RejectedQty        DECIMAL(18,3)  NOT NULL,             -- qty found inferior
        PercentBad         DECIMAL(5,2)   NOT NULL,             -- RejectedQty / ReceivedQty * 100
        Rate               DECIMAL(18,4)  NOT NULL DEFAULT 0,   -- rate used for the debit
        Amount             DECIMAL(18,2)  NOT NULL DEFAULT 0,   -- RejectedQty * Rate

        Reason             NVARCHAR(1000) NULL,
        Status             NVARCHAR(30)   NOT NULL DEFAULT 'Issued',  -- Issued | Cancelled

        -- GL linkage (dbo.GeneralLedgerEntry.SourceType='QualityRejectionDebitNote')
        GLEntryId          INT            NULL,

        -- Audit
        CreatedBy          NVARCHAR(150)  NULL,
        CreatedAt          DATETIME       NOT NULL DEFAULT GETDATE(),
        UpdatedBy          NVARCHAR(150)  NULL,
        UpdatedAt          DATETIME       NOT NULL DEFAULT GETDATE()
    );

    PRINT 'dbo.QualityRejectionDebitNote created.';
END
ELSE
    PRINT 'dbo.QualityRejectionDebitNote already exists — skipped.';
GO

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_QualityRejectionDebitNote_DocNo'
      AND object_id = OBJECT_ID('dbo.QualityRejectionDebitNote')
)
    CREATE INDEX IX_QualityRejectionDebitNote_DocNo
        ON dbo.QualityRejectionDebitNote (DocNo);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_QualityRejectionDebitNote_VehicleInOutItemID'
      AND object_id = OBJECT_ID('dbo.QualityRejectionDebitNote')
)
    CREATE INDEX IX_QualityRejectionDebitNote_VehicleInOutItemID
        ON dbo.QualityRejectionDebitNote (VehicleInOutItemID);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_QualityRejectionDebitNote_GRNID'
      AND object_id = OBJECT_ID('dbo.QualityRejectionDebitNote')
)
    CREATE INDEX IX_QualityRejectionDebitNote_GRNID
        ON dbo.QualityRejectionDebitNote (GRNID);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_QualityRejectionDebitNote_SupplierID_DebitDate'
      AND object_id = OBJECT_ID('dbo.QualityRejectionDebitNote')
)
    CREATE INDEX IX_QualityRejectionDebitNote_SupplierID_DebitDate
        ON dbo.QualityRejectionDebitNote (SupplierID, DebitDate DESC);
GO

-- ── 4. Relax to nullable / add GRN columns for pre-existing installs ────────
-- (No-ops on a fresh install where the CREATE TABLE above already has the
-- final shape; only does work if this table was created by an older copy
-- of this migration where VehicleInOutID/VehicleInOutItemID were NOT NULL
-- and GRNID/GRNItemIndex didn't exist yet.)
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'QualityRejectionDebitNote'
      AND COLUMN_NAME = 'VehicleInOutID' AND IS_NULLABLE = 'NO'
)
    ALTER TABLE dbo.QualityRejectionDebitNote ALTER COLUMN VehicleInOutID INT NULL;
GO

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'QualityRejectionDebitNote'
      AND COLUMN_NAME = 'VehicleInOutItemID' AND IS_NULLABLE = 'NO'
)
    ALTER TABLE dbo.QualityRejectionDebitNote ALTER COLUMN VehicleInOutItemID INT NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.QualityRejectionDebitNote') AND name = N'GRNID'
)
    ALTER TABLE dbo.QualityRejectionDebitNote ADD GRNID INT NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.QualityRejectionDebitNote') AND name = N'GRNItemIndex'
)
    ALTER TABLE dbo.QualityRejectionDebitNote ADD GRNItemIndex INT NULL;
GO

PRINT '================================================================';
PRINT '228-quality-rejection-debit-note applied successfully.';
PRINT '================================================================';
GO

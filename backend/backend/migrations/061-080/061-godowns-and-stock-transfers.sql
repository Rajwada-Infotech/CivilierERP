-- ============================================================
-- Migration: 061-godowns-and-stock-transfers.sql
-- Introduces the Godown (warehouse) concept:
--   1. Godowns         – master table for warehouses / stores
--   2. StockLedger     – add GodownID (nullable; NULL = Main Godown)
--   3. StockTransfers  – internal godown-to-godown transfers
-- ============================================================

SET NOCOUNT ON;
GO

-- ── 1. Godowns master table ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Godowns'))
BEGIN
    CREATE TABLE dbo.Godowns (
        GodownID      INT            IDENTITY(1,1) PRIMARY KEY,
        GodownCode    NVARCHAR(50)   NOT NULL UNIQUE,
        GodownName    NVARCHAR(255)  NOT NULL,
        ShortDesc     NVARCHAR(100)  NULL,
        Description   NVARCHAR(MAX)  NULL,
        Remarks       NVARCHAR(500)  NULL,
        IsMain        BIT            NOT NULL DEFAULT 0,
        EnterpriseID  INT            NULL,
        ProjectID     INT            NULL,
        Location      NVARCHAR(255)  NULL,
        IsActive      BIT            NOT NULL DEFAULT 1,
        IsDeleted     BIT            NOT NULL DEFAULT 0,
        CreatedAt     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt     DATETIME2      NULL
    );

    -- Seed the default Main Godown
    INSERT INTO dbo.Godowns (GodownCode, GodownName, ShortDesc, Description, IsMain, IsActive)
    VALUES ('MAIN', 'Main Godown', 'Main', 'Default central warehouse', 1, 1);

    PRINT 'Godowns table created and Main Godown seeded.';
END
ELSE
    PRINT 'Godowns table already exists.';
GO

-- ── 2. Add GodownID to StockLedger ─────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'StockLedger'
      AND COLUMN_NAME = 'GodownID'
)
BEGIN
    PRINT 'Adding GodownID column to StockLedger...';

    ALTER TABLE dbo.StockLedger
    ADD GodownID INT NULL
        CONSTRAINT FK_StockLedger_Godowns
        REFERENCES dbo.Godowns(GodownID);

    PRINT 'GodownID column added successfully.';
END
ELSE
    PRINT 'GodownID column already exists on StockLedger.';
GO

-- ── 3. Back-fill existing StockLedger rows with Main Godown ─────────────────────
IF EXISTS (
    SELECT 1
    FROM dbo.StockLedger
    WHERE GodownID IS NULL
)
BEGIN
    PRINT 'Back-filling GodownID with Main Godown for existing records...';

    UPDATE sl
    SET sl.GodownID = g.GodownID
    FROM dbo.StockLedger sl
    CROSS JOIN (
        SELECT TOP 1 GodownID
        FROM dbo.Godowns
        WHERE IsMain = 1
    ) g
    WHERE sl.GodownID IS NULL;

    PRINT 'Back-fill completed.';
END
ELSE
    PRINT 'Back-fill not required (all rows already have GodownID).';
GO

-- ── 4. Create index on GodownID ─────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.StockLedger')
      AND name = 'IX_StockLedger_GodownID'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockLedger_GodownID
        ON dbo.StockLedger (GodownID)
        INCLUDE (ItemID, Qty, Type, RefType, CreatedDate);

    PRINT 'Index IX_StockLedger_GodownID created.';
END
ELSE
    PRINT 'Index IX_StockLedger_GodownID already exists.';
GO

-- ── 5. StockTransfers table ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.StockTransfers'))
BEGIN
    CREATE TABLE dbo.StockTransfers (
        TransferID      INT            IDENTITY(1,1) PRIMARY KEY,
        DocNo           NVARCHAR(100)  NULL,
        TransferDate    DATE           NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
        FromGodownID    INT            NOT NULL REFERENCES dbo.Godowns(GodownID),
        ToGodownID      INT            NOT NULL REFERENCES dbo.Godowns(GodownID),
        TransferItems   NVARCHAR(MAX)  NOT NULL,   -- JSON array: [{itemId, itemName, qty, uom, remarks}]
        Remarks         NVARCHAR(MAX)  NULL,
        Status          NVARCHAR(50)   NOT NULL DEFAULT 'Completed',
        CreatedBy       NVARCHAR(255)  NULL,
        CreatedAt       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt       DATETIME2      NULL,

        CONSTRAINT CK_StockTransfers_DiffGodowns
            CHECK (FromGodownID <> ToGodownID)
    );

    -- Indexes
    CREATE NONCLUSTERED INDEX IX_StockTransfers_FromGodown
        ON dbo.StockTransfers (FromGodownID, TransferDate DESC);

    CREATE NONCLUSTERED INDEX IX_StockTransfers_ToGodown
        ON dbo.StockTransfers (ToGodownID, TransferDate DESC);

    PRINT 'StockTransfers table created with indexes.';
END
ELSE
    PRINT 'StockTransfers table already exists.';
GO

PRINT '================================================================';
PRINT '061-godowns-and-stock-transfers applied successfully.';
PRINT '================================================================';
GO

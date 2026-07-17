-- ============================================================
-- Migration: 109-create-sale-orders.sql
-- Introduces the Sales module's Sale Order document:
--   Records an inter-company / inter-project transfer of items,
--   each carrying a user-set sale rate, from a source
--   Company+Project (Godown) to a destination Company+Project (Godown).
--
-- Mirrors the StockTransfers pattern (061-godowns-and-stock-transfers.sql)
-- but adds Company/Project context on both sides plus Rate/Amount,
-- and posts to StockLedger with RefType='SO' so it shows up in
-- Inventory Master like any other stock movement.
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.SaleOrders'))
BEGIN
    CREATE TABLE dbo.SaleOrders (
        SaleOrderID     INT            IDENTITY(1,1) PRIMARY KEY,
        DocNo           NVARCHAR(100)  NULL,
        OrderDate       DATE           NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),

        -- Source (From) company / project / godown
        FromCompanyID   INT            NOT NULL REFERENCES dbo.enterprise(id),
        FromProjectID   INT            NOT NULL REFERENCES dbo.enterprise(id),
        FromGodownID    INT            NOT NULL REFERENCES dbo.Godowns(GodownID),

        -- Destination (To) company / project / godown
        ToCompanyID     INT            NOT NULL REFERENCES dbo.enterprise(id),
        ToProjectID     INT            NOT NULL REFERENCES dbo.enterprise(id),
        ToGodownID      INT            NOT NULL REFERENCES dbo.Godowns(GodownID),

        -- JSON array: [{itemId, itemName, qty, uom, rate, amount, remarks}]
        SaleItems       NVARCHAR(MAX)  NOT NULL,
        TotalAmount     DECIMAL(18,2)  NOT NULL DEFAULT 0,

        Remarks         NVARCHAR(MAX)  NULL,
        Status          NVARCHAR(50)   NOT NULL DEFAULT 'Completed',
        CreatedBy       NVARCHAR(255)  NULL,
        CreatedAt       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt       DATETIME2      NULL,

        CONSTRAINT CK_SaleOrders_DiffGodowns
            CHECK (FromGodownID <> ToGodownID)
    );

    CREATE NONCLUSTERED INDEX IX_SaleOrders_FromGodown
        ON dbo.SaleOrders (FromGodownID, OrderDate DESC);

    CREATE NONCLUSTERED INDEX IX_SaleOrders_ToGodown
        ON dbo.SaleOrders (ToGodownID, OrderDate DESC);

    CREATE NONCLUSTERED INDEX IX_SaleOrders_FromCompanyProject
        ON dbo.SaleOrders (FromCompanyID, FromProjectID);

    CREATE NONCLUSTERED INDEX IX_SaleOrders_ToCompanyProject
        ON dbo.SaleOrders (ToCompanyID, ToProjectID);

    PRINT 'SaleOrders table created with indexes.';
END
ELSE
    PRINT 'SaleOrders table already exists.';
GO

PRINT '================================================================';
PRINT '109-create-sale-orders applied successfully.';
PRINT '================================================================';
GO

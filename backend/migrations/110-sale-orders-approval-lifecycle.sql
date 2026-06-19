-- ============================================================
-- Migration: 110-sale-orders-approval-lifecycle.sql
-- Sale Orders move from "Completed-on-creation" to a proper
-- Draft -> Pending -> Approved/Rejected approval lifecycle
-- (matching GRN/BOQ/PurchaseOrders). Stock now only posts to
-- StockLedger once a Sale Order is fully Approved, not at
-- creation time.
--
-- Adds PostedToStock so the approval route can guard against
-- posting the same Sale Order's StockLedger entries twice
-- (e.g. a retried/duplicate approve call).
-- ============================================================

SET NOCOUNT ON;
GO

-- 1. Add PostedToStock guard flag
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'SaleOrders'
      AND COLUMN_NAME = 'PostedToStock'
)
BEGIN
    ALTER TABLE dbo.SaleOrders
    ADD PostedToStock BIT NOT NULL DEFAULT 0;

    PRINT 'PostedToStock column added to SaleOrders.';
END
ELSE
    PRINT 'PostedToStock column already exists on SaleOrders.';
GO

-- 2. Change default Status for new rows from 'Completed' to 'Draft'
IF EXISTS (
    SELECT 1
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.SaleOrders')
      AND c.name = 'Status'
)
BEGIN
    DECLARE @constraintName NVARCHAR(200);
    SELECT @constraintName = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.SaleOrders')
      AND c.name = 'Status';

    EXEC('ALTER TABLE dbo.SaleOrders DROP CONSTRAINT ' + @constraintName);
END
GO

ALTER TABLE dbo.SaleOrders
ADD CONSTRAINT DF_SaleOrders_Status DEFAULT 'Draft' FOR Status;
GO

-- 3. Back-fill any existing 'Completed' rows (created before this migration)
--    to 'Approved' + PostedToStock=1, since their StockLedger entries were
--    already posted at creation time under the old flow.
UPDATE dbo.SaleOrders
SET Status = 'Approved', PostedToStock = 1
WHERE Status = 'Completed';
GO

PRINT '================================================================';
PRINT '110-sale-orders-approval-lifecycle applied successfully.';
PRINT '================================================================';
GO

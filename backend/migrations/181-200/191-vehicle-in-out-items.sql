-- ============================================================
-- Migration: 191-vehicle-in-out-items.sql
--
-- Vehicle In/Out was header-only (one row per truck, one PO link, no
-- per-item quantity at all) — there was no way to record how much of a
-- PO's ordered quantity a specific lot/vehicle delivered, or to stop a
-- user recording more than was ever ordered.
--
-- Adds dbo.VehicleInOutItems — one row per (VehicleInOut record, PO line
-- item) capturing the quantity received in THAT specific lot. Deliberately
-- independent of dbo.PurchaseOrderItems.ReceivedQty (GRN's own running
-- total) — Vehicle In/Out tracks gate-in deliveries, not formal GRN
-- receipt, so the two must not be summed together or GRN's existing
-- reporting would silently double-count.
--
-- Safe to run multiple times (all operations guarded).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VehicleInOutItems'
)
BEGIN
    CREATE TABLE dbo.VehicleInOutItems (
        VehicleInOutItemID INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
        VehicleInOutID      INT            NOT NULL,
        POItemId             INT            NOT NULL,   -- FK -> PurchaseOrderItems.Id
        ItemId               NVARCHAR(100)  NULL,        -- denormalized, from PurchaseOrderItems.ItemId
        ItemName              NVARCHAR(255)  NULL,
        UomName               NVARCHAR(50)   NULL,
        ReceivedQty           DECIMAL(18,3)  NOT NULL DEFAULT 0,

        CreatedAt             DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt             DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT FK_VehicleInOutItems_VehicleInOut
            FOREIGN KEY (VehicleInOutID) REFERENCES dbo.VehicleInOut (VehicleInOutID)
            ON DELETE CASCADE,
        CONSTRAINT FK_VehicleInOutItems_PurchaseOrderItems
            FOREIGN KEY (POItemId) REFERENCES dbo.PurchaseOrderItems (Id)
    );

    PRINT 'dbo.VehicleInOutItems created.';
END
ELSE
    PRINT 'dbo.VehicleInOutItems already exists — skipped.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_VehicleInOutItems_VehicleInOutID'
      AND object_id = OBJECT_ID('dbo.VehicleInOutItems')
)
    CREATE INDEX IX_VehicleInOutItems_VehicleInOutID ON dbo.VehicleInOutItems (VehicleInOutID);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_VehicleInOutItems_POItemId'
      AND object_id = OBJECT_ID('dbo.VehicleInOutItems')
)
    CREATE INDEX IX_VehicleInOutItems_POItemId ON dbo.VehicleInOutItems (POItemId);
GO

PRINT '================================================================';
PRINT '149-vehicle-in-out-items applied successfully.';
PRINT '================================================================';
GO

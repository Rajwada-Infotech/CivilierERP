-- Migration 585: one Purchase Order can be raised against several Material Requests (same company and project).
--
--   dbo.PurchaseOrderMRs           — every MR a PO is tagged to. PurchaseOrders.SourceMRId / SourceMRDocNo keep the
--                                    first one, so everything that reads a single MR keeps working.
--   dbo.PurchaseOrderItemMRLinks   — how much of each PO line comes from which MR line. The same item requested on two
--                                    MRs becomes one summed PO line with two links. PurchaseOrderItems.MRItemId is
--                                    still set when a line comes from exactly one MR line.
--   dbo.vw_PurchaseOrderMRItemQty  — the quantity a PO line takes from an MR line, from the links when a line has
--                                    them and from PurchaseOrderItems.MRItemId when it doesn't (older POs). Every
--                                    "how much of this MR is ordered" sum reads it, so a summed line counts once
--                                    against each MR line it draws on.

IF OBJECT_ID('dbo.PurchaseOrderMRs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PurchaseOrderMRs (
        PurchaseOrderID INT           NOT NULL,
        MRId            INT           NOT NULL,
        MRDocNo         NVARCHAR(100) NULL,
        CreatedAt       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_PurchaseOrderMRs PRIMARY KEY (PurchaseOrderID, MRId),
        CONSTRAINT FK_PurchaseOrderMRs_PO FOREIGN KEY (PurchaseOrderID)
            REFERENCES dbo.PurchaseOrders (PurchaseOrderID) ON DELETE CASCADE
    );
    CREATE INDEX IX_PurchaseOrderMRs_MRId ON dbo.PurchaseOrderMRs (MRId);
    PRINT 'Created dbo.PurchaseOrderMRs';
END
GO

-- Existing POs: the one MR they were raised from.
INSERT INTO dbo.PurchaseOrderMRs (PurchaseOrderID, MRId, MRDocNo)
SELECT po.PurchaseOrderID, po.SourceMRId, po.SourceMRDocNo
FROM dbo.PurchaseOrders po
WHERE po.SourceMRId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrderMRs x WHERE x.PurchaseOrderID = po.PurchaseOrderID AND x.MRId = po.SourceMRId);
GO

IF OBJECT_ID('dbo.PurchaseOrderItemMRLinks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PurchaseOrderItemMRLinks (
        Id                  INT IDENTITY(1,1) PRIMARY KEY,
        PurchaseOrderItemId INT            NOT NULL,
        MRItemId            INT            NOT NULL,
        Quantity            DECIMAL(18, 4) NOT NULL,
        CONSTRAINT FK_POItemMRLinks_POItem FOREIGN KEY (PurchaseOrderItemId)
            REFERENCES dbo.PurchaseOrderItems (Id) ON DELETE CASCADE
    );
    CREATE INDEX IX_POItemMRLinks_MRItemId ON dbo.PurchaseOrderItemMRLinks (MRItemId) INCLUDE (Quantity, PurchaseOrderItemId);
    CREATE INDEX IX_POItemMRLinks_POItem ON dbo.PurchaseOrderItemMRLinks (PurchaseOrderItemId);
    PRINT 'Created dbo.PurchaseOrderItemMRLinks';
END
GO

CREATE OR ALTER VIEW dbo.vw_PurchaseOrderMRItemQty AS
    SELECT poi.PurchaseOrderID, poi.Id AS PurchaseOrderItemId, l.MRItemId, l.Quantity
    FROM dbo.PurchaseOrderItemMRLinks l
    JOIN dbo.PurchaseOrderItems poi ON poi.Id = l.PurchaseOrderItemId
    UNION ALL
    SELECT poi.PurchaseOrderID, poi.Id, poi.MRItemId, poi.Quantity
    FROM dbo.PurchaseOrderItems poi
    WHERE poi.MRItemId IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.PurchaseOrderItemMRLinks l WHERE l.PurchaseOrderItemId = poi.Id);
GO

PRINT '585-purchase-order-multiple-mrs applied.';
GO

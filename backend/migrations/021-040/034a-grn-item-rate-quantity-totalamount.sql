-- Migration 034: Add rate / quantity / totalAmount to GRN item JSON shape
--
-- Safe to re-run.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'GoodsReceiptNotes'
)
BEGIN
  RAISERROR('GoodsReceiptNotes table does not exist. Run migration 004 first.', 16, 1);
  RETURN;
END
PRINT 'GoodsReceiptNotes table found - proceeding.';

DECLARE @BatchSize INT = 500;
DECLARE @Rows     INT  = 1;
DECLARE @Updated  INT  = 0;

WHILE @Rows > 0
BEGIN
  ;WITH NeedsUpdate AS (
    SELECT TOP (@BatchSize) g.GRNID, g.GRNItems
    FROM   dbo.GoodsReceiptNotes g
    WHERE  g.GRNItems IS NOT NULL
      AND  g.GRNItems <> '[]'
      AND  EXISTS (
             SELECT 1
             FROM   OPENJSON(g.GRNItems)
             WITH   (rate NVARCHAR(50) '$.rate')
             WHERE  rate IS NULL
           )
  )
  UPDATE g
  SET    g.GRNItems = (
           SELECT
             ISNULL(j.itemId,       '')                          AS itemId,
             ISNULL(j.itemName,     '')                          AS itemName,
             ISNULL(j.orderedQty,   0)                           AS orderedQty,
             ISNULL(j.receivedQty,  0)                           AS receivedQty,
             ISNULL(j.remainingQty, 0)                           AS remainingQty,
             ISNULL(j.uom,          '')                          AS uom,
             ISNULL(TRY_CAST(j.rate        AS DECIMAL(18,4)), 0) AS rate,
             ISNULL(TRY_CAST(j.quantity    AS DECIMAL(18,4)), 0) AS quantity,
             ISNULL(TRY_CAST(j.totalAmount AS DECIMAL(18,2)), 0) AS totalAmount
           FROM OPENJSON(n.GRNItems)
           WITH (
             itemId       NVARCHAR(100)  '$.itemId',
             itemName     NVARCHAR(500)  '$.itemName',
             orderedQty   DECIMAL(18,4)  '$.orderedQty',
             receivedQty  DECIMAL(18,4)  '$.receivedQty',
             remainingQty DECIMAL(18,4)  '$.remainingQty',
             uom          NVARCHAR(50)   '$.uom',
             rate         NVARCHAR(50)   '$.rate',
             quantity     NVARCHAR(50)   '$.quantity',
             totalAmount  NVARCHAR(50)   '$.totalAmount'
           ) j
           FOR JSON PATH
         )
  FROM   dbo.GoodsReceiptNotes g
  JOIN   NeedsUpdate n ON n.GRNID = g.GRNID;

  SET @Rows    = @@ROWCOUNT;
  SET @Updated = @Updated + @Rows;
END

PRINT CONCAT('Back-fill complete. Rows updated: ', @Updated);

IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'GRN_ItemTotals')
BEGIN
  EXEC sp_executesql N'DROP VIEW dbo.GRN_ItemTotals';
END

EXEC sp_executesql N'
CREATE VIEW dbo.GRN_ItemTotals AS
SELECT
  g.GRNID,
  g.GRNNo,
  g.GRNDate,
  g.SupplierID,
  g.POID,
  g.Status,
  g.DocNo,
  ROW_NUMBER() OVER (PARTITION BY g.GRNID ORDER BY (SELECT NULL)) - 1 AS LineIndex,
  j.itemId,
  j.itemName,
  j.orderedQty,
  j.receivedQty,
  j.remainingQty,
  j.uom,
  ISNULL(j.rate,        0) AS Rate,
  ISNULL(j.quantity,    0) AS Quantity,
  ISNULL(j.totalAmount, 0) AS TotalAmount,
  ISNULL(j.rate, 0) * ISNULL(j.quantity, 0) AS ComputedTotal
FROM dbo.GoodsReceiptNotes g
CROSS APPLY OPENJSON(g.GRNItems)
WITH (
  itemId       NVARCHAR(100)  ''$.itemId'',
  itemName     NVARCHAR(500)  ''$.itemName'',
  orderedQty   DECIMAL(18,4)  ''$.orderedQty'',
  receivedQty  DECIMAL(18,4)  ''$.receivedQty'',
  remainingQty DECIMAL(18,4)  ''$.remainingQty'',
  uom          NVARCHAR(50)   ''$.uom'',
  rate         DECIMAL(18,4)  ''$.rate'',
  quantity     DECIMAL(18,4)  ''$.quantity'',
  totalAmount  DECIMAL(18,2)  ''$.totalAmount''
) j
';

PRINT 'GRN_ItemTotals view created.';

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes')
    AND name = 'IX_GoodsReceiptNotes_GRNNo'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_GoodsReceiptNotes_GRNNo
    ON dbo.GoodsReceiptNotes (GRNNo ASC)
    INCLUDE (GRNDate, SupplierID, POID, Status);
END

PRINT 'Migration 034 complete.';
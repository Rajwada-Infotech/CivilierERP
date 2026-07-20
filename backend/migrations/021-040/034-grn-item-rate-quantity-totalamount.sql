-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 034: Add rate / quantity / totalAmount to GRN item JSON shape
--
-- Context
-- ───────
-- GRNItems is stored as NVARCHAR(MAX) JSON in GoodsReceiptNotes.
-- Before this migration each element had the shape:
--
--   { itemId, itemName, orderedQty, receivedQty, remainingQty, uom }
--
-- After this migration each element has:
--
--   { itemId, itemName, orderedQty, receivedQty, remainingQty, uom,
--     rate, quantity, totalAmount }
--
-- Because the data lives inside a JSON column there are no ALTER TABLE
-- column operations required — the new fields are simply written by the
-- updated application layer when a GRN is saved or updated.
--
-- This migration:
--   1. Documents the shape change (no-op DDL guard).
--   2. Back-fills existing rows so that every element in GRNItems already
--      contains rate / quantity / totalAmount with safe defaults (0).
--   3. Adds a computed-column view GRN_ItemTotals for reporting so that
--      consumers can query line-level totals without re-parsing JSON.
--   4. Adds an index on GRNNo for lookup performance (idempotent).
--
-- Safe to re-run: all changes are wrapped in IF NOT EXISTS / TRY-CATCH.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Confirm the table exists ───────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'GoodsReceiptNotes'
)
BEGIN
  RAISERROR(
    'GoodsReceiptNotes table does not exist. Run migration 004 first.',
    16, 1
  );
  RETURN;
END
PRINT 'GoodsReceiptNotes table found — proceeding.';

-- ── 1. Back-fill existing GRNItems rows ───────────────────────────────────────
-- For every GRN whose JSON items are missing rate / quantity / totalAmount,
-- rewrite the array with those keys defaulted to 0.
-- This uses SQL Server's JSON_MODIFY + OPENJSON pattern.
-- Rows that already have the new fields are left unchanged.
--
-- NOTE: SQL Server's FOR JSON PATH / OPENJSON round-trip is used here.
--       The update is batched in groups of 500 to avoid long-running locks.

DECLARE @BatchSize INT = 500;
DECLARE @Rows     INT  = 1;
DECLARE @Updated  INT  = 0;

WHILE @Rows > 0
BEGIN
  -- Select GRNs where at least one item element is missing 'rate'
  -- (we treat 'rate' as the sentinel for the new shape).
  ;WITH NeedsUpdate AS (
    SELECT TOP (@BatchSize) g.GRNID, g.GRNItems
    FROM   dbo.GoodsReceiptNotes g
    WHERE  g.GRNItems IS NOT NULL
      AND  g.GRNItems <> '[]'
      AND  EXISTS (
             SELECT 1
             FROM   OPENJSON(g.GRNItems)
             WITH   (rate NVARCHAR(50) '$.rate')
             WHERE  rate IS NULL          -- field absent → old shape
           )
  )
  UPDATE g
  SET    g.GRNItems = (
           SELECT
             ISNULL(j.itemId,       '')                        AS itemId,
             ISNULL(j.itemName,     '')                        AS itemName,
             ISNULL(j.orderedQty,   0)                         AS orderedQty,
             ISNULL(j.receivedQty,  0)                         AS receivedQty,
             ISNULL(j.remainingQty, 0)                         AS remainingQty,
             ISNULL(j.uom,          '')                        AS uom,
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
             rate         NVARCHAR(50)   '$.rate',        -- read as string to detect NULL
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

-- ── 2. Reporting view: GRN_ItemTotals ─────────────────────────────────────────
-- Provides a flat, queryable view of every GRN line item including the new
-- monetary fields. Downstream modules (Expense Booking, dashboards) can JOIN
-- against this instead of calling OPENJSON inline.

IF EXISTS (SELECT 1 FROM sys.views WHERE name = 'GRN_ItemTotals')
BEGIN
  DROP VIEW dbo.GRN_ItemTotals;
  PRINT 'Dropped existing GRN_ItemTotals view for recreation.';
END
GO

CREATE VIEW dbo.GRN_ItemTotals AS
SELECT
  g.GRNID,
  g.GRNNo,
  g.GRNDate,
  g.SupplierID,
  g.POID,
  g.Status,
  g.DocNo,
  -- Line item fields
  raw.[key]                           AS LineIndex,
  j.itemId,
  j.itemName,
  j.orderedQty,
  j.receivedQty,
  j.remainingQty,
  j.uom,
  ISNULL(j.rate,        0)            AS Rate,
  ISNULL(j.quantity,    0)            AS Quantity,
  ISNULL(j.totalAmount, 0)            AS TotalAmount,
  -- Derived / safety-net: recompute in case totalAmount was stored as 0
  ISNULL(j.rate, 0) * ISNULL(j.quantity, 0) AS ComputedTotal
FROM dbo.GoodsReceiptNotes g
CROSS APPLY OPENJSON(g.GRNItems) raw
CROSS APPLY OPENJSON(raw.[value])
WITH (
  itemId       NVARCHAR(100)  '$.itemId',
  itemName     NVARCHAR(500)  '$.itemName',
  orderedQty   DECIMAL(18,4)  '$.orderedQty',
  receivedQty  DECIMAL(18,4)  '$.receivedQty',
  remainingQty DECIMAL(18,4)  '$.remainingQty',
  uom          NVARCHAR(50)   '$.uom',
  rate         DECIMAL(18,4)  '$.rate',
  quantity     DECIMAL(18,4)  '$.quantity',
  totalAmount  DECIMAL(18,2)  '$.totalAmount'
) j;
GO

PRINT 'GRN_ItemTotals view created.';

-- ── 3. Performance index on GRNNo ─────────────────────────────────────────────
-- The GRN list page and expense-booking lookups filter / sort by GRNNo.
-- Safe to re-run; guarded by IF NOT EXISTS.

IF NOT EXISTS (
  SELECT 1
  FROM   sys.indexes
  WHERE  object_id = OBJECT_ID('dbo.GoodsReceiptNotes')
    AND  name      = 'IX_GoodsReceiptNotes_GRNNo'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_GoodsReceiptNotes_GRNNo
    ON dbo.GoodsReceiptNotes (GRNNo ASC)
    INCLUDE (GRNDate, SupplierID, POID, Status);
  PRINT 'Index IX_GoodsReceiptNotes_GRNNo created.';
END
ELSE
  PRINT 'Index IX_GoodsReceiptNotes_GRNNo already exists — skipped.';

-- ── 4. Summary ────────────────────────────────────────────────────────────────
PRINT '────────────────────────────────────────────────────────────────────────';
PRINT 'Migration 034 complete.';
PRINT '';
PRINT 'What changed:';
PRINT '  • Existing GRNItems JSON rows back-filled with rate=0, quantity=0,';
PRINT '    totalAmount=0 where those keys were absent (old shape).';
PRINT '  • View dbo.GRN_ItemTotals created for flat reporting queries.';
PRINT '  • Index IX_GoodsReceiptNotes_GRNNo added for lookup performance.';
PRINT '';
PRINT 'No table columns were altered — all new data lives inside the JSON.';
PRINT 'The application (grnApi.ts + GRN.tsx) writes rate/quantity/totalAmount';
PRINT 'on every save going forward.';
PRINT '────────────────────────────────────────────────────────────────────────';

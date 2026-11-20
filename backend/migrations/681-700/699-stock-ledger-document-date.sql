-- 699: Stock movements dated by their document, not by when the stock entry was written.
--  StockLedger.CreatedDate is GETDATE() at insert, and a GRN's stock is (re)written on approval, so a GRN received on
--  12 Oct but approved on 13 Nov showed its stock on 13 Nov. EntryDate now holds the document's own date (GRN Date,
--  issue date, return / transfer / update / sale order date); the stock pages already read EntryDate first, falling
--  back to CreatedDate. Backfills every existing row, and a trigger fills it on every new row, so no writer changes.
--  Safe to re-run.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.StockLedger') AND name = 'EntryDate')
  ALTER TABLE dbo.StockLedger ADD EntryDate DATE NULL;
GO

UPDATE sl SET EntryDate = d.DocDate
FROM dbo.StockLedger sl
CROSS APPLY (
  SELECT CASE sl.RefType
    WHEN 'GRN'    THEN (SELECT GRNDate      FROM dbo.GoodsReceiptNotes    WHERE GRNID = sl.RefID)
    WHEN 'ISS'    THEN (SELECT [Date]       FROM dbo.MaterialIssues       WHERE IssueId = sl.RefID)
    WHEN 'IRN'    THEN (SELECT ReturnDate   FROM dbo.MaterialIssueReturn  WHERE ReturnId = sl.RefID)
    WHEN 'TRF'    THEN (SELECT TransferDate FROM dbo.StockTransfers       WHERE TransferID = sl.RefID)
    WHEN 'STKUPD' THEN (SELECT UpdateDate   FROM dbo.StockUpdate          WHERE StockUpdateId = sl.RefID)
    WHEN 'ICT'    THEN (SELECT TransferDate FROM dbo.InterCompanyTransfer WHERE ICTId = sl.RefID)
    WHEN 'SO'     THEN (SELECT OrderDate    FROM dbo.SaleOrders           WHERE SaleOrderID = sl.RefID)
  END AS DocDate
) d
WHERE d.DocDate IS NOT NULL AND (sl.EntryDate IS NULL OR sl.EntryDate <> d.DocDate);
GO

CREATE OR ALTER TRIGGER dbo.TR_StockLedger_EntryDate ON dbo.StockLedger AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  UPDATE sl SET EntryDate = d.DocDate
  FROM dbo.StockLedger sl
  JOIN inserted i ON i.StockID = sl.StockID
  CROSS APPLY (
    SELECT CASE sl.RefType
      WHEN 'GRN'    THEN (SELECT GRNDate      FROM dbo.GoodsReceiptNotes    WHERE GRNID = sl.RefID)
      WHEN 'ISS'    THEN (SELECT [Date]       FROM dbo.MaterialIssues       WHERE IssueId = sl.RefID)
      WHEN 'IRN'    THEN (SELECT ReturnDate   FROM dbo.MaterialIssueReturn  WHERE ReturnId = sl.RefID)
      WHEN 'TRF'    THEN (SELECT TransferDate FROM dbo.StockTransfers       WHERE TransferID = sl.RefID)
      WHEN 'STKUPD' THEN (SELECT UpdateDate   FROM dbo.StockUpdate          WHERE StockUpdateId = sl.RefID)
      WHEN 'ICT'    THEN (SELECT TransferDate FROM dbo.InterCompanyTransfer WHERE ICTId = sl.RefID)
      WHEN 'SO'     THEN (SELECT OrderDate    FROM dbo.SaleOrders           WHERE SaleOrderID = sl.RefID)
    END AS DocDate
  ) d
  WHERE sl.EntryDate IS NULL AND d.DocDate IS NOT NULL;
END;
GO

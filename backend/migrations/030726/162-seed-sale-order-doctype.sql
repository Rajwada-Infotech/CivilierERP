-- Migration 162: Seed Sale Order document type
--
-- createSaleOrderInternal (customerSaleOrders.js) requires either a client-
-- supplied SaleOrderNo or a DocTypeId to auto-number against — no "Sale
-- Order" TypeOfDoc row exists in this DB today (confirmed: only 'PO'/'DPO'
-- for Purchase Order and 'SI' for Sale Invoice). Without this, the
-- Inter-Company Stock Transfer orchestrator's sender-side Sale Order leg
-- fails immediately with "Required document types...are missing."

DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'SO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, links_to, CreatedBy, CreatedAt)
  VALUES ('SO', 'SO', 'Sale Order', 1, 5, 1, @EId_ANY, 'Sale Order', 'migration', GETDATE());

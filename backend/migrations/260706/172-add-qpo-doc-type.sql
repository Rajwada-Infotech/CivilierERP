-- Migration 172: Add Quotation Purchase Order (QPO) document type

DECLARE @EId_PO UNIQUEIDENTIFIER = (SELECT E_Id FROM dbo.Entry_Type WHERE EntryType = 'Purchase Order');
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'QPO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, links_to, CreatedBy, CreatedAt)
  VALUES ('QPO', 'QPO', 'Quotation Purchase Order', 1, 5, 1, ISNULL(@EId_PO, @EId_ANY), 'Purchase Order', 'migration', GETDATE());

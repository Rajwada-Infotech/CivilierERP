-- Migration 161: Seed Inter-Company Transfer (ICT) document type
-- Child documents (Sale Order, Sale Invoice, PO, GRN, Expense Booking,
-- Payment) reuse their own existing prefixes — this is only for the
-- InterCompanyTransfer header's own DocNo.

DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ICT')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, links_to, CreatedBy, CreatedAt)
  VALUES ('ICT', 'ICT', 'Inter-Company Stock Transfer', 1, 5, 1, @EId_ANY, 'Inter-Company Transfer', 'migration', GETDATE());

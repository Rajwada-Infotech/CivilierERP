-- Migration 159: Seed Journal Voucher (JV) document type

DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'JV')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, links_to, CreatedBy, CreatedAt)
  VALUES ('JV', 'JV', 'Journal Voucher', 1, 5, 1, @EId_ANY, 'Journal Voucher', 'migration', GETDATE());

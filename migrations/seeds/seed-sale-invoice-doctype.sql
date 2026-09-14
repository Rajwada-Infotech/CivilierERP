-- Seed dbo.TypeOfDoc row for Sale Invoice ("SI" prefix). Required by
-- backend/routes/saleInvoices.js, which hard-fails invoice creation
-- ("Select a document type with SI prefix") if no active row with
-- links_to LIKE '%Sale Invoice%' (or DocNoPrefix = 'SI') exists.
--
-- Safe to re-run.

USE Civilier;
GO

DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (
  SELECT 1 FROM dbo.TypeOfDoc
  WHERE IsActive = 1 AND (DocNoPrefix = 'SI' OR links_to LIKE '%Sale Invoice%')
)
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, ModuleCode, StartingDocNo, DocNoPadding,
     IsActive, EntryTypeId, links_to, FinYearReset, CreatedBy, CreatedAt)
  VALUES
    ('SI', 'SI', 'Sale Invoice', 'SI', 1, 5,
     1, @EId_ANY, 'Sale Invoice', 1, 'migration', GETDATE());
ELSE
  PRINT 'Sale Invoice document type already exists';

SELECT TypeOfDocId, Prefix, Description, links_to, ModuleCode, EntryTypeId
FROM dbo.TypeOfDoc
WHERE DocNoPrefix = 'SI' OR links_to LIKE '%Sale Invoice%';

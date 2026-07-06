-- Seed dbo.TypeOfDoc rows so the "Type of Doc" dropdown on the Payment and
-- Received Payment pages (fetchDocTypes("PAY") / fetchDocTypes("RECP")) has
-- something to show. Those pages filter via /api/document-type?module=...,
-- which matches on TypeOfDoc.links_to (see MODULE_LINKS in
-- backend/routes/document-type.js: PAY -> 'Payment', RECP -> 'Received Payment').
--
-- EntryTypeId is a required FK (dbo.Entry_Type.E_Id). We resolve it by name,
-- falling back to 'Other Expense' (the same fallback migration 035 used for
-- outgoing Payment) and finally to any row if neither exists.
--
-- Safe to re-run — guarded by IF NOT EXISTS on Prefix.

USE Civilier;
GO

DECLARE @EId_PAY  UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type WHERE EntryType = 'Payment');
DECLARE @EId_REC  UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type WHERE EntryType = 'Received Payment');
DECLARE @EId_OTH  UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type WHERE EntryType = 'Other Expense');
DECLARE @EId_ANY  UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

SET @EId_PAY = ISNULL(@EId_PAY, ISNULL(@EId_OTH, @EId_ANY));
SET @EId_REC = ISNULL(@EId_REC, @EId_ANY);

-- ── Payment ────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE Prefix = 'PAY')
  INSERT INTO dbo.TypeOfDoc
    (Prefix, Description, EntryTypeId, StartingDocNo, CreatedBy, links_to,
     DocNoPrefix, FinYearReset)
  VALUES
    ('PAY', 'Payment', @EId_PAY, 1, 'migration', 'Payment', 'PAY', 1);
ELSE
  PRINT 'PAY document type already exists';

-- ── Received Payment ─────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE Prefix = 'REC')
  INSERT INTO dbo.TypeOfDoc
    (Prefix, Description, EntryTypeId, StartingDocNo, CreatedBy, links_to,
     DocNoPrefix, FinYearReset)
  VALUES
    ('REC', 'Received Payment', @EId_REC, 1, 'migration', 'Received Payment', 'REC', 1);
ELSE
  PRINT 'REC document type already exists';

SELECT TypeOfDocId, Prefix, Description, links_to, EntryTypeId
FROM dbo.TypeOfDoc
WHERE Prefix IN ('PAY', 'REC');

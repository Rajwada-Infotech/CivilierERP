-- Migration 312: separate document-number sequence for invoice GL postings.
-- Invoice posting (routes/expenseBooking.js POST /:id/post-to-gl) was
-- reusing the "JV" (Journal Voucher) TypeOfDoc purely to reserve a display
-- number, even though it never creates an actual JournalVoucher row (see
-- the code comment there — GeneralLedgerEntry is the sole source of
-- truth). That made the voucher label read "JV-2026-00012", which looks
-- like a real Journal Voucher entry and isn't. Give it its own "GL" prefix
-- so the label honestly reads "GL-2026-00001".

DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'GL')
  INSERT INTO dbo.TypeOfDoc
    (Prefix, Description, EntryTypeId, StartingDocNo, IsActive, CreatedBy, CreatedAt,
     DocNoPrefix, DocNoPadding, links_to, FinYearReset)
  VALUES
    ('GL', 'General Ledger Posting', @EId_ANY, 1, 1, 'migration-312', GETDATE(),
     'GL', 5, 'Invoice GL Posting', 0);

PRINT '312-seed-gl-posting-doctype applied successfully.';
GO

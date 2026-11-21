-- Migration 410: Reverse duplicate GRN GL postings
--
-- Mirrors migration 409 (duplicate ExpenseBooking/InvoicePosting cleanup).
-- postGRNApproval (SourceType='GRN', auto-fires on approval) and
-- routes/grns.js's POST /:id/post-to-gl (SourceType='GRNPosting', the
-- manual "Post to GL" button) were two independent, fully-functional
-- posting paths for the same GRN, each only checking its OWN SourceType
-- via hasPosting — neither checked the other. GRNPosting is authoritative;
-- reverse the stale GRN postings for any GRN that also has a live
-- GRNPosting entry.

UPDATE gle
SET IsReversed = 1
FROM dbo.GeneralLedgerEntry gle
WHERE gle.SourceType = 'GRN'
  AND gle.IsReversed = 0
  AND EXISTS (
    SELECT 1 FROM dbo.GeneralLedgerEntry gp
    WHERE gp.SourceType = 'GRNPosting'
      AND gp.SourceId = gle.SourceId
      AND gp.IsReversed = 0
  );

PRINT '410-reverse-duplicate-grn-postings applied successfully.';
GO

-- Migration 411: Reverse duplicate Payment GL postings
--
-- Mirrors migrations 409 (ExpenseBooking/InvoicePosting) and 410 (GRN/
-- GRNPosting). postPaymentApproval (SourceType='NewPayment', auto-fires on
-- approval) and routes/newPayment.js's POST /:id/post-to-gl (SourceType=
-- 'PaymentPosting', the manual "Post to GL" button) were two independent,
-- fully-functional posting paths for the same payment, each only checking
-- its OWN SourceType via hasPosting — neither checked the other.
-- PaymentPosting is authoritative; reverse the stale NewPayment postings
-- for any payment that also has a live PaymentPosting entry.

UPDATE gle
SET IsReversed = 1
FROM dbo.GeneralLedgerEntry gle
WHERE gle.SourceType = 'NewPayment'
  AND gle.IsReversed = 0
  AND EXISTS (
    SELECT 1 FROM dbo.GeneralLedgerEntry pp
    WHERE pp.SourceType = 'PaymentPosting'
      AND pp.SourceId = gle.SourceId
      AND pp.IsReversed = 0
  );

PRINT '411-reverse-duplicate-payment-postings applied successfully.';
GO

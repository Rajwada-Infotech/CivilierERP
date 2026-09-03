-- ============================================================
-- Migration 398: Reverse GL entries orphaned by hard deletes.
--
-- routes/newPayment.js, expenseBooking.js, and receivedPayment.js DELETE
-- handlers hard-deleted the source row (NewPayment/ExpenseBooking/
-- ReceivedPayment) without reversing the GeneralLedgerEntry rows it had
-- posted — the DELETE FROM dbo.LoanSanction handler already did this
-- correctly (calls reversePostingBySource before deleting); the other three
-- never did. Every ledger/report reading off GeneralLedgerEntry (Vendor
-- Ledger Report, Trial Balance, Balance Sheet, ...) kept counting postings
-- for documents that no longer exist, inflating totals.
--
-- The route handlers are fixed in this same change (see git history) to
-- reverse the posting before deleting going forward. This migration is the
-- one-time backfill: flip IsReversed=1 (never physically delete — same
-- audit-trail-preserving convention every other reversal in
-- services/generalLedger.js uses) on any currently-orphaned row, i.e. any
-- unreversed posting whose source document is gone.
--
-- Safe to run multiple times — WHERE IsReversed = 0 makes it a no-op once
-- applied.
-- ============================================================

SET NOCOUNT ON;
GO

UPDATE gle
  SET IsReversed = 1
FROM dbo.GeneralLedgerEntry gle
WHERE gle.IsReversed = 0
  AND (
    (gle.SourceType IN ('NewPayment', 'PaymentPosting', 'BounceChargePosting', 'LoanRepayment')
      AND NOT EXISTS (SELECT 1 FROM dbo.NewPayment np WHERE np.PPaymentID = gle.SourceId))
    OR (gle.SourceType = 'ExpenseBooking'
      AND NOT EXISTS (SELECT 1 FROM dbo.ExpenseBooking eb WHERE eb.Eid = gle.SourceId))
    OR (gle.SourceType = 'ReceivedPayment'
      AND NOT EXISTS (SELECT 1 FROM dbo.ReceivedPayment rp WHERE rp.RPPaymentID = gle.SourceId))
  );

PRINT 'Reversed ' + CAST(@@ROWCOUNT AS NVARCHAR(20)) + ' orphaned GeneralLedgerEntry row(s).';
GO

PRINT '398-reverse-orphaned-gl-entries applied successfully.';
GO

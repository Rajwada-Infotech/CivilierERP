-- ============================================================
-- Migration 409: Reverse duplicate ExpenseBooking-sourced GL postings.
--
-- postExpenseBookingApproval() (SourceType='ExpenseBooking', fires
-- automatically when an invoice is approved) and the manual "Post to GL"
-- action (routes/expenseBooking.js POST /:id/post-to-gl, SourceType=
-- 'InvoicePosting') are two independent posting paths for the same
-- invoice. Each only guarded against its OWN re-entry, never checked
-- whether the OTHER had already posted — an invoice approved (auto-
-- posting under 'ExpenseBooking') and later run through "Post to GL"
-- (posting again under 'InvoicePosting') got double-credited to the
-- vendor, each posting using different accounting treatment for the
-- GST/billing-term portion.
--
-- InvoicePosting is the authoritative path going forward (see the
-- cross-checks added to postExpenseBookingApproval and POST /:id/post-to-gl
-- in this same change). This migration cleans up every historical case:
-- wherever BOTH SourceTypes exist live for the same invoice, the
-- ExpenseBooking-sourced legs are reversed (IsReversed=1, never deleted —
-- same audit-trail-preserving convention as every other reversal in this
-- app) and the InvoicePosting-sourced legs are left untouched.
--
-- Safe to run multiple times — the WHERE IsReversed=0 guard means a
-- second run finds nothing left to reverse.
-- ============================================================

UPDATE gle
SET IsReversed = 1
FROM dbo.GeneralLedgerEntry gle
WHERE gle.SourceType = 'ExpenseBooking'
  AND gle.IsReversed = 0
  AND EXISTS (
    SELECT 1 FROM dbo.GeneralLedgerEntry ip
    WHERE ip.SourceType = 'InvoicePosting'
      AND ip.SourceId = gle.SourceId
      AND ip.IsReversed = 0
  );

PRINT '409-reverse-duplicate-invoice-postings applied successfully.';
GO

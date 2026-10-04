-- Migration 417: Let a payment settle a Journal Voucher's liability leg
--
-- A Journal Voucher (dbo.JournalVoucher/JournalVoucherLines) can record a
-- liability (e.g. DR Expense / CR Party) without any cash/bank movement —
-- once approved it already posts straight to dbo.GeneralLedgerEntry
-- (services/generalLedger.js's postJournalVoucherApproval). Paying that
-- liability off is a separate, later voucher (DR the same party/liability
-- head, CR bank) — same shape as any other payment, just sourced from a JV
-- credit line instead of an ExpenseBooking/Contract. This column links the
-- payment back to the specific line it's settling, so the "Journal
-- Vouchers" tab on the Payment page can compute how much of that line is
-- still unpaid (CreditAmount minus the sum of linked payments) instead of
-- allowing the same liability to be paid more than once.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'JVLineId'
)
BEGIN
  ALTER TABLE dbo.NewPayment
    ADD JVLineId INT NULL
      CONSTRAINT FK_NewPayment_JVLineId REFERENCES dbo.JournalVoucherLines(LineID);
  PRINT 'Added JVLineId to NewPayment (nullable — links a payment to the JV credit line it settles)';
END
ELSE
  PRINT 'NewPayment.JVLineId already exists — skipping';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'IX_NewPayment_JVLineId'
)
BEGIN
  CREATE INDEX IX_NewPayment_JVLineId ON dbo.NewPayment(JVLineId) WHERE JVLineId IS NOT NULL;
  PRINT 'Created IX_NewPayment_JVLineId';
END

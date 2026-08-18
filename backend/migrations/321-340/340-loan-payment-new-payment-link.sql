-- Migration 340: Link dbo.LoanPayment to its real dbo.NewPayment record.
--
-- A Loan EMI is only ever settled from Finance -> Payment's "Loan EMIs" tab
-- (backend/routes/loanSanction.js POST /:id/pay is called right after
-- Payment.tsx creates the dbo.NewPayment row) — that NewPayment row already
-- correctly captures payment mode, cheque number, bank, NEFT/UPI/RTGS ref,
-- etc. dbo.LoanPayment never referenced it, so the loan's own Repayment
-- History/Posting tabs had no way to show HOW a repayment was actually made
-- (cheque no. always blank there even when one was on file).
--
-- No hard FK to dbo.NewPayment — same pragmatic no-FK convention already
-- used for LoanPayment/DependencyActivityAssignment's other cross-table
-- links in this codebase.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.LoanPayment') AND name = 'NewPaymentId'
)
BEGIN
  ALTER TABLE dbo.LoanPayment ADD NewPaymentId INT NULL;
END
GO

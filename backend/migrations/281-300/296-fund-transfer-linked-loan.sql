-- Migration 296: Link Fund Transfer to the real Loan Sanction module.
--
-- An Inter-Company Fund Transfer no longer invents its own ad-hoc GL loan
-- head — it creates a real dbo.LoanSanction row (LoanType='Inter-Company',
-- no interest, single bullet installment) via createLoanSanctionInternal()
-- in routes/loanSanction.js, and posts its combined bank-movement +
-- lender/borrower legs itself (see postFundTransferApproval in
-- generalLedger.js). LinkedLoanId is how the two modules reference each
-- other — the Fund Transfer UI links out to the created loan, and
-- loanSanction.js's own POST /:id/post-to-gl checks this to refuse a
-- manual double-post on a loan Fund Transfer already posted.
--
-- LoanHeadId (migration 291) is superseded and left in place unused rather
-- than dropped — no code writes to it anymore, and nothing currently
-- references any non-null value in it (the feature shipped and was
-- live-tested, then cleaned up, before this redesign).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FundTransfer') AND name = 'LinkedLoanId')
BEGIN
  ALTER TABLE dbo.FundTransfer ADD LinkedLoanId INT NULL;
  ALTER TABLE dbo.FundTransfer ADD CONSTRAINT FK_FundTransfer_LinkedLoan FOREIGN KEY (LinkedLoanId) REFERENCES dbo.LoanSanction(LoanId);
END
GO

-- Migration 557: the GL head a broker's brokerage is expensed to.
--
-- Approving a brokerage records what is owed to the broker:
--   Dr Brokerage on Sales (gross)  /  Cr the broker's ledger (gross)
-- and the payout voucher then clears it:
--   Dr broker (gross)  /  Cr Bank (net)  +  Cr TDS Payable (TDS)
-- Before this, only the payout posted, so the broker's ledger was left in
-- debit and the commission never reached expenses.
--
-- An outside broker's brokerage is its own expense, apart from 'Sales
-- Commission Expense' (SA-COMMISSION, sales associates). Placed under
-- Indirect Expenses (IE) when that group exists; if it does not, the head is
-- not created and the posting reports it, rather than guessing a group.

DECLARE @ie INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'IE');
IF @ie IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'CRM-BROKERAGE-EXP')
  INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadCode, LHeadType, LBelongsTo, LHeadStatus, IsSystemGenerated,
    LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LBranchName, LCountry, LDescription, CreatedAt)
  VALUES ('Brokerage on Sales', 'CRM-BROKERAGE-EXP', 'GL', @ie, 1, 1, 'N/A', 'N/A', 'N/A', 'Main', 'India',
          'Brokerage owed to outside brokers on CRM bookings, recorded when the brokerage is approved.', SYSDATETIME());
IF @ie IS NULL PRINT 'Migration 557: account group IE not found — Brokerage on Sales head not created; add it under the right group.';
GO

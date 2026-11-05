-- Migration 551: buy-back payout through Finance.
--
-- A buy-back (dbo.CrmUnitResale Kind='BuyBack') is paid by ONE payout voucher
-- in Finance -> Payments, the same way a refund is: NewPayment.SourceCrmResaleId
-- links the voucher back. Approving it closes the seller's booking(s) and
-- returns the property to stock.
--
-- 'Property Buy-back Cost' takes the difference between the agreed buy-back
-- price and what the seller had paid (a premium is a debit, a discount a
-- credit). Placed under Indirect Expenses (IE) when that group exists; if it
-- does not, the head is not created and the posting reports it, rather than
-- guessing a group.

IF COL_LENGTH('dbo.NewPayment', 'SourceCrmResaleId') IS NULL
  ALTER TABLE dbo.NewPayment ADD SourceCrmResaleId INT NULL;
GO

DECLARE @ie INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'IE');
IF @ie IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'CRM-BUYBACK-COST')
  INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadCode, LHeadType, LBelongsTo, LHeadStatus, IsSystemGenerated,
    LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LBranchName, LCountry, LDescription, CreatedAt)
  VALUES ('Property Buy-back Cost', 'CRM-BUYBACK-COST', 'GL', @ie, 1, 1, 'N/A', 'N/A', 'N/A', 'Main', 'India',
          'Difference between the agreed buy-back price of a sold property and what its buyer had paid. Earlier invoices are left as they are.', SYSDATETIME());
IF @ie IS NULL PRINT 'Migration 551: account group IE not found — Property Buy-back Cost head not created; add it under the right group.';
GO

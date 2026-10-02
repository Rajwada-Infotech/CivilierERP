-- Migration 522: ledger heads for villa construction income and the resale fee.
--
-- Each kind of turnover gets its own head so the P&L reconciles to the GST
-- returns line by line:
--   CRM-SALE-LAND    Sale of Land            outside GST            (migration 504)
--   CRM-SALE-INCOME  Sale of Flat/Parking    flats sold with land   (migration 472)
--   CRM-SALE-VILLA   Villa Construction      villa built on the buyer's own plot
--   CRM-RESALE-FEE   Plot Resale / Transfer Fee   developer's fee on a resale (SAC 999794)
--
-- Both new heads sit under REVENUE > REVENUE FROM OPERATIONS (group code 'RO'):
-- building villas and handling plot transfers are the company's operations,
-- not incidental income. The group is found by its CODE, so a renamed group
-- still resolves. Postings find the heads by LHeadCode (getGLHeadIdByCode),
-- so renaming a head in Account Head Master is safe.
-- Safe to re-run.

DECLARE @ro INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'RO');
IF @ro IS NULL
BEGIN
  RAISERROR('Migration 522: account group RO (Revenue from Operations) not found — seed the chart of accounts first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'CRM-SALE-VILLA')
  INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadCode, LHeadType, LBelongsTo, LHeadStatus, IsSystemGenerated,
    LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LBranchName, LCountry, LDescription, CreatedAt)
  VALUES ('Villa Construction Income', 'CRM-SALE-VILLA', 'GL', @ro, 1, 1, 'N/A', 'N/A', 'N/A', 'Main', 'India',
          'Construction of a villa on a plot the buyer already owns. Recognised at invoice, net of GST (GST is booked at receipt).', SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'CRM-RESALE-FEE')
  INSERT INTO dbo.AccountHeadMaster (LHeadName, LHeadCode, LHeadType, LBelongsTo, LHeadStatus, IsSystemGenerated,
    LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LBranchName, LCountry, LDescription, CreatedAt)
  VALUES ('Plot Resale / Transfer Fee', 'CRM-RESALE-FEE', 'GL', @ro, 1, 1, 'N/A', 'N/A', 'N/A', 'Main', 'India',
          'Developer''s fee for a plot resale between buyers (SAC 999794). The land price itself passes between the buyers and is never developer income.', SYSDATETIME());

PRINT 'Migration 522: villa construction and resale fee heads in place under Revenue from Operations.';
GO

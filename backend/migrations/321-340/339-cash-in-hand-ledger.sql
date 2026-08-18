-- Migration 339: Cash-in-Hand system GL account
--
-- Direct Payments made in "Cash" mode never carry a PBankID (Payment.tsx
-- disables the Bank field for Cash — "Not applicable for cash payments"),
-- so GL posting for them had no counter-account to credit and hard-failed
-- with "No bank account linked to this payment." This seeds a singleton
-- Cash-in-Hand ledger head (same pattern as migration 178's
-- "Company On Account A/c") so Cash payments can post a balanced
-- Supplier/Creditor Debit — Cash-in-Hand Credit voucher, same shape as a
-- bank payment just with Cash-in-Hand standing in for the bank leg.

IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Cash-in-Hand A/c' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadCategory, LHeadAddress, LHeadContactPerson,
     LHeadPaymentTerms, LBranchName, LCountry, IsSystemGenerated)
  VALUES
    ('Cash-in-Hand A/c', 'CASHPX', 'GL', 1,
     'Cash', 'N/A', 'N/A', 'N/A', 'Main', 'India', 1);
  PRINT 'Seeded: Cash-in-Hand A/c GL head';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET IsSystemGenerated = 1, LHeadCategory = 'Cash',
        LHeadCode = ISNULL(NULLIF(LHeadCode,''), 'CASHPX')
  WHERE LHeadName = 'Cash-in-Hand A/c' AND LHeadType = 'GL';
  PRINT 'Updated: Cash-in-Hand A/c — marked system-generated';
END
GO

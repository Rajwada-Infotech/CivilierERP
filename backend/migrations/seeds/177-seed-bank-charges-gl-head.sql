-- Migration 177: Seed Bank Charges system GL head
-- Used for bounce charge postings: Bank Charges A/c Dr / Bank A/c Cr
-- Group: Expenses > Other Expenses

IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Bank Charges' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadCategory, LHeadAddress, LHeadContactPerson,
     LHeadPaymentTerms, LBranchName, LCountry, IsSystemGenerated)
  VALUES
    ('Bank Charges', 'BNKCHG', 'GL', 1,
     'Other Expenses', 'N/A', 'N/A',
     'N/A', 'Main', 'India', 1);
  PRINT 'Seeded: Bank Charges GL head (Expenses > Other Expenses)';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET IsSystemGenerated = 1,
        LHeadCategory     = 'Other Expenses',
        LHeadCode         = ISNULL(NULLIF(LHeadCode, ''), 'BNKCHG')
  WHERE LHeadName = 'Bank Charges' AND LHeadType = 'GL';
  PRINT 'Updated existing Bank Charges GL head — marked system-generated under Other Expenses';
END
GO

-- Migration 190: CRM Collections GL account
-- Seeds the system GL account CRM money postings debit when a customer
-- payment/on-account deposit is received, mirroring the exact seeding
-- pattern migration 125 used for the GRN posting ledgers (Purchase A/c,
-- PROVISION FOR PENDING GRN A/C, Provisional Credit Available).
-- Idempotent: skipped if the name already exists under LHeadType='GL'.

IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'CRM Collections A/c' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
     LBranchName, LCountry, IsSystemGenerated)
  VALUES
    ('CRM Collections A/c', 'CRMCOLL', 'GL', 1,
     'N/A', 'N/A', 'N/A',
     'Main', 'India', 1);
  PRINT 'Seeded: CRM Collections A/c';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET IsSystemGenerated = 1
  WHERE LHeadName = 'CRM Collections A/c' AND LHeadType = 'GL';
  PRINT 'Updated IsSystemGenerated for: CRM Collections A/c';
END
GO

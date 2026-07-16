-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 125: System-Generated Ledger Accounts
-- Adds IsSystemGenerated flag to AccountHeadMaster.
-- Records marked IsSystemGenerated = 1 can only be deleted by super_admin.
-- Seeds the three standard GRN posting ledger accounts if they don't exist.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the column (nullable so existing rows remain valid)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'AccountHeadMaster'
    AND COLUMN_NAME  = 'IsSystemGenerated'
)
BEGIN
  ALTER TABLE dbo.AccountHeadMaster
    ADD IsSystemGenerated BIT NOT NULL DEFAULT 0;
  PRINT 'Column IsSystemGenerated added.';
END
ELSE
  PRINT 'Column IsSystemGenerated already exists — skipped.';
GO

-- 2. Seed the three GRN posting ledgers (idempotent — skip if name already exists)

-- Purchase A/c  (Debit on GRN)
IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Purchase A/c' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
     LBranchName, LCountry, IsSystemGenerated)
  VALUES
    ('Purchase A/c', 'PURCH', 'GL', 1,
     'N/A', 'N/A', 'N/A',
     'Main', 'India', 1);
  PRINT 'Seeded: Purchase A/c';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET IsSystemGenerated = 1
  WHERE LHeadName = 'Purchase A/c' AND LHeadType = 'GL';
  PRINT 'Updated IsSystemGenerated for: Purchase A/c';
END
GO

-- PROVISION FOR PENDING GRN A/C  (Credit on GRN)
IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'PROVISION FOR PENDING GRN A/C' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
     LBranchName, LCountry, IsSystemGenerated)
  VALUES
    ('PROVISION FOR PENDING GRN A/C', 'PGRN', 'GL', 1,
     'N/A', 'N/A', 'N/A',
     'Main', 'India', 1);
  PRINT 'Seeded: PROVISION FOR PENDING GRN A/C';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET IsSystemGenerated = 1
  WHERE LHeadName = 'PROVISION FOR PENDING GRN A/C' AND LHeadType = 'GL';
  PRINT 'Updated IsSystemGenerated for: PROVISION FOR PENDING GRN A/C';
END
GO

-- Provisional Credit Available  (Debit on GRN)
IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Provisional Credit Available' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
     LBranchName, LCountry, IsSystemGenerated)
  VALUES
    ('Provisional Credit Available', 'PCRAVL', 'GL', 1,
     'N/A', 'N/A', 'N/A',
     'Main', 'India', 1);
  PRINT 'Seeded: Provisional Credit Available';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET IsSystemGenerated = 1
  WHERE LHeadName = 'Provisional Credit Available' AND LHeadType = 'GL';
  PRINT 'Updated IsSystemGenerated for: Provisional Credit Available';
END
GO

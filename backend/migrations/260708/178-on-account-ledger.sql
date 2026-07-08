-- Migration 178: On Account Ledger
-- Tracks excess payment credits (stored OA) and invoice adjustment debits (OA applied).
-- Party-wise running balance: SUM(CREDIT) - SUM(DEBIT) per PartyId.

-- 1. OnAccountLedger table
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'OnAccountLedger'
)
BEGIN
  CREATE TABLE dbo.OnAccountLedger (
    OAId        INT IDENTITY(1,1) PRIMARY KEY,
    PartyId     INT NOT NULL
                  REFERENCES dbo.AccountHeadMaster(LHeadId),
    PartyType   NVARCHAR(20) NOT NULL,     -- Supplier / Contractor / Customer
    TxnDate     DATE NOT NULL,
    TxnType     NVARCHAR(10) NOT NULL      -- CREDIT (excess stored) / DEBIT (adjusted)
                  CHECK (TxnType IN ('CREDIT','DEBIT')),
    Amount      DECIMAL(18,2) NOT NULL CHECK (Amount > 0),
    RefType     NVARCHAR(30) NOT NULL,     -- Payment / Invoice / Manual
    RefDocNo    NVARCHAR(100) NULL,        -- payment DocNo (CREDIT) or invoice EDocNo (DEBIT)
    RefId       INT NULL,                  -- PPaymentID (CREDIT) or ExpenseBooking.Eid (DEBIT)
    AdjRefDocNo NVARCHAR(100) NULL,        -- DEBIT: invoice EDocNo being settled
    CompanyId   INT NULL,
    ProjectId   INT NULL,
    Notes       NVARCHAR(500) NULL,
    CreatedBy   NVARCHAR(150) NULL,
    CreatedAt   DATETIME2 DEFAULT GETDATE()
  );
  PRINT 'Created table: OnAccountLedger';
END
ELSE
  PRINT 'Table OnAccountLedger already exists — skipped.';
GO

-- 2. PPartyId on NewPayment for direct party reference
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PPartyId'
)
BEGIN
  ALTER TABLE dbo.NewPayment
    ADD PPartyId INT NULL
      REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Column PPartyId added to NewPayment.';
END
ELSE
  PRINT 'Column PPartyId already exists — skipped.';
GO

-- 3. Seed Company On Account A/c system GL head
IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Company On Account A/c' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadCategory, LHeadAddress, LHeadContactPerson,
     LHeadPaymentTerms, LBranchName, LCountry, IsSystemGenerated)
  VALUES
    ('Company On Account A/c', 'COAPX', 'GL', 1,
     'On Account', 'N/A', 'N/A', 'N/A', 'Main', 'India', 1);
  PRINT 'Seeded: Company On Account A/c GL head';
END
ELSE
BEGIN
  UPDATE dbo.AccountHeadMaster
    SET IsSystemGenerated = 1, LHeadCategory = 'On Account',
        LHeadCode = ISNULL(NULLIF(LHeadCode,''), 'COAPX')
  WHERE LHeadName = 'Company On Account A/c' AND LHeadType = 'GL';
  PRINT 'Updated: Company On Account A/c — marked system-generated';
END
GO

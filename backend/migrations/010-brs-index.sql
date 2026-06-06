IF OBJECT_ID('dbo.BankReconciliation', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.BankReconciliation (
    BRSID INT IDENTITY(1,1) PRIMARY KEY,
    BankID INT NULL,
    BankDate DATE NULL,
    Amount DECIMAL(18,2) NULL,
    IsMatched BIT NOT NULL CONSTRAINT DF_BankReconciliation_IsMatched DEFAULT (0),
    SourceType NVARCHAR(20) NULL,
    SourceID INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_BankReconciliation_CreatedAt DEFAULT (GETDATE()),
    UpdatedAt DATETIME2 NULL
  );

  PRINT 'BankReconciliation table created.';
END

-- Add positive amount constraint if not exists
IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = 'chk_amount_positive'
    AND parent_object_id = OBJECT_ID('dbo.BankReconciliation')
)
BEGIN
  ALTER TABLE dbo.BankReconciliation
  ADD CONSTRAINT chk_amount_positive CHECK (Amount >= 0);
END

-- Create performance index
IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'idx_brs_bank_date'
    AND object_id = OBJECT_ID('dbo.BankReconciliation')
)
BEGIN
  CREATE NONCLUSTERED INDEX idx_brs_bank_date
  ON dbo.BankReconciliation (BankID, BankDate DESC)
  INCLUDE (BRSID, Amount, IsMatched);
END

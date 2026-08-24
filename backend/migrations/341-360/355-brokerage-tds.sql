-- Migration 355: TDS columns on CrmBrokerageMaster (Section 194H compliance)
--
-- Stores a full TDS snapshot per brokerage record — identical to the pattern
-- used by ExpenseBooking (TDSId FK + TDSNature/TDSName/TDSPercentage snapshot
-- + TDSAmount computed).  Finance disburses NetPayable (gross minus TDSAmount).
--
-- Rename guard: earlier dev builds of this migration used TdsPercent/TdsAmount
-- (wrong casing).  sp_rename handles both fresh installs and already-migrated
-- databases without duplicating columns.

-- 1. Rename TdsPercent → TDSPercentage if the old column exists
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TdsPercent'
) AND NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TDSPercentage'
)
BEGIN
  EXEC sp_rename 'dbo.CrmBrokerageMaster.TdsPercent', 'TDSPercentage', 'COLUMN';
END
GO

-- 2. Rename TdsAmount → TDSAmount if the old column exists
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TdsAmount'
) AND NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TDSAmount'
)
BEGIN
  EXEC sp_rename 'dbo.CrmBrokerageMaster.TdsAmount', 'TDSAmount', 'COLUMN';
END
GO

-- 3. TDSId — FK to TDSMaster; NULL means no TDS applied
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TDSId'
)
BEGIN
  ALTER TABLE dbo.CrmBrokerageMaster ADD TDSId INT NULL;
END
GO

-- 4. TDSNature — snapshot of TDSMaster.Nature at time of recording
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TDSNature'
)
BEGIN
  ALTER TABLE dbo.CrmBrokerageMaster ADD TDSNature NVARCHAR(200) NULL;
END
GO

-- 5. TDSName — snapshot of TDSMaster.Name at time of recording
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TDSName'
)
BEGIN
  ALTER TABLE dbo.CrmBrokerageMaster ADD TDSName NVARCHAR(200) NULL;
END
GO

-- 6. TDSPercentage — fresh install path (rename guard above handles upgrades)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TDSPercentage'
)
BEGIN
  ALTER TABLE dbo.CrmBrokerageMaster ADD TDSPercentage DECIMAL(5,2) NULL;
END
GO

-- 7. TDSAmount — fresh install path
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TDSAmount'
)
BEGIN
  ALTER TABLE dbo.CrmBrokerageMaster ADD TDSAmount DECIMAL(18,2) NOT NULL DEFAULT 0;
END
GO

-- 8. NetPayable — what Finance disburses (ComputedAmount - TDSAmount)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'NetPayable'
)
BEGIN
  ALTER TABLE dbo.CrmBrokerageMaster ADD NetPayable DECIMAL(18,2) NULL;
  -- Backfill: pre-migration rows had no TDS; net = gross
  UPDATE dbo.CrmBrokerageMaster SET NetPayable = ISNULL(ComputedAmount, 0) WHERE NetPayable IS NULL;
  ALTER TABLE dbo.CrmBrokerageMaster ALTER COLUMN NetPayable DECIMAL(18,2) NOT NULL;
END
GO

PRINT 'Migration 355 complete — brokerage TDS columns (TDSMaster-synced)';

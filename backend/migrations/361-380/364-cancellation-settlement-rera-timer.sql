-- Migration 364: Cancellation settlement tracking + RERA 45-day refund timer
-- RERA Section 18: promoter must refund within 45 days of cancellation.
-- SettlementStatus tracks whether a cancelled booking's financial obligations
-- have been met so the cancelled pool shows which records are truly closed.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCancellation') AND name = 'SettlementStatus')
BEGIN
  ALTER TABLE dbo.CrmCancellation ADD SettlementStatus NVARCHAR(30) NULL;
  PRINT 'Added CrmCancellation.SettlementStatus';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCancellation') AND name = 'RefundDueDate')
BEGIN
  -- 45 calendar days from cancellation approval (RERA Section 18)
  ALTER TABLE dbo.CrmCancellation ADD RefundDueDate DATE NULL;
  PRINT 'Added CrmCancellation.RefundDueDate';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCancellation') AND name = 'SettledAt')
BEGIN
  ALTER TABLE dbo.CrmCancellation ADD SettledAt DATETIME2 NULL;
  PRINT 'Added CrmCancellation.SettledAt';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCancellation') AND name = 'SettledBy')
BEGIN
  ALTER TABLE dbo.CrmCancellation ADD SettledBy INT NULL;
  PRINT 'Added CrmCancellation.SettledBy';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCancellation') AND name = 'SettlementNotes')
BEGIN
  ALTER TABLE dbo.CrmCancellation ADD SettlementNotes NVARCHAR(500) NULL;
  PRINT 'Added CrmCancellation.SettlementNotes';
END
GO

-- Backfill: Refunded = Settled
UPDATE dbo.CrmCancellation
SET SettlementStatus = 'Settled',
    SettledAt        = UpdatedAt
WHERE Status = 'Refunded'
  AND SettlementStatus IS NULL;
GO

-- Backfill: RefundAmount = 0 (full forfeiture) already approved = ForfeitureDocumented
UPDATE dbo.CrmCancellation
SET SettlementStatus = 'ForfeitureDocumented'
WHERE Status IN ('Approved', 'FinancePending')
  AND ISNULL(RefundAmount, 0) = 0
  AND SettlementStatus IS NULL;
GO

-- Backfill: active approved/finance-pending with refund owed = RefundPending
UPDATE dbo.CrmCancellation
SET SettlementStatus = 'RefundPending',
    RefundDueDate    = CAST(DATEADD(day, 45, ApprovedAt) AS DATE)
WHERE Status IN ('Approved', 'FinancePending')
  AND ISNULL(RefundAmount, 0) > 0
  AND SettlementStatus IS NULL
  AND ApprovedAt IS NOT NULL;
GO

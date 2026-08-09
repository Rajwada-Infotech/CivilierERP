-- Brokerage admin approval now hands the payable to Finance as dbo.NewPayment,
-- then Finance approval writes back the actual broker payout for CRM tracking.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'SourceCrmBrokerageId'
)
  ALTER TABLE dbo.NewPayment ADD SourceCrmBrokerageId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'IX_NewPayment_SourceCrmBrokerageId'
)
  CREATE INDEX IX_NewPayment_SourceCrmBrokerageId
    ON dbo.NewPayment(SourceCrmBrokerageId)
    WHERE SourceCrmBrokerageId IS NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerPayment') AND name = 'SourceNewPaymentId'
)
  ALTER TABLE dbo.CrmBrokerPayment ADD SourceNewPaymentId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerPayment') AND name = 'UX_CrmBrokerPayment_SourceNewPaymentId'
)
  CREATE UNIQUE INDEX UX_CrmBrokerPayment_SourceNewPaymentId
    ON dbo.CrmBrokerPayment(SourceNewPaymentId)
    WHERE SourceNewPaymentId IS NOT NULL;
GO

-- Migration 203 allowed split tranches, but later milestone-wise brokerage
-- needs one row per MilestoneId. The old "TrancheLabel IS NULL" uniqueness
-- can still block correct schedules, so replace it with rules that understand
-- milestone tranches and leave the full-payout case protected.
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster')
    AND name = 'UQ_CrmBrokerageMaster_BookingId_SinglePayout'
)
  DROP INDEX UQ_CrmBrokerageMaster_BookingId_SinglePayout ON dbo.CrmBrokerageMaster;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster')
    AND name = 'UQ_CrmBrokerageMaster_BookingId_FullPayout'
)
  CREATE UNIQUE INDEX UQ_CrmBrokerageMaster_BookingId_FullPayout
    ON dbo.CrmBrokerageMaster(BookingId)
    WHERE MilestoneId IS NULL AND TrancheLabel IS NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster')
    AND name = 'UQ_CrmBrokerageMaster_BookingId_Milestone'
)
  CREATE UNIQUE INDEX UQ_CrmBrokerageMaster_BookingId_Milestone
    ON dbo.CrmBrokerageMaster(BookingId, MilestoneId)
    WHERE MilestoneId IS NOT NULL;
GO

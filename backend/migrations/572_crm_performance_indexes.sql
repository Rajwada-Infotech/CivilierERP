-- Migration 572: CRM Performance Indexes & Filtered Unique Index for CrmMutation

-- Covering index for Milestone Aggregations (used in invoicing, receipts, cancellations)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmPaymentMilestone_Booking_Status')
BEGIN
  CREATE NONCLUSTERED INDEX IX_CrmPaymentMilestone_Booking_Status
    ON dbo.CrmPaymentMilestone (BookingId, Status)
    INCLUDE (AmountDue, AmountPaid, MilestoneNo, MilestoneName, DueDate);
END
GO

-- Covering index for Money Receipts
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmMoneyReceipt_Booking_Status')
BEGIN
  CREATE NONCLUSTERED INDEX IX_CrmMoneyReceipt_Booking_Status
    ON dbo.CrmMoneyReceipt (BookingId, Status)
    INCLUDE (Amount, ReceiptNo, CreatedAt, ReceiptDate);
END
GO

-- Covering index for On-Account Payments
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmOnAccountPayment_Booking_Status')
BEGIN
  CREATE NONCLUSTERED INDEX IX_CrmOnAccountPayment_Booking_Status
    ON dbo.CrmOnAccountPayment (BookingId, Status)
    INCLUDE (Amount, AvailableAmount, DepositBankId);
END
GO

-- Index for Company Bank Resolution
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmPaymentReceipt_DepositBankId')
BEGIN
  CREATE NONCLUSTERED INDEX IX_CrmPaymentReceipt_DepositBankId
    ON dbo.CrmPaymentReceipt (DepositBankId)
    WHERE DepositBankId IS NOT NULL;
END
GO

-- Covering index for Sales Deed lookups  
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmSalesDeed_Booking_Status')
BEGIN
  CREATE NONCLUSTERED INDEX IX_CrmSalesDeed_Booking_Status
    ON dbo.CrmSalesDeed (BookingId, Status)
    INCLUDE (Id, DeedNo, CreatedAt);
END
GO

-- Drop the unconditional unique constraint that blocks repeat mutations on same booking after cancellation
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CrmMutation_BookingId' AND object_id = OBJECT_ID('dbo.CrmMutation'))
BEGIN
  ALTER TABLE dbo.CrmMutation DROP CONSTRAINT UQ_CrmMutation_BookingId;
END
GO

-- Add filtered unique index that only applies to active (non-cancelled/rejected) mutations
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmMutation_Booking_Live')
BEGIN
  CREATE UNIQUE INDEX UX_CrmMutation_Booking_Live 
    ON dbo.CrmMutation (BookingId) 
    WHERE Status NOT IN (N'Rejected', N'Cancelled');
END
GO

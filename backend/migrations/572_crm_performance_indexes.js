"use strict";

/**
 * Migration 572: CRM Performance Indexes & Filtered Unique Index for CrmMutation
 *
 * Adds covering indexes for:
 * 1. CrmPaymentMilestone (BookingId, Status) INCLUDE (AmountDue, AmountPaid, MilestoneNo, MilestoneName, DueDate)
 * 2. CrmMoneyReceipt (BookingId, Status) INCLUDE (Amount, ReceiptNo, CreatedAt, ReceiptDate)
 * 3. CrmOnAccountPayment (BookingId, Status) INCLUDE (Amount, AvailableAmount, DepositBankId)
 * 4. CrmPaymentReceipt (DepositBankId) WHERE DepositBankId IS NOT NULL
 * 5. CrmSalesDeed (BookingId, Status) INCLUDE (Id, DeedNo, CreatedAt)
 *
 * Drops unconditional unique constraint UQ_CrmMutation_BookingId and replaces it with
 * filtered unique index UX_CrmMutation_Booking_Live WHERE Status NOT IN ('Rejected', 'Cancelled').
 */

const migrationSql = `
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
`;

const rollbackSql = `
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmMutation_Booking_Live')
BEGIN
  DROP INDEX UX_CrmMutation_Booking_Live ON dbo.CrmMutation;
END
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmSalesDeed_Booking_Status')
BEGIN
  DROP INDEX IX_CrmSalesDeed_Booking_Status ON dbo.CrmSalesDeed;
END
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmPaymentReceipt_DepositBankId')
BEGIN
  DROP INDEX IX_CrmPaymentReceipt_DepositBankId ON dbo.CrmPaymentReceipt;
END
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmOnAccountPayment_Booking_Status')
BEGIN
  DROP INDEX IX_CrmOnAccountPayment_Booking_Status ON dbo.CrmOnAccountPayment;
END
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmMoneyReceipt_Booking_Status')
BEGIN
  DROP INDEX IX_CrmMoneyReceipt_Booking_Status ON dbo.CrmMoneyReceipt;
END
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmPaymentMilestone_Booking_Status')
BEGIN
  DROP INDEX IX_CrmPaymentMilestone_Booking_Status ON dbo.CrmPaymentMilestone;
END
GO
`;

async function executeBatches(pool, sqlScript) {
  const batches = sqlScript
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const batch of batches) {
    await pool.request().query(batch);
  }
}

async function up(params = {}) {
  const context = params.context || params;
  const pool =
    context?.pool ||
    (typeof context?.request === "function" ? context : null) ||
    require("../db").getPool();
  await executeBatches(pool, migrationSql);
}

async function down(params = {}) {
  const context = params.context || params;
  const pool =
    context?.pool ||
    (typeof context?.request === "function" ? context : null) ||
    require("../db").getPool();
  await executeBatches(pool, rollbackSql);
}

module.exports = {
  up,
  down,
  sql: migrationSql,
  rollbackSql,
};

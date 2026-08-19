-- CrmInvoice has been write-once since it was created (migration 185): no
-- UPDATE route, no DELETE route, Status sits at its 'Generated' default
-- forever because nothing ever writes anything else. That's fine until a
-- Maintenance/Other invoice gets raised with a wrong amount, or a Milestone
-- invoice's underlying payment turns out to be wrong — there was previously
-- no way to correct that short of a raw DB delete, which this app's CRM
-- module deliberately avoids everywhere else (named terminal status instead
-- of hard-delete, same as CrmApplication/CrmMoneyReceipt/etc.).
--
-- This adds a real Void status: an audited, one-way correction (who voided
-- it, when, why) that keeps the invoice row and its InvoiceNo permanently on
-- the books for audit trail, but frees up its MilestoneId / OnAccountPaymentId
-- / BillingPeriod slot so a corrected invoice can be generated in its place.
-- Mirrors CrmMoneyReceipt's BouncedBy/BouncedAt/BouncedReason shape exactly.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'VoidedBy')
  ALTER TABLE dbo.CrmInvoice ADD VoidedBy INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'VoidedAt')
  ALTER TABLE dbo.CrmInvoice ADD VoidedAt DATETIME2(3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'VoidReason')
  ALTER TABLE dbo.CrmInvoice ADD VoidReason NVARCHAR(500) NULL;
GO

-- Status has been a free NVARCHAR(20) with no constraint since migration 185
-- (only value ever written is the 'Generated' default). Locking it down now,
-- while it's still exactly one real value plus the one this migration adds,
-- is safe — it would not be safe to add this retroactively once more values
-- existed in the wild.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CrmInvoice_Status')
  ALTER TABLE dbo.CrmInvoice WITH CHECK
    ADD CONSTRAINT CK_CrmInvoice_Status CHECK (Status IN ('Generated', 'Void'));
GO

-- Re-scope the three existing "at most once" unique indexes to exclude Void
-- rows, so voiding an invoice actually frees its slot for a corrected one —
-- otherwise Void would be a dead-end status: the mistake stays on record
-- forever AND permanently blocks fixing it, which is worse than not having
-- Void at all.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'UQ_CrmInvoice_MilestoneId')
  DROP INDEX UQ_CrmInvoice_MilestoneId ON dbo.CrmInvoice;
GO
CREATE UNIQUE INDEX UQ_CrmInvoice_MilestoneId ON dbo.CrmInvoice(MilestoneId)
  WHERE MilestoneId IS NOT NULL AND Status <> 'Void';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'UQ_CrmInvoice_OnAccountPaymentId')
  DROP INDEX UQ_CrmInvoice_OnAccountPaymentId ON dbo.CrmInvoice;
GO
CREATE UNIQUE INDEX UQ_CrmInvoice_OnAccountPaymentId ON dbo.CrmInvoice(OnAccountPaymentId)
  WHERE OnAccountPaymentId IS NOT NULL AND Status <> 'Void';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'UQ_CrmInvoice_MaintOther_Period')
  DROP INDEX UQ_CrmInvoice_MaintOther_Period ON dbo.CrmInvoice;
GO
CREATE UNIQUE INDEX UQ_CrmInvoice_MaintOther_Period
  ON dbo.CrmInvoice(BookingId, InvoiceType, BillingPeriod)
  WHERE InvoiceType IN ('Maintenance', 'Other') AND Status <> 'Void';
GO

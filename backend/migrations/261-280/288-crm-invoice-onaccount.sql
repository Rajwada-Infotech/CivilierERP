-- On-account deposits (dbo.CrmOnAccountPayment — money received in excess of
-- what's currently due, auto-parked and later auto-applied to future
-- milestones) had no invoice path at all: real cash received that never got
-- an invoice. Same pattern as MilestoneId (migration 268) — a plain nullable
-- FK-style column plus a filtered unique index so each on-account deposit
-- can be invoiced at most once, while unlimited NULLs (deposits not yet
-- invoiced) remain allowed.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'OnAccountPaymentId')
  ALTER TABLE dbo.CrmInvoice ADD OnAccountPaymentId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'UQ_CrmInvoice_OnAccountPaymentId')
  CREATE UNIQUE INDEX UQ_CrmInvoice_OnAccountPaymentId ON dbo.CrmInvoice(OnAccountPaymentId) WHERE OnAccountPaymentId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrmInvoice_OnAccountPayment')
  ALTER TABLE dbo.CrmInvoice WITH CHECK
    ADD CONSTRAINT FK_CrmInvoice_OnAccountPayment
    FOREIGN KEY (OnAccountPaymentId) REFERENCES dbo.CrmOnAccountPayment(Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CrmInvoice_OnAccountPaymentType')
  ALTER TABLE dbo.CrmInvoice WITH CHECK
    ADD CONSTRAINT CK_CrmInvoice_OnAccountPaymentType CHECK (
      (InvoiceType = 'OnAccount' AND OnAccountPaymentId IS NOT NULL)
      OR
      (InvoiceType <> 'OnAccount' AND OnAccountPaymentId IS NULL)
    );
GO

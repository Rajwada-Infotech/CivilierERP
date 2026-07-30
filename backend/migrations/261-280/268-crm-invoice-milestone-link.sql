-- Manual "Milestone" invoices (Foundation, Superstructure, Slab Casting,
-- Plastering, On Possession, parking/extra-charge line items — anything
-- after the auto-generated Booking invoice) need to stay tied to the exact
-- milestone they were raised for, both so the amount/date can be pulled
-- from real payment data instead of typed freehand, and so a milestone can
-- never end up invoiced twice.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'MilestoneId')
  ALTER TABLE dbo.CrmInvoice ADD MilestoneId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'UQ_CrmInvoice_MilestoneId')
  CREATE UNIQUE INDEX UQ_CrmInvoice_MilestoneId ON dbo.CrmInvoice(MilestoneId) WHERE MilestoneId IS NOT NULL;
GO

-- Migration 289: add a genuine Remarks field to dbo.NewPayment, distinct
-- from PPaymentName (the "Payment Purpose" field) — previously the only
-- "remarks" the frontend sent was actually an alias for PPaymentName.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'PRemarks')
  ALTER TABLE dbo.NewPayment ADD PRemarks NVARCHAR(1000) NULL;
GO

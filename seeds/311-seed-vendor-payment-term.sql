-- Migration 311: seed dbo.VendorPaymentTerm ("Payment Terms" page) — was
-- empty. Net-day terms for POs/invoices, due date = vendor invoice date +
-- Days. Used by Contractor Master's payment-term dropdown and the invoice
-- due-date calc.

IF NOT EXISTS (SELECT 1 FROM dbo.VendorPaymentTerm WHERE Description = 'Immediate / Cash on Delivery')
  INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedAt)
  VALUES ('Immediate / Cash on Delivery', 0, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.VendorPaymentTerm WHERE Description = 'Net 7 Days')
  INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedAt)
  VALUES ('Net 7 Days', 7, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.VendorPaymentTerm WHERE Description = 'Net 15 Days')
  INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedAt)
  VALUES ('Net 15 Days', 15, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.VendorPaymentTerm WHERE Description = 'Net 30 Days')
  INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedAt)
  VALUES ('Net 30 Days', 30, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.VendorPaymentTerm WHERE Description = 'Net 45 Days')
  INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedAt)
  VALUES ('Net 45 Days', 45, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.VendorPaymentTerm WHERE Description = 'Net 60 Days')
  INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedAt)
  VALUES ('Net 60 Days', 60, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.VendorPaymentTerm WHERE Description = 'Net 90 Days')
  INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedAt)
  VALUES ('Net 90 Days', 90, 1, GETDATE());

-- One inactive row on purpose — confirms the status filter/toggle and any
-- dropdown that only lists active terms behave correctly.
IF NOT EXISTS (SELECT 1 FROM dbo.VendorPaymentTerm WHERE Description = 'Net 120 Days (legacy)')
  INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedAt)
  VALUES ('Net 120 Days (legacy)', 120, 0, GETDATE());

PRINT '311-seed-vendor-payment-term applied successfully.';
GO

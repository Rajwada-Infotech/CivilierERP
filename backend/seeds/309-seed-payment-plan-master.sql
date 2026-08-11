-- Migration 309: seed dbo.PaymentTermMaster ("Payment Plan Master" in the
-- admin UI) with common construction-industry billing terms — was empty.

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Retention Money')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Retention Money', 'percent', 5.00, NULL, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Mobilization Advance')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Mobilization Advance', 'percent', 10.00, NULL, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Security Deposit')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Security Deposit', 'percent', 3.00, NULL, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Early Payment Discount')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Early Payment Discount', 'percent', 2.00, NULL, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Late Payment Surcharge')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Late Payment Surcharge', 'percent', 1.50, NULL, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Loading / Unloading Charges')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Loading / Unloading Charges', 'fixed', 1500.00, NULL, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Freight & Transportation')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Freight & Transportation', 'fixed', 2500.00, NULL, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Net 15')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Net 15', 'fixed', 0.00, 15, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Net 30')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Net 30', 'fixed', 0.00, 30, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Net 45')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Net 45', 'fixed', 0.00, 45, 1, GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Net 60')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Net 60', 'fixed', 0.00, 60, 1, GETDATE());

-- One inactive row on purpose — confirms the UI's active/inactive filter
-- and the invoice-side dropdown (which only lists active terms) behave.
IF NOT EXISTS (SELECT 1 FROM dbo.PaymentTermMaster WHERE TermName = 'Cash Against Delivery (deprecated)')
  INSERT INTO dbo.PaymentTermMaster (TermName, ValueType, TermValue, CreditDays, IsActive, CreatedAt)
  VALUES ('Cash Against Delivery (deprecated)', 'fixed', 0.00, 0, 0, GETDATE());

PRINT '309-seed-payment-plan-master applied successfully.';
GO

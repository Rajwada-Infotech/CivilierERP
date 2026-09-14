-- Seeds a system-generated GL expense account for Sales Automation marketing
-- invoices (ad platform / vendor billing) so paying one becomes a real,
-- traceable company expense instead of a PaymentStatus flag with no
-- financial trail. GST on the invoice is split out to the existing
-- "Provisional Credit Available" input-credit account (same one GRN/Expense
-- Booking already use — see generalLedger.js), not folded into the expense.
IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'SA-ADVERTISING')
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LCountry,
     IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('Advertising & Marketing Expense', 'SA-ADVERTISING', 'GL', 1, 'Approved', 42,
     'N/A', 'N/A', 'N/A', 'India',
     1, 'system', SYSDATETIME());
END
GO

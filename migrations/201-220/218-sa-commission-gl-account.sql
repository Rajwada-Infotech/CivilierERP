-- Seeds a system-generated GL expense account for Sales Automation commission
-- payouts (salesperson / team lead / channel partner) so a commission being
-- marked "Paid" becomes a real, traceable expense instead of a status flag
-- with no financial trail. Classified under OTHER EXPENSES > INDIRECT
-- EXPENSES (AGId 42), same branch as CRM stamp duty (migration 194).
IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'SA-COMMISSION')
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LCountry,
     IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('Sales Commission Expense', 'SA-COMMISSION', 'GL', 1, 'Approved', 42,
     'N/A', 'N/A', 'N/A', 'India',
     1, 'system', SYSDATETIME());
END
GO

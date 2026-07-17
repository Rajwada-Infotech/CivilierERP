-- Seeds a system-generated GL expense account for CRM sales-deed statutory
-- costs (stamp duty + registration fee) so these become real, traceable
-- company expenses instead of plain numbers sitting on CrmSalesDeed with no
-- financial trail. Classified under OTHER EXPENSES > INDIRECT EXPENSES
-- (AGId 42) so it shows up correctly in Trial Balance / P&L.
IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'CRM-STAMPDUTY')
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LCountry,
     IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('Stamp Duty & Registration Expense', 'CRM-STAMPDUTY', 'GL', 1, 'Approved', 42,
     'N/A', 'N/A', 'N/A', 'India',
     1, 'system', SYSDATETIME());
END
GO

UPDATE dbo.PageDefinitions
SET Actions = Actions + ',import'
WHERE PageKey IN (
  'bank-master', 'billing-terms', 'card-master', 'cheque-master',
  'contractor-master', 'expense-booking', 'grn-master', 'hsn-master',
  'item-group', 'item-master', 'material-issue-return', 'material-issues',
  'material-request', 'purchase-orders', 'sa-role-master', 'supplier-master',
  'tds-master', 'unit-of-measurement', 'vehicle-in-out'
)
AND CHARINDEX('import', Actions) = 0;

-- Migration 121: Seed missing page definitions that are referenced by
-- requirePageRight() in backend routes but were absent from migration 117.
--
-- Safe to re-run: every insert is guarded by NOT EXISTS on PageKey + IsActive=1.

DECLARE @Pages TABLE (
  PageKey   NVARCHAR(100),
  Label     NVARCHAR(200),
  Module    NVARCHAR(100),
  GroupName NVARCHAR(150),
  Actions   NVARCHAR(200),
  SortOrder INT
);

INSERT INTO @Pages (PageKey, Label, Module, GroupName, Actions, SortOrder) VALUES
('account-group',          'Account Group Master',    'Finance',   'Finance Masters',   'view,create,edit,delete,print,export', 135),
('contractor-category',    'Contractor Category',     'Admin',     'Admin Masters',     'view,create,edit,delete,print,export', 85),
('material-request',       'Material Request',        'Material',  'Material',          'view,create,edit,delete,print,export', 100),
('payment-plan-master',    'Payment Plan Master',     'Follow-Up', 'Follow-Up Setup',   'view,create,edit,delete,print,export', 142),
('work-order-master',      'Work Order (Material)',   'Material',  'Material',          'view,create,edit,delete,print,export', 72),
('followup-applications',  'Applications',            'Follow-Up', 'Follow-Up Sales',   'view,create,edit,delete,print,export', 152),
('followup-demands',       'Finance Demands',         'Follow-Up', 'Follow-Up Finance', 'view,create,edit,delete,print,export', 292),
('followup-payments',      'Follow-Up Payments',      'Follow-Up', 'Follow-Up Finance', 'view,create,edit,delete,print,export', 302),
('followup-unit-selections','Unit Selections',        'Follow-Up', 'Follow-Up Sales',   'view,create,edit,delete,print,export', 182),
('ticket-dashboard',       'Ticket Dashboard',        'Ticket',    'Ticket',            'view,create,edit,delete,print,export', 5),
('transactions',           'Transactions',            'Finance',   'Finance',           'view,create,edit,delete,print,export', 25)
;

INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT
  p.PageKey, p.Label, p.Module, p.GroupName, p.Actions, p.SortOrder, 1, 'migration-121', GETDATE()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd
  WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT 'Migration 121 complete';

SELECT PageKey, Label, Module, GroupName, IsActive
FROM dbo.PageDefinitions
WHERE PageKey IN (
  'account-group','contractor-category','material-request',
  'payment-plan-master','work-order-master',
  'followup-applications','followup-demands','followup-payments',
  'followup-unit-selections','ticket-dashboard','transactions'
)
ORDER BY Module, GroupName, PageKey;
GO

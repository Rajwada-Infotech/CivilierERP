-- Migration 117: Seed dbo.PageDefinitions for EVERY page in the application.
-- Covers: General, Finance, Material, Engineering, Follow-Up, Ticket, Sales,
-- Masters, Reports, and Admin modules — one row per routed page in src/App.tsx.
--
-- Safe to re-run: table creation is guarded (same as migration 116), and every
-- insert is guarded by "IF NOT EXISTS (... PageKey = @x AND IsActive = 1)" so
-- re-running this script after rows already exist is a no-op for those rows.
--
-- Action set: all rows get the full 'view,create,edit,delete,print,export' set
-- by default (matches the pattern already used for Sales in migration 116) so
-- every action toggle is available in Menu Rights; admins can still narrow a
-- specific page's allowed actions later from /admin/page-definitions.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  CREATE TABLE dbo.PageDefinitions (
    PageDefId   INT           IDENTITY(1,1) PRIMARY KEY,
    PageKey     NVARCHAR(100) NOT NULL,
    Label       NVARCHAR(200) NOT NULL,
    Module      NVARCHAR(100) NOT NULL,
    GroupName   NVARCHAR(150) NOT NULL,
    Actions     NVARCHAR(200) NOT NULL,
    SortOrder   INT           NOT NULL CONSTRAINT DF_PD_SortOrder_117 DEFAULT 100,
    IsActive    BIT           NOT NULL CONSTRAINT DF_PD_IsActive_117  DEFAULT 1,
    CreatedBy   NVARCHAR(100) NULL,
    CreatedAt   DATETIME2     NOT NULL CONSTRAINT DF_PD_CreatedAt_117 DEFAULT SYSDATETIME(),
    UpdatedAt   DATETIME2     NULL
  );

  CREATE UNIQUE INDEX UX_PageDefinitions_PageKey_Active
    ON dbo.PageDefinitions(PageKey) WHERE IsActive = 1;

  PRINT 'Created dbo.PageDefinitions';
END
ELSE
  PRINT 'dbo.PageDefinitions already exists — skipping create';
GO

-- ── Helper: reusable insert pattern via a staging table ───────────────────────
-- Using a table variable lets us list every page declaratively, then insert
-- only the ones missing, instead of writing ~110 repetitive IF blocks.

DECLARE @Pages TABLE (
  PageKey   NVARCHAR(100),
  Label     NVARCHAR(200),
  Module    NVARCHAR(100),
  GroupName NVARCHAR(150),
  Actions   NVARCHAR(200),
  SortOrder INT
);

INSERT INTO @Pages (PageKey, Label, Module, GroupName, Actions, SortOrder) VALUES
-- ── GENERAL ──────────────────────────────────────────────────────────────────
('dashboard',              'Dashboard',                 'General',     'General',        'view,create,edit,delete,print,export', 10),
('reports',                'Reports',                   'General',     'General',        'view,create,edit,delete,print,export', 20),
('widgets',                'Widgets',                   'General',     'General',        'view,create,edit,delete,print,export', 30),
('command-center',         'Command Center',            'General',     'General',        'view,create,edit,delete,print,export', 40),
('tasks',                  'Tasks',                      'General',     'General',        'view,create,edit,delete,print,export', 50),
('user-profile',           'User Profile',               'General',     'General',        'view,create,edit,delete,print,export', 60),

-- ── FINANCE ──────────────────────────────────────────────────────────────────
('finance-dashboard',      'Finance Dashboard',          'Finance',      'Finance',         'view,create,edit,delete,print,export', 10),
('trial-balance',          'Trial Balance / Transactions','Finance',     'Finance',         'view,create,edit,delete,print,export', 20),
('new-payment',            'Payments',                   'Finance',      'Finance',         'view,create,edit,delete,print,export', 30),
('received-payment',       'Received Payments',          'Finance',      'Finance',         'view,create,edit,delete,print,export', 40),
('brs',                    'BRS',                         'Finance',     'Finance',         'view,create,edit,delete,print,export', 50),
('records',                'Records',                     'Finance',     'Finance',         'view,create,edit,delete,print,export', 60),
('bank-master',            'Bank Master',                 'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 70),
('expenses-master',        'Expenses Master',             'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 80),
('financial-year-master',  'Financial Year Master',       'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 90),
('cheque-master',          'Cheque Master',               'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 100),
('card-master',            'Card Master',                 'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 110),
('tds-master',             'TDS Master',                  'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 120),
('account-head',           'Account Group Master',        'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 130),
('named-entry-type',       'Named Entry Type Master',     'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 140),
('type-of-doc',            'Type Of Doc Master',          'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 150),
('activity-master',        'Activity Master',             'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 160),
('general-ledger',         'General Ledger Master',       'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 170),
('debit-note',             'Debit Note Master',           'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 180),
('billing-terms',          'Billing Terms Master',        'Finance',     'Finance Masters', 'view,create,edit,delete,print,export', 190),

-- ── MATERIAL ─────────────────────────────────────────────────────────────────
('material-dashboard',     'Material Dashboard',          'Material',    'Material',         'view,create,edit,delete,print,export', 10),
('grn-master',             'GRN',                          'Material',   'Material',         'view,create,edit,delete,print,export', 20),
('vehicle-in-out',         'Vehicle In/Out',               'Material',   'Material',         'view,create,edit,delete,print,export', 30),
('expense-booking',        'Material Expense Booking',     'Material',   'Material',         'view,create,edit,delete,print,export', 40),
('material-debit-note',    'Material Debit Note',          'Material',   'Material',         'view,create,edit,delete,print,export', 50),
('boq',                    'BOQ',                           'Material',  'Material',         'view,create,edit,delete,print,export', 60),
('work-order',             'Work Order',                    'Material', 'Material',         'view,create,edit,delete,print,export', 70),
('amendments',             'Amendments',                    'Material',  'Material',         'view,create,edit,delete,print,export', 80),
('amendment-menu',         'Amendment Menu',                'Material',  'Material',         'view,create,edit,delete,print,export', 90),
('material-request',      'Material Request',              'Material',  'Material',         'view,create,edit,delete,print,export', 100),
('material-issues',       'Material Issues',               'Material',  'Material',         'view,create,edit,delete,print,export', 110),
('purchase-orders',       'Purchase Order',                 'Material', 'Material',         'view,create,edit,delete,print,export', 120),
('t-c-master',            'Terms & Conditions Master',      'Material', 'Material Masters', 'view,create,edit,delete,print,export', 130),
('inventory-master',      'Inventory Master',               'Material', 'Material Masters', 'view,create,edit,delete,print,export', 140),
('stock-ledger',          'Stock',                           'Material', 'Material',         'view,create,edit,delete,print,export', 150),
('stock-transfers',       'Stock Transfer',                  'Material', 'Material',         'view,create,edit,delete,print,export', 160),
('contractor-master',     'Contractor Master',               'Material', 'Material Masters', 'view,create,edit,delete,print,export', 170),
('supplier-master',       'Supplier Master',                 'Material', 'Material Masters', 'view,create,edit,delete,print,export', 180),
('item-master',           'Item Master',                     'Material', 'Material Masters', 'view,create,edit,delete,print,export', 190),
('item-group',            'Item Group Master',               'Material', 'Material Masters', 'view,create,edit,delete,print,export', 200),
('hsn-master',            'HSN Master',                       'Material','Material Masters', 'view,create,edit,delete,print,export', 210),
('unit-of-measurement',   'Unit Of Measurement Master',       'Material','Material Masters', 'view,create,edit,delete,print,export', 220),

-- ── ENGINEERING ──────────────────────────────────────────────────────────────
('engineering-dashboard',  'Engineering Dashboard',       'Engineering', 'Engineering', 'view,create,edit,delete,print,export', 10),
('work-done',              'Work Done',                   'Engineering', 'Engineering', 'view,create,edit,delete,print,export', 20),
('engineering-work-order', 'Work Order (Engineering)',    'Engineering', 'Engineering', 'view,create,edit,delete,print,export', 30),
('engineering-boq',        'BOQ (Engineering)',           'Engineering', 'Engineering', 'view,create,edit,delete,print,export', 40),
('dpr',                    'Daily Progress Report',       'Engineering', 'Engineering', 'view,create,edit,delete,print,export', 50),
('engineering-amendment-menu', 'Amendment Menu (Engineering)', 'Engineering', 'Engineering', 'view,create,edit,delete,print,export', 60),

-- ── FOLLOW-UP ────────────────────────────────────────────────────────────────
('followup-dashboard',          'Follow-Up Dashboard',          'Follow-Up', 'Follow-Up',          'view,create,edit,delete,print,export', 10),
('followup-reminders',          'Reminders',                     'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 20),
('followup-tasks',              'Follow-Up Tasks',               'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 30),
('followup-log',                'Follow-Up Log',                 'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 40),
('po-reminders',                'PO Reminders',                  'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 50),
('wo-reminders',                'WO Reminders',                  'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 60),
('chq-reminders',               'Cheque Reminders',              'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 70),
('grn-reminders',               'GRN Reminders',                 'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 80),
('tds-reminders',                'TDS Reminders',                 'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 90),
('followup-pending-tasks',      'Pending Tasks',                 'Follow-Up','Follow-Up Setup',    'view,create,edit,delete,print,export', 100),
('followup-customer-master',    'Customer Master',               'Follow-Up','Follow-Up Setup',    'view,create,edit,delete,print,export', 110),
('followup-unit-master',        'Unit Master',                   'Follow-Up','Follow-Up Setup',    'view,create,edit,delete,print,export', 120),
('followup-block-master',       'Block Master',                  'Follow-Up','Follow-Up Setup',    'view,create,edit,delete,print,export', 130),
('followup-payment-plan-master','Payment Plan Master',           'Follow-Up','Follow-Up Setup',    'view,create,edit,delete,print,export', 140),
('followup-applicants',         'Applicants / Applications',     'Follow-Up','Follow-Up Sales',    'view,create,edit,delete,print,export', 150),
('followup-applicant-timeline',  'Applicant Timeline',           'Follow-Up','Follow-Up Sales',    'view,create,edit,delete,print,export', 160),
('followup-bookings',           'Bookings',                      'Follow-Up','Follow-Up Sales',    'view,create,edit,delete,print,export', 170),
('followup-unit-selection',     'Unit Selection',                'Follow-Up','Follow-Up Sales',    'view,create,edit,delete,print,export', 180),
('followup-agreements',         'Agreements',                    'Follow-Up','Follow-Up Agreement','view,create,edit,delete,print,export', 190),
('followup-welcome-calls',      'Welcome Calls',                 'Follow-Up','Follow-Up Sales',    'view,create,edit,delete,print,export', 200),
('followup-noc',                'NOC',                           'Follow-Up','Follow-Up Closure',  'view,create,edit,delete,print,export', 210),
('followup-bank-noc',           'Bank NOC',                      'Follow-Up','Follow-Up Closure',  'view,create,edit,delete,print,export', 220),
('followup-sales-deed',         'Sales Deed',                    'Follow-Up','Follow-Up Closure',  'view,create,edit,delete,print,export', 230),
('followup-handover',           'Handover',                      'Follow-Up','Follow-Up Closure',  'view,create,edit,delete,print,export', 240),
('followup-legal-milestones',   'Legal Milestones',              'Follow-Up','Follow-Up Legal',    'view,create,edit,delete,print,export', 250),
('followup-pre-possession',     'Pre-Possession',                'Follow-Up','Follow-Up Closure',  'view,create,edit,delete,print,export', 260),
('followup-possession-notice',  'Possession Notice',             'Follow-Up','Follow-Up Closure',  'view,create,edit,delete,print,export', 270),
('followup-construction-updates','Construction Updates',         'Follow-Up','Follow-Up',          'view,create,edit,delete,print,export', 280),
('followup-finance-demands',    'Finance Demands',               'Follow-Up','Follow-Up Finance',  'view,create,edit,delete,print,export', 290),
('followup-finance-payments',   'Follow-Up Payments',            'Follow-Up','Follow-Up Finance',  'view,create,edit,delete,print,export', 300),
('followup-report-customer',    'Customer Report',               'Follow-Up','Follow-Up Reports',  'view,create,edit,delete,print,export', 310),
('followup-report-financial',   'Financial Report',              'Follow-Up','Follow-Up Reports',  'view,create,edit,delete,print,export', 320),
('followup-report-project-status','Project Status Report',       'Follow-Up','Follow-Up Reports',  'view,create,edit,delete,print,export', 330),
('followup-agreement-workflow', 'Agreement Workflow',            'Follow-Up','Follow-Up Agreement','view,create,edit,delete,print,export', 340),
('followup-document-vault',     'Document Vault',                'Follow-Up','Follow-Up Agreement','view,create,edit,delete,print,export', 350),
('followup-communicator',       'Communicator',                  'Follow-Up','Follow-Up Agreement','view,create,edit,delete,print,export', 360),
('followup-pipeline-applicants','Applicants Pipeline',           'Follow-Up','Follow-Up Sales',    'view,create,edit,delete,print,export', 370),
('followup-pipeline-unit-selections','Unit Selection Pipeline',  'Follow-Up','Follow-Up Sales',    'view,create,edit,delete,print,export', 380),

-- ── TICKET ───────────────────────────────────────────────────────────────────
('tickets',                'Ticket Dashboard',            'Ticket', 'Ticket', 'view,create,edit,delete,print,export', 10),
('ticket-create',          'Create Ticket',               'Ticket', 'Ticket', 'view,create,edit,delete,print,export', 20),
('ticket-my-tickets',      'My Tickets',                  'Ticket', 'Ticket', 'view,create,edit,delete,print,export', 30),
('ticket-pending',         'Pending Tickets',             'Ticket', 'Ticket', 'view,create,edit,delete,print,export', 40),
('ticket-resolved',        'Resolved Tickets',            'Ticket', 'Ticket', 'view,create,edit,delete,print,export', 50),
('ticket-admin-panel',     'Admin Ticket Panel',          'Ticket', 'Ticket', 'view,create,edit,delete,print,export', 60),
('ticket-resolution',      'Ticket Resolution',           'Ticket', 'Ticket', 'view,create,edit,delete,print,export', 70),

-- ── SALES ────────────────────────────────────────────────────────────────────
-- (sale-order, sale-invoice, sales-payment already seeded by migration 116 —
--  included here too, guarded by the same IsActive check, so this file can
--  also run standalone on a fresh environment without depending on 116.)
('sale-order',             'Sale Order',                  'Sales', 'Sales', 'view,create,edit,delete,print,export', 10),
('sale-invoice',           'Sale Invoice',                'Sales', 'Sales', 'view,create,edit,delete,print,export', 20),
('sales-payment',          'Payment',                     'Sales', 'Sales', 'view,create,edit,delete,print,export', 30),

-- ── ADMIN ────────────────────────────────────────────────────────────────────
('admin-dashboard',        'Admin Dashboard',             'Admin', 'Admin', 'view,create,edit,delete,print,export', 10),
('users',                  'Users',                       'Admin', 'Admin', 'view,create,edit,delete,print,export', 20),
('menu-rights',            'Menu Rights',                 'Admin', 'Admin Rights', 'view,create,edit,delete,print,export', 30),
('widget-rights',          'Widget Rights',               'Admin', 'Admin Rights', 'view,create,edit,delete,print,export', 40),
('widget-catalog',         'Widget Catalog',              'Admin', 'Admin Rights', 'view,create,edit,delete,print,export', 50),
('page-definitions',       'Page Definitions',            'Admin', 'Admin Rights', 'view,create,edit,delete,print,export', 60),
('integration-channels',   'Integration Channels',        'Admin', 'Admin Masters', 'view,create,edit,delete,print,export', 70),
('contractor-categories',  'Contractor Categories',       'Admin', 'Admin Masters', 'view,create,edit,delete,print,export', 80),
('godowns',                'Godowns',                     'Admin', 'Admin Masters', 'view,create,edit,delete,print,export', 90),
('fin-year-rights',        'Financial Year Rights',       'Admin', 'Admin Rights', 'view,create,edit,delete,print,export', 100),
('approval-setup',         'Approval Setup',              'Admin', 'Admin Approval', 'view,create,edit,delete,print,export', 110),
('post-approval-rights',   'Post Approval Rights',        'Admin', 'Admin Approval', 'view,create,edit,delete,print,export', 120),
('approval-inbox',         'Approval Inbox',              'Admin', 'Admin Approval', 'view,create,edit,delete,print,export', 130),
('api-integration',        'API Integration',             'Admin', 'Admin', 'view,create,edit,delete,print,export', 140),
('signature',              'Signature',                   'Admin', 'Admin', 'view,create,edit,delete,print,export', 150),
('admin-profile',          'Admin Profile',                'Admin', 'Admin', 'view,create,edit,delete,print,export', 160),
('superadmin-profile',     'Super Admin Profile',          'Admin', 'Admin', 'view,create,edit,delete,print,export', 170),
('dba-profile',            'DBA Profile',                  'Admin', 'Admin', 'view,create,edit,delete,print,export', 180),
('business-unit-master',   'Business Unit / Enterprise Master', 'Admin', 'Admin Masters', 'view,create,edit,delete,print,export', 190),
('project-master',         'Project Master',               'Admin', 'Admin Masters', 'view,create,edit,delete,print,export', 200),
('company-master',         'Company Master',               'Admin', 'Admin Masters', 'view,create,edit,delete,print,export', 210),
('role-master',            'Role Master',                   'Admin', 'Admin Masters', 'view,create,edit,delete,print,export', 220),
('menu-types',             'Menu Types Master',             'Admin', 'Admin Masters', 'view,create,edit,delete,print,export', 230),
('password-reset',         'Password Reset',                'Admin', 'Admin Security', 'view,create,edit,delete,print,export', 240),
('activity-browser',       'Activity Browser',              'Admin', 'Admin', 'view,create,edit,delete,print,export', 250),
('sms-setup',              'SMS Setup',                      'Admin', 'Admin Communicator', 'view,create,edit,delete,print,export', 260),
('email-setup',            'Email Setup',                    'Admin', 'Admin Communicator', 'view,create,edit,delete,print,export', 270),
('whatsapp-setup',         'WhatsApp Setup',                 'Admin', 'Admin Communicator', 'view,create,edit,delete,print,export', 280),
('metrics-dashboard',      'Metrics Dashboard',              'Admin', 'Admin', 'view,create,edit,delete,print,export', 290),
('admin-control-panel',    'Admin Control Panel',            'Admin', 'Admin', 'view,create,edit,delete,print,export', 300),

-- ── DBA ───────────────────────────────────────────────────────────────────────
('dba-dashboard',          'DBA Dashboard',                  'Admin', 'DBA', 'view,create,edit,delete,print,export', 310),
('dba-control-panel',      'DBA Control Panel',              'Admin', 'DBA', 'view,create,edit,delete,print,export', 320),
('dba-ads',                'Ads Manager',                    'Admin', 'DBA', 'view,create,edit,delete,print,export', 330),
('dba-reminders',          'Reminders Manager',              'Admin', 'DBA', 'view,create,edit,delete,print,export', 340),
('dba-payment-logs',       'Payment Logs',                   'Admin', 'DBA', 'view,create,edit,delete,print,export', 350),

-- ── SUPER ADMIN ──────────────────────────────────────────────────────────────
('superadmin-dashboard',   'Super Admin Dashboard',          'Admin', 'Super Admin', 'view,create,edit,delete,print,export', 360)

;

-- ── Insert only rows that don't already exist as an active PageKey ───────────
INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT
  p.PageKey, p.Label, p.Module, p.GroupName, p.Actions, p.SortOrder, 1, 'migration', GETDATE()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd
  WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT 'Migration 117 complete — page definitions seeded for all modules';
GO

-- Verify: full list grouped by module
SELECT Module, GroupName, PageKey, Label, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
ORDER BY Module, SortOrder;

-- Verify: count per module
SELECT Module, COUNT(*) AS PageCount
FROM dbo.PageDefinitions
WHERE IsActive = 1
GROUP BY Module
ORDER BY Module;

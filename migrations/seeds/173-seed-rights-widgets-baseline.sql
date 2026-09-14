-- ============================================================
-- Migration 172: Seed Page Definitions, Widget Catalog, Role Rights, and
-- per-user rights overrides from the local dev DB baseline to the live
-- server DB.
--
-- Generated programmatically from a live read of the local dev DB
-- (192.168.0.205) on 2026-07-06T10:30:16.958Z — NOT hand-typed, to
-- eliminate transcription error across 165
-- PageDefinitions rows, 12 WidgetCatalog rows,
-- 88 RoleRights rows, and 4
-- per-user overrides.
--
-- Every reference is resolved BY NAME (RoleName -> RId, email -> UserId),
-- never by hardcoded numeric ID — a prior migration (166) hardcoded
-- "Account's Head" as RId=5, which only worked because that happened to
-- match on live too; roles created independently via the Role Master UI
-- on two separate databases have no guarantee of matching IDs, and this
-- migration must not repeat that risk.
--
-- Fully idempotent: every block is either an "insert if row for this
-- natural key doesn't exist yet" or an explicit UPDATE...WHERE-matched-
-- key, so running this migration twice changes nothing on the second run.
-- Safe to run even if PageDefinitions/WidgetCatalog rows already exist on
-- live with different values — they get updated to match the source of
-- truth (code-driven catalogs, not something an admin hand-edits on live).
-- ============================================================

-- ── PageDefinitions (165 rows) ──────────────────────────────────
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'account-head')
  UPDATE dbo.PageDefinitions SET Label = N'Account Group Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 130, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'account-head';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'account-head', N'Account Group Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 130, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'activity-browser')
  UPDATE dbo.PageDefinitions SET Label = N'Activity Browser', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 250, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'activity-browser';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'activity-browser', N'Activity Browser', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 250, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'activity-master')
  UPDATE dbo.PageDefinitions SET Label = N'Activity Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 160, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'activity-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'activity-master', N'Activity Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 160, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'admin-control-panel')
  UPDATE dbo.PageDefinitions SET Label = N'Admin Control Panel', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 300, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'admin-control-panel';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'admin-control-panel', N'Admin Control Panel', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 300, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'admin-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Admin Dashboard', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'admin-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'admin-dashboard', N'Admin Dashboard', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'admin-profile')
  UPDATE dbo.PageDefinitions SET Label = N'Admin Profile', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 160, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'admin-profile';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'admin-profile', N'Admin Profile', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 160, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'amendment-menu')
  UPDATE dbo.PageDefinitions SET Label = N'Amendment Menu', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 90, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'amendment-menu';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'amendment-menu', N'Amendment Menu', N'Material', N'Material', N'view,create,edit,delete,print,export', 90, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'amendments')
  UPDATE dbo.PageDefinitions SET Label = N'Amendments', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 80, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'amendments';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'amendments', N'Amendments', N'Material', N'Material', N'view,create,edit,delete,print,export', 80, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'api-integration')
  UPDATE dbo.PageDefinitions SET Label = N'API Integration', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 140, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'api-integration';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'api-integration', N'API Integration', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 140, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'approval-inbox')
  UPDATE dbo.PageDefinitions SET Label = N'Approval Inbox', Module = N'Admin', GroupName = N'Admin Approval', Actions = N'view,create,edit,delete,print,export', SortOrder = 130, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'approval-inbox';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'approval-inbox', N'Approval Inbox', N'Admin', N'Admin Approval', N'view,create,edit,delete,print,export', 130, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'approval-setup')
  UPDATE dbo.PageDefinitions SET Label = N'Approval Setup', Module = N'Admin', GroupName = N'Admin Approval', Actions = N'view,create,edit,delete,print,export', SortOrder = 110, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'approval-setup';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'approval-setup', N'Approval Setup', N'Admin', N'Admin Approval', N'view,create,edit,delete,print,export', 110, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'bank-master')
  UPDATE dbo.PageDefinitions SET Label = N'Bank Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 70, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'bank-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'bank-master', N'Bank Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 70, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'billing-terms')
  UPDATE dbo.PageDefinitions SET Label = N'Billing Terms Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 190, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'billing-terms';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'billing-terms', N'Billing Terms Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 190, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'boq')
  UPDATE dbo.PageDefinitions SET Label = N'BOQ', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export,post-approval', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'boq';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'boq', N'BOQ', N'Material', N'Material', N'view,create,edit,delete,print,export,post-approval', 60, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'brs')
  UPDATE dbo.PageDefinitions SET Label = N'BRS', Module = N'Finance', GroupName = N'Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'brs';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'brs', N'BRS', N'Finance', N'Finance', N'view,create,edit,delete,print,export', 50, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'business-unit-master')
  UPDATE dbo.PageDefinitions SET Label = N'Business Unit / Enterprise Master', Module = N'Admin', GroupName = N'Admin Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 190, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'business-unit-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'business-unit-master', N'Business Unit / Enterprise Master', N'Admin', N'Admin Masters', N'view,create,edit,delete,print,export', 190, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'card-master')
  UPDATE dbo.PageDefinitions SET Label = N'Card Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 110, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'card-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'card-master', N'Card Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 110, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'cheque-master')
  UPDATE dbo.PageDefinitions SET Label = N'Cheque Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 100, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'cheque-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'cheque-master', N'Cheque Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 100, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'chq-reminders')
  UPDATE dbo.PageDefinitions SET Label = N'Cheque Reminders', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 70, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'chq-reminders';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'chq-reminders', N'Cheque Reminders', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 70, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'civilworkdpr-activity')
  UPDATE dbo.PageDefinitions SET Label = N'Activity', Module = N'Civil Work DPR', GroupName = N'Civil Work DPR', Actions = N'view', SortOrder = 15, IsActive = 0, UpdatedAt = SYSDATETIME() WHERE PageKey = N'civilworkdpr-activity';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'civilworkdpr-activity', N'Activity', N'Civil Work DPR', N'Civil Work DPR', N'view', 15, 0, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'civilworkdpr-contractor-register')
  UPDATE dbo.PageDefinitions SET Label = N'Contractor Register', Module = N'Civil Work DPR', GroupName = N'Civil Work DPR', Actions = N'view,create,edit,delete', SortOrder = 13, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'civilworkdpr-contractor-register';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'civilworkdpr-contractor-register', N'Contractor Register', N'Civil Work DPR', N'Civil Work DPR', N'view,create,edit,delete', 13, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'civilworkdpr-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Dashboard', Module = N'Civil Work DPR', GroupName = N'Civil Work DPR', Actions = N'view', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'civilworkdpr-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'civilworkdpr-dashboard', N'Dashboard', N'Civil Work DPR', N'Civil Work DPR', N'view', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'civilworkdpr-dependency')
  UPDATE dbo.PageDefinitions SET Label = N'Dependency', Module = N'Civil Work DPR', GroupName = N'Civil Work DPR', Actions = N'view,create,edit,delete', SortOrder = 12, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'civilworkdpr-dependency';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'civilworkdpr-dependency', N'Dependency', N'Civil Work DPR', N'Civil Work DPR', N'view,create,edit,delete', 12, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'civilworkdpr-worker-attendance')
  UPDATE dbo.PageDefinitions SET Label = N'Worker Attendance', Module = N'Civil Work DPR', GroupName = N'Civil Work DPR', Actions = N'view,create,edit,delete', SortOrder = 14, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'civilworkdpr-worker-attendance';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'civilworkdpr-worker-attendance', N'Worker Attendance', N'Civil Work DPR', N'Civil Work DPR', N'view,create,edit,delete', 14, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'command-center')
  UPDATE dbo.PageDefinitions SET Label = N'Command Center', Module = N'General', GroupName = N'General', Actions = N'view,create,edit,delete,print,export', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'command-center';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'command-center', N'Command Center', N'General', N'General', N'view,create,edit,delete,print,export', 40, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'company-master')
  UPDATE dbo.PageDefinitions SET Label = N'Company Master', Module = N'Admin', GroupName = N'Admin Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 210, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'company-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'company-master', N'Company Master', N'Admin', N'Admin Masters', N'view,create,edit,delete,print,export', 210, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'contractor-categories')
  UPDATE dbo.PageDefinitions SET Label = N'Contractor Categories', Module = N'Admin', GroupName = N'Admin Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 80, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'contractor-categories';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'contractor-categories', N'Contractor Categories', N'Admin', N'Admin Masters', N'view,create,edit,delete,print,export', 80, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'contractor-master')
  UPDATE dbo.PageDefinitions SET Label = N'Contractor Master', Module = N'Material', GroupName = N'Material Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 170, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'contractor-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'contractor-master', N'Contractor Master', N'Material', N'Material Masters', N'view,create,edit,delete,print,export', 170, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'cost-center')
  UPDATE dbo.PageDefinitions SET Label = N'Cost Center Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 195, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'cost-center';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'cost-center', N'Cost Center Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 195, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'customer-master')
  UPDATE dbo.PageDefinitions SET Label = N'Customer Master', Module = N'Masters', GroupName = N'Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 48, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'customer-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'customer-master', N'Customer Master', N'Masters', N'Masters', N'view,create,edit,delete,print,export', 48, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Dashboard', Module = N'General', GroupName = N'General', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dashboard', N'Dashboard', N'General', N'General', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dba-ads')
  UPDATE dbo.PageDefinitions SET Label = N'Ads Manager', Module = N'Admin', GroupName = N'DBA', Actions = N'view,create,edit,delete,print,export', SortOrder = 330, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dba-ads';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dba-ads', N'Ads Manager', N'Admin', N'DBA', N'view,create,edit,delete,print,export', 330, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dba-control-panel')
  UPDATE dbo.PageDefinitions SET Label = N'DBA Control Panel', Module = N'Admin', GroupName = N'DBA', Actions = N'view,create,edit,delete,print,export', SortOrder = 320, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dba-control-panel';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dba-control-panel', N'DBA Control Panel', N'Admin', N'DBA', N'view,create,edit,delete,print,export', 320, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dba-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'DBA Dashboard', Module = N'Admin', GroupName = N'DBA', Actions = N'view,create,edit,delete,print,export', SortOrder = 310, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dba-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dba-dashboard', N'DBA Dashboard', N'Admin', N'DBA', N'view,create,edit,delete,print,export', 310, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dba-payment-logs')
  UPDATE dbo.PageDefinitions SET Label = N'Payment Logs', Module = N'Admin', GroupName = N'DBA', Actions = N'view,create,edit,delete,print,export', SortOrder = 350, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dba-payment-logs';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dba-payment-logs', N'Payment Logs', N'Admin', N'DBA', N'view,create,edit,delete,print,export', 350, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dba-profile')
  UPDATE dbo.PageDefinitions SET Label = N'DBA Profile', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 180, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dba-profile';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dba-profile', N'DBA Profile', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 180, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dba-reminders')
  UPDATE dbo.PageDefinitions SET Label = N'Reminders Manager', Module = N'Admin', GroupName = N'DBA', Actions = N'view,create,edit,delete,print,export', SortOrder = 340, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dba-reminders';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dba-reminders', N'Reminders Manager', N'Admin', N'DBA', N'view,create,edit,delete,print,export', 340, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'debit-note')
  UPDATE dbo.PageDefinitions SET Label = N'Debit Note Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 180, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'debit-note';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'debit-note', N'Debit Note Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 180, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dependency-master')
  UPDATE dbo.PageDefinitions SET Label = N'Dependency', Module = N'Civil Work DPR', GroupName = N'Setup', Actions = N'view,create,edit,delete', SortOrder = 20, IsActive = 0, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dependency-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dependency-master', N'Dependency', N'Civil Work DPR', N'Setup', N'view,create,edit,delete', 20, 0, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'dpr')
  UPDATE dbo.PageDefinitions SET Label = N'Daily Progress Report', Module = N'Engineering', GroupName = N'Engineering', Actions = N'view,create,edit,delete,print,export', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'dpr';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'dpr', N'Daily Progress Report', N'Engineering', N'Engineering', N'view,create,edit,delete,print,export', 50, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'email-setup')
  UPDATE dbo.PageDefinitions SET Label = N'Email Setup', Module = N'Admin', GroupName = N'Admin Communicator', Actions = N'view,create,edit,delete,print,export', SortOrder = 270, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'email-setup';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'email-setup', N'Email Setup', N'Admin', N'Admin Communicator', N'view,create,edit,delete,print,export', 270, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'engineering-amendment-menu')
  UPDATE dbo.PageDefinitions SET Label = N'Amendment Menu (Engineering)', Module = N'Engineering', GroupName = N'Engineering', Actions = N'view,create,edit,delete,print,export', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'engineering-amendment-menu';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'engineering-amendment-menu', N'Amendment Menu (Engineering)', N'Engineering', N'Engineering', N'view,create,edit,delete,print,export', 60, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'engineering-boq')
  UPDATE dbo.PageDefinitions SET Label = N'BOQ (Engineering)', Module = N'Engineering', GroupName = N'Engineering', Actions = N'view,create,edit,delete,print,export', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'engineering-boq';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'engineering-boq', N'BOQ (Engineering)', N'Engineering', N'Engineering', N'view,create,edit,delete,print,export', 40, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'engineering-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Engineering Dashboard', Module = N'Engineering', GroupName = N'Engineering', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'engineering-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'engineering-dashboard', N'Engineering Dashboard', N'Engineering', N'Engineering', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'engineering-work-order')
  UPDATE dbo.PageDefinitions SET Label = N'Work Order (Engineering)', Module = N'Engineering', GroupName = N'Engineering', Actions = N'view,create,edit,delete,print,export,post-approval', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'engineering-work-order';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'engineering-work-order', N'Work Order (Engineering)', N'Engineering', N'Engineering', N'view,create,edit,delete,print,export,post-approval', 30, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'expense-booking')
  UPDATE dbo.PageDefinitions SET Label = N'Material Expense Booking', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export,post-approval', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'expense-booking';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'expense-booking', N'Material Expense Booking', N'Material', N'Material', N'view,create,edit,delete,print,export,post-approval', 40, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'expenses-master')
  UPDATE dbo.PageDefinitions SET Label = N'Expenses Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 80, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'expenses-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'expenses-master', N'Expenses Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 80, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'finance-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Finance Dashboard', Module = N'Finance', GroupName = N'Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'finance-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'finance-dashboard', N'Finance Dashboard', N'Finance', N'Finance', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'financial-year-master')
  UPDATE dbo.PageDefinitions SET Label = N'Financial Year Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 90, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'financial-year-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'financial-year-master', N'Financial Year Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 90, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'fin-year-rights')
  UPDATE dbo.PageDefinitions SET Label = N'Financial Year Rights', Module = N'Admin', GroupName = N'Admin Rights', Actions = N'view,create,edit,delete,print,export', SortOrder = 100, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'fin-year-rights';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'fin-year-rights', N'Financial Year Rights', N'Admin', N'Admin Rights', N'view,create,edit,delete,print,export', 100, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-agreements')
  UPDATE dbo.PageDefinitions SET Label = N'Agreements', Module = N'Follow-Up', GroupName = N'Follow-Up Agreement', Actions = N'view,create,edit,delete,print,export', SortOrder = 190, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-agreements';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-agreements', N'Agreements', N'Follow-Up', N'Follow-Up Agreement', N'view,create,edit,delete,print,export', 190, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-agreement-workflow')
  UPDATE dbo.PageDefinitions SET Label = N'Agreement Workflow', Module = N'Follow-Up', GroupName = N'Follow-Up Agreement', Actions = N'view,create,edit,delete,print,export', SortOrder = 340, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-agreement-workflow';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-agreement-workflow', N'Agreement Workflow', N'Follow-Up', N'Follow-Up Agreement', N'view,create,edit,delete,print,export', 340, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-applicants')
  UPDATE dbo.PageDefinitions SET Label = N'Applicants / Applications', Module = N'Follow-Up', GroupName = N'Follow-Up Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 150, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-applicants';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-applicants', N'Applicants / Applications', N'Follow-Up', N'Follow-Up Sales', N'view,create,edit,delete,print,export', 150, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-applicant-timeline')
  UPDATE dbo.PageDefinitions SET Label = N'Applicant Timeline', Module = N'Follow-Up', GroupName = N'Follow-Up Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 160, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-applicant-timeline';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-applicant-timeline', N'Applicant Timeline', N'Follow-Up', N'Follow-Up Sales', N'view,create,edit,delete,print,export', 160, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-bank-noc')
  UPDATE dbo.PageDefinitions SET Label = N'Bank NOC', Module = N'Follow-Up', GroupName = N'Follow-Up Closure', Actions = N'view,create,edit,delete,print,export', SortOrder = 220, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-bank-noc';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-bank-noc', N'Bank NOC', N'Follow-Up', N'Follow-Up Closure', N'view,create,edit,delete,print,export', 220, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-block-master')
  UPDATE dbo.PageDefinitions SET Label = N'Block Master', Module = N'Follow-Up', GroupName = N'Follow-Up Setup', Actions = N'view,create,edit,delete,print,export', SortOrder = 130, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-block-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-block-master', N'Block Master', N'Follow-Up', N'Follow-Up Setup', N'view,create,edit,delete,print,export', 130, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-bookings')
  UPDATE dbo.PageDefinitions SET Label = N'Bookings', Module = N'Follow-Up', GroupName = N'Follow-Up Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 170, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-bookings';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-bookings', N'Bookings', N'Follow-Up', N'Follow-Up Sales', N'view,create,edit,delete,print,export', 170, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-communicator')
  UPDATE dbo.PageDefinitions SET Label = N'Communicator', Module = N'Follow-Up', GroupName = N'Follow-Up Agreement', Actions = N'view,create,edit,delete,print,export', SortOrder = 360, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-communicator';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-communicator', N'Communicator', N'Follow-Up', N'Follow-Up Agreement', N'view,create,edit,delete,print,export', 360, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-construction-updates')
  UPDATE dbo.PageDefinitions SET Label = N'Construction Updates', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 280, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-construction-updates';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-construction-updates', N'Construction Updates', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 280, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-customer-master')
  UPDATE dbo.PageDefinitions SET Label = N'Customer Master', Module = N'Follow-Up', GroupName = N'Follow-Up Setup', Actions = N'view,create,edit,delete,print,export', SortOrder = 110, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-customer-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-customer-master', N'Customer Master', N'Follow-Up', N'Follow-Up Setup', N'view,create,edit,delete,print,export', 110, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Follow-Up Dashboard', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-dashboard', N'Follow-Up Dashboard', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-document-vault')
  UPDATE dbo.PageDefinitions SET Label = N'Document Vault', Module = N'Follow-Up', GroupName = N'Follow-Up Agreement', Actions = N'view,create,edit,delete,print,export', SortOrder = 350, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-document-vault';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-document-vault', N'Document Vault', N'Follow-Up', N'Follow-Up Agreement', N'view,create,edit,delete,print,export', 350, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-finance-demands')
  UPDATE dbo.PageDefinitions SET Label = N'Finance Demands', Module = N'Follow-Up', GroupName = N'Follow-Up Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 290, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-finance-demands';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-finance-demands', N'Finance Demands', N'Follow-Up', N'Follow-Up Finance', N'view,create,edit,delete,print,export', 290, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-finance-payments')
  UPDATE dbo.PageDefinitions SET Label = N'Follow-Up Payments', Module = N'Follow-Up', GroupName = N'Follow-Up Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 300, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-finance-payments';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-finance-payments', N'Follow-Up Payments', N'Follow-Up', N'Follow-Up Finance', N'view,create,edit,delete,print,export', 300, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-handover')
  UPDATE dbo.PageDefinitions SET Label = N'Handover', Module = N'Follow-Up', GroupName = N'Follow-Up Closure', Actions = N'view,create,edit,delete,print,export', SortOrder = 240, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-handover';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-handover', N'Handover', N'Follow-Up', N'Follow-Up Closure', N'view,create,edit,delete,print,export', 240, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-legal-milestones')
  UPDATE dbo.PageDefinitions SET Label = N'Legal Milestones', Module = N'Follow-Up', GroupName = N'Follow-Up Legal', Actions = N'view,create,edit,delete,print,export', SortOrder = 250, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-legal-milestones';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-legal-milestones', N'Legal Milestones', N'Follow-Up', N'Follow-Up Legal', N'view,create,edit,delete,print,export', 250, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-log')
  UPDATE dbo.PageDefinitions SET Label = N'Follow-Up Log', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-log';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-log', N'Follow-Up Log', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 40, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-noc')
  UPDATE dbo.PageDefinitions SET Label = N'NOC', Module = N'Follow-Up', GroupName = N'Follow-Up Closure', Actions = N'view,create,edit,delete,print,export', SortOrder = 210, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-noc';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-noc', N'NOC', N'Follow-Up', N'Follow-Up Closure', N'view,create,edit,delete,print,export', 210, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-payment-plan-master')
  UPDATE dbo.PageDefinitions SET Label = N'Payment Plan Master', Module = N'Follow-Up', GroupName = N'Follow-Up Setup', Actions = N'view,create,edit,delete,print,export', SortOrder = 140, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-payment-plan-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-payment-plan-master', N'Payment Plan Master', N'Follow-Up', N'Follow-Up Setup', N'view,create,edit,delete,print,export', 140, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-pending-tasks')
  UPDATE dbo.PageDefinitions SET Label = N'Pending Tasks', Module = N'Follow-Up', GroupName = N'Follow-Up Setup', Actions = N'view,create,edit,delete,print,export', SortOrder = 100, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-pending-tasks';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-pending-tasks', N'Pending Tasks', N'Follow-Up', N'Follow-Up Setup', N'view,create,edit,delete,print,export', 100, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-pipeline-applicants')
  UPDATE dbo.PageDefinitions SET Label = N'Applicants Pipeline', Module = N'Follow-Up', GroupName = N'Follow-Up Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 370, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-pipeline-applicants';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-pipeline-applicants', N'Applicants Pipeline', N'Follow-Up', N'Follow-Up Sales', N'view,create,edit,delete,print,export', 370, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-pipeline-unit-selections')
  UPDATE dbo.PageDefinitions SET Label = N'Unit Selection Pipeline', Module = N'Follow-Up', GroupName = N'Follow-Up Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 380, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-pipeline-unit-selections';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-pipeline-unit-selections', N'Unit Selection Pipeline', N'Follow-Up', N'Follow-Up Sales', N'view,create,edit,delete,print,export', 380, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-possession-notice')
  UPDATE dbo.PageDefinitions SET Label = N'Possession Notice', Module = N'Follow-Up', GroupName = N'Follow-Up Closure', Actions = N'view,create,edit,delete,print,export', SortOrder = 270, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-possession-notice';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-possession-notice', N'Possession Notice', N'Follow-Up', N'Follow-Up Closure', N'view,create,edit,delete,print,export', 270, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-pre-possession')
  UPDATE dbo.PageDefinitions SET Label = N'Pre-Possession', Module = N'Follow-Up', GroupName = N'Follow-Up Closure', Actions = N'view,create,edit,delete,print,export', SortOrder = 260, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-pre-possession';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-pre-possession', N'Pre-Possession', N'Follow-Up', N'Follow-Up Closure', N'view,create,edit,delete,print,export', 260, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-reminders')
  UPDATE dbo.PageDefinitions SET Label = N'Reminders', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-reminders';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-reminders', N'Reminders', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-report-customer')
  UPDATE dbo.PageDefinitions SET Label = N'Customer Report', Module = N'Follow-Up', GroupName = N'Follow-Up Reports', Actions = N'view,create,edit,delete,print,export', SortOrder = 310, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-report-customer';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-report-customer', N'Customer Report', N'Follow-Up', N'Follow-Up Reports', N'view,create,edit,delete,print,export', 310, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-report-financial')
  UPDATE dbo.PageDefinitions SET Label = N'Financial Report', Module = N'Follow-Up', GroupName = N'Follow-Up Reports', Actions = N'view,create,edit,delete,print,export', SortOrder = 320, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-report-financial';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-report-financial', N'Financial Report', N'Follow-Up', N'Follow-Up Reports', N'view,create,edit,delete,print,export', 320, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-report-project-status')
  UPDATE dbo.PageDefinitions SET Label = N'Project Status Report', Module = N'Follow-Up', GroupName = N'Follow-Up Reports', Actions = N'view,create,edit,delete,print,export', SortOrder = 330, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-report-project-status';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-report-project-status', N'Project Status Report', N'Follow-Up', N'Follow-Up Reports', N'view,create,edit,delete,print,export', 330, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-room-master')
  UPDATE dbo.PageDefinitions SET Label = N'Room Master', Module = N'Follow-Up', GroupName = N'Follow-Up Setup', Actions = N'view,create,edit,delete,print,export', SortOrder = 125, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-room-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-room-master', N'Room Master', N'Follow-Up', N'Follow-Up Setup', N'view,create,edit,delete,print,export', 125, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-sales-deed')
  UPDATE dbo.PageDefinitions SET Label = N'Sales Deed', Module = N'Follow-Up', GroupName = N'Follow-Up Closure', Actions = N'view,create,edit,delete,print,export', SortOrder = 230, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-sales-deed';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-sales-deed', N'Sales Deed', N'Follow-Up', N'Follow-Up Closure', N'view,create,edit,delete,print,export', 230, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-tasks')
  UPDATE dbo.PageDefinitions SET Label = N'Follow-Up Tasks', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-tasks';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-tasks', N'Follow-Up Tasks', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 30, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-unit-master')
  UPDATE dbo.PageDefinitions SET Label = N'Unit Master', Module = N'Follow-Up', GroupName = N'Follow-Up Setup', Actions = N'view,create,edit,delete,print,export', SortOrder = 120, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-unit-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-unit-master', N'Unit Master', N'Follow-Up', N'Follow-Up Setup', N'view,create,edit,delete,print,export', 120, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-unit-selection')
  UPDATE dbo.PageDefinitions SET Label = N'Unit Selection', Module = N'Follow-Up', GroupName = N'Follow-Up Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 180, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-unit-selection';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-unit-selection', N'Unit Selection', N'Follow-Up', N'Follow-Up Sales', N'view,create,edit,delete,print,export', 180, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'followup-welcome-calls')
  UPDATE dbo.PageDefinitions SET Label = N'Welcome Calls', Module = N'Follow-Up', GroupName = N'Follow-Up Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 200, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'followup-welcome-calls';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'followup-welcome-calls', N'Welcome Calls', N'Follow-Up', N'Follow-Up Sales', N'view,create,edit,delete,print,export', 200, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'general-ledger')
  UPDATE dbo.PageDefinitions SET Label = N'General Ledger Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 170, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'general-ledger';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'general-ledger', N'General Ledger Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 170, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'godowns')
  UPDATE dbo.PageDefinitions SET Label = N'Godowns', Module = N'Admin', GroupName = N'Admin Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 90, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'godowns';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'godowns', N'Godowns', N'Admin', N'Admin Masters', N'view,create,edit,delete,print,export', 90, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'grn-master')
  UPDATE dbo.PageDefinitions SET Label = N'GRN', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export,post-approval', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'grn-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'grn-master', N'GRN', N'Material', N'Material', N'view,create,edit,delete,print,export,post-approval', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'grn-reminders')
  UPDATE dbo.PageDefinitions SET Label = N'GRN Reminders', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 80, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'grn-reminders';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'grn-reminders', N'GRN Reminders', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 80, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'hsn-master')
  UPDATE dbo.PageDefinitions SET Label = N'HSN Master', Module = N'Material', GroupName = N'Material Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 210, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'hsn-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'hsn-master', N'HSN Master', N'Material', N'Material Masters', N'view,create,edit,delete,print,export', 210, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'integration-channels')
  UPDATE dbo.PageDefinitions SET Label = N'Integration Channels', Module = N'Admin', GroupName = N'Admin Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 70, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'integration-channels';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'integration-channels', N'Integration Channels', N'Admin', N'Admin Masters', N'view,create,edit,delete,print,export', 70, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'inventory-master')
  UPDATE dbo.PageDefinitions SET Label = N'Inventory Master', Module = N'Material', GroupName = N'Material Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 140, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'inventory-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'inventory-master', N'Inventory Master', N'Material', N'Material Masters', N'view,create,edit,delete,print,export', 140, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'item-group')
  UPDATE dbo.PageDefinitions SET Label = N'Item Group Master', Module = N'Material', GroupName = N'Material Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 200, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'item-group';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'item-group', N'Item Group Master', N'Material', N'Material Masters', N'view,create,edit,delete,print,export', 200, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'item-master')
  UPDATE dbo.PageDefinitions SET Label = N'Item Master', Module = N'Material', GroupName = N'Material Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 190, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'item-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'item-master', N'Item Master', N'Material', N'Material Masters', N'view,create,edit,delete,print,export', 190, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'journal-voucher')
  UPDATE dbo.PageDefinitions SET Label = N'Journal Voucher', Module = N'Finance', GroupName = N'Finance', Actions = N'view,create,edit,delete,print,export,post-approval', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'journal-voucher';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'journal-voucher', N'Journal Voucher', N'Finance', N'Finance', N'view,create,edit,delete,print,export,post-approval', 60, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'l1-chart')
  UPDATE dbo.PageDefinitions SET Label = N'L1 Price Comparative Chart', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 65, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'l1-chart';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'l1-chart', N'L1 Price Comparative Chart', N'Material', N'Material', N'view,create,edit,delete,print,export', 65, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'material-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Material Dashboard', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'material-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'material-dashboard', N'Material Dashboard', N'Material', N'Material', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'material-debit-note')
  UPDATE dbo.PageDefinitions SET Label = N'Material Debit Note', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'material-debit-note';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'material-debit-note', N'Material Debit Note', N'Material', N'Material', N'view,create,edit,delete,print,export', 50, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'material-issues')
  UPDATE dbo.PageDefinitions SET Label = N'Material Issues', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 110, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'material-issues';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'material-issues', N'Material Issues', N'Material', N'Material', N'view,create,edit,delete,print,export', 110, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'material-request')
  UPDATE dbo.PageDefinitions SET Label = N'Material Request', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 100, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'material-request';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'material-request', N'Material Request', N'Material', N'Material', N'view,create,edit,delete,print,export', 100, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'menu-rights')
  UPDATE dbo.PageDefinitions SET Label = N'Menu Rights', Module = N'Admin', GroupName = N'Admin Rights', Actions = N'view,create,edit,delete,print,export', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'menu-rights';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'menu-rights', N'Menu Rights', N'Admin', N'Admin Rights', N'view,create,edit,delete,print,export', 30, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'menu-types')
  UPDATE dbo.PageDefinitions SET Label = N'Menu Types Master', Module = N'Admin', GroupName = N'Admin Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 230, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'menu-types';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'menu-types', N'Menu Types Master', N'Admin', N'Admin Masters', N'view,create,edit,delete,print,export', 230, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'metrics-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Metrics Dashboard', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 290, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'metrics-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'metrics-dashboard', N'Metrics Dashboard', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 290, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'named-entry-type')
  UPDATE dbo.PageDefinitions SET Label = N'Named Entry Type Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 140, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'named-entry-type';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'named-entry-type', N'Named Entry Type Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 140, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'new-payment')
  UPDATE dbo.PageDefinitions SET Label = N'Payments', Module = N'Finance', GroupName = N'Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'new-payment';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'new-payment', N'Payments', N'Finance', N'Finance', N'view,create,edit,delete,print,export', 30, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'page-definitions')
  UPDATE dbo.PageDefinitions SET Label = N'Page Definitions', Module = N'Admin', GroupName = N'Admin Rights', Actions = N'view,create,edit,delete,print,export', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'page-definitions';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'page-definitions', N'Page Definitions', N'Admin', N'Admin Rights', N'view,create,edit,delete,print,export', 60, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'password-reset')
  UPDATE dbo.PageDefinitions SET Label = N'Password Reset', Module = N'Admin', GroupName = N'Admin Security', Actions = N'view,create,edit,delete,print,export', SortOrder = 240, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'password-reset';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'password-reset', N'Password Reset', N'Admin', N'Admin Security', N'view,create,edit,delete,print,export', 240, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'po-reminders')
  UPDATE dbo.PageDefinitions SET Label = N'PO Reminders', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'po-reminders';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'po-reminders', N'PO Reminders', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 50, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'post-approval-rights')
  UPDATE dbo.PageDefinitions SET Label = N'Post Approval Rights', Module = N'Admin', GroupName = N'Admin Approval', Actions = N'view,create,edit,delete,print,export', SortOrder = 120, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'post-approval-rights';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'post-approval-rights', N'Post Approval Rights', N'Admin', N'Admin Approval', N'view,create,edit,delete,print,export', 120, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'profit-center')
  UPDATE dbo.PageDefinitions SET Label = N'Profit Center Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 196, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'profit-center';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'profit-center', N'Profit Center Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 196, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'project-master')
  UPDATE dbo.PageDefinitions SET Label = N'Project Master', Module = N'Admin', GroupName = N'Admin Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 200, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'project-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'project-master', N'Project Master', N'Admin', N'Admin Masters', N'view,create,edit,delete,print,export', 200, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'purchase-orders')
  UPDATE dbo.PageDefinitions SET Label = N'Purchase Order', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export,post-approval', SortOrder = 120, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'purchase-orders';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'purchase-orders', N'Purchase Order', N'Material', N'Material', N'view,create,edit,delete,print,export,post-approval', 120, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'quotation')
  UPDATE dbo.PageDefinitions SET Label = N'Quotation', Module = N'Material', GroupName = N'Transaction', Actions = N'view,create,edit,delete,print,export', SortOrder = 45, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'quotation';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'quotation', N'Quotation', N'Material', N'Transaction', N'view,create,edit,delete,print,export', 45, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'received-payment')
  UPDATE dbo.PageDefinitions SET Label = N'Received Payments', Module = N'Finance', GroupName = N'Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'received-payment';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'received-payment', N'Received Payments', N'Finance', N'Finance', N'view,create,edit,delete,print,export', 40, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'records')
  UPDATE dbo.PageDefinitions SET Label = N'Records', Module = N'Finance', GroupName = N'Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'records';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'records', N'Records', N'Finance', N'Finance', N'view,create,edit,delete,print,export', 60, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'reports')
  UPDATE dbo.PageDefinitions SET Label = N'Reports', Module = N'General', GroupName = N'General', Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'reports';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'reports', N'Reports', N'General', N'General', N'view,create,edit,delete,print,export', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'role-master')
  UPDATE dbo.PageDefinitions SET Label = N'Role Master', Module = N'Admin', GroupName = N'Admin Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 220, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'role-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'role-master', N'Role Master', N'Admin', N'Admin Masters', N'view,create,edit,delete,print,export', 220, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-ads')
  UPDATE dbo.PageDefinitions SET Label = N'Ad Master', Module = N'Sales Automation', GroupName = N'Sales Automation Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 420, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-ads';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-ads', N'Ad Master', N'Sales Automation', N'Sales Automation Masters', N'view,create,edit,delete,print,export', 420, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-campaigns')
  UPDATE dbo.PageDefinitions SET Label = N'Campaign Master', Module = N'Sales Automation', GroupName = N'Sales Automation Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 410, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-campaigns';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-campaigns', N'Campaign Master', N'Sales Automation', N'Sales Automation Masters', N'view,create,edit,delete,print,export', 410, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-distribution-rules')
  UPDATE dbo.PageDefinitions SET Label = N'Distribution Rules Setup', Module = N'Sales Automation', GroupName = N'Sales Automation Admin', Actions = N'view,create,edit,delete', SortOrder = 478, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-distribution-rules';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-distribution-rules', N'Distribution Rules Setup', N'Sales Automation', N'Sales Automation Admin', N'view,create,edit,delete', 478, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-inquiry')
  UPDATE dbo.PageDefinitions SET Label = N'Inquiry Dashboard', Module = N'Sales Automation', GroupName = N'Sales Automation Inquiry', Actions = N'view,create,edit,delete,print,export', SortOrder = 450, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-inquiry';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-inquiry', N'Inquiry Dashboard', N'Sales Automation', N'Sales Automation Inquiry', N'view,create,edit,delete,print,export', 450, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-lead-distribution')
  UPDATE dbo.PageDefinitions SET Label = N'Lead Distribution', Module = N'Sales Automation', GroupName = N'Sales Automation Leads', Actions = N'view,create,edit,delete,print,export', SortOrder = 440, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-lead-distribution';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-lead-distribution', N'Lead Distribution', N'Sales Automation', N'Sales Automation Leads', N'view,create,edit,delete,print,export', 440, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-leads')
  UPDATE dbo.PageDefinitions SET Label = N'Lead Management', Module = N'Sales Automation', GroupName = N'Sales Automation Leads', Actions = N'view,create,edit,delete,print,export', SortOrder = 430, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-leads';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-leads', N'Lead Management', N'Sales Automation', N'Sales Automation Leads', N'view,create,edit,delete,print,export', 430, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-lead-transfers')
  UPDATE dbo.PageDefinitions SET Label = N'Lead Transfers', Module = N'Sales Automation', GroupName = N'Sales Automation Leads', Actions = N'view,create,edit,delete', SortOrder = 480, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-lead-transfers';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-lead-transfers', N'Lead Transfers', N'Sales Automation', N'Sales Automation Leads', N'view,create,edit,delete', 480, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sale-invoice')
  UPDATE dbo.PageDefinitions SET Label = N'Sale Invoice', Module = N'Sales', GroupName = N'Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sale-invoice';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sale-invoice', N'Sale Invoice', N'Sales', N'Sales', N'view,create,edit,delete,print,export', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sale-order')
  UPDATE dbo.PageDefinitions SET Label = N'Sale Order', Module = N'Sales', GroupName = N'Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sale-order';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sale-order', N'Sale Order', N'Sales', N'Sales', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sales-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Sales Dashboard', Module = N'Sales', GroupName = N'Sales', Actions = N'view', SortOrder = 5, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sales-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sales-dashboard', N'Sales Dashboard', N'Sales', N'Sales', N'view', 5, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sales-payment')
  UPDATE dbo.PageDefinitions SET Label = N'Payment', Module = N'Sales', GroupName = N'Sales', Actions = N'view,create,edit,delete,print,export', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sales-payment';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sales-payment', N'Payment', N'Sales', N'Sales', N'view,create,edit,delete,print,export', 30, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-marketing-invoices')
  UPDATE dbo.PageDefinitions SET Label = N'Marketing Invoices', Module = N'Sales Automation', GroupName = N'Sales Automation Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 470, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-marketing-invoices';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-marketing-invoices', N'Marketing Invoices', N'Sales Automation', N'Sales Automation Finance', N'view,create,edit,delete,print,export', 470, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-role-master')
  UPDATE dbo.PageDefinitions SET Label = N'SA Role Master', Module = N'Sales Automation', GroupName = N'Sales Automation Admin', Actions = N'view,create,edit,delete,print', SortOrder = 490, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-role-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-role-master', N'SA Role Master', N'Sales Automation', N'Sales Automation Admin', N'view,create,edit,delete,print', 490, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-site-visits')
  UPDATE dbo.PageDefinitions SET Label = N'Site Visits', Module = N'Sales Automation', GroupName = N'Sales Automation Inquiry', Actions = N'view,create,edit,delete,print,export', SortOrder = 460, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-site-visits';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-site-visits', N'Site Visits', N'Sales Automation', N'Sales Automation Inquiry', N'view,create,edit,delete,print,export', 460, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-social-media')
  UPDATE dbo.PageDefinitions SET Label = N'Social Media Master', Module = N'Sales Automation', GroupName = N'Sales Automation Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 400, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-social-media';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-social-media', N'Social Media Master', N'Sales Automation', N'Sales Automation Masters', N'view,create,edit,delete,print,export', 400, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sa-teams')
  UPDATE dbo.PageDefinitions SET Label = N'Sales Team Management', Module = N'Sales Automation', GroupName = N'Sales Automation Admin', Actions = N'view,create,edit,delete', SortOrder = 475, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sa-teams';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sa-teams', N'Sales Team Management', N'Sales Automation', N'Sales Automation Admin', N'view,create,edit,delete', 475, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'signature')
  UPDATE dbo.PageDefinitions SET Label = N'Signature', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 150, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'signature';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'signature', N'Signature', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 150, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'sms-setup')
  UPDATE dbo.PageDefinitions SET Label = N'SMS Setup', Module = N'Admin', GroupName = N'Admin Communicator', Actions = N'view,create,edit,delete,print,export', SortOrder = 260, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'sms-setup';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'sms-setup', N'SMS Setup', N'Admin', N'Admin Communicator', N'view,create,edit,delete,print,export', 260, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'stock-ledger')
  UPDATE dbo.PageDefinitions SET Label = N'Stock', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 150, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'stock-ledger';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'stock-ledger', N'Stock', N'Material', N'Material', N'view,create,edit,delete,print,export', 150, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'stock-transfers')
  UPDATE dbo.PageDefinitions SET Label = N'Stock Transfer', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 160, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'stock-transfers';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'stock-transfers', N'Stock Transfer', N'Material', N'Material', N'view,create,edit,delete,print,export', 160, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'superadmin-dashboard')
  UPDATE dbo.PageDefinitions SET Label = N'Super Admin Dashboard', Module = N'Admin', GroupName = N'Super Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 360, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'superadmin-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'superadmin-dashboard', N'Super Admin Dashboard', N'Admin', N'Super Admin', N'view,create,edit,delete,print,export', 360, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'superadmin-profile')
  UPDATE dbo.PageDefinitions SET Label = N'Super Admin Profile', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 170, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'superadmin-profile';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'superadmin-profile', N'Super Admin Profile', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 170, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'supplier-catalog')
  UPDATE dbo.PageDefinitions SET Label = N'Supplier Price Catalog', Module = N'Supplier', GroupName = N'Supplier Portal', Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'supplier-catalog';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'supplier-catalog', N'Supplier Price Catalog', N'Supplier', N'Supplier Portal', N'view,create,edit,delete,print,export', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'supplier-master')
  UPDATE dbo.PageDefinitions SET Label = N'Supplier Master', Module = N'Material', GroupName = N'Material Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 180, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'supplier-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'supplier-master', N'Supplier Master', N'Material', N'Material Masters', N'view,create,edit,delete,print,export', 180, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'supplier-quotations')
  UPDATE dbo.PageDefinitions SET Label = N'Supplier Quotations', Module = N'Supplier', GroupName = N'Supplier Portal', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'supplier-quotations';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'supplier-quotations', N'Supplier Quotations', N'Supplier', N'Supplier Portal', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'tasks')
  UPDATE dbo.PageDefinitions SET Label = N'Tasks', Module = N'General', GroupName = N'General', Actions = N'view,create,edit,delete,print,export', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'tasks';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'tasks', N'Tasks', N'General', N'General', N'view,create,edit,delete,print,export', 50, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N't-c-master')
  UPDATE dbo.PageDefinitions SET Label = N'Terms & Conditions Master', Module = N'Material', GroupName = N'Material Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 130, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N't-c-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N't-c-master', N'Terms & Conditions Master', N'Material', N'Material Masters', N'view,create,edit,delete,print,export', 130, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'tds-master')
  UPDATE dbo.PageDefinitions SET Label = N'TDS Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 120, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'tds-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'tds-master', N'TDS Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 120, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'tds-reminders')
  UPDATE dbo.PageDefinitions SET Label = N'TDS Reminders', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 90, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'tds-reminders';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'tds-reminders', N'TDS Reminders', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 90, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'ticket-admin-panel')
  UPDATE dbo.PageDefinitions SET Label = N'Admin Ticket Panel', Module = N'Ticket', GroupName = N'Ticket', Actions = N'view,create,edit,delete,print,export', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'ticket-admin-panel';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'ticket-admin-panel', N'Admin Ticket Panel', N'Ticket', N'Ticket', N'view,create,edit,delete,print,export', 60, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'ticket-create')
  UPDATE dbo.PageDefinitions SET Label = N'Create Ticket', Module = N'Ticket', GroupName = N'Ticket', Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'ticket-create';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'ticket-create', N'Create Ticket', N'Ticket', N'Ticket', N'view,create,edit,delete,print,export', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'ticket-my-tickets')
  UPDATE dbo.PageDefinitions SET Label = N'My Tickets', Module = N'Ticket', GroupName = N'Ticket', Actions = N'view,create,edit,delete,print,export', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'ticket-my-tickets';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'ticket-my-tickets', N'My Tickets', N'Ticket', N'Ticket', N'view,create,edit,delete,print,export', 30, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'ticket-pending')
  UPDATE dbo.PageDefinitions SET Label = N'Pending Tickets', Module = N'Ticket', GroupName = N'Ticket', Actions = N'view,create,edit,delete,print,export', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'ticket-pending';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'ticket-pending', N'Pending Tickets', N'Ticket', N'Ticket', N'view,create,edit,delete,print,export', 40, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'ticket-resolution')
  UPDATE dbo.PageDefinitions SET Label = N'Ticket Resolution', Module = N'Ticket', GroupName = N'Ticket', Actions = N'view,create,edit,delete,print,export', SortOrder = 70, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'ticket-resolution';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'ticket-resolution', N'Ticket Resolution', N'Ticket', N'Ticket', N'view,create,edit,delete,print,export', 70, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'ticket-resolved')
  UPDATE dbo.PageDefinitions SET Label = N'Resolved Tickets', Module = N'Ticket', GroupName = N'Ticket', Actions = N'view,create,edit,delete,print,export', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'ticket-resolved';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'ticket-resolved', N'Resolved Tickets', N'Ticket', N'Ticket', N'view,create,edit,delete,print,export', 50, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'tickets')
  UPDATE dbo.PageDefinitions SET Label = N'Ticket Dashboard', Module = N'Ticket', GroupName = N'Ticket', Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'tickets';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'tickets', N'Ticket Dashboard', N'Ticket', N'Ticket', N'view,create,edit,delete,print,export', 10, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'trial-balance')
  UPDATE dbo.PageDefinitions SET Label = N'Trial Balance / Transactions', Module = N'Finance', GroupName = N'Finance', Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'trial-balance';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'trial-balance', N'Trial Balance / Transactions', N'Finance', N'Finance', N'view,create,edit,delete,print,export', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'type-of-doc')
  UPDATE dbo.PageDefinitions SET Label = N'Type Of Doc Master', Module = N'Finance', GroupName = N'Finance Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 150, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'type-of-doc';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'type-of-doc', N'Type Of Doc Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 150, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'unit-of-measurement')
  UPDATE dbo.PageDefinitions SET Label = N'Unit Of Measurement Master', Module = N'Material', GroupName = N'Material Masters', Actions = N'view,create,edit,delete,print,export', SortOrder = 220, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'unit-of-measurement';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'unit-of-measurement', N'Unit Of Measurement Master', N'Material', N'Material Masters', N'view,create,edit,delete,print,export', 220, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'user-profile')
  UPDATE dbo.PageDefinitions SET Label = N'User Profile', Module = N'General', GroupName = N'General', Actions = N'view,create,edit,delete,print,export', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'user-profile';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'user-profile', N'User Profile', N'General', N'General', N'view,create,edit,delete,print,export', 60, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'users')
  UPDATE dbo.PageDefinitions SET Label = N'Users', Module = N'Admin', GroupName = N'Admin', Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'users';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'users', N'Users', N'Admin', N'Admin', N'view,create,edit,delete,print,export', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'vehicle-in-out')
  UPDATE dbo.PageDefinitions SET Label = N'Vehicle In/Out', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'vehicle-in-out';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'vehicle-in-out', N'Vehicle In/Out', N'Material', N'Material', N'view,create,edit,delete,print,export', 30, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'whatsapp-setup')
  UPDATE dbo.PageDefinitions SET Label = N'WhatsApp Setup', Module = N'Admin', GroupName = N'Admin Communicator', Actions = N'view,create,edit,delete,print,export', SortOrder = 280, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'whatsapp-setup';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'whatsapp-setup', N'WhatsApp Setup', N'Admin', N'Admin Communicator', N'view,create,edit,delete,print,export', 280, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'widget-catalog')
  UPDATE dbo.PageDefinitions SET Label = N'Widget Catalog', Module = N'Admin', GroupName = N'Admin Rights', Actions = N'view,create,edit,delete,print,export', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'widget-catalog';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'widget-catalog', N'Widget Catalog', N'Admin', N'Admin Rights', N'view,create,edit,delete,print,export', 50, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'widget-rights')
  UPDATE dbo.PageDefinitions SET Label = N'Widget Rights', Module = N'Admin', GroupName = N'Admin Rights', Actions = N'view,create,edit,delete,print,export', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'widget-rights';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'widget-rights', N'Widget Rights', N'Admin', N'Admin Rights', N'view,create,edit,delete,print,export', 40, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'widgets')
  UPDATE dbo.PageDefinitions SET Label = N'Widgets', Module = N'General', GroupName = N'General', Actions = N'view,create,edit,delete,print,export', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'widgets';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'widgets', N'Widgets', N'General', N'General', N'view,create,edit,delete,print,export', 30, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'wo-reminders')
  UPDATE dbo.PageDefinitions SET Label = N'WO Reminders', Module = N'Follow-Up', GroupName = N'Follow-Up', Actions = N'view,create,edit,delete,print,export', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'wo-reminders';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'wo-reminders', N'WO Reminders', N'Follow-Up', N'Follow-Up', N'view,create,edit,delete,print,export', 60, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'work-done')
  UPDATE dbo.PageDefinitions SET Label = N'Work Done', Module = N'Engineering', GroupName = N'Engineering', Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'work-done';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'work-done', N'Work Done', N'Engineering', N'Engineering', N'view,create,edit,delete,print,export', 20, 1, N'migration-172', SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'work-order')
  UPDATE dbo.PageDefinitions SET Label = N'Work Order', Module = N'Material', GroupName = N'Material', Actions = N'view,create,edit,delete,print,export,post-approval', SortOrder = 70, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'work-order';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'work-order', N'Work Order', N'Material', N'Material', N'view,create,edit,delete,print,export,post-approval', 70, 1, N'migration-172', SYSDATETIME());

-- ── WidgetCatalog (12 rows) ──────────────────────────────────
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Bar Chart')
  UPDATE dbo.WidgetCatalog SET Label = N'Bar Chart', IconKey = N'bar-chart-2', Category = N'Charts', Description = N'System activity bar chart, last 7 days', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Bar Chart';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Bar Chart', N'Bar Chart', N'bar-chart-2', N'Charts', N'System activity bar chart, last 7 days', 10, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Line Chart')
  UPDATE dbo.WidgetCatalog SET Label = N'Line Chart', IconKey = N'trending-up', Category = N'Charts', Description = N'Tasks vs activity trend line chart', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Line Chart';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Line Chart', N'Line Chart', N'trending-up', N'Charts', N'Tasks vs activity trend line chart', 20, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Pie Chart')
  UPDATE dbo.WidgetCatalog SET Label = N'Pie Chart', IconKey = N'pie-chart', Category = N'Charts', Description = N'Task status breakdown pie chart', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Pie Chart';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Pie Chart', N'Pie Chart', N'pie-chart', N'Charts', N'Task status breakdown pie chart', 30, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Stat Card')
  UPDATE dbo.WidgetCatalog SET Label = N'Stat Card', IconKey = N'hash', Category = N'KPIs', Description = N'Key metrics summary cards', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Stat Card';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Stat Card', N'Stat Card', N'hash', N'KPIs', N'Key metrics summary cards', 40, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Data Table')
  UPDATE dbo.WidgetCatalog SET Label = N'Data Table', IconKey = N'table-2', Category = N'Data', Description = N'Tabular data view with sorting', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Data Table';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Data Table', N'Data Table', N'table-2', N'Data', N'Tabular data view with sorting', 50, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Calendar')
  UPDATE dbo.WidgetCatalog SET Label = N'Calendar', IconKey = N'calendar', Category = N'Planning', Description = N'Calendar view of tasks and events', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Calendar';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Calendar', N'Calendar', N'calendar', N'Planning', N'Calendar view of tasks and events', 60, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Notifications')
  UPDATE dbo.WidgetCatalog SET Label = N'Notifications', IconKey = N'bell', Category = N'Alerts', Description = N'System alerts and notifications', SortOrder = 70, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Notifications';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Notifications', N'Notifications', N'bell', N'Alerts', N'System alerts and notifications', 70, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Activity Feed')
  UPDATE dbo.WidgetCatalog SET Label = N'Activity Feed', IconKey = N'message-square', Category = N'Activity', Description = N'Live user activity stream', SortOrder = 80, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Activity Feed';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Activity Feed', N'Activity Feed', N'message-square', N'Activity', N'Live user activity stream', 80, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Map View')
  UPDATE dbo.WidgetCatalog SET Label = N'Map View', IconKey = N'map', Category = N'Geo', Description = N'Geographic site map view', SortOrder = 90, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Map View';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Map View', N'Map View', N'map', N'Geo', N'Geographic site map view', 90, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'File Uploader')
  UPDATE dbo.WidgetCatalog SET Label = N'File Uploader', IconKey = N'paperclip', Category = N'Tools', Description = N'Quick file upload widget', SortOrder = 100, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'File Uploader';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'File Uploader', N'File Uploader', N'paperclip', N'Tools', N'Quick file upload widget', 100, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Progress Ring')
  UPDATE dbo.WidgetCatalog SET Label = N'Progress Ring', IconKey = N'refresh-cw', Category = N'KPIs', Description = N'Task completion progress rings', SortOrder = 110, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Progress Ring';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Progress Ring', N'Progress Ring', N'refresh-cw', N'KPIs', N'Task completion progress rings', 110, 1, SYSDATETIME());
IF EXISTS (SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = N'Calculator')
  UPDATE dbo.WidgetCatalog SET Label = N'Calculator', IconKey = N'calculator', Category = N'Tools', Description = N'Built-in calculator tool', SortOrder = 120, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE WidgetKey = N'Calculator';
ELSE
  INSERT INTO dbo.WidgetCatalog (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
  VALUES (N'Calculator', N'Calculator', N'calculator', N'Tools', N'Built-in calculator tool', 120, 1, SYSDATETIME());

-- ── RoleRights (88 rows, grouped by role) ──────────────────────
-- Skips gracefully (prints a warning, does not fail the migration) if a
-- role named here doesn't exist yet on this DB — run migration 169 first.

GO
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = N'Accountant')
  PRINT 'WARNING: role Accountant not found — skipping its 40 RoleRights row(s). Run migration 169 first.';
ELSE
BEGIN
  DECLARE @rid_Accountant INT = (SELECT RId FROM dbo.Role WHERE RName = N'Accountant');
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'account-head',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'account-head','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'account-head', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'bank-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'bank-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'bank-master', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'billing-terms',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'billing-terms','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'billing-terms', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'brs',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'brs','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'brs', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'card-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'card-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'card-master', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'cheque-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'cheque-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'cheque-master', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'debit-note',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'debit-note','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'debit-note', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'ExpenseBooking',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'ExpenseBooking','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'ExpenseBooking', 1, 1, 1, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'expenses-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'expenses-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'expenses-master', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'finance-dashboard',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'finance-dashboard','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'finance-dashboard', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'financial-year-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'financial-year-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'financial-year-master', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'general-ledger',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'general-ledger','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'general-ledger', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'new-payment',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'new-payment','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'new-payment', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'Payments',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'Payments','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'Payments', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'received-payment',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'received-payment','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'received-payment', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'ReceivedPayments',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'ReceivedPayments','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'ReceivedPayments', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'tds-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'tds-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'tds-master', 1, 1, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'Transactions',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'Transactions','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'Transactions', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'trial-balance',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'trial-balance','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Finance', N'trial-balance', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'contractor-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'contractor-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'contractor-master', 1, 1, 1, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'expense-booking',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'expense-booking','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'expense-booking', 1, 1, 1, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'GRN',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'GRN','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'GRN', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'grn-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'grn-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'grn-master', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'hsn-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'hsn-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'hsn-master', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'item-group',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'item-group','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'item-group', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'item-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'item-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'item-master', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'material-dashboard',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'material-dashboard','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'material-dashboard', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'material-debit-note',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'material-debit-note','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'material-debit-note', 1, 1, 1, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'material-issues',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'material-issues','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'material-issues', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'material-request',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'material-request','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'material-request', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'PurchaseOrders',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'PurchaseOrders','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'PurchaseOrders', 1, 1, 1, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'purchase-orders',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'purchase-orders','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'purchase-orders', 1, 1, 1, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'stock-ledger',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'stock-ledger','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'stock-ledger', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'stock-transfers',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'stock-transfers','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'stock-transfers', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'supplier-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'supplier-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'supplier-master', 1, 1, 1, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N't-c-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N't-c-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N't-c-master', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'unit-of-measurement',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'unit-of-measurement','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'unit-of-measurement', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'VehicleInOut',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'VehicleInOut','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'VehicleInOut', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'vehicle-in-out',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'vehicle-in-out','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'vehicle-in-out', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'work-order',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Accountant AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'work-order','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Accountant, N'Material', N'work-order', 1, 0, 0, 0, 1, 1, 0);
END

GO
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = N'Account''s Head')
  PRINT 'WARNING: role Account''s Head not found — skipping its 2 RoleRights row(s). Run migration 169 first.';
ELSE
BEGIN
  DECLARE @rid_Account_s_Head INT = (SELECT RId FROM dbo.Role WHERE RName = N'Account''s Head');
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Account_s_Head AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'Journal Voucher',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_Account_s_Head AND Module = N'Finance' AND ISNULL(SubModule,'') = ISNULL(N'Journal Voucher','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Account_s_Head, N'Finance', N'Journal Voucher', 1, 1, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Account_s_Head AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'Stock Transfers',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_Account_s_Head AND Module = N'Material' AND ISNULL(SubModule,'') = ISNULL(N'Stock Transfers','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Account_s_Head, N'Material', N'Stock Transfers', 1, 1, 0, 0, 0, 0, 0);
END

GO
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = N'Engineer')
  PRINT 'WARNING: role Engineer not found — skipping its 17 RoleRights row(s). Run migration 169 first.';
ELSE
BEGIN
  DECLARE @rid_Engineer INT = (SELECT RId FROM dbo.Role WHERE RName = N'Engineer');
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'BOQ',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'BOQ','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'BOQ', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'boq',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'boq','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'boq', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'dpr',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'dpr','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'dpr', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'DPR',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'DPR','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'DPR', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'engineering-boq',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'engineering-boq','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'engineering-boq', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'engineering-dashboard',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'engineering-dashboard','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'engineering-dashboard', 1, 0, 0, 0, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'engineering-work-order',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'engineering-work-order','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'engineering-work-order', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'WorkDone',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'WorkDone','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'WorkDone', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'work-done',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'work-done','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'work-done', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'work-order-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'work-order-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'work-order-master', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'WorkOrders',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Engineering' AND ISNULL(SubModule,'') = ISNULL(N'WorkOrders','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Engineering', N'WorkOrders', 1, 1, 1, 1, 1, 1, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-create',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-create','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Tickets', N'ticket-create', 1, 1, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-my-tickets',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-my-tickets','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Tickets', N'ticket-my-tickets', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-pending',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-pending','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Tickets', N'ticket-pending', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-resolution',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-resolution','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Tickets', N'ticket-resolution', 1, 1, 1, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-resolved',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'ticket-resolved','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Tickets', N'ticket-resolved', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'tickets',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=1, CanExport=1, CanPostApproval=0
    WHERE RoleId = @rid_Engineer AND Module = N'Tickets' AND ISNULL(SubModule,'') = ISNULL(N'tickets','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_Engineer, N'Tickets', N'tickets', 1, 1, 1, 0, 1, 1, 0);
END

GO
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = N'marketing_head')
  PRINT 'WARNING: role marketing_head not found — skipping its 15 RoleRights row(s). Run migration 169 first.';
ELSE
BEGIN
  DECLARE @rid_marketing_head INT = (SELECT RId FROM dbo.Role WHERE RName = N'marketing_head');
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales' AND ISNULL(SubModule,'') = ISNULL(N'sale-invoice',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales' AND ISNULL(SubModule,'') = ISNULL(N'sale-invoice','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales', N'sale-invoice', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales' AND ISNULL(SubModule,'') = ISNULL(N'sale-order',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales' AND ISNULL(SubModule,'') = ISNULL(N'sale-order','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales', N'sale-order', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales' AND ISNULL(SubModule,'') = ISNULL(N'sales-payment',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales' AND ISNULL(SubModule,'') = ISNULL(N'sales-payment','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales', N'sales-payment', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-ads',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-ads','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-ads', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-campaigns',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-campaigns','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-campaigns', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-distribution-rules',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-distribution-rules','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-distribution-rules', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-inquiry',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-inquiry','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-inquiry', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-lead-distribution',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-lead-distribution','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-lead-distribution', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-leads',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-leads','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-leads', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-lead-transfers',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-lead-transfers','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-lead-transfers', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-marketing-invoices',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-marketing-invoices','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-marketing-invoices', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-role-master',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-role-master','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-role-master', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-site-visits',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-site-visits','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-site-visits', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-social-media',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-social-media','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-social-media', 1, 1, 1, 1, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-teams',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=1, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_marketing_head AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-teams','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_marketing_head, N'Sales Automation', N'sa-teams', 1, 1, 1, 1, 0, 0, 0);
END

GO
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = N'sales_person')
  PRINT 'WARNING: role sales_person not found — skipping its 3 RoleRights row(s). Run migration 169 first.';
ELSE
BEGIN
  DECLARE @rid_sales_person INT = (SELECT RId FROM dbo.Role WHERE RName = N'sales_person');
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_person AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-inquiry',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_person AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-inquiry','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_person, N'Sales Automation', N'sa-inquiry', 1, 1, 1, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_person AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-leads',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=1, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_person AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-leads','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_person, N'Sales Automation', N'sa-leads', 1, 0, 1, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_person AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-site-visits',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_person AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-site-visits','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_person, N'Sales Automation', N'sa-site-visits', 1, 1, 1, 0, 0, 0, 0);
END

GO
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = N'sales_team_lead')
  PRINT 'WARNING: role sales_team_lead not found — skipping its 11 RoleRights row(s). Run migration 169 first.';
ELSE
BEGIN
  DECLARE @rid_sales_team_lead INT = (SELECT RId FROM dbo.Role WHERE RName = N'sales_team_lead');
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-ads',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-ads','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-ads', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-campaigns',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-campaigns','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-campaigns', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-distribution-rules',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-distribution-rules','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-distribution-rules', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-inquiry',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-inquiry','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-inquiry', 1, 1, 1, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-lead-distribution',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-lead-distribution','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-lead-distribution', 1, 1, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-leads',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=1, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-leads','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-leads', 1, 0, 1, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-lead-transfers',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-lead-transfers','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-lead-transfers', 1, 1, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-marketing-invoices',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-marketing-invoices','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-marketing-invoices', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-site-visits',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=1, CanEdit=1, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-site-visits','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-site-visits', 1, 1, 1, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-social-media',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-social-media','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-social-media', 1, 0, 0, 0, 0, 0, 0);
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-teams',''))
    UPDATE dbo.RoleRights SET CanView=1, CanAdd=0, CanEdit=0, CanDelete=0, CanPrint=0, CanExport=0, CanPostApproval=0
    WHERE RoleId = @rid_sales_team_lead AND Module = N'Sales Automation' AND ISNULL(SubModule,'') = ISNULL(N'sa-teams','');
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@rid_sales_team_lead, N'Sales Automation', N'sa-teams', 1, 0, 0, 0, 0, 0, 0);
END

-- ── UserPageRightsJson overrides (4 users) ─────────────────────
-- Skips gracefully if the user doesn't exist yet on this DB.

GO
IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = N'accounts@civilier.in')
  PRINT 'WARNING: user accounts@civilier.in not found — skipping their UserPageRightsJson override.';
ELSE
BEGIN
  DECLARE @uid_accounts_civilier_in INT = (SELECT id FROM dbo.users WHERE email = N'accounts@civilier.in');
  IF EXISTS (SELECT 1 FROM dbo.UserPageRightsJson WHERE UserId = @uid_accounts_civilier_in AND IsActive = 1)
    UPDATE dbo.UserPageRightsJson SET RightsJson = N'[{"page":"trial-balance","actions":["view","create","edit","delete","print","export"]},{"page":"finance-dashboard","actions":["view","create","edit","delete","print","export"]},{"page":"new-payment","actions":["view","create","edit","delete","print","export"]},{"page":"received-payment","actions":["view","create","edit","delete","print","export"]},{"page":"brs","actions":["view","create","edit","delete","print","export"]},{"page":"records","actions":["view","create","edit","delete","print","export"]},{"page":"bank-master","actions":["view","create","edit","delete","print","export"]},{"page":"expenses-master","actions":["view","create","edit","delete","print","export"]},{"page":"financial-year-master","actions":[]},{"page":"cheque-master","actions":["view","create","edit","delete","print","export"]},{"page":"card-master","actions":["view","create","edit","delete","print","export"]},{"page":"tds-master","actions":["view","create","edit","delete","print","export"]},{"page":"account-head","actions":["view","create","edit","delete","print","export"]},{"page":"general-ledger","actions":["view","create","edit","delete","print","export"]},{"page":"billing-terms","actions":["view","create","edit","delete","print","export"]},{"page":"debit-note","actions":["view","create","edit","delete","print","export"]},{"page":"material-dashboard","actions":["view","create","edit","delete","print","export"]},{"page":"grn-master","actions":["view","print"]},{"page":"vehicle-in-out","actions":["view","print"]},{"page":"expense-booking","actions":["view","create","edit","delete","print","export"]},{"page":"material-debit-note","actions":["view","create","edit","delete","print","export"]},{"page":"purchase-orders","actions":["view","create","edit","delete","print","export"]},{"page":"stock-ledger","actions":["view","print"]},{"page":"stock-transfers","actions":["view","print","create"]},{"page":"t-c-master","actions":["view","create","edit","delete","print","export"]},{"page":"contractor-master","actions":["view","create","edit","delete","print","export"]},{"page":"supplier-master","actions":["view","create","edit","delete","print","export"]},{"page":"item-master","actions":["view","create","edit","delete","print","export"]},{"page":"item-group","actions":["view","create","edit","delete","print","export"]},{"page":"hsn-master","actions":["view","create","edit","delete","print","export"]},{"page":"unit-of-measurement","actions":["view","create","edit","delete","print","export"]},{"page":"journal-voucher","actions":["view","create"]},{"page":"approval-inbox","actions":["view"]}]', UpdatedAt = GETDATE()
    WHERE UserId = @uid_accounts_civilier_in AND IsActive = 1;
  ELSE
    INSERT INTO dbo.UserPageRightsJson (UserId, RightsJson, IsActive, CreatedAt)
    VALUES (@uid_accounts_civilier_in, N'[{"page":"trial-balance","actions":["view","create","edit","delete","print","export"]},{"page":"finance-dashboard","actions":["view","create","edit","delete","print","export"]},{"page":"new-payment","actions":["view","create","edit","delete","print","export"]},{"page":"received-payment","actions":["view","create","edit","delete","print","export"]},{"page":"brs","actions":["view","create","edit","delete","print","export"]},{"page":"records","actions":["view","create","edit","delete","print","export"]},{"page":"bank-master","actions":["view","create","edit","delete","print","export"]},{"page":"expenses-master","actions":["view","create","edit","delete","print","export"]},{"page":"financial-year-master","actions":[]},{"page":"cheque-master","actions":["view","create","edit","delete","print","export"]},{"page":"card-master","actions":["view","create","edit","delete","print","export"]},{"page":"tds-master","actions":["view","create","edit","delete","print","export"]},{"page":"account-head","actions":["view","create","edit","delete","print","export"]},{"page":"general-ledger","actions":["view","create","edit","delete","print","export"]},{"page":"billing-terms","actions":["view","create","edit","delete","print","export"]},{"page":"debit-note","actions":["view","create","edit","delete","print","export"]},{"page":"material-dashboard","actions":["view","create","edit","delete","print","export"]},{"page":"grn-master","actions":["view","print"]},{"page":"vehicle-in-out","actions":["view","print"]},{"page":"expense-booking","actions":["view","create","edit","delete","print","export"]},{"page":"material-debit-note","actions":["view","create","edit","delete","print","export"]},{"page":"purchase-orders","actions":["view","create","edit","delete","print","export"]},{"page":"stock-ledger","actions":["view","print"]},{"page":"stock-transfers","actions":["view","print","create"]},{"page":"t-c-master","actions":["view","create","edit","delete","print","export"]},{"page":"contractor-master","actions":["view","create","edit","delete","print","export"]},{"page":"supplier-master","actions":["view","create","edit","delete","print","export"]},{"page":"item-master","actions":["view","create","edit","delete","print","export"]},{"page":"item-group","actions":["view","create","edit","delete","print","export"]},{"page":"hsn-master","actions":["view","create","edit","delete","print","export"]},{"page":"unit-of-measurement","actions":["view","create","edit","delete","print","export"]},{"page":"journal-voucher","actions":["view","create"]},{"page":"approval-inbox","actions":["view"]}]', 1, GETDATE());
END

GO
IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = N'mainab@civillier.in')
  PRINT 'WARNING: user mainab@civillier.in not found — skipping their UserPageRightsJson override.';
ELSE
BEGIN
  DECLARE @uid_mainab_civillier_in INT = (SELECT id FROM dbo.users WHERE email = N'mainab@civillier.in');
  IF EXISTS (SELECT 1 FROM dbo.UserPageRightsJson WHERE UserId = @uid_mainab_civillier_in AND IsActive = 1)
    UPDATE dbo.UserPageRightsJson SET RightsJson = N'[]', UpdatedAt = GETDATE()
    WHERE UserId = @uid_mainab_civillier_in AND IsActive = 1;
  ELSE
    INSERT INTO dbo.UserPageRightsJson (UserId, RightsJson, IsActive, CreatedAt)
    VALUES (@uid_mainab_civillier_in, N'[]', 1, GETDATE());
END

GO
IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = N'engineer@civilier.com')
  PRINT 'WARNING: user engineer@civilier.com not found — skipping their UserPageRightsJson override.';
ELSE
BEGIN
  DECLARE @uid_engineer_civilier_com INT = (SELECT id FROM dbo.users WHERE email = N'engineer@civilier.com');
  IF EXISTS (SELECT 1 FROM dbo.UserPageRightsJson WHERE UserId = @uid_engineer_civilier_com AND IsActive = 1)
    UPDATE dbo.UserPageRightsJson SET RightsJson = N'[{"page":"tickets","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-create","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-my-tickets","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-pending","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-resolved","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-resolution","actions":["view","create","edit","delete","print","export"]}]', UpdatedAt = GETDATE()
    WHERE UserId = @uid_engineer_civilier_com AND IsActive = 1;
  ELSE
    INSERT INTO dbo.UserPageRightsJson (UserId, RightsJson, IsActive, CreatedAt)
    VALUES (@uid_engineer_civilier_com, N'[{"page":"tickets","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-create","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-my-tickets","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-pending","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-resolved","actions":["view","create","edit","delete","print","export"]},{"page":"ticket-resolution","actions":["view","create","edit","delete","print","export"]}]', 1, GETDATE());
END

GO
IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = N'marketing.head@civilier.com')
  PRINT 'WARNING: user marketing.head@civilier.com not found — skipping their UserPageRightsJson override.';
ELSE
BEGIN
  DECLARE @uid_marketing_head_civilier_com INT = (SELECT id FROM dbo.users WHERE email = N'marketing.head@civilier.com');
  IF EXISTS (SELECT 1 FROM dbo.UserPageRightsJson WHERE UserId = @uid_marketing_head_civilier_com AND IsActive = 1)
    UPDATE dbo.UserPageRightsJson SET RightsJson = N'[{"page":"sa-social-media","actions":["view","create","edit","delete","print","export"]},{"page":"sa-campaigns","actions":["view","create","edit","delete","print","export"]},{"page":"sa-ads","actions":["view","create","edit","delete","print","export"]},{"page":"sa-leads","actions":["view","create","edit","delete","print","export"]},{"page":"sa-lead-distribution","actions":["view","create","edit","delete","print","export"]},{"page":"sa-lead-transfers","actions":["view","create","edit","delete"]},{"page":"sa-inquiry","actions":["view","create","edit","delete","print","export"]},{"page":"sa-site-visits","actions":["view","create","edit","delete","print","export"]},{"page":"sa-marketing-invoices","actions":["view","create","edit","delete","print","export"]},{"page":"sa-teams","actions":["view","create","edit","delete"]},{"page":"sa-distribution-rules","actions":["view","create","edit","delete"]},{"page":"sa-role-master","actions":["view","print"]}]', UpdatedAt = GETDATE()
    WHERE UserId = @uid_marketing_head_civilier_com AND IsActive = 1;
  ELSE
    INSERT INTO dbo.UserPageRightsJson (UserId, RightsJson, IsActive, CreatedAt)
    VALUES (@uid_marketing_head_civilier_com, N'[{"page":"sa-social-media","actions":["view","create","edit","delete","print","export"]},{"page":"sa-campaigns","actions":["view","create","edit","delete","print","export"]},{"page":"sa-ads","actions":["view","create","edit","delete","print","export"]},{"page":"sa-leads","actions":["view","create","edit","delete","print","export"]},{"page":"sa-lead-distribution","actions":["view","create","edit","delete","print","export"]},{"page":"sa-lead-transfers","actions":["view","create","edit","delete"]},{"page":"sa-inquiry","actions":["view","create","edit","delete","print","export"]},{"page":"sa-site-visits","actions":["view","create","edit","delete","print","export"]},{"page":"sa-marketing-invoices","actions":["view","create","edit","delete","print","export"]},{"page":"sa-teams","actions":["view","create","edit","delete"]},{"page":"sa-distribution-rules","actions":["view","create","edit","delete"]},{"page":"sa-role-master","actions":["view","print"]}]', 1, GETDATE());
END

-- ── Verification ─────────────────────────────────────────────────────────
SELECT 'PageDefinitions' AS TableName, COUNT(*) AS [RowCount] FROM dbo.PageDefinitions
UNION ALL SELECT 'WidgetCatalog', COUNT(*) FROM dbo.WidgetCatalog
UNION ALL SELECT 'RoleRights', COUNT(*) FROM dbo.RoleRights
UNION ALL SELECT 'UserPageRightsJson (active)', COUNT(*) FROM dbo.UserPageRightsJson WHERE IsActive = 1;

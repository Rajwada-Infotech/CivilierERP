-- Migration 275: Finance + Material PageDefinitions cleanup, consolidated
-- into a single file (replaces the four separate passes this went through:
-- 271-normalize-finance-page-groups, 272-reassign-orphaned-finance-pages,
-- 273-normalize-material-page-groups, 274-cleanup-material-duplicates).
--
-- Every reassignment below was cross-checked against the actual sidebars
-- (FinanceSidebar.ts / financeSetupItems, MaterialSidebar.ts /
-- materialSetupItems, EngineeringSidebar.ts, RecordsSidebar.ts in
-- TopNavbar.tsx) — i.e. which module's menu actually reaches a page today,
-- not where its component file happens to live or what its PageKey is named.
--
-- End state: two clean sections per module —
--   Finance  / Finance Setup
--   Material / Material Setup

-- ── Finance's own transactional pages (FinanceSidebar.ts) ──
UPDATE dbo.PageDefinitions
SET Module = 'Finance', GroupName = 'Finance'
WHERE PageKey IN (
  'finance-dashboard', 'finance-contracts', 'new-payment', 'received-payment',
  'brs', 'journal-voucher', 'trial-balance', 'on-account-adjustment',
  'expense-booking' -- mistagged Module='Material'; only ever reached via
                     -- Finance's "Invoice" menu item, never from Material's.
);
GO

-- ── Finance Setup — the masters actually listed in financeSetupItems ──
UPDATE dbo.PageDefinitions
SET Module = 'Finance', GroupName = 'Finance Setup'
WHERE PageKey IN (
  'account-head', 'general-ledger', 'bank-master', 'financial-year-master',
  'cheque-master', 'card-master', 'tds-master', 'cost-center',
  'profit-center', 'return-reason-master', 'payment-reason-master',
  'expenses-master', -- real Finance page (expense heads / Account Groups,
                      -- /masters/expenses) — just missing from the nav.
  'supplier-master', 'contractor-master' -- mistagged Module='Material';
                      -- only ever reached via Finance's setup menu.
);
GO

-- ── Pages mistagged Module='Finance' that actually belong to a different
-- module's own setup menu ──
UPDATE dbo.PageDefinitions
SET Module = 'Material', GroupName = 'Material Setup'
WHERE PageKey = 'billing-terms';
GO

UPDATE dbo.PageDefinitions
SET Module = 'Engineering', GroupName = 'Engineering Setup'
WHERE PageKey = 'activity-master';
GO

UPDATE dbo.PageDefinitions
SET Module = 'Records', GroupName = 'Records'
WHERE PageKey = 'records';
GO

-- ── Pages mistagged Module='Finance' that are Admin-only config ──
UPDATE dbo.PageDefinitions
SET Module = 'Admin', GroupName = 'Admin Masters'
WHERE PageKey IN ('named-entry-type', 'type-of-doc');
GO

-- ── Material's own transactional pages (MaterialSidebar.ts) ──
UPDATE dbo.PageDefinitions
SET Module = 'Material', GroupName = 'Material'
WHERE PageKey IN (
  'material-dashboard', 'material-request', 'quotation', 'purchase-orders',
  'vehicle-in-out', 'grn-master', 'material-issues', 'material-issue-return',
  'short-close', 'l1-chart', 'stock-ledger', 'stock-transfers', 'debit-note',
  'amendments', 'fixed-asset-record'
);
GO

-- ── Material Setup — the masters actually listed in materialSetupItems ──
UPDATE dbo.PageDefinitions
SET Module = 'Material', GroupName = 'Material Setup'
WHERE PageKey IN (
  'item-master', 'item-group', 'unit-of-measurement', 'hsn-master',
  't-c-master', 'payment-terms', 'inventory-master', 'depreciation-setup'
);
GO

-- ── Pages mistagged Module='Material' that belong to Engineering ──
UPDATE dbo.PageDefinitions
SET Module = 'Engineering', GroupName = 'Engineering'
WHERE PageKey = 'boq';
GO

-- ── Dead duplicates — zero references anywhere in the frontend (routes,
-- sidebars, or usePageRights calls). Deactivated rather than deleted, to
-- keep an audit trail. (material-debit-note duplicates debit-note;
-- amendment-menu duplicates amendments.) ──
UPDATE dbo.PageDefinitions
SET IsActive = 0
WHERE PageKey IN ('material-debit-note', 'amendment-menu');
GO

-- ── Pages with a real route (see App.tsx) but no PageDefinitions row at
-- all — Menu Rights could never grant/deny access to them. ──
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'material-issue-return', 'Material Issue Return', 'Material', 'Material', 'view,create,edit,delete,print,export', 45, 1, 'migration-275', SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'material-issue-return');
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'short-close', 'Short Close', 'Material', 'Material', 'view,create,edit', 55, 1, 'migration-275', SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'short-close');
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'payment-terms', 'Payment Terms Master', 'Material', 'Material Setup', 'view,create,edit,delete', 200, 1, 'migration-275', SYSUTCDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'payment-terms');
GO

-- NOTE: a "work-order" PageKey also exists under Module='Material',
-- referenced internally by WorkOrderMaster.tsx's usePageRights() calls, but
-- its actual route (/material/work-order) is gated by "work-order-master"
-- instead. Left untouched — needs sorting out together with the rest of
-- Engineering, not as a Finance/Material-only fix.

-- Migration 116: Ensure dbo.PageDefinitions exists, then seed Sales module pages
-- (sale-order, sale-invoice, sales-payment) used by the Menu Rights admin screen.
-- Safe to re-run: table creation and inserts are both guarded.

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
    Actions     NVARCHAR(200) NOT NULL,            -- comma-separated: view,create,edit,delete,print,export
    SortOrder   INT           NOT NULL CONSTRAINT DF_PD_SortOrder DEFAULT 100,
    IsActive    BIT           NOT NULL CONSTRAINT DF_PD_IsActive  DEFAULT 1,
    CreatedBy   NVARCHAR(100) NULL,
    CreatedAt   DATETIME2     NOT NULL CONSTRAINT DF_PD_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt   DATETIME2     NULL
  );

  CREATE UNIQUE INDEX UX_PageDefinitions_PageKey_Active
    ON dbo.PageDefinitions(PageKey) WHERE IsActive = 1;

  PRINT 'Created dbo.PageDefinitions';
END
ELSE
  PRINT 'dbo.PageDefinitions already exists — skipping create';

-- Seed: Sale Order
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'sale-order' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('sale-order', 'Sale Order', 'Sales', 'Sales', 'view,create,edit,delete,print,export', 10, 1, 'migration', GETDATE());
END

-- Seed: Sale Invoice
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'sale-invoice' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('sale-invoice', 'Sale Invoice', 'Sales', 'Sales', 'view,create,edit,delete,print,export', 20, 1, 'migration', GETDATE());
END

-- Seed: Sales Payment (route is /sales/payment, component SalesPayment — key kept distinct
-- from Finance's existing 'new-payment' page key to avoid collisions)
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'sales-payment' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('sales-payment', 'Payment', 'Sales', 'Sales', 'view,create,edit,delete,print,export', 30, 1, 'migration', GETDATE());
END

-- Verify
SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
WHERE Module = 'Sales'
ORDER BY SortOrder;

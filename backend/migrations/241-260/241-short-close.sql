-- Short Close: controlled year-end retirement of partially-fulfilled
-- Purchase Orders and Material Requests. Adds the who/when/why columns to
-- both header tables and a dedicated audit log table.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'ShortClosedAt')
  ALTER TABLE dbo.PurchaseOrders ADD ShortClosedAt DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'ShortClosedBy')
  ALTER TABLE dbo.PurchaseOrders ADD ShortClosedBy NVARCHAR(200) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'ShortCloseRemarks')
  ALTER TABLE dbo.PurchaseOrders ADD ShortCloseRemarks NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialRequests') AND name = 'ShortClosedAt')
  ALTER TABLE dbo.MaterialRequests ADD ShortClosedAt DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialRequests') AND name = 'ShortClosedBy')
  ALTER TABLE dbo.MaterialRequests ADD ShortClosedBy NVARCHAR(200) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialRequests') AND name = 'ShortCloseRemarks')
  ALTER TABLE dbo.MaterialRequests ADD ShortCloseRemarks NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ShortCloseAuditLog')
CREATE TABLE dbo.ShortCloseAuditLog (
  Id                INT IDENTITY(1,1) PRIMARY KEY,
  DocType           NVARCHAR(10)   NOT NULL,   -- 'PO' | 'MR'
  DocId             INT            NOT NULL,
  DocNo             NVARCHAR(100)  NULL,
  FinYearId         INT            NULL,
  CompanyId         INT            NULL,
  ProjectId         INT            NULL,
  PreviousStatus    NVARCHAR(50)   NULL,
  NewStatus         NVARCHAR(50)   NOT NULL DEFAULT 'Short Closed',
  CompletedQty      DECIMAL(18,4)  NULL,
  CancelledQty      DECIMAL(18,4)  NULL,
  PerformedBy       NVARCHAR(200)  NULL,
  PerformedAt       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
  Remarks           NVARCHAR(MAX)  NULL
);

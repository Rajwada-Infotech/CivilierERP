-- ============================================================
-- Migration 404: Maintenance — Charge Head master.
-- Standard maintenance services (Lift, Garden, Security, etc.) with a
-- rate, an optional HSN/SAC link (dbo.HSN), and a combined tax %
-- (auto-suggested from the linked HSN's CGST+SGST on the frontend, but
-- stored explicitly here — no separate Tax Master exists in this app,
-- see dbo.HSN's own CGST/SGST/IGST columns for the established pattern).
-- Never hard-deleted once used — see MaintenanceCustomerCharge FK below;
-- Status=0 (Inactive) is how a retired Charge Head is removed from new use.
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaintenanceChargeHead' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.MaintenanceChargeHead (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Name        NVARCHAR(200)   NOT NULL,
    Rate        DECIMAL(18,2)   NOT NULL DEFAULT 0,
    TaxPct      DECIMAL(5,2)    NOT NULL DEFAULT 0,
    HsnId       INT             NULL REFERENCES dbo.HSN(HId),
    Status      BIT             NOT NULL DEFAULT 1,
    CreatedBy   INT             NULL,
    CreatedAt   DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedBy   INT             NULL,
    UpdatedAt   DATETIME        NULL
  );
  PRINT 'Created dbo.MaintenanceChargeHead';
END
ELSE
  PRINT 'dbo.MaintenanceChargeHead already exists';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'charge-head-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('charge-head-master', 'Charge Head Master', 'Maintenance', 'Maintenance', 'view,create,edit,delete', 241, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions charge-head-master';
END
ELSE
  PRINT 'PageDefinitions charge-head-master already exists';
GO

PRINT '404-maintenance-charge-head applied successfully.';
GO

-- ============================================================
-- Migration 405: Maintenance — Customer Directory + per-unit charge
-- assignment. Confirmed CrmBooking rows ARE the directory (no separate
-- customer table — see crmBookings.js's BOOKING_SELECT for the join
-- pattern this mirrors). MaintenanceCustomerCharge links a Charge Head to
-- a booking/unit with the base+tax+total snapshotted at assignment time
-- (so a later Charge Head rate change never silently rewrites history).
-- Status=0 removes an assignment without losing the historical row.
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaintenanceCustomerCharge' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.MaintenanceCustomerCharge (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    BookingId     INT             NOT NULL REFERENCES dbo.CrmBooking(Id),
    ChargeHeadId  INT             NOT NULL REFERENCES dbo.MaintenanceChargeHead(Id),
    BaseAmount    DECIMAL(18,2)   NOT NULL,
    TaxPct        DECIMAL(5,2)    NOT NULL DEFAULT 0,
    TaxAmount     DECIMAL(18,2)   NOT NULL DEFAULT 0,
    TotalAmount   DECIMAL(18,2)   NOT NULL,
    Status        BIT             NOT NULL DEFAULT 1,
    CreatedBy     INT             NULL,
    CreatedAt     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedBy     INT             NULL,
    UpdatedAt     DATETIME        NULL
  );
  PRINT 'Created dbo.MaintenanceCustomerCharge';
END
ELSE
  PRINT 'dbo.MaintenanceCustomerCharge already exists';
GO

-- One active assignment per (booking, charge head) — re-adding after
-- removal (Status=0) is fine, only one Status=1 row may exist at a time.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_MaintenanceCustomerCharge_Active' AND object_id = OBJECT_ID('dbo.MaintenanceCustomerCharge'))
BEGIN
  CREATE UNIQUE INDEX UX_MaintenanceCustomerCharge_Active
    ON dbo.MaintenanceCustomerCharge (BookingId, ChargeHeadId)
    WHERE Status = 1;
  PRINT 'Created UX_MaintenanceCustomerCharge_Active';
END
ELSE
  PRINT 'UX_MaintenanceCustomerCharge_Active already exists';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'maintenance-directory' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('maintenance-directory', 'Maintenance Customer Directory', 'Maintenance', 'Maintenance', 'view', 242, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions maintenance-directory';
END
ELSE
  PRINT 'PageDefinitions maintenance-directory already exists';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'maintenance-customer-charges' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('maintenance-customer-charges', 'Maintenance Customer Charges', 'Maintenance', 'Maintenance', 'view,create,delete', 243, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions maintenance-customer-charges';
END
ELSE
  PRINT 'PageDefinitions maintenance-customer-charges already exists';
GO

PRINT '405-maintenance-customer-directory applied successfully.';
GO

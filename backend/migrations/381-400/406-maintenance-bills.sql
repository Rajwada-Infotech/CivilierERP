-- ============================================================
-- Migration 406: Maintenance — Bills. A bill snapshots one or more
-- Charge Heads (name/rate/tax/HSN as they stood at bill time — see
-- MaintenanceBillItem) against a confirmed CrmBooking. BillNo is
-- generated via the shared getNextDocNumber() service (same
-- race-safe sequence mechanism CRM Bookings/Agreements/etc already use),
-- prefix 'MB'. Never hard-deleted — Status flips to 'Cancelled' instead,
-- matching the app-wide soft-cancel convention for financial documents.
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaintenanceBill' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.MaintenanceBill (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    BillNo        NVARCHAR(30)    NOT NULL UNIQUE,
    BookingId     INT             NOT NULL REFERENCES dbo.CrmBooking(Id),
    BillDate      DATE            NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    Subtotal      DECIMAL(18,2)   NOT NULL DEFAULT 0,
    TotalTax      DECIMAL(18,2)   NOT NULL DEFAULT 0,
    GrandTotal    DECIMAL(18,2)   NOT NULL DEFAULT 0,
    Status        NVARCHAR(20)    NOT NULL DEFAULT 'Active',
    CancelReason  NVARCHAR(500)   NULL,
    CancelledBy   INT             NULL,
    CancelledAt   DATETIME        NULL,
    CreatedBy     INT             NULL,
    CreatedAt     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedBy     INT             NULL,
    UpdatedAt     DATETIME        NULL
  );
  PRINT 'Created dbo.MaintenanceBill';
END
ELSE
  PRINT 'dbo.MaintenanceBill already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaintenanceBillItem' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.MaintenanceBillItem (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    BillId          INT             NOT NULL REFERENCES dbo.MaintenanceBill(Id),
    ChargeHeadId    INT             NOT NULL REFERENCES dbo.MaintenanceChargeHead(Id),
    -- Snapshots — a later Charge Head rename/rate/HSN edit must never
    -- silently rewrite an already-issued bill's line items.
    ChargeHeadName  NVARCHAR(200)   NOT NULL,
    HsnId           INT             NULL,
    HsnCode         NVARCHAR(20)    NULL,
    Rate            DECIMAL(18,2)   NOT NULL,
    TaxPct          DECIMAL(5,2)    NOT NULL DEFAULT 0,
    TaxAmount       DECIMAL(18,2)   NOT NULL DEFAULT 0,
    TotalAmount     DECIMAL(18,2)   NOT NULL,
    CreatedAt       DATETIME        NOT NULL DEFAULT GETDATE()
  );
  PRINT 'Created dbo.MaintenanceBillItem';
END
ELSE
  PRINT 'dbo.MaintenanceBillItem already exists';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'maintenance-bills' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('maintenance-bills', 'Maintenance Bills', 'Maintenance', 'Maintenance', 'view,create,edit,delete,print,export', 244, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions maintenance-bills';
END
ELSE
  PRINT 'PageDefinitions maintenance-bills already exists';
GO

PRINT '406-maintenance-bills applied successfully.';
GO

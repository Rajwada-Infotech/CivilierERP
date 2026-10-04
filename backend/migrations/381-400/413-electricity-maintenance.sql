-- ============================================================
-- Migration 413: Maintenance — Electricity Maintenance.
--
-- Meter Reading Master ties a confirmed CrmBooking to a physical
-- electricity meter (Provider/Tariff-driven billing, never a hard-coded
-- rate). A billing period's consumption is split at the customer's
-- HANDOVER date — Rajwada supplies electricity until handover is
-- completed, so pre-handover consumption is billed to Rajwada and added
-- as a line item on the customer's own MaintenanceBill. The handover
-- reading is just another row of dbo.MeterReading (ReadingType=
-- 'Handover') — every individual reading is stored, never only a final
-- period total, and the split is never estimated by prorating days.
--
-- Reuses dbo.CrmHandover for handover status/date (no new handover
-- concept) and dbo.CrmBooking for Customer/Project/Tower/Flat (no
-- duplicated customer/unit columns) — same as dbo.MaintenanceBill.
--
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ElectricityProvider' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ElectricityProvider (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    Name           NVARCHAR(100)   NOT NULL UNIQUE,
    Code           NVARCHAR(20)    NULL,
    State          NVARCHAR(100)   NULL,
    BillingMethod  NVARCHAR(50)    NULL,
    Status         NVARCHAR(20)    NOT NULL DEFAULT 'Active',
    Remarks        NVARCHAR(500)   NULL,
    CreatedBy      NVARCHAR(150)   NULL,
    CreatedAt      DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy      NVARCHAR(150)   NULL,
    UpdatedAt      DATETIME2       NULL
  );
  PRINT 'Created dbo.ElectricityProvider';
END
ELSE
  PRINT 'dbo.ElectricityProvider already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ElectricityTariff' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ElectricityTariff (
    Id               INT IDENTITY(1,1) PRIMARY KEY,
    ProviderId       INT             NOT NULL REFERENCES dbo.ElectricityProvider(Id),
    TariffName       NVARCHAR(150)   NOT NULL,
    EffectiveFrom    DATE            NOT NULL,
    EffectiveTo      DATE            NULL,
    BillingCycle     NVARCHAR(20)    NOT NULL DEFAULT 'Monthly',
    FixedCharge      DECIMAL(18,2)   NOT NULL DEFAULT 0,
    MinimumCharge    DECIMAL(18,2)   NOT NULL DEFAULT 0,
    AdditionalCharge DECIMAL(18,2)   NOT NULL DEFAULT 0,
    Status           NVARCHAR(20)    NOT NULL DEFAULT 'Active',
    CreatedBy        NVARCHAR(150)   NULL,
    CreatedAt        DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy        NVARCHAR(150)   NULL,
    UpdatedAt        DATETIME2       NULL
  );
  PRINT 'Created dbo.ElectricityTariff';
END
ELSE
  PRINT 'dbo.ElectricityTariff already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ElectricityTariffSlab' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ElectricityTariffSlab (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    TariffId   INT             NOT NULL REFERENCES dbo.ElectricityTariff(Id),
    SlabFrom   DECIMAL(18,2)   NOT NULL,
    -- NULL SlabTo = open-ended top slab ("Y+ units").
    SlabTo     DECIMAL(18,2)   NULL,
    RatePerUnit DECIMAL(10,4)  NOT NULL,
    CreatedAt  DATETIME2       NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.ElectricityTariffSlab';
END
ELSE
  PRINT 'dbo.ElectricityTariffSlab already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MeterReadingMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.MeterReadingMaster (
    Id                    INT IDENTITY(1,1) PRIMARY KEY,
    BookingId             INT             NOT NULL REFERENCES dbo.CrmBooking(Id),
    MeterBoxNumber        NVARCHAR(50)    NULL,
    MeterNumber           NVARCHAR(50)    NOT NULL UNIQUE,
    ProviderId            INT             NOT NULL REFERENCES dbo.ElectricityProvider(Id),
    ConnectionType        NVARCHAR(50)    NULL,
    MeterType             NVARCHAR(50)    NULL,
    BillingCycle          NVARCHAR(20)    NOT NULL DEFAULT 'Monthly',
    OpeningReading        DECIMAL(18,2)   NOT NULL DEFAULT 0,
    OpeningReadingDate    DATE            NULL,
    MeterInstallationDate DATE            NULL,
    Status                NVARCHAR(20)    NOT NULL DEFAULT 'Active',
    Remarks               NVARCHAR(500)   NULL,
    CreatedBy             NVARCHAR(150)   NULL,
    CreatedAt             DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy             NVARCHAR(150)   NULL,
    UpdatedAt             DATETIME2       NULL
  );
  PRINT 'Created dbo.MeterReadingMaster';
END
ELSE
  PRINT 'dbo.MeterReadingMaster already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MeterReading' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.MeterReading (
    Id                     INT IDENTITY(1,1) PRIMARY KEY,
    MeterId                INT             NOT NULL REFERENCES dbo.MeterReadingMaster(Id),
    BillingPeriodFrom      DATE            NOT NULL,
    BillingPeriodTo        DATE            NOT NULL,
    ReadingDate            DATE            NOT NULL,
    PreviousReading        DECIMAL(18,2)   NOT NULL,
    CurrentReading         DECIMAL(18,2)   NOT NULL,
    UnitsConsumed          DECIMAL(18,2)   NOT NULL,
    -- 'Regular' = period-end reading. 'Handover' = the mid-period reading
    -- taken at the customer's actual handover date (its UnitsConsumed IS
    -- the Rajwada-supply consumption for that period). 'Correction' = a
    -- replacement for a previously-entered Regular/Handover reading.
    ReadingType            NVARCHAR(20)    NOT NULL DEFAULT 'Regular',
    IsHandoverReading      BIT             NOT NULL DEFAULT 0,
    EnteredBy              NVARCHAR(150)   NULL,
    IsSuperseded           BIT             NOT NULL DEFAULT 0,
    CorrectedFromReadingId INT             NULL REFERENCES dbo.MeterReading(Id),
    CorrectionReason       NVARCHAR(500)   NULL,
    CorrectionApprovedBy   NVARCHAR(150)   NULL,
    CorrectionApprovedAt   DATETIME2       NULL,
    CreatedAt              DATETIME2       NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.MeterReading';
END
ELSE
  PRINT 'dbo.MeterReading already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ElectricityBill' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ElectricityBill (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    MeterId             INT             NOT NULL REFERENCES dbo.MeterReadingMaster(Id),
    BookingId           INT             NOT NULL REFERENCES dbo.CrmBooking(Id),
    BillingPeriodFrom   DATE            NOT NULL,
    BillingPeriodTo     DATE            NOT NULL,
    PreviousReadingId   INT             NULL REFERENCES dbo.MeterReading(Id),
    CurrentReadingId    INT             NULL REFERENCES dbo.MeterReading(Id),
    HandoverReadingId   INT             NULL REFERENCES dbo.MeterReading(Id),
    TotalUnits          DECIMAL(18,2)   NOT NULL DEFAULT 0,
    HandoverDate         DATE           NULL,
    HandoverReading      DECIMAL(18,2)  NULL,
    RajwadaUnits         DECIMAL(18,2)  NOT NULL DEFAULT 0,
    PostHandoverUnits    DECIMAL(18,2)  NOT NULL DEFAULT 0,
    TariffId            INT             NULL REFERENCES dbo.ElectricityTariff(Id),
    EnergyCharge        DECIMAL(18,2)   NOT NULL DEFAULT 0,
    FixedCharge         DECIMAL(18,2)   NOT NULL DEFAULT 0,
    OtherCharge         DECIMAL(18,2)   NOT NULL DEFAULT 0,
    -- The amount actually billed to Rajwada's customer — RajwadaUnits-based
    -- whenever a handover split applies, TotalUnits-based otherwise.
    TotalAmount         DECIMAL(18,2)   NOT NULL DEFAULT 0,
    -- 'Draft'/'Calculated' exist for schema completeness but are never
    -- written — nothing persists until "Generate Bill" (the confirmation
    -- screen is client-side only), which inserts directly as
    -- 'PendingVerification'.
    BillStatus          NVARCHAR(30)    NOT NULL DEFAULT 'PendingVerification',
    VerifiedBy          NVARCHAR(150)   NULL,
    VerifiedAt          DATETIME2       NULL,
    MaintenanceBillId     INT           NULL,
    MaintenanceBillItemId INT           NULL,
    CancelReason        NVARCHAR(500)   NULL,
    RevisedFromBillId   INT             NULL REFERENCES dbo.ElectricityBill(Id),
    CreatedBy           NVARCHAR(150)   NULL,
    CreatedAt           DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy           NVARCHAR(150)   NULL,
    UpdatedAt           DATETIME2       NULL
  );
  PRINT 'Created dbo.ElectricityBill';
END
ELSE
  PRINT 'dbo.ElectricityBill already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ElectricityAuditLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ElectricityAuditLog (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    Action       NVARCHAR(40)    NOT NULL,
    MeterId      INT             NULL,
    ReadingId    INT             NULL,
    BillId       INT             NULL,
    BookingId    INT             NULL,
    OldValue     NVARCHAR(MAX)   NULL,
    NewValue     NVARCHAR(MAX)   NULL,
    PerformedBy  NVARCHAR(150)   NULL,
    PerformedAt  DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    Remarks      NVARCHAR(500)   NULL,
    IPAddress    NVARCHAR(50)    NULL,
    DeviceInfo   NVARCHAR(300)   NULL
  );
  PRINT 'Created dbo.ElectricityAuditLog';
END
ELSE
  PRINT 'dbo.ElectricityAuditLog already exists';
GO

-- ── Extend MaintenanceBillItem so an Electricity charge can be a line on
-- the customer's existing bill instead of a parallel document. Exactly
-- one of ChargeHeadId / ElectricityBillId is set on any row. ────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaintenanceBillItem') AND name = 'ElectricityBillId')
BEGIN
  ALTER TABLE dbo.MaintenanceBillItem ADD ElectricityBillId INT NULL REFERENCES dbo.ElectricityBill(Id);
  PRINT 'Added MaintenanceBillItem.ElectricityBillId';
END
ELSE
  PRINT 'MaintenanceBillItem.ElectricityBillId already exists';
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.MaintenanceBillItem') AND name = 'ChargeHeadId' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.MaintenanceBillItem ALTER COLUMN ChargeHeadId INT NULL;
  PRINT 'Relaxed MaintenanceBillItem.ChargeHeadId to NULL-able';
END
ELSE
  PRINT 'MaintenanceBillItem.ChargeHeadId already NULL-able';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_MaintenanceBillItem_OneKind')
BEGIN
  ALTER TABLE dbo.MaintenanceBillItem WITH CHECK
    ADD CONSTRAINT CK_MaintenanceBillItem_OneKind
    CHECK (
      (ChargeHeadId IS NOT NULL AND ElectricityBillId IS NULL) OR
      (ChargeHeadId IS NULL AND ElectricityBillId IS NOT NULL)
    );
  PRINT 'Added CK_MaintenanceBillItem_OneKind';
END
ELSE
  PRINT 'CK_MaintenanceBillItem_OneKind already exists';
GO

-- ── Seed providers (extensible — never hard-coded in application logic) ──
IF NOT EXISTS (SELECT 1 FROM dbo.ElectricityProvider WHERE Name = 'CESC')
BEGIN
  INSERT INTO dbo.ElectricityProvider (Name, Code, State, BillingMethod, CreatedBy)
  VALUES ('CESC', 'CESC', 'West Bengal', 'Slab-wise', 'migration');
  PRINT 'Seeded ElectricityProvider: CESC';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ElectricityProvider WHERE Name = 'WBSEDCL')
BEGIN
  INSERT INTO dbo.ElectricityProvider (Name, Code, State, BillingMethod, CreatedBy)
  VALUES ('WBSEDCL', 'WBSEDCL', 'West Bengal', 'Slab-wise', 'migration');
  PRINT 'Seeded ElectricityProvider: WBSEDCL';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ElectricityProvider WHERE Name = 'Other')
BEGIN
  INSERT INTO dbo.ElectricityProvider (Name, Code, State, BillingMethod, CreatedBy)
  VALUES ('Other', 'OTHER', NULL, 'Slab-wise', 'migration');
  PRINT 'Seeded ElectricityProvider: Other';
END
GO

-- ── PageDefinitions ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'maintenance-electricity' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('maintenance-electricity', 'Electricity Maintenance', 'Maintenance', 'Maintenance', 'view,create,edit,delete,print,export', 246, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions maintenance-electricity';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'meter-reading-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('meter-reading-master', 'Meter Reading Master', 'Maintenance', 'Maintenance', 'view,create,edit,delete,print,export', 247, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions meter-reading-master';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'electricity-provider-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('electricity-provider-master', 'Electricity Provider Master', 'Maintenance', 'Maintenance', 'view,create,edit,delete,print,export', 248, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions electricity-provider-master';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'electricity-tariff-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('electricity-tariff-master', 'Electricity Tariff Master', 'Maintenance', 'Maintenance', 'view,create,edit,delete,print,export', 249, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions electricity-tariff-master';
END
GO

PRINT '413-electricity-maintenance applied successfully.';
GO

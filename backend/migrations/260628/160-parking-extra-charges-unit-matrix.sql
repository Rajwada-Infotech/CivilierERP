-- ============================================================
-- Migration 160: Parking Master, Extra Charges Master, and the
-- schema needed to sync both into Booking financials, plus Floor
-- on UnitMaster for the Unit Matrix (project-wise, floor-wise grid).
-- ============================================================

-- Unit Matrix needs a floor to group units by, per project/block.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'FloorNo')
BEGIN
  ALTER TABLE dbo.UnitMaster ADD FloorNo INT NULL;
END
GO

-- ── Parking Master (Setup) — project-wise, optionally block-wise charge ────
-- BlockId NULL = applies project-wide; a specific BlockId overrides the
-- project-wide rate for that block when both exist.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ParkingMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ParkingMaster (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId    INT           NOT NULL REFERENCES dbo.enterprise(id),
    BlockId      INT           NULL REFERENCES dbo.BlockMaster(Id),
    -- ParkingType: Open / Covered / Stack / Basement
    ParkingType  NVARCHAR(50)  NOT NULL DEFAULT 'Open',
    Charge       DECIMAL(18,2) NOT NULL,
    GstRate      DECIMAL(5,2)  NOT NULL DEFAULT 18,
    IsActive     BIT           NOT NULL DEFAULT 1,
    CreatedBy    INT           NULL,
    CreatedAt    DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy    INT           NULL,
    UpdatedAt    DATETIME2(3)  NULL
  );
  CREATE INDEX IX_ParkingMaster_Project ON dbo.ParkingMaster(ProjectId, BlockId);
  PRINT 'Created dbo.ParkingMaster';
END
GO

-- ── Extra Charges Master (Setup) — chargeable item types (PLC, Modular
-- Kitchen, etc). DefaultAmount is a suggested starting value; the actual
-- amount is always set per-unit/booking (custom requirement), never forced.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ExtraChargeMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ExtraChargeMaster (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    ChargeName    NVARCHAR(200) NOT NULL,
    DefaultAmount DECIMAL(18,2) NULL,
    GstRate       DECIMAL(5,2)  NOT NULL DEFAULT 18,
    IsActive      BIT           NOT NULL DEFAULT 1,
    CreatedBy     INT           NULL,
    CreatedAt     DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy     INT           NULL,
    UpdatedAt     DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.ExtraChargeMaster';
END
GO

-- ── Per-booking Parking Allotment — snapshots the Setup rate/GST at the
-- moment of allotment so later Setup edits never silently reprice an
-- already-allotted booking.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmParkingAllotment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmParkingAllotment (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    BookingId       INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    ParkingMasterId INT           NOT NULL REFERENCES dbo.ParkingMaster(Id),
    ParkingSlotNo   NVARCHAR(50)  NULL,
    Quantity        INT           NOT NULL DEFAULT 1,
    RateSnapshot    DECIMAL(18,2) NOT NULL,
    GstRateSnapshot DECIMAL(5,2)  NOT NULL,
    GstAmount       DECIMAL(18,2) NOT NULL,
    TotalAmount     DECIMAL(18,2) NOT NULL,
    Notes           NVARCHAR(MAX) NULL,
    IsActive        BIT           NOT NULL DEFAULT 1,
    CreatedBy       INT           NULL,
    CreatedAt       DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmParkingAllotment_Booking ON dbo.CrmParkingAllotment(BookingId);
  PRINT 'Created dbo.CrmParkingAllotment';
END
GO

-- ── Per-booking Extra Charges — same snapshot pattern.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmExtraCharge' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmExtraCharge (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    BookingId           INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    ExtraChargeMasterId INT           NULL REFERENCES dbo.ExtraChargeMaster(Id),
    Description         NVARCHAR(300) NOT NULL,
    Amount              DECIMAL(18,2) NOT NULL,
    GstRate             DECIMAL(5,2)  NOT NULL DEFAULT 0,
    GstAmount           DECIMAL(18,2) NOT NULL DEFAULT 0,
    TotalAmount         DECIMAL(18,2) NOT NULL,
    IsActive            BIT           NOT NULL DEFAULT 1,
    CreatedBy           INT           NULL,
    CreatedAt           DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmExtraCharge_Booking ON dbo.CrmExtraCharge(BookingId);
  PRINT 'Created dbo.CrmExtraCharge';
END
GO

-- ── Booking financial rollup columns ─────────────────────────────────────
-- ParkingTotal/ExtraChargesTotal are separate visible line-item totals
-- (never merged into the base unit TotalValue). GrandTotal = TotalValue +
-- ParkingTotal + ExtraChargesTotal and is what payment milestones are
-- ultimately reconciled against.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'ParkingTotal')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD ParkingTotal DECIMAL(18,2) NOT NULL DEFAULT 0;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'ExtraChargesTotal')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD ExtraChargesTotal DECIMAL(18,2) NOT NULL DEFAULT 0;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'GrandTotal')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD GrandTotal DECIMAL(18,2) NULL;
END
GO
-- Backfill existing rows so GrandTotal starts in sync with TotalValue
UPDATE dbo.CrmBooking SET GrandTotal = ISNULL(TotalValue, 0) WHERE GrandTotal IS NULL;
GO

-- ── Page definitions (Follow-Up Setup + Sales groups) ────────────────────
DECLARE @Pages TABLE (
  PageKey   NVARCHAR(100),
  Label     NVARCHAR(200),
  GroupName NVARCHAR(150),
  Actions   NVARCHAR(200),
  SortOrder INT
);

INSERT INTO @Pages (PageKey, Label, GroupName, Actions, SortOrder) VALUES
('followup-parking-master',      'Parking Master',       'Follow-Up Setup', 'view,create,edit,delete,print,export', 150),
('followup-extra-charge-master', 'Extra Charges Master',  'Follow-Up Setup', 'view,create,edit,delete,print,export', 160),
('followup-unit-matrix',         'Unit Matrix',           'Follow-Up Sales', 'view',                                  30);

INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, 'Follow-Up', p.GroupName, p.Actions, p.SortOrder, 1, 'migration-160', SYSDATETIME()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT 'Migration 160 complete — Parking Master, Extra Charges Master, Unit Matrix schema';

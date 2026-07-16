-- ============================================================
-- Migration 172: Parking Slot inventory + Parking Matrix + decoupling
-- parking purchases from requiring a unit booking.
--
-- Previously ParkingMaster was only a rate table (no individually numbered
-- slots to show Available/Booked in a matrix), and CrmParkingAllotment
-- required a BookingId — meaning parking could only ever be sold alongside
-- a unit. This adds real slot inventory (mirrors UnitMaster) and lets a
-- parking allotment stand alone against just an Application (a customer
-- buying parking only, no unit), while still supporting the existing
-- unit+parking combined flow.
-- ============================================================

-- ── Parking Slot (real numbered inventory, mirrors UnitMaster) ─────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ParkingSlot' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ParkingSlot (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId   INT           NOT NULL REFERENCES dbo.enterprise(id),
    BlockId     INT           NULL REFERENCES dbo.BlockMaster(Id),
    SlotNo      NVARCHAR(50)  NOT NULL,
    ParkingType NVARCHAR(50)  NOT NULL DEFAULT 'Open',
    IsActive    BIT           NOT NULL DEFAULT 1,
    CreatedBy   INT           NULL,
    CreatedAt   DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy   INT           NULL,
    UpdatedAt   DATETIME2(3)  NULL
  );
  CREATE INDEX IX_ParkingSlot_Project ON dbo.ParkingSlot(ProjectId, BlockId);
  PRINT 'Created dbo.ParkingSlot';
END
GO

-- ── Decouple CrmParkingAllotment from requiring a unit booking ─────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmParkingAllotment') AND name = 'ApplicationId')
BEGIN
  ALTER TABLE dbo.CrmParkingAllotment ADD ApplicationId INT NULL REFERENCES dbo.CrmApplication(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmParkingAllotment') AND name = 'ParkingSlotId')
BEGIN
  ALTER TABLE dbo.CrmParkingAllotment ADD ParkingSlotId INT NULL REFERENCES dbo.ParkingSlot(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmParkingAllotment') AND name = 'PaymentStatus')
BEGIN
  -- Pending/Paid — only meaningful for a standalone (no BookingId) sale;
  -- unit-linked allotments track payment through the booking's own
  -- CrmPaymentMilestone line instead.
  ALTER TABLE dbo.CrmParkingAllotment ADD PaymentStatus NVARCHAR(20) NOT NULL DEFAULT 'Pending';
END
GO

-- BookingId was NOT NULL — relax it so a parking-only sale (no unit) can
-- have a NULL BookingId as long as ApplicationId is set instead.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmParkingAllotment') AND name = 'BookingId' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.CrmParkingAllotment ALTER COLUMN BookingId INT NULL;
END
GO

-- Backfill ApplicationId for existing (unit-linked) allotments from their booking.
UPDATE pa
SET pa.ApplicationId = b.ApplicationId
FROM dbo.CrmParkingAllotment pa
JOIN dbo.CrmBooking b ON b.Id = pa.BookingId
WHERE pa.ApplicationId IS NULL AND pa.BookingId IS NOT NULL;
GO

-- ── Page definitions ────────────────────────────────────────────────────
DECLARE @Pages TABLE (
  PageKey   NVARCHAR(100),
  Label     NVARCHAR(200),
  GroupName NVARCHAR(150),
  Actions   NVARCHAR(200),
  SortOrder INT
);

INSERT INTO @Pages (PageKey, Label, GroupName, Actions, SortOrder) VALUES
('followup-parking-slot-master', 'Parking Slot Master', 'Follow-Up Setup', 'view,create,edit,delete,print,export', 155),
('followup-parking-matrix',      'Parking Matrix',       'Follow-Up Sales', 'view',                                  35);

INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, 'Follow-Up', p.GroupName, p.Actions, p.SortOrder, 1, 'migration-172', SYSDATETIME()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT 'Migration 172 complete — Parking Slot inventory + standalone parking sales';

-- Migration 485: a booking becomes a header with UNIT LINES.
--
-- CRM assumes one unit per booking (CrmBooking.UnitId). That holds for a flat,
-- but a plotted buyer routinely takes 2-3 plots on a SINGLE agreement with one
-- payment schedule. Modelling that as several bookings would fragment the
-- schedule — milestones are BookingId-scoped, and the "fully paid before
-- invoice" gate would then fire per plot instead of per deal.
--
-- So: header + lines, exactly like an invoice.
--
-- WHY LINES CANNOT BE COLLAPSED INTO ONE SYNTHETIC UNIT
-- Each plot carries its own survey / sub-division number and is registered
-- separately. Amalgamating them into a single unit would destroy the identity
-- the registrar needs, and would make it impossible for a buyer to return one
-- plot of three.
--
-- PRICING: "CALCULATED AS A SINGLE UNIT"
-- Plots differ in size, and a multi-plot sale is priced on the COMBINED area as
-- one unit, not as a sum of independent line calculations. So pricing lives on
-- the booking, and a line's RatePerSqFt / PremiumAmount stay NULL in the normal
-- case. They exist for the variant where a specific plot carries its own rate or
-- a corner / park-facing premium; leaving them nullable means adopting that later
-- needs no schema change and no backfill.
--
-- AllocatedValue is the booking's consideration apportioned back to each plot
-- pro-rata by area. That is NOT redundant with the booking total: stamp duty and
-- the conveyance deed are per plot, so the split has to exist as data rather than
-- be recomputed by hand for every registration. It also gives partial
-- cancellation a value to work from.
--
-- BACK-COMPAT: CrmBooking.UnitId is deliberately left in place and keeps pointing
-- at the primary unit. 347 references across 41 backend files read it, and none
-- of them have to move for this migration to be safe. Lines are additive; code
-- migrates to them surface by surface.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBookingUnit' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmBookingUnit (
    Id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmBookingUnit PRIMARY KEY,
    BookingId      INT NOT NULL,
    UnitId         INT NOT NULL,

    -- Snapshot of the unit's area when booked. Snapshotted, not joined live:
    -- a later correction to UnitMaster must never silently restate a signed
    -- agreement's consideration.
    AreaSqFt       DECIMAL(18,2) NULL,

    -- Both NULL in the normal "priced as a single unit" case (see header).
    RatePerSqFt    DECIMAL(18,2) NULL,
    PremiumAmount  DECIMAL(18,2) NULL,

    -- Booking consideration apportioned to this plot, for registration and
    -- partial cancellation. Derived by services/bookingUnits.js.
    AllocatedValue DECIMAL(18,2) NULL,

    -- 'Active' | 'Cancelled'. A cancelled line is how one plot of several is
    -- returned without touching the rest of the booking — never a hard delete,
    -- matching how CRM treats every other record.
    Status         NVARCHAR(30) NOT NULL CONSTRAINT DF_CrmBookingUnit_Status DEFAULT (N'Active'),

    -- Mirrors CrmBooking.UnitId so the two can be reconciled while old code
    -- still reads the column. Exactly one Active primary line per booking.
    IsPrimary      BIT NOT NULL CONSTRAINT DF_CrmBookingUnit_IsPrimary DEFAULT (0),

    CreatedBy      INT NULL,
    CreatedAt      DATETIME2(0) NOT NULL CONSTRAINT DF_CrmBookingUnit_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy      INT NULL,
    UpdatedAt      DATETIME2(0) NULL,

    CONSTRAINT FK_CrmBookingUnit_Booking FOREIGN KEY (BookingId) REFERENCES dbo.CrmBooking(Id),
    CONSTRAINT FK_CrmBookingUnit_Unit    FOREIGN KEY (UnitId)    REFERENCES dbo.UnitMaster(Id),
    CONSTRAINT CK_CrmBookingUnit_Status  CHECK (Status IN (N'Active', N'Cancelled'))
  );

  -- A unit can only be on one booking at a time, but may reappear on a new
  -- booking after an earlier line is cancelled — so the guard is over Active
  -- lines only, not the whole table.
  CREATE UNIQUE INDEX UX_CrmBookingUnit_ActiveUnit
    ON dbo.CrmBookingUnit(UnitId) WHERE Status = N'Active';
  CREATE UNIQUE INDEX UX_CrmBookingUnit_Primary
    ON dbo.CrmBookingUnit(BookingId) WHERE IsPrimary = 1 AND Status = N'Active';
  CREATE NONCLUSTERED INDEX IX_CrmBookingUnit_Booking
    ON dbo.CrmBookingUnit(BookingId) INCLUDE (UnitId, AreaSqFt, AllocatedValue) WHERE Status = N'Active';

  PRINT 'Migration 485: created dbo.CrmBookingUnit.';
END
ELSE
  PRINT 'Migration 485: dbo.CrmBookingUnit already exists — skipped.';
GO

-- Backfill: exactly one line per existing booking, from the unit it already
-- points at. Idempotent — a booking that already has a line is skipped, so this
-- never double-inserts on re-run.
--
-- The existing booking's own AreaSqFt/RatePerSqFt/TotalValue are copied rather
-- than recomputed, so no historical consideration is restated by this migration.
--
-- The line's Status MIRRORS THE BOOKING'S. A unit that was booked, cancelled and
-- then re-booked has two booking rows pointing at it — real rows exist in this
-- database (units 250 and 251, one cancelled booking plus one live one each).
-- Marking every backfilled line Active would claim the unit is sold twice and
-- trips UX_CrmBookingUnit_ActiveUnit, which is the index doing its job: only the
-- live booking may hold the unit. Cancelled and rejected bookings keep their
-- line for history, flagged Cancelled.
INSERT INTO dbo.CrmBookingUnit (BookingId, UnitId, AreaSqFt, RatePerSqFt, AllocatedValue, Status, IsPrimary, CreatedAt)
SELECT b.Id, b.UnitId, b.AreaSqFt, b.RatePerSqFt,
       COALESCE(b.GrandTotal, b.TotalValue),
       CASE WHEN b.Status IN (N'Cancelled', N'Rejected') OR ISNULL(b.IsActive, 1) = 0
            THEN N'Cancelled' ELSE N'Active' END,
       1, SYSDATETIME()
FROM dbo.CrmBooking b
WHERE b.UnitId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingUnit l WHERE l.BookingId = b.Id);
GO

DECLARE @Bookings INT = (SELECT COUNT(*) FROM dbo.CrmBooking WHERE UnitId IS NOT NULL);
DECLARE @Lines    INT = (SELECT COUNT(*) FROM dbo.CrmBookingUnit);
DECLARE @Orphans  INT = (
  SELECT COUNT(*) FROM dbo.CrmBooking b
  WHERE b.UnitId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingUnit l WHERE l.BookingId = b.Id)
);
PRINT CONCAT('Migration 485 done. Bookings with a unit: ', @Bookings, ', lines: ', @Lines, ', bookings still without a line: ', @Orphans, ' (must be 0).');
GO

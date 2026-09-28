-- Migration 486: a plot changing hands — investor resale / assignment.
--
-- THE BUSINESS MODEL THIS EXISTS FOR
-- Plots are sold to investors. The developer then builds villas on them
-- regardless of who owns the plot. Once built, the plot's owner either keeps
-- the villa (paying for the construction at current rates) or exits, selling
-- the plot on to a new buyer. The same plot therefore has three possible
-- histories, and the system has to tell them apart:
--
--   plot unsold     -> developer owns the land; sells land + construction
--   investor keeps  -> investor owns the land; pays developer for construction
--   investor exits  -> investor sells the land on; the NEW buyer pays the
--                      developer for construction
--
-- NAMED 'Resale' ON PURPOSE — three adjacent things already exist and this is
-- none of them:
--   dbo.CrmRebookingTransfer (migration 416) moves MONEY — a held credit from a
--     cancelled booking onto a different booking. No unit changes owner.
--   dbo.CrmMutation updates the municipal record (Khata) AFTER a deed is
--     registered. It is the tail of a sale, not the sale.
--   dbo.CrmSalesDeed / dbo.CrmRegistry paper the DEVELOPER'S own primary sale.
-- This table records ownership of a unit passing from one customer to another,
-- with the developer as facilitator rather than seller.
--
-- WHY A RESALE IS NOT A NEW SALE
-- The DEVELOPER IS NOT SELLING THE LAND here; the investor is. Recording it as
-- a fresh land sale would book the investor's proceeds as developer turnover,
-- inflating revenue and creating a GST liability on a supply the developer
-- never made. Only the developer's facilitation fee is developer revenue — and
-- being a service, that fee is taxable even though the land itself is outside
-- GST entirely.
--
-- Hence the money columns are split deliberately: AgreedValue is what the new
-- buyer pays the OUTGOING INVESTOR and must never reach a developer income
-- head, while DeveloperFeeAmount is the only figure here that may.
--
-- WHY CrmBookingUnit GAINS A 'Transferred' STATUS
-- Migration 485 permits one Active line per unit, which is what stops a plot
-- being sold twice. A resale is neither a cancellation (nothing was undone --
-- the original sale stands and the investor was paid) nor a plain re-booking.
-- The outgoing line becomes 'Transferred', preserving the history and freeing
-- the unit for the incoming booking's line without weakening that index.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmUnitResale' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmUnitResale (
    Id                    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmUnitResale PRIMARY KEY,

    -- The unit changing hands (a PLOT in this model, but not constrained to
    -- one kind — a villa can be resold the same way).
    UnitId                INT NOT NULL,

    -- Outgoing side: the investor exiting, and the booking they bought under.
    FromBookingId         INT NULL,
    FromCustomerId        INT NULL,

    -- Incoming side. ToBookingId stays NULL until the new buyer's booking
    -- exists, so a resale can be negotiated and approved before it is papered.
    ToBookingId           INT NULL,
    ToCustomerId          INT NULL,

    ResaleDate            DATE NULL,

    -- What the NEW BUYER pays the OUTGOING INVESTOR. Never developer money.
    AgreedValue           DECIMAL(18,2) NULL,
    -- What the investor originally paid, snapshotted so a later rate change
    -- cannot restate an already-realised gain.
    OriginalValue         DECIMAL(18,2) NULL,

    -- The developer's facilitation fee. THE ONLY developer revenue on this row.
    DeveloperFeeAmount    DECIMAL(18,2) NULL,
    DeveloperFeeGstAmount DECIMAL(18,2) NULL,

    Status                NVARCHAR(30) NOT NULL CONSTRAINT DF_CrmUnitResale_Status DEFAULT (N'Pending'),
    Notes                 NVARCHAR(1000) NULL,

    CreatedBy             INT NULL,
    CreatedAt             DATETIME2(0) NOT NULL CONSTRAINT DF_CrmUnitResale_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy             INT NULL,
    UpdatedAt             DATETIME2(0) NULL,
    IsActive              BIT NOT NULL CONSTRAINT DF_CrmUnitResale_IsActive DEFAULT (1),

    CONSTRAINT FK_CrmUnitResale_Unit    FOREIGN KEY (UnitId)        REFERENCES dbo.UnitMaster(Id),
    CONSTRAINT FK_CrmUnitResale_FromBkg FOREIGN KEY (FromBookingId) REFERENCES dbo.CrmBooking(Id),
    CONSTRAINT FK_CrmUnitResale_ToBkg   FOREIGN KEY (ToBookingId)   REFERENCES dbo.CrmBooking(Id),
    CONSTRAINT CK_CrmUnitResale_Status  CHECK (Status IN (N'Pending', N'Approved', N'Completed', N'Cancelled'))
  );
  CREATE NONCLUSTERED INDEX IX_CrmUnitResale_Unit ON dbo.CrmUnitResale(UnitId) WHERE IsActive = 1;
  CREATE NONCLUSTERED INDEX IX_CrmUnitResale_FromBooking ON dbo.CrmUnitResale(FromBookingId) WHERE IsActive = 1;
  PRINT 'Migration 486: created dbo.CrmUnitResale.';
END
ELSE
  PRINT 'Migration 486: dbo.CrmUnitResale already exists — skipped.';
GO

-- Widen CrmBookingUnit.Status to admit 'Transferred' (see header). T-SQL has no
-- ALTER CHECK, so the constraint is dropped and recreated — and only when it
-- does not already permit the value, so re-running is a no-op.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CrmBookingUnit_Status')
   AND NOT EXISTS (
     SELECT 1 FROM sys.check_constraints
     WHERE name = 'CK_CrmBookingUnit_Status' AND definition LIKE '%Transferred%'
   )
BEGIN
  ALTER TABLE dbo.CrmBookingUnit DROP CONSTRAINT CK_CrmBookingUnit_Status;
  ALTER TABLE dbo.CrmBookingUnit WITH NOCHECK
    ADD CONSTRAINT CK_CrmBookingUnit_Status CHECK (Status IN (N'Active', N'Cancelled', N'Transferred'));
  PRINT 'Migration 486: CrmBookingUnit.Status now admits Transferred.';
END
ELSE
  PRINT 'Migration 486: CrmBookingUnit.Status already admits Transferred — skipped.';
GO

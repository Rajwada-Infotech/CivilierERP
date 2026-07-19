-- ============================================================
-- Migration: 229-uom-category-conversion.sql
--
-- UOM relevance + conversion. Today dbo.UOMMaster is a flat, unrelated
-- list — picking a UOM anywhere (Item Master, Material Request, Purchase
-- Order) offers every unit regardless of fit (a liquid item could be
-- offered "Running Meter" alongside "Litre"), and there's no way to
-- convert a rate quoted in one unit into another (e.g. a supplier's
-- ₹100/tonne quote can't become a ₹/kg rate anywhere in the system).
--
-- Adds two columns:
--   UOMCategory  — a measurement family (Weight, Volume, Area, Length,
--                  Time). Units that don't have a fixed physical relationship
--                  to others (Bags, Box, Set, Lump Sum, Trip, ...) are left
--                  NULL — grouping those together would be actively wrong
--                  (a "Bag" of cement isn't a fixed weight), and NULL is
--                  the caller's own signal to skip filtering/conversion for
--                  that unit rather than mis-group it.
--   BaseFactor   — this unit's size relative to its category's base unit
--                  (base unit itself = 1). E.g. Weight's base is Kilogram:
--                  KG=1, Metric Ton=1000. Converting a rate from unit A to
--                  unit B: newRate = oldRate * (BaseFactor_B / BaseFactor_A).
--
-- Only seeds the units already in this table (see the SELECT below) —
-- never invents new UOM rows. Anything added later stays uncategorized
-- until someone explicitly sets it via the UOM Master admin screen.
--
-- Safe to run multiple times (all operations guarded / idempotent UPDATEs).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.UOMMaster') AND name = N'UOMCategory'
)
    ALTER TABLE dbo.UOMMaster ADD UOMCategory NVARCHAR(30) NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.UOMMaster') AND name = N'BaseFactor'
)
    ALTER TABLE dbo.UOMMaster ADD BaseFactor DECIMAL(18,6) NOT NULL CONSTRAINT DF_UOMMaster_BaseFactor DEFAULT 1;
GO

-- ── Seed known units by UOMCode (idempotent — re-running just re-applies
--    the same values) ─────────────────────────────────────────────────────

-- Weight — base unit: Kilogram (KG)
UPDATE dbo.UOMMaster SET UOMCategory = 'Weight', BaseFactor = 1    WHERE UOMCode = 'KG';
UPDATE dbo.UOMMaster SET UOMCategory = 'Weight', BaseFactor = 1000 WHERE UOMCode = 'MT';  -- Metric Ton

-- Volume — base unit: Litre (LTR). 1 Cubic Meter = 1000 Litres.
UPDATE dbo.UOMMaster SET UOMCategory = 'Volume', BaseFactor = 1    WHERE UOMCode = 'LTR';
UPDATE dbo.UOMMaster SET UOMCategory = 'Volume', BaseFactor = 1000 WHERE UOMCode = 'CUM'; -- Cubic Meter

-- Area — base unit: Square Meter (SQM). 1 sqft = 0.092903 sqm.
UPDATE dbo.UOMMaster SET UOMCategory = 'Area', BaseFactor = 1        WHERE UOMCode = 'SQM';
UPDATE dbo.UOMMaster SET UOMCategory = 'Area', BaseFactor = 0.092903 WHERE UOMCode = 'SFT'; -- Square Feet

-- Length — base unit: Running Meter (RMT)
UPDATE dbo.UOMMaster SET UOMCategory = 'Length', BaseFactor = 1 WHERE UOMCode = 'RMT';

-- Time — base unit: Hours (HRS)
UPDATE dbo.UOMMaster SET UOMCategory = 'Time', BaseFactor = 1  WHERE UOMCode = 'HRS';
UPDATE dbo.UOMMaster SET UOMCategory = 'Time', BaseFactor = 24 WHERE UOMCode = 'DAY';

-- Count — base unit: Pieces (PCS). A Pair is fixed at 2 pieces; Bags,
-- Box, Bundle, Can, Coil, Load, Lump Sum, Packet, Roll, Set, Sheet, Trip
-- deliberately left uncategorized — none of them denote a fixed quantity
-- (a "Box" of screws and a "Box" of tiles aren't comparable).
UPDATE dbo.UOMMaster SET UOMCategory = 'Count', BaseFactor = 1 WHERE UOMCode = 'PCS';
UPDATE dbo.UOMMaster SET UOMCategory = 'Count', BaseFactor = 2 WHERE UOMCode = 'PR'; -- Pair

PRINT '================================================================';
PRINT '229-uom-category-conversion applied successfully.';
PRINT '================================================================';
GO

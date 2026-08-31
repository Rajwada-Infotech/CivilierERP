-- Migration 377: Allow NULL ParkingMasterId in CrmParkingAllotment
--
-- Problem: ParkingMasterId was NOT NULL + FK. Parking types that have slot
-- inventory (ParkingSlot rows) but no configured rate (no ParkingMaster row)
-- could not produce a CrmParkingAllotment record, so they were silently
-- excluded from bookings even after a staff member entered a manual price.
--
-- Fix: make ParkingMasterId nullable. The FK is kept (now nullable) so rows
-- with a master rate still validate against ParkingMaster. Rows with no
-- master rate store NULL and derive their type from the slot JOIN instead.

-- 1. Drop the auto-named FK on ParkingMasterId (name varies by environment)
DECLARE @fk NVARCHAR(200) = (
  SELECT TOP 1 name FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.CrmParkingAllotment')
    AND name LIKE '%ParkingMaster%'
);
IF @fk IS NOT NULL
  EXEC('ALTER TABLE dbo.CrmParkingAllotment DROP CONSTRAINT [' + @fk + ']');
GO

-- 2. Relax NOT NULL
ALTER TABLE dbo.CrmParkingAllotment ALTER COLUMN ParkingMasterId INT NULL;
GO

-- 3. Re-add FK as nullable so rated rows still enforce referential integrity
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.CrmParkingAllotment')
    AND name = 'FK_CrmParkingAllotment_ParkingMaster'
)
  ALTER TABLE dbo.CrmParkingAllotment
    ADD CONSTRAINT FK_CrmParkingAllotment_ParkingMaster
    FOREIGN KEY (ParkingMasterId) REFERENCES dbo.ParkingMaster(Id);

PRINT 'Migration 377: ParkingMasterId is now nullable in CrmParkingAllotment';
GO

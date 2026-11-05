-- Migration 528: what a floor is used for, in Auto Project Setup.
--
-- A building can be partly commercial (Gloria: shops on ground + first floor,
-- flats above). Each setup floor can now say which unit kind its units are —
-- a code from the unit kind master (Unit Master › Unit kinds). NULL keeps
-- today's behaviour (residential flats, typed from the block's unit mix).

IF COL_LENGTH('dbo.CrmProjectAutoSetupFloor', 'UnitKind') IS NULL
BEGIN
  ALTER TABLE dbo.CrmProjectAutoSetupFloor ADD UnitKind NVARCHAR(20) NULL;
  PRINT 'Migration 528: added CrmProjectAutoSetupFloor.UnitKind.';
END
GO

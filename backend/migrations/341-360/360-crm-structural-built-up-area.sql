-- Add built-up area to the CRM structural area path.
-- Pricing still uses the single inclusive saleable/SBU area; these columns are
-- descriptive facts carried from setup/master into the booking snapshot.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'BuiltUpAreaSqFt')
  ALTER TABLE dbo.UnitMaster ADD BuiltUpAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmProjectAutoSetupUnitTemplate') AND name = 'BuiltUpAreaSqFt')
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD BuiltUpAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'BuiltUpAreaSqFt')
  ALTER TABLE dbo.CrmBooking ADD BuiltUpAreaSqFt DECIMAL(18,2) NULL;

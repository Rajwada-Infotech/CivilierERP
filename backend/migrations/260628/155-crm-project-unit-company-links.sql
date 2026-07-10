-- ============================================================
-- Migration 155: CRM Project/Unit/Company Connectivity
-- CrmApplication and CrmBooking previously stored Project/Unit
-- as free text with no link back to the real Unit Master /
-- Project / Company data. This adds real FK columns so the
-- dropdowns in the CRM module resolve against actual master
-- data instead of being typed by hand.
-- ============================================================

-- CrmApplication: real project + preferred-unit + company links
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'ProjectId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD ProjectId INT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'PreferredUnitId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD PreferredUnitId INT NULL REFERENCES dbo.UnitMaster(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'CompanyId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD CompanyId INT NULL;
END
GO

-- CrmBooking: CompanyId (ProjectId already existed but was never populated
-- by the frontend — that gap is fixed in the same pass as this migration)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'CompanyId')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD CompanyId INT NULL;
END
GO

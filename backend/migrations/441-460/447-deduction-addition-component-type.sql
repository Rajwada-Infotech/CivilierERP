-- Migration 447: widen DeductionAdditionMaster.Type from Deduction/Addition
-- to the full Component Type set the Salary Structure formula engine needs:
-- Earning / Deduction / Employer Contribution / Informational. Existing
-- "Addition" rows (created under the old 2-value scheme) backfill to
-- "Earning" before the constraint changes, so live data (Basic Salary etc.)
-- keeps working without the user re-entering anything. Column also widens
-- NVARCHAR(20) -> NVARCHAR(30) since "Employer Contribution" is 21 chars.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DeductionAdditionMaster_Type')
BEGIN
  ALTER TABLE dbo.DeductionAdditionMaster DROP CONSTRAINT CK_DeductionAdditionMaster_Type;
END
GO

ALTER TABLE dbo.DeductionAdditionMaster ALTER COLUMN Type NVARCHAR(30) NOT NULL;
GO

UPDATE dbo.DeductionAdditionMaster SET Type = N'Earning' WHERE Type = N'Addition';
GO

ALTER TABLE dbo.DeductionAdditionMaster ADD CONSTRAINT CK_DeductionAdditionMaster_Type
  CHECK (Type IN (N'Earning', N'Deduction', N'Employer Contribution', N'Informational'));
GO

PRINT '447-deduction-addition-component-type applied successfully.';
GO

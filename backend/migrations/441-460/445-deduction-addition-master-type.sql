-- Migration 445: Deduction and Addition Master -- Type column, classifying
-- each component as a payroll Deduction or Addition (e.g. PF is a
-- Deduction, a Bonus is an Addition), restricted to those two values.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DeductionAdditionMaster') AND name = 'Type'
)
BEGIN
  ALTER TABLE dbo.DeductionAdditionMaster ADD Type NVARCHAR(20) NOT NULL
    CONSTRAINT DF_DeductionAdditionMaster_Type DEFAULT N'Deduction';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DeductionAdditionMaster_Type'
)
BEGIN
  ALTER TABLE dbo.DeductionAdditionMaster ADD CONSTRAINT CK_DeductionAdditionMaster_Type
    CHECK (Type IN (N'Deduction', N'Addition'));
END
GO

PRINT '445-deduction-addition-master-type applied successfully.';
GO

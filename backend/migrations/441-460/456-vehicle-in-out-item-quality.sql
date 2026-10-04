-- Migration 456: Vehicle In/Out line items gain a quality rating.
-- One of 'Excellent' | 'Good' | 'Bad', set per received line item at entry
-- time — independent of the existing quality-rejection debit note flow
-- (that raises a formal debit note against a line; this is just a quick
-- inspection grade shown as a badge next to the item).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.VehicleInOutItems') AND name = 'Quality')
  ALTER TABLE dbo.VehicleInOutItems ADD Quality NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_VehicleInOutItems_Quality')
  ALTER TABLE dbo.VehicleInOutItems ADD CONSTRAINT CK_VehicleInOutItems_Quality
    CHECK (Quality IS NULL OR Quality IN (N'Excellent', N'Good', N'Bad'));
GO

PRINT '456-vehicle-in-out-item-quality applied successfully.';
GO

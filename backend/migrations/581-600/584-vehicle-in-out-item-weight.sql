-- Migration 584: a weight per received line on Vehicle In/Out — a number and its unit (kg or tonne), entered beside
-- the item at the gate, and shown in the record's preview and in the Approval Inbox. Optional.

IF COL_LENGTH('dbo.VehicleInOutItems', 'Weight') IS NULL
BEGIN
    ALTER TABLE dbo.VehicleInOutItems ADD Weight DECIMAL(18,3) NULL;
    PRINT 'Added dbo.VehicleInOutItems.Weight';
END
GO

IF COL_LENGTH('dbo.VehicleInOutItems', 'WeightUnit') IS NULL
BEGIN
    ALTER TABLE dbo.VehicleInOutItems ADD WeightUnit NVARCHAR(10) NULL
        CONSTRAINT CK_VehicleInOutItems_WeightUnit CHECK (WeightUnit IS NULL OR WeightUnit IN (N'kg', N'tonne'));
    PRINT 'Added dbo.VehicleInOutItems.WeightUnit';
END
GO

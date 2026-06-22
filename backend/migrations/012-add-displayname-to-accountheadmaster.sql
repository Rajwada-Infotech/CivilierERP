-- Migration 012: Add DisplayName to AccountHeadMaster for universal bank name display
-- Purpose: Allow clean UI names without modifying raw LHeadName data.
-- Compatible with existing dynamic column detection in routes.
-- Usage: ISNULL(DisplayName, LHeadName) AS label/BName/SupplierName

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'DisplayName'
)
BEGIN
    ALTER TABLE dbo.AccountHeadMaster
    ADD DisplayName NVARCHAR(100) NULL;

    PRINT '✅ DisplayName column added successfully. Restart server and test APIs.';
END
ELSE
BEGIN
    PRINT 'ℹ️ DisplayName column already exists. Skipping.';
END
-- Migration 012: Add DisplayName to AccountHeadMaster for universal bank name display
-- Purpose: Allow clean UI names without modifying raw LHeadName data.
-- Compatible with existing dynamic column detection in routes.
-- Usage: ISNULL(DisplayName, LHeadName) AS label/BName/SupplierName

ALTER TABLE dbo.AccountHeadMaster 
ADD DisplayName NVARCHAR(100) NULL;

PRINT '✅ DisplayName column added successfully. Restart server and test APIs.';


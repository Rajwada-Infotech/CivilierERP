-- ============================================================
-- 121-fix-chequemaster-status-column.sql
--
-- Converts ChequeMaster.Status from nvarchar to BIT.
-- Run each statement individually in SSMS if batching fails.
-- ============================================================

USE Civilier;

-- Step 1: Add temp BIT column (defaults all rows to 1 = active)
ALTER TABLE dbo.ChequeMaster ADD Status_bit BIT NOT NULL DEFAULT 1;
GO

-- Step 2: Backfill from old nvarchar values
UPDATE dbo.ChequeMaster
SET Status_bit = CASE WHEN Status IN ('0', 'Inactive') THEN 0 ELSE 1 END;
GO

-- Step 3a: Drop default constraint on old Status column
ALTER TABLE dbo.ChequeMaster DROP CONSTRAINT DF_ChequeMaster_Status;
GO

-- Step 3b: Drop index dependent on old Status column
DROP INDEX IX_ChequeMaster_CId_Covering ON dbo.ChequeMaster;
GO

-- Step 3c: Drop the old nvarchar Status column
ALTER TABLE dbo.ChequeMaster DROP COLUMN Status;
GO

-- Step 4: Rename temp column to Status
EXEC sp_rename 'dbo.ChequeMaster.Status_bit', 'Status', 'COLUMN';
GO

-- Step 5: Re-create the covering index on the new BIT column
CREATE INDEX IX_ChequeMaster_CId_Covering
ON dbo.ChequeMaster (CId)
INCLUDE (Status, BankId, ChequeLotNumber, ChequeStartNumber, ChequeEndNumber, TotalCheques);
GO

-- Verify
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'ChequeMaster'
ORDER BY ORDINAL_POSITION;

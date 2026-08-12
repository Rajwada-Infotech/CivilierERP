-- Run against Civilier DB — only after the BrokeragePaymentPlan code fixes
-- have been deployed and running cleanly for a while, and after a backup.
--
-- Revision note: the first version of this migration guessed at explicit
-- constraint names (DF_CrmApplication_BrokerageSplitEnabled /
-- DF_CrmBooking_BrokerageSplitEnabled), which failed because SQL Server
-- auto-generated system names for these default constraints when the
-- column was originally created without an explicit CONSTRAINT clause
-- (e.g. DF__CrmApplic__Broke__5788D180). This version looks the real
-- name up from sys.default_constraints instead of assuming it.

DECLARE @constraintName SYSNAME;
DECLARE @sql NVARCHAR(MAX);

-- CrmApplication.BrokerageSplitEnabled
SELECT @constraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c
  ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('dbo.CrmApplication')
  AND c.name = 'BrokerageSplitEnabled';

IF @constraintName IS NOT NULL
BEGIN
  SET @sql = N'ALTER TABLE dbo.CrmApplication DROP CONSTRAINT ' + QUOTENAME(@constraintName);
  EXEC sp_executesql @sql;
END

IF COL_LENGTH('dbo.CrmApplication', 'BrokerageSplitEnabled') IS NOT NULL
  ALTER TABLE dbo.CrmApplication DROP COLUMN BrokerageSplitEnabled;

-- CrmBooking.BrokerageSplitEnabled
SET @constraintName = NULL;

SELECT @constraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c
  ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('dbo.CrmBooking')
  AND c.name = 'BrokerageSplitEnabled';

IF @constraintName IS NOT NULL
BEGIN
  SET @sql = N'ALTER TABLE dbo.CrmBooking DROP CONSTRAINT ' + QUOTENAME(@constraintName);
  EXEC sp_executesql @sql;
END

IF COL_LENGTH('dbo.CrmBooking', 'BrokerageSplitEnabled') IS NOT NULL
  ALTER TABLE dbo.CrmBooking DROP COLUMN BrokerageSplitEnabled;
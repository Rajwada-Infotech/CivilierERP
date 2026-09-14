-- ============================================================
-- 121-fix-chequemaster-status-column.sql
--
-- Converts ChequeMaster.Status from nvarchar to BIT.
-- IDEMPOTENT: safe to re-run. If Status is already BIT (or a prior
-- partial run left a Status_bit column behind), each step guards
-- itself and the migration becomes a no-op instead of erroring.
-- ============================================================

-- Step 0: If a previous failed run left an orphan Status_bit column,
-- drop it (with its default constraint) so we start clean.
IF COL_LENGTH('dbo.ChequeMaster', 'Status_bit') IS NOT NULL
BEGIN
  DECLARE @df sysname;
  SELECT @df = dc.name
  FROM sys.default_constraints dc
  JOIN sys.columns c ON c.default_object_id = dc.object_id
  WHERE c.object_id = OBJECT_ID('dbo.ChequeMaster')
    AND c.name = 'Status_bit';
  IF @df IS NOT NULL
    EXEC('ALTER TABLE dbo.ChequeMaster DROP CONSTRAINT ' + @df);
  ALTER TABLE dbo.ChequeMaster DROP COLUMN Status_bit;
END
GO

-- Only do the conversion if Status is NOT already BIT.
IF EXISTS (
  SELECT 1 FROM sys.columns c
  JOIN sys.types t ON c.user_type_id = t.user_type_id
  WHERE c.object_id = OBJECT_ID('dbo.ChequeMaster')
    AND c.name = 'Status'
    AND t.name <> 'bit'
)
BEGIN
  ALTER TABLE dbo.ChequeMaster ADD Status_bit BIT NOT NULL DEFAULT 1;
  UPDATE dbo.ChequeMaster SET Status_bit = CASE WHEN Status IN ('0', 'Inactive') THEN 0 ELSE 1 END;
  IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_ChequeMaster_Status')
    ALTER TABLE dbo.ChequeMaster DROP CONSTRAINT DF_ChequeMaster_Status;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ChequeMaster') AND name = 'IX_ChequeMaster_CId_Covering')
    DROP INDEX IX_ChequeMaster_CId_Covering ON dbo.ChequeMaster;
  ALTER TABLE dbo.ChequeMaster DROP COLUMN Status;
  EXEC sp_rename @objname = 'dbo.ChequeMaster.Status_bit', @newname = 'Status', @objtype = 'COLUMN';
END
GO

-- Ensure the covering index exists on the (now BIT) Status column.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ChequeMaster') AND name = 'IX_ChequeMaster_CId_Covering')
  CREATE INDEX IX_ChequeMaster_CId_Covering
  ON dbo.ChequeMaster (CId)
  INCLUDE (Status, BankId, ChequeLotNumber, ChequeStartNumber, ChequeEndNumber, TotalCheques);
GO
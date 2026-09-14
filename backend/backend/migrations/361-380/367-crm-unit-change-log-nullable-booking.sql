-- Migration 367: Make CrmUnitChangeLog.BookingId nullable so the audit row
-- survives a booking's permanent deletion (MCA FY2024 tamper-proof audit trail).
-- Previously: NOT NULL + FK → row had to be deleted with the booking (history lost).
-- After:      NULL allowed → permanent-delete NULLs BookingId, row is preserved
--             as an orphaned audit record (same pattern as CrmAuditLog).

-- 1. Drop the existing FK constraint
DECLARE @fkName NVARCHAR(200);
SELECT @fkName = fk.name
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
WHERE OBJECT_NAME(fk.parent_object_id) = 'CrmUnitChangeLog'
  AND c.name = 'BookingId';

IF @fkName IS NOT NULL
BEGIN
  EXEC('ALTER TABLE dbo.CrmUnitChangeLog DROP CONSTRAINT [' + @fkName + ']');
  PRINT 'Dropped FK on CrmUnitChangeLog.BookingId';
END
GO

-- 2. Make the column nullable
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmUnitChangeLog')
    AND name = 'BookingId'
    AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.CrmUnitChangeLog ALTER COLUMN BookingId INT NULL;
  PRINT 'Made CrmUnitChangeLog.BookingId nullable';
END
GO

-- 3. Re-add FK (nullable — NULL = booking was permanently deleted, row preserved for audit)
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE OBJECT_NAME(parent_object_id) = 'CrmUnitChangeLog'
    AND name = 'FK_CrmUnitChangeLog_CrmBooking'
)
BEGIN
  ALTER TABLE dbo.CrmUnitChangeLog
    ADD CONSTRAINT FK_CrmUnitChangeLog_CrmBooking
    FOREIGN KEY (BookingId) REFERENCES dbo.CrmBooking(Id);
  PRINT 'Re-added FK_CrmUnitChangeLog_CrmBooking (nullable)';
END
GO

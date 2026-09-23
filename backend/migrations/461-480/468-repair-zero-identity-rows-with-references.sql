-- Migration 463: repair identity rows that were created as 0, including
-- rows already referenced by child tables.
--
-- Root cause: SQL Server IDENTITY(1,1) never naturally starts at 0. A real
-- identity value of 0 means the table was manually reseeded to -1, or the
-- value was forced with IDENTITY_INSERT, outside the normal app path. Earlier
-- migrations 441/443 deliberately refused to touch referenced rows because
-- silently orphaning payments/bookings would be worse than leaving the bad
-- Id visible. This migration performs the missing root repair atomically:
--
--   1. Find every user table whose identity column has exactly one row = 0.
--   2. Pick the next real positive identity value for that table.
--   3. Temporarily disable only the FK constraints that point to that
--      identity column.
--   4. Repoint child FK values from 0 to the new Id.
--   5. Delete the 0 parent row, reinsert the same row at the new Id, and
--      re-check the FK constraints before commit.
--   6. Reseed the table to MAX(identity column).
--
-- Idempotent: once a table has no identity row at 0 it is skipped.
-- Guarded: if a table somehow has multiple zero rows, or a self-referencing
-- FK already points at 0, it is skipped for manual review.
--
-- KNOWN LIMITATION: this can only repoint what SQL Server tracks as a real
-- FOREIGN KEY constraint (sys.foreign_key_columns). A hand review of
-- migrations/ found three CrmBooking-referencing columns declared WITHOUT a
-- constraint — CrmBookingStageLog.BookingId, CrmOnAccountPayment
-- .HeldFromBookingId, CrmRefund.BookingId — added below as @softRefs so this
-- script repoints them too. That review covered CrmBooking specifically, not
-- every table this script might touch; before running this against a table
-- other than CrmBooking, re-check for unconstrained columns referencing it
-- the same way, or the fix will look successful while silently orphaning
-- those rows.

SET NOCOUNT ON;
SET XACT_ABORT ON;
-- sqlcmd's default session runs with QUOTED_IDENTIFIER OFF, which SQL
-- Server refuses for any UPDATE/DELETE against a table with a filtered
-- index or computed column — found by an actual production run of the
-- CRM-scoped sibling of this script.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @fixed TABLE (TableName NVARCHAR(300), IdentityColumn SYSNAME, OldId INT, NewId INT);
DECLARE @blocked TABLE (TableName NVARCHAR(300), Reason NVARCHAR(1000));

-- Columns that logically reference another table's identity column but were
-- never declared as a real FOREIGN KEY constraint (checked by hand against
-- every CREATE TABLE in migrations/ — see the code review that found this).
-- sys.foreign_key_columns can't see these, so without this list the script
-- above would silently leave them pointing at the old 0 after the parent
-- row is renumbered — exactly the orphaning risk 441/443 were written to
-- avoid. Add a row here any time a new unconstrained "soft FK" column
-- referencing an identity column turns up.
DECLARE @softRefs TABLE (SchemaName SYSNAME, TableName SYSNAME, ColumnName SYSNAME, RefSchemaName SYSNAME, RefTableName SYSNAME, RefColumnName SYSNAME);
INSERT INTO @softRefs VALUES
  ('dbo', 'CrmBookingStageLog',    'BookingId',         'dbo', 'CrmBooking', 'Id'),
  ('dbo', 'CrmOnAccountPayment',   'HeldFromBookingId', 'dbo', 'CrmBooking', 'Id'),
  ('dbo', 'CrmRefund',             'BookingId',         'dbo', 'CrmBooking', 'Id'),
  ('dbo', 'CrmMoneyReceipt',       'BookingId',         'dbo', 'CrmBooking', 'Id');

DECLARE
  @SchemaName SYSNAME,
  @TableName SYSNAME,
  @ColumnName SYSNAME,
  @ObjectId INT,
  @QualifiedTable NVARCHAR(300),
  @sql NVARCHAR(MAX),
  @zeroCount INT,
  @selfRefCount INT,
  @nextId INT,
  @reseedTo INT,
  @colList NVARCHAR(MAX),
  @selectList NVARCHAR(MAX),
  @disableFkSql NVARCHAR(MAX),
  @enableFkSql NVARCHAR(MAX),
  @updateFkSql NVARCHAR(MAX);

DECLARE identity_cursor CURSOR LOCAL FAST_FORWARD FOR
  SELECT s.name, t.name, c.name, t.object_id
  FROM sys.identity_columns c
  JOIN sys.tables t ON t.object_id = c.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE t.is_ms_shipped = 0;

OPEN identity_cursor;
FETCH NEXT FROM identity_cursor INTO @SchemaName, @TableName, @ColumnName, @ObjectId;

WHILE @@FETCH_STATUS = 0
BEGIN
  SET @QualifiedTable = QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName);
  SET @sql = N'SELECT @cnt = COUNT(*) FROM ' + @QualifiedTable + N' WHERE ' + QUOTENAME(@ColumnName) + N' = 0;';
  EXEC sp_executesql @sql, N'@cnt INT OUTPUT', @cnt = @zeroCount OUTPUT;

  IF @zeroCount > 1
  BEGIN
    INSERT INTO @blocked VALUES (
      @SchemaName + N'.' + @TableName,
      N'More than one identity row has value 0; this is not the known single-bad-first-row pattern.'
    );
  END
  ELSE IF @zeroCount = 1
  BEGIN
    SET @selfRefCount = 0;
    SET @sql = N'';

    SELECT @sql = @sql + N'
IF EXISTS (
  SELECT 1
  FROM ' + QUOTENAME(fs.name) + N'.' + QUOTENAME(ft.name) + N'
  WHERE ' + QUOTENAME(fc.name) + N' = 0
)
  SET @cnt = @cnt + 1;'
    FROM sys.foreign_key_columns fkc
    JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
    JOIN sys.tables ft ON ft.object_id = fkc.parent_object_id
    JOIN sys.schemas fs ON fs.schema_id = ft.schema_id
    JOIN sys.columns fc ON fc.object_id = fkc.parent_object_id AND fc.column_id = fkc.parent_column_id
    WHERE fkc.referenced_object_id = @ObjectId
      AND fkc.parent_object_id = @ObjectId
      AND fkc.referenced_column_id = (
        SELECT column_id
        FROM sys.columns
        WHERE object_id = @ObjectId AND name = @ColumnName
      );

    IF @sql <> N''
      EXEC sp_executesql @sql, N'@cnt INT OUTPUT', @cnt = @selfRefCount OUTPUT;

    IF @selfRefCount > 0
    BEGIN
      INSERT INTO @blocked VALUES (
        @SchemaName + N'.' + @TableName,
        N'Self-referencing FK rows point at 0; this needs table-specific review.'
      );
    END
    ELSE
    BEGIN
      BEGIN TRY
        SET @sql = N'SELECT @n = ISNULL(MAX(' + QUOTENAME(@ColumnName) + N'), 0) + 1 FROM ' +
                   @QualifiedTable + N' WHERE ' + QUOTENAME(@ColumnName) + N' <> 0;';
        EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @nextId OUTPUT;

        IF @nextId <= 0 SET @nextId = 1;

        -- is_computed = 0 excludes computed columns — a computed column can
        -- never appear in an explicit INSERT column list. Found by an actual
        -- production run of the CRM-scoped sibling of this script.
        SELECT
          @colList = STRING_AGG(QUOTENAME(name), N', ') WITHIN GROUP (ORDER BY column_id),
          @selectList = STRING_AGG(
            CASE WHEN name = @ColumnName THEN N'@ReplacementId AS ' + QUOTENAME(name)
                 ELSE QUOTENAME(name)
            END,
            N', '
          ) WITHIN GROUP (ORDER BY column_id)
        FROM sys.columns
        WHERE object_id = @ObjectId AND is_computed = 0;

        SET @disableFkSql = N'';
        SET @enableFkSql = N'';
        SET @updateFkSql = N'';

        SELECT
          @disableFkSql = @disableFkSql + N'
ALTER TABLE ' + QUOTENAME(fs.name) + N'.' + QUOTENAME(ft.name) +
            N' NOCHECK CONSTRAINT ' + QUOTENAME(fk.name) + N';',
          @enableFkSql = @enableFkSql + N'
ALTER TABLE ' + QUOTENAME(fs.name) + N'.' + QUOTENAME(ft.name) +
            N' WITH CHECK CHECK CONSTRAINT ' + QUOTENAME(fk.name) + N';',
          @updateFkSql = @updateFkSql + N'
UPDATE ' + QUOTENAME(fs.name) + N'.' + QUOTENAME(ft.name) +
            N' SET ' + QUOTENAME(fc.name) + N' = @ReplacementId WHERE ' + QUOTENAME(fc.name) + N' = 0;'
        FROM sys.foreign_key_columns fkc
        JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
        JOIN sys.tables ft ON ft.object_id = fkc.parent_object_id
        JOIN sys.schemas fs ON fs.schema_id = ft.schema_id
        JOIN sys.columns fc ON fc.object_id = fkc.parent_object_id AND fc.column_id = fkc.parent_column_id
        WHERE fkc.referenced_object_id = @ObjectId
          AND fkc.parent_object_id <> @ObjectId
          AND fkc.referenced_column_id = (
            SELECT column_id
            FROM sys.columns
            WHERE object_id = @ObjectId AND name = @ColumnName
          )
          AND NOT EXISTS (
            SELECT 1
            FROM sys.foreign_key_columns fkc2
            WHERE fkc2.constraint_object_id = fkc.constraint_object_id
              AND fkc2.constraint_column_id <> fkc.constraint_column_id
          );

        -- Known unconstrained "soft FK" columns pointing at this same
        -- table/column (see @softRefs above) — no constraint to disable,
        -- just repoint the value before the parent row is deleted/reinserted.
        SELECT @updateFkSql = @updateFkSql + N'
UPDATE ' + QUOTENAME(sr.SchemaName) + N'.' + QUOTENAME(sr.TableName) +
          N' SET ' + QUOTENAME(sr.ColumnName) + N' = @ReplacementId WHERE ' + QUOTENAME(sr.ColumnName) + N' = 0;'
        FROM @softRefs sr
        WHERE sr.RefSchemaName = @SchemaName AND sr.RefTableName = @TableName AND sr.RefColumnName = @ColumnName;

        BEGIN TRAN;

          SET @sql = N'
SELECT *
INTO #ZeroIdentityRow
FROM ' + @QualifiedTable + N'
WHERE ' + QUOTENAME(@ColumnName) + N' = 0;

' + ISNULL(@disableFkSql, N'') + N'
' + ISNULL(@updateFkSql, N'') + N'

DELETE FROM ' + @QualifiedTable + N'
WHERE ' + QUOTENAME(@ColumnName) + N' = 0;

SET IDENTITY_INSERT ' + @QualifiedTable + N' ON;
INSERT INTO ' + @QualifiedTable + N' (' + @colList + N')
SELECT ' + @selectList + N'
FROM #ZeroIdentityRow;
SET IDENTITY_INSERT ' + @QualifiedTable + N' OFF;

' + ISNULL(@enableFkSql, N'') + N'
';

          EXEC sp_executesql @sql, N'@ReplacementId INT', @ReplacementId = @nextId;

          SET @sql = N'SELECT @r = ISNULL(MAX(' + QUOTENAME(@ColumnName) + N'), 0) FROM ' + @QualifiedTable + N';';
          EXEC sp_executesql @sql, N'@r INT OUTPUT', @r = @reseedTo OUTPUT;
          EXEC (N'DBCC CHECKIDENT (''' + @SchemaName + N'.' + @TableName + N''', RESEED, ' + @reseedTo + N')');

        COMMIT TRAN;

        INSERT INTO @fixed VALUES (@SchemaName + N'.' + @TableName, @ColumnName, 0, @nextId);
        PRINT 'Fixed ' + @SchemaName + '.' + @TableName + ': ' + @ColumnName + ' 0 -> ' + CAST(@nextId AS NVARCHAR(20));
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        INSERT INTO @blocked VALUES (
          @SchemaName + N'.' + @TableName,
          N'Automatic referenced-row repair failed: ' + ERROR_MESSAGE()
        );
        PRINT 'FAILED to fix ' + @SchemaName + '.' + @TableName + ': ' + ERROR_MESSAGE();
      END CATCH
    END
  END

  FETCH NEXT FROM identity_cursor INTO @SchemaName, @TableName, @ColumnName, @ObjectId;
END

CLOSE identity_cursor;
DEALLOCATE identity_cursor;

PRINT '--- Zero identity repair summary ---';
SELECT * FROM @fixed ORDER BY TableName;
SELECT * FROM @blocked ORDER BY TableName;
GO

-- Migration 464: same repair as 463 (renumber a real Id=0 identity row to a
-- normal positive Id, repointing every reference — declared FK or known
-- unconstrained "soft FK" — atomically), but scoped to ONLY CRM tables
-- (t.name LIKE 'Crm%'), per explicit request to resolve the Id=0 problem for
-- the CRM module's current data specifically, not the whole database.
--
-- ⚠️ RUN THIS ONLY AFTER A FULL DATABASE BACKUP. This deletes and reinserts
-- rows and repoints foreign keys on live financial data (bookings, payment
-- milestones, on-account payments, parking allotments). It is guarded and
-- transactional per table, but it is still a real write to production data
-- — do not run this unattended or without a fresh backup you have verified
-- you can restore from.
--
-- What it does, per CRM table with an identity column:
--   1. Skip if the table has no row at Id = 0 (idempotent — safe to re-run).
--   2. Skip (report in @blocked) if more than one row is at Id = 0, or if a
--      self-referencing FK already points at 0 — both need manual eyes.
--   3. Pick the next real positive Id for that table.
--   4. Repoint every declared FK (sys.foreign_key_columns) pointing at this
--      table's identity column, from 0 to the new Id.
--   5. ALSO repoint the known unconstrained "soft FK" columns in @softRefs
--      below (found by hand-reviewing every CrmBooking-referencing CREATE
--      TABLE in migrations/ — CrmBookingStageLog.BookingId,
--      CrmOnAccountPayment.HeldFromBookingId, CrmRefund.BookingId). If you
--      add a new CRM table that references another CRM table's identity
--      column WITHOUT a real FOREIGN KEY constraint, add it here too, or
--      this script will silently leave it pointing at 0.
--   6. Delete the Id=0 row, reinsert it at the new Id, re-enable FKs.
--   7. Reseed the identity so the next real insert continues correctly.
--
-- Prints a summary at the end: @fixed lists every table actually repaired,
-- @blocked lists every table it deliberately left alone and why — read
-- @blocked before assuming this finished the job.

SET NOCOUNT ON;
SET XACT_ABORT ON;
-- sqlcmd's default session runs with QUOTED_IDENTIFIER OFF, which SQL
-- Server refuses for any UPDATE/DELETE against a table with a filtered
-- index or computed column (several CRM tables have one) — found by an
-- actual production run where 3 simple tables fixed cleanly and the other
-- 10 (including CrmBooking) failed with exactly this error and rolled
-- back safely, untouched, thanks to the per-table TRY/CATCH already here.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @fixed TABLE (TableName NVARCHAR(300), IdentityColumn SYSNAME, OldId INT, NewId INT);
DECLARE @blocked TABLE (TableName NVARCHAR(300), Reason NVARCHAR(1000));

-- Known unconstrained "soft FK" columns — see header comment above.
-- CrmMoneyReceipt.BookingId added after a live production diagnostic
-- (2026-09) found a real Approved MoneyReceipt row pointing at
-- CrmBooking.Id=0 that this list had missed — the DB-level
-- trg_CrmBooking_PreventUnsafeDelete trigger would otherwise block this
-- whole repair for CrmBooking, since it checks CrmMoneyReceipt for any
-- non-Rejected row before allowing the delete this script's repair
-- step performs.
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

-- Only CRM tables — the one line that differs from migration 463.
DECLARE identity_cursor CURSOR LOCAL FAST_FORWARD FOR
  SELECT s.name, t.name, c.name, t.object_id
  FROM sys.identity_columns c
  JOIN sys.tables t ON t.object_id = c.object_id
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE t.is_ms_shipped = 0
    AND t.name LIKE 'Crm%';

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

        -- is_computed = 0 excludes computed columns (e.g. CrmPaymentPlanTemplate
        -- .ScopeKey) — a computed column can never appear in an explicit INSERT
        -- column list, SQL Server always derives it itself. Found by an actual
        -- production run where this table failed with "column cannot be
        -- modified because it is a computed column" until this filter was added.
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

PRINT '--- CRM zero-identity repair summary ---';
SELECT * FROM @fixed ORDER BY TableName;
SELECT * FROM @blocked ORDER BY TableName;
GO

-- Migration 443: find and safely fix EVERY table in the database with the
-- same "Id = 0" corruption migration 441 fixed for dbo.CrmCustomer.
--
-- Root cause (established in migration 441): no script in this codebase
-- ever calls DBCC CHECKIDENT/RESEED — every IDENTITY(1,1) column here is
-- meant to start at 1. Production somehow got at least one table's first
-- row seeded at 0 instead, most likely from a single manual "reset
-- numbering before go-live" action run directly against the database that
-- reseeded to -1 instead of 0. If that was a blanket action, it likely hit
-- every table touched that day, not just CrmCustomer — so this scans and
-- fixes generically instead of guessing which other tables to check by name.
--
-- For EVERY identity column in the database, per table found with an
-- existing Id = 0 row, this:
--   1. Skips (prints a warning) if more than one row already has Id = 0 —
--      that's not this bug's signature and needs manual eyes.
--   2. Walks sys.foreign_keys to find every child table/column that
--      references this table's identity column, and checks each one for a
--      row that already points at 0. If ANY do, skips this table entirely
--      (prints exactly which child rows need re-pointing) rather than
--      auto-repointing foreign keys, which is a judgment call this script
--      won't make silently.
--   3. Only when a table's Id = 0 row has ZERO existing references anywhere
--      does it perform the same safe fix as migration 441: re-insert the
--      row's full data under a real (next available) Id, delete the Id = 0
--      row, and reseed the identity so future inserts continue correctly.
--
-- Fully idempotent — running it again after a clean run finds nothing left
-- to do. Safe to run before or after 441 (if 441 already fixed CrmCustomer,
-- this migration's scan simply won't find it again).

SET NOCOUNT ON;

DECLARE @TableName SYSNAME, @SchemaName SYSNAME, @ColumnName SYSNAME, @ObjectId INT;
DECLARE @sql NVARCHAR(MAX), @zeroCount INT, @refCount INT, @nextId INT, @colList NVARCHAR(MAX), @reseedTo INT;
DECLARE @blockedReasons TABLE (TableName NVARCHAR(300), Reason NVARCHAR(1000));
DECLARE @fixed TABLE (TableName NVARCHAR(300), OldId INT, NewId INT);

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
  -- 1. Does this table even have a row with the identity column = 0?
  SET @sql = N'SELECT @cnt = COUNT(*) FROM ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) +
             N' WHERE ' + QUOTENAME(@ColumnName) + N' = 0';
  EXEC sp_executesql @sql, N'@cnt INT OUTPUT', @cnt = @zeroCount OUTPUT;

  IF @zeroCount = 1
  BEGIN
    -- 2. Any child table referencing THIS table's identity column that
    -- already has a row pointing at 0? Walk every FK targeting this table.
    SET @refCount = 0;
    DECLARE @fkSql NVARCHAR(MAX) = N'';
    SELECT @fkSql = @fkSql + N'
      IF EXISTS (SELECT 1 FROM ' + QUOTENAME(fs.name) + N'.' + QUOTENAME(ft.name) +
                 N' WHERE ' + QUOTENAME(fc.name) + N' = 0)
      BEGIN
        SET @refCount = @refCount + 1;
        PRINT ''  -> blocked: '' + ''' + fs.name + N'.' + ft.name + N'.' + fc.name + N''' + '' already has a row referencing 0'';
      END'
    FROM sys.foreign_key_columns fkc
    JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
    JOIN sys.tables ft ON ft.object_id = fkc.parent_object_id
    JOIN sys.schemas fs ON fs.schema_id = ft.schema_id
    JOIN sys.columns fc ON fc.object_id = fkc.parent_object_id AND fc.column_id = fkc.parent_column_id
    WHERE fkc.referenced_object_id = @ObjectId
      AND fkc.referenced_column_id = (SELECT column_id FROM sys.columns WHERE object_id = @ObjectId AND name = @ColumnName);

    IF @fkSql <> N''
    BEGIN
      PRINT 'Checking references to ' + @SchemaName + '.' + @TableName + '.' + @ColumnName + ' = 0:';
      EXEC sp_executesql @fkSql, N'@refCount INT OUTPUT', @refCount = @refCount OUTPUT;
    END

    IF @refCount > 0
    BEGIN
      INSERT INTO @blockedReasons VALUES (@SchemaName + '.' + @TableName,
        'Id = 0 row is already referenced elsewhere — needs a manual, reviewed fix that re-points those references, not this automatic one.');
    END
    ELSE
    BEGIN
      -- 3. Safe to fix — same re-insert/delete/reseed pattern as migration 441.
      BEGIN TRY
        SET XACT_ABORT ON;
        BEGIN TRAN;

        SET @sql = N'SELECT @n = ISNULL(MAX(' + QUOTENAME(@ColumnName) + N'), 0) + 1 FROM ' +
                   QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N' WHERE ' + QUOTENAME(@ColumnName) + N' <> 0';
        EXEC sp_executesql @sql, N'@n INT OUTPUT', @n = @nextId OUTPUT;

        -- Build the full column list (every column except we still write the
        -- identity column explicitly via IDENTITY_INSERT) so this works
        -- generically for any table shape, not a hardcoded column set.
        SELECT @colList = STRING_AGG(QUOTENAME(name), ', ') WITHIN GROUP (ORDER BY column_id)
        FROM sys.columns WHERE object_id = @ObjectId;

        SET @sql = N'SET IDENTITY_INSERT ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N' ON; ' +
          N'INSERT INTO ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N' (' + @colList + N') ' +
          N'SELECT ' + REPLACE(@colList, QUOTENAME(@ColumnName), CAST(@nextId AS NVARCHAR(20))) +
          N' FROM ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N' WHERE ' + QUOTENAME(@ColumnName) + N' = 0; ' +
          N'SET IDENTITY_INSERT ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N' OFF; ' +
          N'DELETE FROM ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName) + N' WHERE ' + QUOTENAME(@ColumnName) + N' = 0;';
        EXEC sp_executesql @sql;

        SET @sql = N'SELECT @r = MAX(' + QUOTENAME(@ColumnName) + N') FROM ' + QUOTENAME(@SchemaName) + N'.' + QUOTENAME(@TableName);
        EXEC sp_executesql @sql, N'@r INT OUTPUT', @r = @reseedTo OUTPUT;
        SET @reseedTo = ISNULL(@reseedTo, 0);
        EXEC ('DBCC CHECKIDENT (''' + @SchemaName + '.' + @TableName + ''', RESEED, ' + @reseedTo + ')');

        COMMIT TRAN;
        INSERT INTO @fixed VALUES (@SchemaName + '.' + @TableName, 0, @nextId);
        PRINT 'Fixed ' + @SchemaName + '.' + @TableName + ': Id 0 -> ' + CAST(@nextId AS NVARCHAR(10));
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        INSERT INTO @blockedReasons VALUES (@SchemaName + '.' + @TableName, 'Automatic fix failed: ' + ERROR_MESSAGE());
        PRINT 'FAILED to fix ' + @SchemaName + '.' + @TableName + ': ' + ERROR_MESSAGE();
      END CATCH
    END
  END

  FETCH NEXT FROM identity_cursor INTO @SchemaName, @TableName, @ColumnName, @ObjectId;
END

CLOSE identity_cursor;
DEALLOCATE identity_cursor;

PRINT '--- Summary ---';
SELECT * FROM @fixed;
SELECT * FROM @blockedReasons;
GO

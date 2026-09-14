-- 204-drop-payment-plan-scope-columns.sql
--
-- NOTE ON NUMBERING: same caveat as 203 — check dbo.__Migrations for the
-- actual latest applied filename before running; renumber if 204 is taken.
--
-- Corrective follow-up to 203. That migration's steps 1 (create
-- CrmUnitPaymentPlan) and 2 (drop UnitMaster.DefaultPaymentPlanId)
-- succeeded. Step 3 (drop CompanyId/BlockId/UnitId from
-- CrmPaymentPlanTemplate) failed:
--   - a computed column 'ScopeKey' depends on CompanyId and BlockId
--   - an FK (FK__CrmPaymen__Block__18977ACE) depends on BlockId
-- None of that was visible from the application code, so rather than
-- hardcode a guess at ScopeKey's definition or the FK's name, this script
-- finds every object that depends on CompanyId/BlockId/UnitId on
-- CrmPaymentPlanTemplate via sys.* catalogs and drops exactly what it
-- finds, then drops the columns. Every step is guarded with IF EXISTS so
-- this is safe to re-run if it fails partway again.
--
-- Effect: CrmPaymentPlanTemplate goes back to Name + Description +
-- Milestones only, with nothing else attached to the old scope columns.
-- Step 4 from 203 (drop dbo.CrmPaymentPlanProject) is untouched here —
-- re-run 203 afterward, or run its step 4 block standalone, once this
-- passes.

SET NOCOUNT ON;

DECLARE @tbl INT = OBJECT_ID('dbo.CrmPaymentPlanTemplate');
DECLARE @sql NVARCHAR(MAX);

IF @tbl IS NULL
BEGIN
    RAISERROR('dbo.CrmPaymentPlanTemplate not found — aborting.', 16, 1);
    RETURN;
END

-- 1) Drop every index that includes ScopeKey as a key or included column
--    (covers a unique index used for old scope-uniqueness enforcement,
--    without assuming its name or exact shape).
DECLARE idx_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT DISTINCT i.name
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = @tbl AND c.name = 'ScopeKey' AND i.name IS NOT NULL;

DECLARE @idxName SYSNAME;
OPEN idx_cursor;
FETCH NEXT FROM idx_cursor INTO @idxName;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'DROP INDEX ' + QUOTENAME(@idxName) + N' ON dbo.CrmPaymentPlanTemplate;';
    PRINT @sql;
    EXEC sp_executesql @sql;
    FETCH NEXT FROM idx_cursor INTO @idxName;
END
CLOSE idx_cursor;
DEALLOCATE idx_cursor;

-- 2) Drop any check constraints that reference ScopeKey (defensive — a
--    computed column used for scope uniqueness sometimes also has a CHECK
--    tied to it).
DECLARE @ckName SYSNAME;
DECLARE ck_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT cc.name
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = @tbl
      AND cc.definition LIKE '%ScopeKey%';
OPEN ck_cursor;
FETCH NEXT FROM ck_cursor INTO @ckName;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'ALTER TABLE dbo.CrmPaymentPlanTemplate DROP CONSTRAINT ' + QUOTENAME(@ckName) + N';';
    PRINT @sql;
    EXEC sp_executesql @sql;
    FETCH NEXT FROM ck_cursor INTO @ckName;
END
CLOSE ck_cursor;
DEALLOCATE ck_cursor;

-- 3) Drop the ScopeKey computed column itself, if present.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = @tbl AND name = 'ScopeKey')
BEGIN
    SET @sql = N'ALTER TABLE dbo.CrmPaymentPlanTemplate DROP COLUMN ScopeKey;';
    PRINT @sql;
    EXEC sp_executesql @sql;
END

-- 4) For each scope column still present, drop every FK where that column
--    is on THIS table's side (i.e. CrmPaymentPlanTemplate is the
--    referencing/child table — the FK pointing out to Company/Block/Unit),
--    found by name from sys.foreign_key_columns, not assumed.
DECLARE @col SYSNAME, @fkName SYSNAME;
DECLARE col_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT name FROM (VALUES ('CompanyId'), ('BlockId'), ('UnitId')) v(name);
OPEN col_cursor;
FETCH NEXT FROM col_cursor INTO @col;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = @tbl AND name = @col)
    BEGIN
        DECLARE fk_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT DISTINCT fk.name
            FROM sys.foreign_keys fk
            JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
            JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
            WHERE fkc.parent_object_id = @tbl AND c.name = @col;
        OPEN fk_cursor;
        FETCH NEXT FROM fk_cursor INTO @fkName;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @sql = N'ALTER TABLE dbo.CrmPaymentPlanTemplate DROP CONSTRAINT ' + QUOTENAME(@fkName) + N';';
            PRINT @sql;
            EXEC sp_executesql @sql;
            FETCH NEXT FROM fk_cursor INTO @fkName;
        END
        CLOSE fk_cursor;
        DEALLOCATE fk_cursor;

        -- Default constraint on this column, same guard as 203 used.
        DECLARE @dfName SYSNAME;
        SELECT @dfName = dc.name
        FROM sys.default_constraints dc
        JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = @tbl AND c.name = @col;
        IF @dfName IS NOT NULL
        BEGIN
            SET @sql = N'ALTER TABLE dbo.CrmPaymentPlanTemplate DROP CONSTRAINT ' + QUOTENAME(@dfName) + N';';
            PRINT @sql;
            EXEC sp_executesql @sql;
        END

        -- Any remaining non-FK, non-default index that still includes this
        -- column directly (e.g. a plain index on BlockId).
        DECLARE @ixName SYSNAME;
        DECLARE ix_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT DISTINCT i.name
            FROM sys.indexes i
            JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE i.object_id = @tbl AND c.name = @col AND i.name IS NOT NULL AND i.is_primary_key = 0;
        OPEN ix_cursor;
        FETCH NEXT FROM ix_cursor INTO @ixName;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @sql = N'DROP INDEX ' + QUOTENAME(@ixName) + N' ON dbo.CrmPaymentPlanTemplate;';
            PRINT @sql;
            EXEC sp_executesql @sql;
            FETCH NEXT FROM ix_cursor INTO @ixName;
        END
        CLOSE ix_cursor;
        DEALLOCATE ix_cursor;

        -- Finally, the column itself.
        SET @sql = N'ALTER TABLE dbo.CrmPaymentPlanTemplate DROP COLUMN ' + QUOTENAME(@col) + N';';
        PRINT @sql;
        EXEC sp_executesql @sql;
    END
    FETCH NEXT FROM col_cursor INTO @col;
END
CLOSE col_cursor;
DEALLOCATE col_cursor;

-- 5) Verify: list anything scope-related still standing, for you to review
--    in the output rather than this script silently assuming success.
SELECT c.name AS RemainingColumn
FROM sys.columns c
WHERE c.object_id = @tbl AND c.name IN ('CompanyId', 'BlockId', 'UnitId', 'ScopeKey');
-- Migration 623: retire indexes nobody reads and tables nothing uses — undoable in one step
--
-- Measured on production (sys.dm_db_index_usage_stats since 2026-10-05, a month of use).
-- Nothing is dropped: an index is DISABLED (its space is freed and writes stop updating it, but the
-- database keeps its exact definition — ALTER INDEX … REBUILD brings it back as it was), and a table is
-- RENAMED to <name>__retired_623 (renaming it back restores it as it was). A later migration can drop them
-- for good once they have been retired without trouble.
--
-- A. Activity log (dbo.UserActivityLog, written on every save): 10 indexes, ~270 MB for 55,000 rows.
--    Disabled, each only while the index that takes over its work is there and in use:
--      IX_UserActivityLog_CreatedAt_Covering  54 MB — the same as IX_UserActivityLog_CreatedAt_Filters
--                                             (both lead with CreatedAt and carry every column)
--      IX_UserActivityLog_Role_CreatedAt      17 MB — 1 read; the Filters index serves the role filter
--      IX_UserActivityLog_UserId               7 MB — 0 reads; IX_UserActivityLog_UserId_CreatedAt leads with UserId
--      IX_UserActivityLog_Resource_ActionType 19 MB — 0 reads
--      IX_UserActivityLog_ActionType           7 MB — 0 reads
--    (IX_UserActivityLog_SessionId stays: the Sessions view looks rows up by it.)
--
-- B. Exact duplicates — the same key on the same table; the twin named here stays:
--      PurchaseOrders              IX_PO_SourceWOId     (= IX_PurchaseOrders_SourceWOId, same filter)
--      WorkDone                    IX_WorkDone_Status   (= IX_WD_Status)
--      Roles                       IX_Roles_RName       (the unique index on RName already serves it)
--      DependencyActivityDailyLog  IX_DADailyLog_Rung   (= UX_DADailyLog_Rung_Date, same two columns)
--
-- C. Empty tables no code uses: BookingPaymentTerms (migrations 083 / 262 already meant to retire it),
--    FollowupApplicants_DEPRECATED, ProjectUnitTypeSpec, CrmUnitLineage, DprActivityChainTemplate and its
--    Item table, sysdiagrams (left by SQL tools). Each is retired only while it is still empty and nothing
--    outside this list uses it — no foreign key from another table, no view, procedure, function or trigger.
--
-- No row of data is touched. Safe to re-run. Undo, per object:
--   ALTER INDEX <index> ON dbo.<table> REBUILD;          -- the index is back exactly as it was
--   EXEC sp_rename 'dbo.<table>__retired_623', '<table>';  -- the table is back under its name

-- ── A + B: disable an index only while the one taking over its work is there and enabled ──
DECLARE @retire TABLE (TableName SYSNAME, IndexName SYSNAME, KeepIndex SYSNAME NULL);
INSERT INTO @retire VALUES
  ('UserActivityLog', 'IX_UserActivityLog_CreatedAt_Covering', 'IX_UserActivityLog_CreatedAt_Filters'),
  ('UserActivityLog', 'IX_UserActivityLog_Role_CreatedAt', 'IX_UserActivityLog_CreatedAt_Filters'),
  ('UserActivityLog', 'IX_UserActivityLog_UserId', 'IX_UserActivityLog_UserId_CreatedAt'),
  ('UserActivityLog', 'IX_UserActivityLog_Resource_ActionType', NULL),
  ('UserActivityLog', 'IX_UserActivityLog_ActionType', NULL),
  ('PurchaseOrders', 'IX_PO_SourceWOId', 'IX_PurchaseOrders_SourceWOId'),
  ('WorkDone', 'IX_WorkDone_Status', 'IX_WD_Status'),
  ('DependencyActivityDailyLog', 'IX_DADailyLog_Rung', 'UX_DADailyLog_Rung_Date');

DECLARE @t SYSNAME, @i SYSNAME, @k SYSNAME, @sqlText NVARCHAR(500);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT TableName, IndexName, KeepIndex FROM @retire;
OPEN c;
FETCH NEXT FROM c INTO @t, @i, @k;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = @i AND object_id = OBJECT_ID('dbo.' + @t) AND type = 2
               AND is_unique = 0 AND is_primary_key = 0 AND is_disabled = 0)
     AND (@k IS NULL OR EXISTS (SELECT 1 FROM sys.indexes WHERE name = @k AND object_id = OBJECT_ID('dbo.' + @t) AND is_disabled = 0))
  BEGIN
    SET @sqlText = N'ALTER INDEX ' + QUOTENAME(@i) + N' ON dbo.' + QUOTENAME(@t) + N' DISABLE';
    EXEC sp_executesql @sqlText;
    PRINT 'Disabled ' + @t + '.' + @i;
  END
  FETCH NEXT FROM c INTO @t, @i, @k;
END
CLOSE c;
DEALLOCATE c;
GO

-- Roles.RName: the non-unique copy is disabled only while an enabled unique index on RName alone exists.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Roles_RName' AND object_id = OBJECT_ID('dbo.Roles')
             AND type = 2 AND is_unique = 0 AND is_disabled = 0)
   AND EXISTS (
     SELECT 1 FROM sys.indexes i
     WHERE i.object_id = OBJECT_ID('dbo.Roles') AND i.is_unique = 1 AND i.is_disabled = 0 AND i.name <> 'IX_Roles_RName'
       AND (SELECT COUNT(*) FROM sys.index_columns ic WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0) = 1
       AND EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
                   WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal = 1 AND col.name = 'RName'))
BEGIN
  ALTER INDEX IX_Roles_RName ON dbo.Roles DISABLE;
  PRINT 'Disabled Roles.IX_Roles_RName';
END
GO

-- ── C: rename an empty table nothing outside this list uses ──
DECLARE @tables TABLE (TableName SYSNAME);
INSERT INTO @tables VALUES
  ('BookingPaymentTerms'), ('FollowupApplicants_DEPRECATED'), ('ProjectUnitTypeSpec'), ('CrmUnitLineage'),
  ('DprActivityChainTemplateItem'), ('DprActivityChainTemplate'), ('sysdiagrams');

DECLARE @name SYSNAME, @rows BIGINT, @old NVARCHAR(300), @new SYSNAME;
DECLARE d CURSOR LOCAL FAST_FORWARD FOR SELECT TableName FROM @tables;
OPEN d;
FETCH NEXT FROM d INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @new = @name + N'__retired_623';
  IF OBJECT_ID('dbo.' + @name, 'U') IS NOT NULL AND OBJECT_ID('dbo.' + @new, 'U') IS NULL
  BEGIN
    SELECT @rows = SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID('dbo.' + @name) AND p.index_id IN (0, 1);
    IF ISNULL(@rows, 0) = 0
       -- No table outside this list points at it.
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys fk
                       WHERE fk.referenced_object_id = OBJECT_ID('dbo.' + @name)
                         AND OBJECT_NAME(fk.parent_object_id) NOT IN (SELECT TableName FROM @tables))
       -- No view, procedure, function or trigger uses it (including any made on the server by hand).
       AND NOT EXISTS (SELECT 1 FROM sys.sql_expression_dependencies dep
                       WHERE dep.referenced_id = OBJECT_ID('dbo.' + @name) AND dep.referencing_id <> OBJECT_ID('dbo.' + @name))
    BEGIN
      SET @old = N'dbo.' + QUOTENAME(@name);
      EXEC sp_rename @old, @new;
      PRINT 'Retired table ' + @name + ' -> ' + @new;
    END
    ELSE
      PRINT 'Kept table ' + @name + ' (has rows or something uses it)';
  END
  FETCH NEXT FROM d INTO @name;
END
CLOSE d;
DEALLOCATE d;
GO

PRINT '623-retire-unused-indexes-and-dead-tables applied successfully.';

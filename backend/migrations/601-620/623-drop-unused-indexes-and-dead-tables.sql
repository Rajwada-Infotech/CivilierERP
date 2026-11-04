-- Migration 623: drop indexes nobody reads and tables nothing uses
--
-- Measured on production (sys.dm_db_index_usage_stats since 2026-10-05, a month of use):
--
-- A. Activity log (dbo.UserActivityLog, written on every save): 10 indexes, ~270 MB for 55,000 rows.
--    Dropped, each only while the index that takes over its work exists:
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
-- C. Empty tables no code uses (each dropped only while still empty and nothing references it):
--      BookingPaymentTerms (migrations 083 / 262 already meant to retire it), FollowupApplicants_DEPRECATED,
--      ProjectUnitTypeSpec, CrmUnitLineage, DprActivityChainTemplate(Item), sysdiagrams (left by SQL tools).
--    Kept instead if it has rows, a foreign key points at it, or a view / procedure / function / trigger uses it.
--
-- No row of data is removed. Safe to re-run.

-- ── A + B: an index goes only while the one that takes over its work is there ──
DECLARE @drops TABLE (TableName SYSNAME, IndexName SYSNAME, KeepIndex SYSNAME NULL);
INSERT INTO @drops VALUES
  ('UserActivityLog', 'IX_UserActivityLog_CreatedAt_Covering', 'IX_UserActivityLog_CreatedAt_Filters'),
  ('UserActivityLog', 'IX_UserActivityLog_Role_CreatedAt', 'IX_UserActivityLog_CreatedAt_Filters'),
  ('UserActivityLog', 'IX_UserActivityLog_UserId', 'IX_UserActivityLog_UserId_CreatedAt'),
  ('UserActivityLog', 'IX_UserActivityLog_Resource_ActionType', NULL),
  ('UserActivityLog', 'IX_UserActivityLog_ActionType', NULL),
  ('PurchaseOrders', 'IX_PO_SourceWOId', 'IX_PurchaseOrders_SourceWOId'),
  ('WorkDone', 'IX_WorkDone_Status', 'IX_WD_Status'),
  ('DependencyActivityDailyLog', 'IX_DADailyLog_Rung', 'UX_DADailyLog_Rung_Date');

DECLARE @t SYSNAME, @i SYSNAME, @k SYSNAME, @sqlText NVARCHAR(500);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT TableName, IndexName, KeepIndex FROM @drops;
OPEN c;
FETCH NEXT FROM c INTO @t, @i, @k;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = @i AND object_id = OBJECT_ID('dbo.' + @t))
     AND (@k IS NULL OR EXISTS (SELECT 1 FROM sys.indexes WHERE name = @k AND object_id = OBJECT_ID('dbo.' + @t)))
  BEGIN
    SET @sqlText = N'DROP INDEX ' + QUOTENAME(@i) + N' ON dbo.' + QUOTENAME(@t);
    EXEC sp_executesql @sqlText;
    PRINT 'Dropped ' + @t + '.' + @i;
  END
  FETCH NEXT FROM c INTO @t, @i, @k;
END
CLOSE c;
DEALLOCATE c;
GO

-- Roles.RName: the non-unique copy goes only while a unique index on RName alone exists.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Roles_RName' AND object_id = OBJECT_ID('dbo.Roles'))
   AND EXISTS (
     SELECT 1 FROM sys.indexes i
     WHERE i.object_id = OBJECT_ID('dbo.Roles') AND i.is_unique = 1 AND i.name <> 'IX_Roles_RName'
       AND (SELECT COUNT(*) FROM sys.index_columns ic WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0) = 1
       AND EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
                   WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal = 1 AND col.name = 'RName'))
BEGIN
  DROP INDEX IX_Roles_RName ON dbo.Roles;
  PRINT 'Dropped Roles.IX_Roles_RName';
END
GO

-- ── C: an empty, unreferenced table goes; one with rows or a foreign key pointing at it stays ──
DECLARE @tables TABLE (TableName SYSNAME);
INSERT INTO @tables VALUES
  ('BookingPaymentTerms'), ('FollowupApplicants_DEPRECATED'), ('ProjectUnitTypeSpec'), ('CrmUnitLineage'),
  ('DprActivityChainTemplateItem'), ('DprActivityChainTemplate'), ('sysdiagrams');

DECLARE @name SYSNAME, @rows BIGINT, @dropSql NVARCHAR(300);
DECLARE d CURSOR LOCAL FAST_FORWARD FOR SELECT TableName FROM @tables;
OPEN d;
FETCH NEXT FROM d INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID('dbo.' + @name, 'U') IS NOT NULL
  BEGIN
    SELECT @rows = SUM(p.rows) FROM sys.partitions p WHERE p.object_id = OBJECT_ID('dbo.' + @name) AND p.index_id IN (0, 1);
    IF ISNULL(@rows, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys fk
                       WHERE fk.referenced_object_id = OBJECT_ID('dbo.' + @name) AND fk.parent_object_id <> fk.referenced_object_id)
       -- Nor a view, procedure, function or trigger made on the server by hand (not in any migration) uses it.
       AND NOT EXISTS (SELECT 1 FROM sys.sql_expression_dependencies dep
                       WHERE dep.referenced_id = OBJECT_ID('dbo.' + @name) AND dep.referencing_id <> OBJECT_ID('dbo.' + @name))
    BEGIN
      -- Its own outgoing foreign keys go with it.
      SET @dropSql = N'DROP TABLE dbo.' + QUOTENAME(@name);
      EXEC sp_executesql @dropSql;
      PRINT 'Dropped table ' + @name;
    END
    ELSE
      PRINT 'Kept table ' + @name + ' (has rows or is referenced)';
  END
  FETCH NEXT FROM d INTO @name;
END
CLOSE d;
DEALLOCATE d;
GO

PRINT '623-drop-unused-indexes-and-dead-tables applied successfully.';

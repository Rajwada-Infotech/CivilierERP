-- Migration 442: READ-ONLY diagnostic — find every table where an identity
-- column has an existing row with value 0.
--
-- Migration 441 fixed dbo.CrmCustomer's Id=0 row, caused by a one-time
-- manual identity reseed (no script in this codebase ever calls DBCC
-- CHECKIDENT/RESEED). If that reseed was done as a blanket "reset the whole
-- database" action, other tables could carry the exact same corruption —
-- guessing which ones from table names would be exactly the kind of blind
-- guess to avoid. This scans EVERY identity column across the whole
-- database generically instead.
--
-- SAFE: pure SELECT, no writes, nothing to roll back. Run this, inspect the
-- results, and only THEN write a targeted fix for whatever it finds — the
-- same careful, evidence-first approach migration 441 used (verify no
-- existing Id=0 duplicate, verify nothing already references it, re-insert
-- under a real Id, reseed). Do not blanket-apply 441's fix to every result
-- here without checking each one's foreign-key references first, the same
-- way 441 did for CrmCustomer.

DECLARE @sql NVARCHAR(MAX) = N'';

SELECT @sql = @sql + N'
SELECT ''' + s.name + N'.' + t.name + N''' AS TableName, ''' + c.name + N''' AS IdentityColumn,
       (SELECT COUNT(*) FROM ' + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) + N' WHERE ' + QUOTENAME(c.name) + N' = 0) AS ZeroRowCount
UNION ALL'
FROM sys.identity_columns c
JOIN sys.tables t ON t.object_id = c.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0;

-- Strip the trailing "UNION ALL" left by the loop above.
SET @sql = LEFT(@sql, LEN(@sql) - LEN('UNION ALL'));

CREATE TABLE #ZeroIdentityScan (TableName NVARCHAR(300), IdentityColumn NVARCHAR(200), ZeroRowCount INT);
INSERT INTO #ZeroIdentityScan EXEC sp_executesql @sql;

-- Only the tables that actually have a real problem — everything else
-- (the vast majority) will correctly show 0 and is omitted here.
SELECT * FROM #ZeroIdentityScan WHERE ZeroRowCount > 0 ORDER BY TableName;

DROP TABLE #ZeroIdentityScan;
GO

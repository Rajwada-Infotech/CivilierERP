-- 632: Land records are no longer verified row by row — the whole land is verified once (Final verification, 641).
-- Every Legal record row is marked Verified and new rows default to Verified, so totals that counted only verified
-- rows (payments, fees, valuations…) count every row. The column stays (old reports / history) but is no longer shown.
-- The land's own status (dbo.LegalLand) is not touched. Safe to re-run.
DECLARE @t SYSNAME, @dc SYSNAME, @sql NVARCHAR(MAX);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT t.name FROM sys.columns col JOIN sys.tables t ON t.object_id = col.object_id
  WHERE col.name = 'VerificationStatus' AND t.name LIKE 'Legal%' AND t.name <> 'LegalLand' AND t.schema_id = SCHEMA_ID('dbo');
OPEN c; FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @sql = N'UPDATE dbo.' + QUOTENAME(@t) + N' SET VerificationStatus = N''Verified'' WHERE ISNULL(VerificationStatus, N'''') <> N''Verified'';';
  EXEC sp_executesql @sql;
  SELECT @dc = d.name FROM sys.default_constraints d JOIN sys.columns col ON col.object_id = d.parent_object_id AND col.column_id = d.parent_column_id
  WHERE d.parent_object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@t)) AND col.name = 'VerificationStatus';
  IF @dc IS NOT NULL BEGIN SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@t) + N' DROP CONSTRAINT ' + QUOTENAME(@dc) + N';'; EXEC sp_executesql @sql; END;
  SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@t) + N' ADD CONSTRAINT ' + QUOTENAME(N'DF_' + @t + N'_VerificationStatus') + N' DEFAULT N''Verified'' FOR VerificationStatus;';
  EXEC sp_executesql @sql;
  SET @dc = NULL;
  FETCH NEXT FROM c INTO @t;
END;
CLOSE c; DEALLOCATE c;
GO
-- Documents too: no per-document review any more (checked at Final verification).
IF COL_LENGTH('dbo.LegalLandDocumentVersion', 'ReviewStatus') IS NOT NULL
  EXEC(N'UPDATE dbo.LegalLandDocumentVersion SET ReviewStatus = N''Verified'' WHERE ISNULL(ReviewStatus, N'''') NOT IN (N''Verified'', N''Not Applicable'');');

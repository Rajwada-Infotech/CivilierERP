-- 699: CrmCustomerPortalUser — drop the old single-column unique keys on ApplicationId and Email.
--  Migration 254 meant to drop them but did so by their auto-generated names (UQ__CrmCusto__…), which differ from
--  database to database — so where the names didn't match (production) they were left in place. Since 254 the
--  ApplicationId is no longer written (always NULL), and since 698 Email may be NULL too, so a second account hits
--  "Violation of UNIQUE KEY … duplicate key value is (<NULL>)". Found here by the column they cover, not by name.
--  The one key that stays: UQ_CrmCustomerPortalUser_CustomerId (one account per customer). Safe to re-run.
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE dbo.CrmCustomerPortalUser DROP CONSTRAINT ' + QUOTENAME(kc.name) + N';' + CHAR(10)
FROM sys.key_constraints kc
WHERE kc.parent_object_id = OBJECT_ID('dbo.CrmCustomerPortalUser')
  AND kc.type = 'UQ'
  AND (SELECT COUNT(*) FROM sys.index_columns ic WHERE ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id) = 1
  AND EXISTS (SELECT 1 FROM sys.index_columns ic
              JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
                AND c.name IN (N'ApplicationId', N'Email'));
-- Unique indexes (not constraints) on those columns alone, should any exist
SELECT @sql += N'DROP INDEX ' + QUOTENAME(i.name) + N' ON dbo.CrmCustomerPortalUser;' + CHAR(10)
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.CrmCustomerPortalUser') AND i.is_unique = 1 AND i.is_unique_constraint = 0 AND i.is_primary_key = 0
  AND (SELECT COUNT(*) FROM sys.index_columns ic WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id) = 1
  AND EXISTS (SELECT 1 FROM sys.index_columns ic
              JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name IN (N'ApplicationId', N'Email'));
IF @sql <> N''
BEGIN
  PRINT @sql;
  EXEC sp_executesql @sql;
END
ELSE
  PRINT 'No old unique keys on ApplicationId / Email — nothing to drop';
GO

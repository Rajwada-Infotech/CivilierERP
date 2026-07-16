-- Migration 007: Drop page_permissions column (replaced by RoleRights)

PRINT '=== Migration 007: Dropping page_permissions ===';

IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.users') AND name = 'page_permissions')
BEGIN
    -- Backup data first (optional). Dynamic SQL avoids compile errors when
    -- fresh databases never had the legacy page_permissions column.
    EXEC sp_executesql N'
        SELECT id, name, page_permissions
        INTO #backup_permissions
        FROM dbo.users
        WHERE page_permissions IS NOT NULL;
    ';
    
    ALTER TABLE dbo.users DROP COLUMN page_permissions;
    PRINT 'page_permissions column dropped.';
END ELSE BEGIN
    PRINT 'page_permissions column does not exist (already dropped).';
END

PRINT 'Migration 007 COMPLETE ✅';
PRINT 'users table cleaned up.';


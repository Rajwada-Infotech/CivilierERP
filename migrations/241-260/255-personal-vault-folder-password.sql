-- Personal Vault folders can now be individually password-protected.
-- A "folder" was previously purely implicit (the distinct FolderName
-- values on dbo.PersonalVaultFiles) — this gives it a real row to hang a
-- PasswordHash off, one per (OwnerId, FolderName).
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PersonalVaultFolders'
)
BEGIN
    CREATE TABLE dbo.PersonalVaultFolders (
        Id            INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
        OwnerId       INT            NOT NULL,
        FolderName    NVARCHAR(200)  NOT NULL,
        PasswordHash  NVARCHAR(200)  NULL,
        CreatedAt     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        UpdatedAt     DATETIME2      NULL,
        CONSTRAINT UQ_PersonalVaultFolders_Owner_Name UNIQUE (OwnerId, FolderName)
    );
    PRINT 'dbo.PersonalVaultFolders created.';
END
ELSE
    PRINT 'dbo.PersonalVaultFolders already exists — skipped.';
GO

-- Backfill a folder row (no password) for every folder that already has
-- files, so existing folders keep working unprotected until the owner
-- opts into a password.
INSERT INTO dbo.PersonalVaultFolders (OwnerId, FolderName)
SELECT DISTINCT f.OwnerId, f.FolderName
FROM dbo.PersonalVaultFiles f
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.PersonalVaultFolders pf
    WHERE pf.OwnerId = f.OwnerId AND pf.FolderName = f.FolderName
);
GO

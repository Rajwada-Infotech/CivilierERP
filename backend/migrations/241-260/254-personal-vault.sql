-- Records module's "New Folder" button — a personal file vault, private per
-- user, unrelated to any project/business document. Arbitrary file types
-- (images, PDFs, Office docs, CSV, etc), grouped into user-named folders
-- (e.g. "XYZ Vault") purely by a free-text FolderName column — no separate
-- "folder" row needed, a folder just is the distinct set of FolderName
-- values a user has uploaded under.
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PersonalVaultFiles'
)
BEGIN
    CREATE TABLE dbo.PersonalVaultFiles (
        Id            INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
        OwnerId       INT            NOT NULL,
        FolderName    NVARCHAR(200)  NOT NULL,
        FileName      NVARCHAR(300)  NOT NULL,
        MimeType      NVARCHAR(150)  NULL,
        FileSize      INT            NULL,
        FileData      VARBINARY(MAX) NOT NULL,
        UploadedAt    DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    PRINT 'dbo.PersonalVaultFiles created.';
END
ELSE
    PRINT 'dbo.PersonalVaultFiles already exists — skipped.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_PersonalVaultFiles_OwnerId'
      AND object_id = OBJECT_ID('dbo.PersonalVaultFiles')
)
    CREATE INDEX IX_PersonalVaultFiles_OwnerId ON dbo.PersonalVaultFiles (OwnerId);
GO

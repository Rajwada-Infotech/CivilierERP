-- Migration 480: APK Manager. One row per uploaded Android build of one of the
-- mobile apps. The row flagged IsCurrent is what the apps' in-app updater is
-- told is the latest version (GET /api/app-releases/latest?app=...). Older
-- rows are kept as release history (the .apk file itself is overwritten by
-- the next upload of the same app; only the latest file is stored).

IF OBJECT_ID('dbo.AppRelease', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppRelease (
    AppReleaseId INT IDENTITY(1,1) PRIMARY KEY,
    AppKey       NVARCHAR(40)   NOT NULL,
    PackageName  NVARCHAR(150)  NOT NULL,
    VersionCode  INT            NOT NULL,
    VersionName  NVARCHAR(50)   NULL,
    FileName     NVARCHAR(150)  NOT NULL,
    SizeBytes    BIGINT         NOT NULL,
    Sha256       CHAR(64)       NOT NULL,
    Md5          CHAR(32)       NOT NULL,
    ReleaseNotes NVARCHAR(2000) NULL,
    IsMandatory  BIT            NOT NULL CONSTRAINT DF_AppRelease_IsMandatory DEFAULT 0,
    IsCurrent    BIT            NOT NULL CONSTRAINT DF_AppRelease_IsCurrent DEFAULT 1,
    PublishedBy  NVARCHAR(150)  NULL,
    PublishedAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_AppRelease_PublishedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AppRelease_App_Version UNIQUE (AppKey, VersionCode)
  );
  CREATE INDEX IX_AppRelease_Current ON dbo.AppRelease (AppKey, IsCurrent);
END
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'apk-manager', 'APK Manager', 'Admin', 'Admin', 'view,create,edit', 370, 1, 'migration-480', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'apk-manager' AND pd.IsActive = 1
);
GO

PRINT '480-app-releases applied successfully.';
GO

-- Migration 722: video ads in the Civilier Security app, shown to residents only.
-- Two kinds: POPUP (plays in a pop-up when a resident opens the app's dashboard, at least 15 seconds or the whole
-- video, whichever is longer) and BANNER (plays in the dashboard's ad space). Uploaded and managed by super admins
-- only (Maintenance → Ads). The video files live on disk (uploads/security-ads); this table holds what they are.
-- Safe to re-run.

IF OBJECT_ID('dbo.SecurityAd', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityAd (
    AdId          INT IDENTITY(1,1) PRIMARY KEY,
    Kind          NVARCHAR(10)    NOT NULL,   -- POPUP | BANNER
    Title         NVARCHAR(120)   NOT NULL,
    FileName      NVARCHAR(100)   NOT NULL,   -- the stored file (random name), never a path from the upload
    OriginalName  NVARCHAR(260)   NULL,
    MimeType      NVARCHAR(50)    NOT NULL,
    SizeBytes     BIGINT          NOT NULL,
    IsActive      BIT             NOT NULL CONSTRAINT DF_SecurityAd_IsActive DEFAULT (1),
    CreatedBy     INT             NULL,
    CreatedAt     DATETIME2(0)    NOT NULL CONSTRAINT DF_SecurityAd_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_SecurityAd_Kind CHECK (Kind IN (N'POPUP', N'BANNER'))
  );
  CREATE INDEX IX_SecurityAd_Active ON dbo.SecurityAd (Kind, IsActive, CreatedAt DESC);
END
GO

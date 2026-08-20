-- Migration 348: Part C of the Blueprint/Photo workflow — before/after
-- site photos per activity, replacing the reporting-context blueprint
-- markup as how a field engineer actually updates a work report.
--
-- Multiple photos per phase are expected (different angles), unlike
-- ActivityBlueprintAnnotation — no uniqueness constraint here. FileData is
-- base64 text (not VARBINARY), same convention as RoomMaster's blueprint
-- (migration 344) and ActivityBlueprintAnnotation — always served through
-- an authenticated JSON endpoint, never a bare <img src> straight to the
-- API (the app's auth is a Bearer token attached only by fetchWithAuth).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ActivityPhoto' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ActivityPhoto (
    Id                          INT IDENTITY(1,1) PRIMARY KEY,
    DependencyMasterActivityId INT NOT NULL,
    Phase                       NVARCHAR(10) NOT NULL
      CONSTRAINT CK_ActivityPhoto_Phase CHECK (Phase IN ('before', 'after')),
    FileName                    NVARCHAR(255) NOT NULL,
    MimeType                    NVARCHAR(100) NOT NULL,
    FileData                    NVARCHAR(MAX) NOT NULL,
    Note                        NVARCHAR(500) NULL,
    CapturedBy                  NVARCHAR(200) NULL,
    CapturedAt                  DATETIME2(3) NOT NULL CONSTRAINT DF_ActivityPhoto_CapturedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_ActivityPhoto_Rung
      FOREIGN KEY (DependencyMasterActivityId) REFERENCES dbo.DependencyMasterActivity(Id) ON DELETE CASCADE
  );
END
GO

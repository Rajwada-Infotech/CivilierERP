-- Migration 616: Script Console (Admin > Script Console, super admin only).
-- A page that runs Node scripts on the server, like `docker compose exec backend node -`, behind a 256-bit vault key.
--   ScriptConsoleKey  one row: the salt and SHA-256 of the vault key. The key itself is never stored.
--   ScriptLibrary     saved scripts. Script and Env are AES-256-GCM encrypted with a key derived from the vault key.
--   ScriptRunLog      every run: who, when, status, exit code; Script / Env / Output encrypted the same way.
-- Safe to run more than once.

IF OBJECT_ID('dbo.ScriptConsoleKey', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ScriptConsoleKey (
    Id         INT           NOT NULL CONSTRAINT PK_ScriptConsoleKey PRIMARY KEY CONSTRAINT CK_ScriptConsoleKey_One CHECK (Id = 1),
    Salt       VARBINARY(16) NOT NULL,
    KeyHash    VARBINARY(32) NOT NULL,
    CreatedBy  NVARCHAR(200) NULL,
    CreatedAt  DATETIME2     NOT NULL CONSTRAINT DF_ScriptConsoleKey_CreatedAt DEFAULT SYSUTCDATETIME(),
    RotatedAt  DATETIME2     NULL
  );
  PRINT 'Migration 616: created ScriptConsoleKey.';
END
GO

IF OBJECT_ID('dbo.ScriptLibrary', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ScriptLibrary (
    Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ScriptLibrary PRIMARY KEY,
    Name        NVARCHAR(200)  NOT NULL,
    Description NVARCHAR(500)  NULL,
    Script      NVARCHAR(MAX)  NOT NULL,
    Env         NVARCHAR(MAX)  NULL,
    CreatedBy   NVARCHAR(200)  NULL,
    CreatedAt   DATETIME2      NOT NULL CONSTRAINT DF_ScriptLibrary_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy   NVARCHAR(200)  NULL,
    UpdatedAt   DATETIME2      NULL,
    CONSTRAINT UQ_ScriptLibrary_Name UNIQUE (Name)
  );
  PRINT 'Migration 616: created ScriptLibrary.';
END
GO

IF OBJECT_ID('dbo.ScriptRunLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ScriptRunLog (
    Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ScriptRunLog PRIMARY KEY,
    RunId       NVARCHAR(40)   NOT NULL,
    UserId      INT            NULL,
    UserEmail   NVARCHAR(200)  NULL,
    Name        NVARCHAR(200)  NULL,
    Script      NVARCHAR(MAX)  NOT NULL,
    Env         NVARCHAR(MAX)  NULL,
    Status      NVARCHAR(20)   NOT NULL,
    ExitCode    INT            NULL,
    StartedAt   DATETIME2      NOT NULL CONSTRAINT DF_ScriptRunLog_StartedAt DEFAULT SYSUTCDATETIME(),
    FinishedAt  DATETIME2      NULL,
    Output      NVARCHAR(MAX)  NULL,
    CONSTRAINT UQ_ScriptRunLog_RunId UNIQUE (RunId)
  );
  CREATE INDEX IX_ScriptRunLog_StartedAt ON dbo.ScriptRunLog (StartedAt DESC);
  PRINT 'Migration 616: created ScriptRunLog.';
END
GO

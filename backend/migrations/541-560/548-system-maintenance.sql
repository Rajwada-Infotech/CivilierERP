-- Migration 548: system maintenance switch.
-- One row (Id = 1). While IsActive = 1 every API call except a super admin's is answered with a 503 carrying
-- the message and the expected end time, and the web app shows the Maintenance page.

IF OBJECT_ID('dbo.SystemMaintenance', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SystemMaintenance (
    Id         INT           NOT NULL CONSTRAINT PK_SystemMaintenance PRIMARY KEY,
    IsActive   BIT           NOT NULL CONSTRAINT DF_SystemMaintenance_IsActive DEFAULT 0,
    Title      NVARCHAR(120) NULL,
    Message    NVARCHAR(500) NULL,
    StartedAt  DATETIME2     NULL,
    EndsAt     DATETIME2     NULL,
    UpdatedBy  NVARCHAR(200) NULL,
    UpdatedAt  DATETIME2     NOT NULL CONSTRAINT DF_SystemMaintenance_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_SystemMaintenance_Single CHECK (Id = 1)
  );
  PRINT 'Migration 548: created dbo.SystemMaintenance.';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.SystemMaintenance WHERE Id = 1)
  INSERT INTO dbo.SystemMaintenance (Id, IsActive) VALUES (1, 0);
GO

-- Migration 716: Security Intercom additions made after 715 had already run on some databases.
-- 715 creates all of this on a database that hadn't run it yet; on one that had, this adds what is missing. Every step
-- checks first, so it is a no-op where 715 already did it. Safe to re-run.
--   SecurityGate.NoResponsePolicy        what the guard does when nobody at the flat answers
--   SecurityVisitorRequest.PassId        let in on a resident's guest pass
--   SecurityAlert.PingAt, Escalated2At   the left-zone check by ping time; the second escalation (super admins / admins)
--   SecurityCallSession.RoomName, GateId the LiveKit room; the gate a resident called
--   SecurityGuestPass                    residents' pre-approved guests
--   PageDefinitions                      security-live, security-geofences; delete on gates / guards / geofences

IF COL_LENGTH('dbo.SecurityGate', 'NoResponsePolicy') IS NULL
  ALTER TABLE dbo.SecurityGate ADD NoResponsePolicy NVARCHAR(12) NOT NULL CONSTRAINT DF_SecurityGate_NoResponsePolicy DEFAULT (N'HOLD');
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_SecurityGate_NoResponsePolicy')
  ALTER TABLE dbo.SecurityGate ADD CONSTRAINT CK_SecurityGate_NoResponsePolicy CHECK (NoResponsePolicy IN (N'HOLD', N'ALLOW', N'CALL_OFFICE'));
GO

IF COL_LENGTH('dbo.SecurityVisitorRequest', 'PassId') IS NULL
  ALTER TABLE dbo.SecurityVisitorRequest ADD PassId INT NULL;
GO

IF COL_LENGTH('dbo.SecurityAlert', 'PingAt') IS NULL
  ALTER TABLE dbo.SecurityAlert ADD PingAt DATETIME2(3) NULL;
GO
IF COL_LENGTH('dbo.SecurityAlert', 'Escalated2At') IS NULL
  ALTER TABLE dbo.SecurityAlert ADD Escalated2At DATETIME2(0) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SecurityAlert_Guard' AND object_id = OBJECT_ID('dbo.SecurityAlert'))
  CREATE INDEX IX_SecurityAlert_Guard ON dbo.SecurityAlert (GuardUserId, Type, RaisedAt DESC);
GO

IF COL_LENGTH('dbo.SecurityCallSession', 'RoomName') IS NULL
  ALTER TABLE dbo.SecurityCallSession ADD RoomName NVARCHAR(64) NULL;
GO
IF COL_LENGTH('dbo.SecurityCallSession', 'GateId') IS NULL
  ALTER TABLE dbo.SecurityCallSession ADD GateId INT NULL;
GO

IF OBJECT_ID('dbo.SecurityGuestPass', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SecurityGuestPass (
    PassId       INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId    INT            NOT NULL,
    Block        NVARCHAR(50)   NOT NULL CONSTRAINT DF_SecurityGuestPass_Block DEFAULT (N''),
    FlatNo       NVARCHAR(50)   NOT NULL,
    CustomerId   INT            NOT NULL,
    GuestName    NVARCHAR(150)  NOT NULL,
    GuestPhone   NVARCHAR(20)   NULL,
    VehicleNo    NVARCHAR(30)   NULL,
    Note         NVARCHAR(200)  NULL,
    Code         CHAR(6)        NOT NULL,
    ValidFrom    DATETIME2(0)   NOT NULL,
    ValidTo      DATETIME2(0)   NOT NULL,
    MaxUses      INT            NOT NULL CONSTRAINT DF_SecurityGuestPass_MaxUses DEFAULT (1),
    Uses         INT            NOT NULL CONSTRAINT DF_SecurityGuestPass_Uses DEFAULT (0),
    CancelledAt  DATETIME2(0)   NULL,
    CreatedAt    DATETIME2(0)   NOT NULL CONSTRAINT DF_SecurityGuestPass_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_SecurityGuestPass_Dates CHECK (ValidTo > ValidFrom),
    CONSTRAINT CK_SecurityGuestPass_Uses CHECK (MaxUses BETWEEN 1 AND 50 AND Uses >= 0)
  );
  CREATE INDEX IX_SecurityGuestPass_Flat ON dbo.SecurityGuestPass (ProjectId, Block, FlatNo, ValidTo);
  CREATE INDEX IX_SecurityGuestPass_Code ON dbo.SecurityGuestPass (ProjectId, Code);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'security-live' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'security-live', N'Security Live', N'Maintenance', N'Maintenance', N'view,edit,export', 249, 1, N'migration-716', SYSDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'security-geofences' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'security-geofences', N'Geofences', N'Maintenance', N'Maintenance', N'view,create,edit,delete', 250, 1, N'migration-716', SYSDATETIME());
UPDATE dbo.PageDefinitions SET Actions = Actions + N',delete'
WHERE PageKey IN (N'security-gates', N'security-guards', N'security-geofences') AND IsActive = 1
  AND (N',' + Actions + N',') NOT LIKE N'%,delete,%';
GO

PRINT 'Migration 716: Security Intercom additions.';
GO

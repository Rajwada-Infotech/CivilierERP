-- Migration 529: phone push-notification registrations for the Expo mobile apps.
-- One row per device token. A token is unique: when a phone is handed to another
-- person and they log in, the same token is re-pointed at the new user instead of
-- the previous user continuing to receive their alerts.
-- Safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PushDeviceToken' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.PushDeviceToken (
    Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    UserId      INT           NOT NULL,
    Token       NVARCHAR(200) NOT NULL,   -- ExponentPushToken[...]
    AppKey      NVARCHAR(50)  NULL,       -- which app: 'finance-material', 'admin', ...
    Platform    NVARCHAR(20)  NULL,       -- 'android' | 'ios'
    CreatedAt   DATETIME2(3)  NOT NULL CONSTRAINT DF_PushDeviceToken_CreatedAt DEFAULT SYSDATETIME(),
    LastSeenAt  DATETIME2(3)  NOT NULL CONSTRAINT DF_PushDeviceToken_LastSeenAt DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_PushDeviceToken_Token UNIQUE (Token)
  );

  -- Every send is "all tokens for these users".
  CREATE INDEX IX_PushDeviceToken_User ON dbo.PushDeviceToken (UserId);
END
GO

PRINT 'Migration 529: dbo.PushDeviceToken.';
GO

-- 584-integration-connections-and-partner-keys.sql
-- Admin → Integrations becomes the one place for Sales Automation's outside connections.
--
--   1. dbo.IntegrationChannels gets credentials: a channel is now a Meta / Google
--      connection (token, refresh token, expiry, developer token / login customer id
--      in SettingsJson) plus the result of its last connection test. Social Media
--      platforms already point at a channel (SaSocialMediaPlatform.ApiConfigId);
--      a platform's own AccessToken stays as a fallback until it is moved to a
--      connection, so nothing stops working on deploy.
--   2. dbo.SaChannelPartnerApiKey — API keys a channel partner's system uses to
--      push leads in (POST /api/public/partner-leads). Only a SHA-256 hash of the
--      key is stored; the key itself is shown once when it is made.
-- Idempotent: every step is guarded.

IF COL_LENGTH('dbo.IntegrationChannels', 'Provider') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD Provider NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'AccessToken') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD AccessToken NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'RefreshToken') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD RefreshToken NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'TokenExpiresAt') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD TokenExpiresAt DATETIME2(3) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'SettingsJson') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD SettingsJson NVARCHAR(MAX) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'LastTestAt') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD LastTestAt DATETIME2(3) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'LastTestOk') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD LastTestOk BIT NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'LastTestMessage') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD LastTestMessage NVARCHAR(500) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaChannelPartnerApiKey' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaChannelPartnerApiKey (
    Id               INT           IDENTITY(1,1) PRIMARY KEY,
    ChannelPartnerId INT           NOT NULL CONSTRAINT FK_SaChannelPartnerApiKey_Partner FOREIGN KEY REFERENCES dbo.SaChannelPartner(Id),
    Label            NVARCHAR(100) NULL,
    KeyPrefix        NVARCHAR(16)  NOT NULL,
    KeyHash          CHAR(64)      NOT NULL CONSTRAINT UQ_SaChannelPartnerApiKey_Hash UNIQUE,
    IsActive         BIT           NOT NULL CONSTRAINT DF_SaChannelPartnerApiKey_IsActive DEFAULT (1),
    LastUsedAt       DATETIME2(3)  NULL,
    LeadsReceived    INT           NOT NULL CONSTRAINT DF_SaChannelPartnerApiKey_Leads DEFAULT (0),
    CreatedBy        INT           NULL,
    CreatedAt        DATETIME2(3)  NOT NULL CONSTRAINT DF_SaChannelPartnerApiKey_CreatedAt DEFAULT (SYSDATETIME()),
    RevokedBy        INT           NULL,
    RevokedAt        DATETIME2(3)  NULL
  );
  CREATE INDEX IX_SaChannelPartnerApiKey_Partner ON dbo.SaChannelPartnerApiKey (ChannelPartnerId);
END
GO

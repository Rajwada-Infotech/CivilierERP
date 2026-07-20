-- Migration: Add API integration fields to SaSocialMediaPlatform
-- Connects social media platforms to their external API credentials
-- Dependencies: dbo.IntegrationChannels (created in migration 028 or earlier)

-- Add API integration columns to SaSocialMediaPlatform
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SaSocialMediaPlatform' AND COLUMN_NAME = 'ApiConfigId')
BEGIN
  ALTER TABLE dbo.SaSocialMediaPlatform
    ADD ApiConfigId INT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SaSocialMediaPlatform' AND COLUMN_NAME = 'AdAccountId')
BEGIN
  ALTER TABLE dbo.SaSocialMediaPlatform
    ADD AdAccountId NVARCHAR(200) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SaSocialMediaPlatform' AND COLUMN_NAME = 'AccessToken')
BEGIN
  ALTER TABLE dbo.SaSocialMediaPlatform
    ADD AccessToken NVARCHAR(MAX) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SaSocialMediaPlatform' AND COLUMN_NAME = 'RefreshToken')
BEGIN
  ALTER TABLE dbo.SaSocialMediaPlatform
    ADD RefreshToken NVARCHAR(MAX) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SaSocialMediaPlatform' AND COLUMN_NAME = 'TokenExpiresAt')
BEGIN
  ALTER TABLE dbo.SaSocialMediaPlatform
    ADD TokenExpiresAt DATETIME2 NULL;
END;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SaSocialMediaPlatform' AND COLUMN_NAME = 'PixelId')
BEGIN
  ALTER TABLE dbo.SaSocialMediaPlatform
    ADD PixelId NVARCHAR(200) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SaSocialMediaPlatform' AND COLUMN_NAME = 'ApiEnabled')
BEGIN
  ALTER TABLE dbo.SaSocialMediaPlatform
    ADD ApiEnabled BIT NOT NULL CONSTRAINT DF_SaSMP_ApiEnabled DEFAULT 0;
END;

-- Foreign key to IntegrationChannels (if table exists)
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'IntegrationChannels')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SaSMP_IntegrationChannels')
  BEGIN
    ALTER TABLE dbo.SaSocialMediaPlatform
      ADD CONSTRAINT FK_SaSMP_IntegrationChannels
        FOREIGN KEY (ApiConfigId) REFERENCES dbo.IntegrationChannels(Id);
  END;
END;

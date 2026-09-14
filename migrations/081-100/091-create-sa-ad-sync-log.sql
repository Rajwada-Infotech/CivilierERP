-- Migration: Create SaAdSyncLog table
-- Tracks every sync attempt between SaAd records and external ad platforms
-- (Google Ads, Meta Ads, LinkedIn Ads, etc.)

IF OBJECT_ID('dbo.SaAdSyncLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SaAdSyncLog (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    SaAdId          INT NOT NULL,
    PlatformId      INT NULL,
    PlatformName    NVARCHAR(100) NOT NULL,
    ExternalAdId    NVARCHAR(200) NULL,
    SyncType        NVARCHAR(30) NOT NULL,         -- 'Import','Export','StatusCheck','MetricsFetch'
    Direction       NVARCHAR(10) NOT NULL DEFAULT 'Import', -- 'Import','Export'
    Status          NVARCHAR(20) NOT NULL DEFAULT 'Pending', -- 'Pending','InProgress','Success','Failed','Partial'

    -- Performance metrics fetched from external platform
    Impressions     BIGINT NULL,
    Clicks          BIGINT NULL,
    Spend           DECIMAL(18, 2) NULL,
    Conversions     INT NULL,
    LeadsGenerated  INT NULL,
    Ctr             DECIMAL(8, 4) NULL,            -- Click-through rate
    Cpc             DECIMAL(18, 4) NULL,           -- Cost per click
    Cpm             DECIMAL(18, 4) NULL,           -- Cost per 1000 impressions
    Reach           BIGINT NULL,
    Frequency       DECIMAL(8, 2) NULL,
    VideoViews      BIGINT NULL,
    PostEngagement  BIGINT NULL,
    CostPerLead     DECIMAL(18, 2) NULL,
    CostPerConversion DECIMAL(18, 2) NULL,
    RevenueGenerated DECIMAL(18, 2) NULL,

    -- Platform-specific raw response (for debugging/audit)
    RawResponse     NVARCHAR(MAX) NULL,
    ErrorMessage    NVARCHAR(MAX) NULL,
    ErrorCode       NVARCHAR(100) NULL,

    -- Sync timing
    SyncStartedAt   DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    SyncEndedAt     DATETIME2 NULL,
    SyncDurationMs  INT NULL,

    -- Audit
    CreatedBy       INT NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT FK_SaAdSyncLog_SaAd
      FOREIGN KEY (SaAdId) REFERENCES dbo.SaAd(Id)
  );

  CREATE INDEX IX_SaAdSyncLog_SaAdId ON dbo.SaAdSyncLog(SaAdId);
  CREATE INDEX IX_SaAdSyncLog_Status ON dbo.SaAdSyncLog(Status);
  CREATE INDEX IX_SaAdSyncLog_SyncStartedAt ON dbo.SaAdSyncLog(SyncStartedAt DESC);
  CREATE INDEX IX_SaAdSyncLog_PlatformName ON dbo.SaAdSyncLog(PlatformName);
  CREATE INDEX IX_SaAdSyncLog_ExternalAdId ON dbo.SaAdSyncLog(ExternalAdId)
    WHERE ExternalAdId IS NOT NULL;
END;

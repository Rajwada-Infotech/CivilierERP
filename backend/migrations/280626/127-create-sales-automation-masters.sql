-- ============================================================
-- 127-create-sales-automation-masters.sql
--
-- Sales Automation module — Phase 1 (masters foundation).
-- Creates the marketing hierarchy:
--   SaSocialMediaPlatform 1──* SaCampaign 1──* SaAd
--
-- Idempotent: each table guarded by IF NOT EXISTS so re-runs are no-ops.
-- ============================================================

-- ── 1. Social Media Platform ────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = ''SaSocialMediaPlatform'' AND schema_id = SCHEMA_ID(''dbo'')
)
BEGIN
  CREATE TABLE dbo.SaSocialMediaPlatform (
    Id              INT            IDENTITY(1,1) PRIMARY KEY,
    Name            NVARCHAR(150)  NOT NULL,
    PlatformType    NVARCHAR(50)   NULL,
    AccountDetails  NVARCHAR(MAX)  NULL,
    Notes           NVARCHAR(MAX)  NULL,
    IsActive        BIT            NOT NULL CONSTRAINT DF_SaSocialMedia_IsActive DEFAULT (1),
    CreatedBy       INT            NULL,
    CreatedAt       DATETIME2(3)   NOT NULL CONSTRAINT DF_SaSocialMedia_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy       INT            NULL,
    UpdatedAt       DATETIME2(3)   NULL
  );

  CREATE INDEX IX_SaSocialMedia_Active
    ON dbo.SaSocialMediaPlatform(IsActive)
    INCLUDE (Name, PlatformType);
END
GO

-- ── 2. Campaign ─────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = ''SaCampaign'' AND schema_id = SCHEMA_ID(''dbo'')
)
BEGIN
  CREATE TABLE dbo.SaCampaign (
    Id                 INT            IDENTITY(1,1) PRIMARY KEY,
    CampaignCode       NVARCHAR(50)   NOT NULL,
    Name               NVARCHAR(200)  NOT NULL,
    Objective          NVARCHAR(MAX)  NULL,
    PlatformId         INT            NOT NULL,
    StartDate          DATE           NULL,
    EndDate            DATE           NULL,
    Budget             DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaCampaign_Budget DEFAULT (0),
    Status             NVARCHAR(20)   NOT NULL CONSTRAINT DF_SaCampaign_Status DEFAULT (''Active''),
    MarketingManagerId INT            NULL,
    IsActive           BIT            NOT NULL CONSTRAINT DF_SaCampaign_IsActive DEFAULT (1),
    CreatedBy          INT            NULL,
    CreatedAt          DATETIME2(3)   NOT NULL CONSTRAINT DF_SaCampaign_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy          INT            NULL,
    UpdatedAt          DATETIME2(3)   NULL,
    CONSTRAINT FK_SaCampaign_Platform FOREIGN KEY (PlatformId)
      REFERENCES dbo.SaSocialMediaPlatform(Id),
    CONSTRAINT UQ_SaCampaign_Code UNIQUE (CampaignCode)
  );

  CREATE INDEX IX_SaCampaign_Platform
    ON dbo.SaCampaign(PlatformId)
    INCLUDE (Name, Status, IsActive);
END
GO

-- ── 3. Ad ───────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = ''SaAd'' AND schema_id = SCHEMA_ID(''dbo'')
)
BEGIN
  CREATE TABLE dbo.SaAd (
    Id            INT            IDENTITY(1,1) PRIMARY KEY,
    CampaignId    INT            NOT NULL,
    Name          NVARCHAR(200)  NOT NULL,
    CreativeRef   NVARCHAR(500)  NULL,
    AdType        NVARCHAR(50)   NULL,
    Budget        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaAd_Budget DEFAULT (0),
    DailySpend    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaAd_DailySpend DEFAULT (0),
    Spent         DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaAd_Spent DEFAULT (0),
    Status        NVARCHAR(20)   NOT NULL CONSTRAINT DF_SaAd_Status DEFAULT (''Active''),
    RunningSince  DATE           NULL,
    IsActive      BIT            NOT NULL CONSTRAINT DF_SaAd_IsActive DEFAULT (1),
    CreatedBy     INT            NULL,
    CreatedAt     DATETIME2(3)   NOT NULL CONSTRAINT DF_SaAd_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy     INT            NULL,
    UpdatedAt     DATETIME2(3)   NULL,
    CONSTRAINT FK_SaAd_Campaign FOREIGN KEY (CampaignId)
      REFERENCES dbo.SaCampaign(Id)
  );

  CREATE INDEX IX_SaAd_Campaign
    ON dbo.SaAd(CampaignId)
    INCLUDE (Name, Status, IsActive);
END
GO

PRINT ''Migration 127: Sales Automation master tables created'';
GO

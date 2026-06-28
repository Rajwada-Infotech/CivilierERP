-- 129-create-sa-lead-tables.sql
-- Creates SaLead (the lead spine) and SaLeadDistribution (allocation audit).
-- Idempotent: guarded by IF NOT EXISTS.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'SaLead' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.SaLead (
    Id                    INT            IDENTITY(1,1) PRIMARY KEY,
    LeadUid               NVARCHAR(50)   NOT NULL CONSTRAINT UQ_SaLead_Uid UNIQUE,
    CustomerName          NVARCHAR(200)  NOT NULL,
    Mobile                NVARCHAR(20)   NOT NULL,
    AltMobile             NVARCHAR(20)   NULL,
    Email                 NVARCHAR(200)  NULL,
    PlatformId            INT            NULL CONSTRAINT FK_SaLead_Platform FOREIGN KEY REFERENCES dbo.SaSocialMediaPlatform(Id),
    CampaignId            INT            NULL CONSTRAINT FK_SaLead_Campaign FOREIGN KEY REFERENCES dbo.SaCampaign(Id),
    AdId                  INT            NULL CONSTRAINT FK_SaLead_Ad FOREIGN KEY REFERENCES dbo.SaAd(Id),
    DateGenerated         DATE           NOT NULL CONSTRAINT DF_SaLead_DateGenerated DEFAULT (CAST(SYSDATETIME() AS DATE)),
    CustomerRemarks       NVARCHAR(MAX)  NULL,
    Status                NVARCHAR(30)   NOT NULL CONSTRAINT DF_SaLead_Status DEFAULT ('New'),
    Classification        NVARCHAR(30)   NULL,
    AssignedTeamLeadId    INT            NULL,
    AssignedSalespersonId INT            NULL,
    FollowupCustomerId    INT            NULL,
    BookingId             INT            NULL,
    IsActive              BIT            NOT NULL CONSTRAINT DF_SaLead_IsActive DEFAULT (1),
    CreatedBy             INT            NULL,
    CreatedAt             DATETIME2(3)   NOT NULL CONSTRAINT DF_SaLead_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy             INT            NULL,
    UpdatedAt             DATETIME2(3)   NULL
  );

  CREATE INDEX IX_SaLead_Status
    ON dbo.SaLead(Status)
    INCLUDE (CustomerName, Mobile, AssignedSalespersonId);

  CREATE INDEX IX_SaLead_Campaign
    ON dbo.SaLead(CampaignId, AdId)
    INCLUDE (Status, DateGenerated);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'SaLeadDistribution' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.SaLeadDistribution (
    Id              INT          IDENTITY(1,1) PRIMARY KEY,
    LeadId          INT          NOT NULL CONSTRAINT FK_SaLeadDist_Lead FOREIGN KEY REFERENCES dbo.SaLead(Id),
    FromUserId      INT          NOT NULL,
    ToUserId        INT          NOT NULL,
    Level           TINYINT      NOT NULL,
    Method          NVARCHAR(20) NOT NULL CONSTRAINT DF_SaLeadDist_Method DEFAULT ('Equal'),
    DistributedAt   DATETIME2(3) NOT NULL CONSTRAINT DF_SaLeadDist_At DEFAULT (SYSDATETIME()),
    DistributedBy   INT          NULL
  );

  CREATE INDEX IX_SaLeadDist_Lead ON dbo.SaLeadDistribution(LeadId);
  CREATE INDEX IX_SaLeadDist_ToUser ON dbo.SaLeadDistribution(ToUserId, Level);
END
GO

PRINT 'Migration 129: SaLead + SaLeadDistribution created';
GO

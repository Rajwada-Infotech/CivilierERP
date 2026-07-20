-- ============================================================
-- Migration 156: CRM Application — deep source chain + automated status
-- Source was a flat free-text/enum field with no link to the real
-- Platform/Campaign/Ad/Channel-Partner chain SaLead already has.
-- Status was a raw manually-editable dropdown with no workflow.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'PlatformId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD PlatformId INT NULL REFERENCES dbo.SaSocialMediaPlatform(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'CampaignId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD CampaignId INT NULL REFERENCES dbo.SaCampaign(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'AdId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD AdId INT NULL REFERENCES dbo.SaAd(Id);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'ChannelPartnerId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD ChannelPartnerId INT NULL REFERENCES dbo.SaChannelPartner(Id);
END
GO

-- Automated status workflow trail (mirrors CrmAgreementApprovalLog)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmApplicationStatusLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmApplicationStatusLog (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    ApplicationId INT NOT NULL REFERENCES dbo.CrmApplication(Id),
    FromStatus    NVARCHAR(30) NULL,
    ToStatus      NVARCHAR(30) NOT NULL,
    -- TriggerSource: Manual / AutoBooking (system-driven transitions get their own marker)
    TriggerSource NVARCHAR(30) NOT NULL DEFAULT 'Manual',
    Remarks       NVARCHAR(MAX) NULL,
    ActorId       INT NULL,
    CreatedAt     DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmApplicationStatusLog';
END
GO

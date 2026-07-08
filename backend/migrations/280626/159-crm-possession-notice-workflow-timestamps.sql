-- ============================================================
-- Migration 159: CrmPossessionNotice sequential workflow timestamps
-- Status (Draft/Sent/Acknowledged/Disputed) was previously a free-form
-- dropdown any editor could set directly. These timestamp columns let the
-- backend derive/validate the transition instead of accepting an arbitrary
-- Status value: Sent requires SentAt, Acknowledged/Disputed require it to
-- follow a Sent notice.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPossessionNotice') AND name = 'SentAt')
BEGIN
  ALTER TABLE dbo.CrmPossessionNotice ADD SentAt DATETIME2(3) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPossessionNotice') AND name = 'AcknowledgedAt')
BEGIN
  ALTER TABLE dbo.CrmPossessionNotice ADD AcknowledgedAt DATETIME2(3) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPossessionNotice') AND name = 'DisputedAt')
BEGIN
  ALTER TABLE dbo.CrmPossessionNotice ADD DisputedAt DATETIME2(3) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPossessionNotice') AND name = 'DisputeReason')
BEGIN
  ALTER TABLE dbo.CrmPossessionNotice ADD DisputeReason NVARCHAR(MAX) NULL;
END
GO

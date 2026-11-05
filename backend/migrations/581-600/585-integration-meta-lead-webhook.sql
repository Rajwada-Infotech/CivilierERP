-- 585-integration-meta-lead-webhook.sql
-- Instant Meta lead-form leads (POST /api/public/integrations/meta-leads/:channelId):
-- each Meta connection records when instant leads were switched on and how the
-- last delivery went, so Admin → Integrations can show it.
-- Idempotent: every step is guarded.

IF COL_LENGTH('dbo.IntegrationChannels', 'WebhookOnAt') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD WebhookOnAt DATETIME2(3) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'LastWebhookAt') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD LastWebhookAt DATETIME2(3) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'LastWebhookOk') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD LastWebhookOk BIT NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'LastWebhookMessage') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD LastWebhookMessage NVARCHAR(500) NULL;
IF COL_LENGTH('dbo.IntegrationChannels', 'WebhookLeads') IS NULL
  ALTER TABLE dbo.IntegrationChannels ADD WebhookLeads INT NOT NULL CONSTRAINT DF_IntegrationChannels_WebhookLeads DEFAULT (0);
GO

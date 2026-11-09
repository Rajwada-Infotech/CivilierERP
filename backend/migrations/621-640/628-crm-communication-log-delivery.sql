-- Migration 628: the columns logCommunication writes (DeliveryStatus, ExternalMessageId) and full-length audit values.
-- These were in migrations/573_crm_audit_communication_columns.js, which the runner never picks up, so the columns did
-- not exist and every action that writes to the Communication Log failed and was rolled back (for example a customer
-- acknowledging a possession notice on the portal). Idempotent.
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmAuditLog' AND COLUMN_NAME = 'OldValue' AND CHARACTER_MAXIMUM_LENGTH <> -1)
  ALTER TABLE dbo.CrmAuditLog ALTER COLUMN OldValue NVARCHAR(MAX) NULL;
GO
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmAuditLog' AND COLUMN_NAME = 'NewValue' AND CHARACTER_MAXIMUM_LENGTH <> -1)
  ALTER TABLE dbo.CrmAuditLog ALTER COLUMN NewValue NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmCommunicationLog' AND COLUMN_NAME = 'DeliveryStatus')
  ALTER TABLE dbo.CrmCommunicationLog ADD DeliveryStatus NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmCommunicationLog' AND COLUMN_NAME = 'ExternalMessageId')
  ALTER TABLE dbo.CrmCommunicationLog ADD ExternalMessageId NVARCHAR(255) NULL;
GO

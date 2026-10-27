"use strict";

/**
 * Migration 573: CRM Audit Log & Communication Log Column Additions
 *
 * 1. Expands CrmAuditLog.OldValue and CrmAuditLog.NewValue from NVARCHAR(4000)
 *    to NVARCHAR(MAX) — audit values for large JSON payloads (e.g. milestone arrays)
 *    were silently truncated at 4000 chars.
 *
 * 2. Adds DeliveryStatus NVARCHAR(50) NULL to CrmCommunicationLog — tracks whether
 *    the SMS/email/WhatsApp message was delivered, bounced, or failed at the
 *    gateway level.
 *
 * 3. Adds ExternalMessageId NVARCHAR(255) NULL to CrmCommunicationLog — the
 *    provider's message ID returned after sending, used to poll delivery status
 *    and correlate webhook callbacks.
 */

const migrationSql = `
-- Expand CrmAuditLog value columns to NVARCHAR(MAX)
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmAuditLog' AND COLUMN_NAME = 'OldValue'
             AND DATA_TYPE = 'nvarchar' AND CHARACTER_MAXIMUM_LENGTH < 2147483647)
BEGIN
  ALTER TABLE dbo.CrmAuditLog ALTER COLUMN OldValue NVARCHAR(MAX) NULL;
END
GO

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmAuditLog' AND COLUMN_NAME = 'NewValue'
             AND DATA_TYPE = 'nvarchar' AND CHARACTER_MAXIMUM_LENGTH < 2147483647)
BEGIN
  ALTER TABLE dbo.CrmAuditLog ALTER COLUMN NewValue NVARCHAR(MAX) NULL;
END
GO

-- Add DeliveryStatus to CrmCommunicationLog (idempotent)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmCommunicationLog' AND COLUMN_NAME = 'DeliveryStatus')
BEGIN
  ALTER TABLE dbo.CrmCommunicationLog ADD DeliveryStatus NVARCHAR(50) NULL;
END
GO

-- Add ExternalMessageId to CrmCommunicationLog (idempotent)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmCommunicationLog' AND COLUMN_NAME = 'ExternalMessageId')
BEGIN
  ALTER TABLE dbo.CrmCommunicationLog ADD ExternalMessageId NVARCHAR(255) NULL;
END
GO
`;

const rollbackSql = `
-- Rollback: Revert CrmAuditLog columns back to NVARCHAR(4000)
-- Note: NVARCHAR(MAX) → NVARCHAR(4000) will truncate existing data > 4000 chars.
-- Only run this rollback if no data has been stored beyond 4000 chars.
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmAuditLog' AND COLUMN_NAME = 'OldValue'
             AND DATA_TYPE = 'nvarchar' AND CHARACTER_MAXIMUM_LENGTH = -1)
BEGIN
  ALTER TABLE dbo.CrmAuditLog ALTER COLUMN OldValue NVARCHAR(4000) NULL;
END
GO

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmAuditLog' AND COLUMN_NAME = 'NewValue'
             AND DATA_TYPE = 'nvarchar' AND CHARACTER_MAXIMUM_LENGTH = -1)
BEGIN
  ALTER TABLE dbo.CrmAuditLog ALTER COLUMN NewValue NVARCHAR(4000) NULL;
END
GO

-- Drop added communication columns
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmCommunicationLog' AND COLUMN_NAME = 'DeliveryStatus')
BEGIN
  ALTER TABLE dbo.CrmCommunicationLog DROP COLUMN DeliveryStatus;
END
GO

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmCommunicationLog' AND COLUMN_NAME = 'ExternalMessageId')
BEGIN
  ALTER TABLE dbo.CrmCommunicationLog DROP COLUMN ExternalMessageId;
END
GO
`;

function executeBatches(pool, sqlText) {
  const batches = sqlText
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);

  return batches.reduce(
    (p, batch) => p.then(() => pool.request().query(batch)),
    Promise.resolve()
  );
}

async function up(params = {}) {
  const context = params.context || params;
  const pool =
    context?.pool ||
    (typeof context?.request === "function" ? context : null) ||
    require("../db").getPool();
  await executeBatches(pool, migrationSql);
}

async function down(params = {}) {
  const context = params.context || params;
  const pool =
    context?.pool ||
    (typeof context?.request === "function" ? context : null) ||
    require("../db").getPool();
  await executeBatches(pool, rollbackSql);
}

module.exports = {
  up,
  down,
  sql: migrationSql,
  rollbackSql,
};

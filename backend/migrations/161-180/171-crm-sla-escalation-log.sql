-- ============================================================
-- Migration 171: Generic CRM SLA escalation log
-- Backs a registry-based SLA engine (backend/services/crmSlaEngine.js) that
-- can cover any CRM entity with a due-date column just by adding a registry
-- entry — no more one-off /escalate-overdue routes per module. This table
-- is the de-duplication record: without it, a scheduled hourly sweep would
-- re-notify the same overdue record every single run.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmSlaEscalationLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmSlaEscalationLog (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    EntityType   NVARCHAR(50)  NOT NULL, -- e.g. 'crm-service-ticket', 'crm-payment-milestone', 'crm-welcome-call'
    EntityId     INT           NOT NULL,
    EscalatedAt  DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmSlaEscalationLog_Entity ON dbo.CrmSlaEscalationLog(EntityType, EntityId, EscalatedAt);
  PRINT 'Created dbo.CrmSlaEscalationLog';
END
GO

PRINT 'Migration 171 complete — CRM SLA escalation log';

IF COL_LENGTH('dbo.tickets', 'escalated_at') IS NULL
  ALTER TABLE dbo.tickets ADD escalated_at DATETIME2 NULL;

IF COL_LENGTH('dbo.tickets', 'escalation_level') IS NULL
  ALTER TABLE dbo.tickets ADD escalation_level INT NOT NULL
    CONSTRAINT DF_tickets_escalation_level DEFAULT (0);

IF COL_LENGTH('dbo.tickets', 'escalation_reason') IS NULL
  ALTER TABLE dbo.tickets ADD escalation_reason NVARCHAR(500) NULL;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_tickets_escalation_open'
    AND object_id = OBJECT_ID('dbo.tickets')
)
  CREATE INDEX IX_tickets_escalation_open
    ON dbo.tickets(status, escalated_at, priority)
    INCLUDE (created_at, updated_at, escalation_level);

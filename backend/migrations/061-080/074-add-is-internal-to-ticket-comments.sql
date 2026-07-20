IF COL_LENGTH('dbo.ticket_comments', 'is_internal') IS NULL
BEGIN
  ALTER TABLE dbo.ticket_comments
  ADD is_internal BIT NOT NULL CONSTRAINT DF_ticket_comments_is_internal DEFAULT (0);
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_ticket_comments_ticket_internal'
    AND object_id = OBJECT_ID('dbo.ticket_comments')
)
BEGIN
  CREATE INDEX IX_ticket_comments_ticket_internal
    ON dbo.ticket_comments(ticket_id, is_internal, created_at);
END;
